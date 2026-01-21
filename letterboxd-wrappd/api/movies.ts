import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { isRedisAvailable, getCached, setCached, CACHE_KEYS, CACHE_DURATION } from './redis.js';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Cache key for Criterion Collection slugs
const CRITERION_CACHE_KEY = 'criterion:slugs';
const CRITERION_CACHE_DURATION = 60 * 60 * 24 * 7; // 7 days
const CRITERION_SLUGS_PATH = join(__dirname, 'criterion-slugs.json');

// Load Criterion Collection film slugs from a bundled JSON file
async function getCriterionSlugs(): Promise<Set<string>> {
  // Check cache first
  const cached = await getCached<string[]>(CRITERION_CACHE_KEY);
  if (cached) {
    console.log('Criterion list loaded from cache:', cached.length, 'films');
    return new Set(cached);
  }

  try {
    const jsonText = readFileSync(CRITERION_SLUGS_PATH, 'utf-8');
    const parsed = JSON.parse(jsonText);
    const slugs = Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : [];

    console.log('Criterion slugs loaded from file:', slugs.length, 'films');

    if (slugs.length > 0) {
      await setCached(CRITERION_CACHE_KEY, slugs, CRITERION_CACHE_DURATION);
    }

    return new Set(slugs);
  } catch (error) {
    console.error('Error loading Criterion Collection slugs:', error);
    return new Set();
  }
}

// Check if a film slug is in the Criterion Collection
function getSlugFromUrl(url: string): string | null {
  const match = url.match(/\/film\/([^/]+)/);
  return match ? match[1] : null;
}

// Simple CSV parser (handles quoted fields)
function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseCSVLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] || '';
    });
    rows.push(row);
  }
  return rows;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

// Resolve Letterboxd shortlink to full URL
async function resolveShortlink(url: string): Promise<string> {
  if (!url.includes('boxd.it')) return url;

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LetterboxdWrappd/1.0)',
      },
    });
    return response.url;
  } catch {
    return url;
  }
}

// Convert user-scoped URL to canonical URL
// e.g., /katswnt/film/network/ -> /film/network/
function toCanonicalUrl(url: string): string {
  // Match pattern: letterboxd.com/<username>/film/<slug>/
  const match = url.match(/letterboxd\.com\/([^/]+)\/film\/([^/]+)/);
  if (match && match[1] !== 'film') {
    // It's a user-scoped URL, convert to canonical
    return `https://letterboxd.com/film/${match[2]}/`;
  }
  return url;
}

type TmdbRef = {
  id: number | null;
  type: 'movie' | 'tv' | null;
  title?: string | null;
  year?: string | null;
};

function extractTitleYearFromHtml(html: string): { title?: string; year?: string } {
  const ogMatch = html.match(/property=["']og:title["']\s+content=["']([^"']+)["']/i);
  const titleTagMatch = html.match(/<title>([^<]+)<\/title>/i);
  const raw = ogMatch?.[1] || titleTagMatch?.[1] || '';
  const cleaned = raw.replace(/\s+—\s+Letterboxd/i, '').trim();
  const yearMatch = cleaned.match(/\((\d{4})\)\s*$/);
  const year = yearMatch ? yearMatch[1] : undefined;
  const title = yearMatch ? cleaned.replace(/\s*\(\d{4}\)\s*$/, '').trim() : cleaned;
  return { title, year };
}

// Extract TMDb ID from Letterboxd page (movie or TV)
async function getTmdbRefFromLetterboxd(url: string): Promise<TmdbRef | null> {
  try {
    // Convert to canonical URL (user-scoped pages don't have TMDb links)
    const canonicalUrl = toCanonicalUrl(url);
    console.log('Fetching Letterboxd page:', canonicalUrl, '(original:', url, ')');
    const response = await fetch(canonicalUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LetterboxdWrappd/1.0)',
        'Accept': 'text/html',
      },
    });
    console.log('Letterboxd response status:', response.status);
    const html = await response.text();
    console.log('Got HTML, length:', html.length);

    // Look for TMDb link in the page (handle both http and https, with or without www)
    const tmdbMovieMatch = html.match(/href=["']https?:\/\/(www\.)?themoviedb\.org\/movie\/(\d+)/);
    if (tmdbMovieMatch) {
      console.log('Found TMDb movie ID:', tmdbMovieMatch[2]);
      const { title, year } = extractTitleYearFromHtml(html);
      return { id: parseInt(tmdbMovieMatch[2], 10), type: 'movie', title, year };
    }

    const tmdbTvMatch = html.match(/href=["']https?:\/\/(www\.)?themoviedb\.org\/tv\/(\d+)/);
    if (tmdbTvMatch) {
      console.log('Found TMDb TV ID:', tmdbTvMatch[2]);
      const { title, year } = extractTitleYearFromHtml(html);
      return { id: parseInt(tmdbTvMatch[2], 10), type: 'tv', title, year };
    }

    // Alternative: look for data attribute
    const dataMatch = html.match(/data-tmdb-id=["'](\d+)["']/);
    if (dataMatch) {
      console.log('Found TMDb ID (data attr):', dataMatch[1]);
      const { title, year } = extractTitleYearFromHtml(html);
      return { id: parseInt(dataMatch[1], 10), type: 'movie', title, year };
    }

    // Log a snippet of HTML around "themoviedb" to help debug
    const tmdbIndex = html.indexOf('themoviedb');
    if (tmdbIndex > -1) {
      console.log('Found themoviedb at index', tmdbIndex, '- snippet:', html.slice(Math.max(0, tmdbIndex - 50), tmdbIndex + 100));
    }

    const { title, year } = extractTitleYearFromHtml(html);
    console.log('No TMDb ID found in page');
    return { id: null, type: null, title, year };
  } catch (e) {
    console.error('Error fetching Letterboxd page:', e);
    return null;
  }
}

async function fetchTmdbDetails(tmdbId: number, apiKey: string, type: 'movie' | 'tv'): Promise<any> {
  const url = `https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${apiKey}`;
  const response = await fetch(url);
  if (!response.ok) return null;
  return response.json();
}

async function fetchTmdbCredits(tmdbId: number, apiKey: string, type: 'movie' | 'tv'): Promise<any> {
  const url = `https://api.themoviedb.org/3/${type}/${tmdbId}/credits?api_key=${apiKey}`;
  const response = await fetch(url);
  if (!response.ok) return null;
  return response.json();
}

async function searchTmdbByTitle(
  title: string,
  year: string | null | undefined,
  apiKey: string
): Promise<{ id: number; type: 'movie' | 'tv' } | null> {
  const query = encodeURIComponent(title);
  const movieUrl = `https://api.themoviedb.org/3/search/movie?api_key=${apiKey}&query=${query}${year ? `&year=${year}` : ''}`;
  const tvUrl = `https://api.themoviedb.org/3/search/tv?api_key=${apiKey}&query=${query}${year ? `&first_air_date_year=${year}` : ''}`;

  const [movieRes, tvRes] = await Promise.all([fetch(movieUrl), fetch(tvUrl)]);
  const movieJson = movieRes.ok ? await movieRes.json() : null;
  const tvJson = tvRes.ok ? await tvRes.json() : null;

  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const target = normalize(title);

  const pickBest = (items: any[], type: 'movie' | 'tv') => {
    let best: any = null;
    let bestScore = -1;
    for (const item of items || []) {
      const itemTitle = type === 'movie' ? item.title : item.name;
      if (!itemTitle) continue;
      const itemNorm = normalize(itemTitle);
      const itemYear = (type === 'movie' ? item.release_date : item.first_air_date)?.slice(0, 4);
      let score = 0;
      if (itemNorm === target) score += 2;
      if (year && itemYear === year) score += 1;
      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    }
    return best ? { id: best.id, type } : null;
  };

  const movieBest = pickBest(movieJson?.results || [], 'movie');
  const tvBest = pickBest(tvJson?.results || [], 'tv');

  if (movieBest && tvBest) {
    if (movieBest.type === 'movie' && tvBest.type === 'tv') {
      // Prefer the one with higher score; if tie, prefer movie.
      const movieYear = (movieJson?.results || []).find((r: any) => r.id === movieBest.id)?.release_date?.slice(0, 4);
      const tvYear = (tvJson?.results || []).find((r: any) => r.id === tvBest.id)?.first_air_date?.slice(0, 4);
      const movieScore = (movieYear && year && movieYear === year ? 1 : 0);
      const tvScore = (tvYear && year && tvYear === year ? 1 : 0);
      return tvScore > movieScore ? tvBest : movieBest;
    }
  }

  return movieBest || tvBest || null;
}

// Concurrency helper for async work
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const current = nextIndex++;
      if (current >= items.length) break;
      results[current] = await worker(items[current]);
    }
  });

  await Promise.all(workers);
  return results;
}

// Gender: 1 = Female, 2 = Male, 0 = Unknown
const FEMALE_GENDER = 1;

// Cache helper functions using ioredis
async function getCachedTmdbData(tmdbId: number, type: 'movie' | 'tv'): Promise<any | null> {
  return getCached(`${CACHE_KEYS.TMDB_DATA}${type}:${tmdbId}`);
}

async function setCachedTmdbData(tmdbId: number, type: 'movie' | 'tv', data: any): Promise<void> {
  await setCached(`${CACHE_KEYS.TMDB_DATA}${type}:${tmdbId}`, data, CACHE_DURATION.TMDB_DATA);
}

async function getCachedLetterboxdMapping(url: string): Promise<any | null> {
  return getCached(`${CACHE_KEYS.LETTERBOXD_MAPPING}${url}`);
}

async function setCachedLetterboxdMapping(url: string, value: any): Promise<void> {
  await setCached(`${CACHE_KEYS.LETTERBOXD_MAPPING}${url}`, value, CACHE_DURATION.LETTERBOXD_MAPPING);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const tmdbApiKey = (req.query.tmdb_api_key as string) || process.env.TMDB_API_KEY;
  const enrich = req.query.enrich === '1';
  const parseOnly = req.query.parse_only === '1';
  // Batch processing: limit how many movies to enrich per request (default 15)
  const batchLimit = parseInt(req.query.limit as string) || 15;

  if (enrich && !parseOnly && !tmdbApiKey) {
    return res.status(400).json({ error: 'TMDb API key required for enrichment' });
  }

  // Check if KV is available
  const redisAvailable = await isRedisAvailable();
  console.log('Redis available:', redisAvailable);

  try {
    // Parse the request body (CSV content or URLs to enrich)
    let csvContent: string | null = null;
    let urlsToEnrich: string[] | null = null;

    // Handle different body formats
    let body = req.body;

    // If body is a string that looks like JSON, parse it
    if (typeof body === 'string') {
      const trimmed = body.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          body = JSON.parse(trimmed);
        } catch {
          // Not JSON, treat as CSV
          csvContent = body;
        }
      } else {
        csvContent = body;
      }
    }

    if (!csvContent) {
      if (body?.file) {
        csvContent = body.file;
      } else if (body?.urls && Array.isArray(body.urls)) {
        // Batch mode: just enrich these specific URLs
        urlsToEnrich = body.urls;
        console.log('Enriching batch of', urlsToEnrich.length, 'URLs');
      } else if (Buffer.isBuffer(body)) {
        csvContent = body.toString('utf-8');
      } else if (typeof body === 'object' && body !== null) {
        // Check if it's already parsed JSON with urls
        if (body.urls && Array.isArray(body.urls)) {
          urlsToEnrich = body.urls;
          console.log('Enriching batch of', urlsToEnrich.length, 'URLs (parsed object)');
        } else {
          return res.status(400).json({ error: 'No CSV content or URLs provided', bodyType: typeof body });
        }
      } else {
        return res.status(400).json({ error: 'No CSV content or URLs provided', bodyType: typeof body });
      }
    }

    // Build movie index
    const movieIndex: Record<string, any> = {};
    const uriMap: Record<string, string> = {};
    let totalRows = 0;

    if (csvContent) {
      const rows = parseCSV(csvContent);
      if (rows.length === 0) {
        return res.status(400).json({ error: 'No data in CSV' });
      }
      totalRows = rows.length;

      // Get unique URIs
      const uriColumn = 'Letterboxd URI';
      const uniqueUris = [...new Set(rows.map(r => r[uriColumn]).filter(Boolean))];

      // Phase 1: Resolve shortlinks (limited concurrency)
      const resolvedPairs = await mapWithConcurrency(uniqueUris, 6, async (uri) => {
        const resolved = await resolveShortlink(uri);
        return [uri, resolved] as const;
      });

      for (const [uri, resolved] of resolvedPairs) {
        uriMap[uri] = resolved;
        if (!movieIndex[resolved]) {
          movieIndex[resolved] = {
            letterboxd_url: resolved,
          };
        }
      }

      // If parse_only, return early with just the uriMap and URLs
      if (parseOnly) {
        const allUrls = Object.keys(movieIndex);
        return res.status(200).json({
          uriMap,
          urls: allUrls,
          stats: {
            totalRows,
            uniqueFilms: allUrls.length,
            parseOnly: true,
          },
        });
      }
    } else if (urlsToEnrich) {
      // Batch mode: create index from provided URLs
      for (const url of urlsToEnrich) {
        movieIndex[url] = { letterboxd_url: url };
      }
    }

    // Stats for response
    let cacheHits = 0;
    let cacheMisses = 0;
    let processed = 0;
    let networkFetches = 0;

    // Phase 2 & 3: Get TMDb IDs and details
    console.log('Enrich check:', { enrich, parseOnly, urlsToEnrichLen: urlsToEnrich?.length, movieIndexLen: Object.keys(movieIndex).length });
    if (enrich && !parseOnly) {
      // Fetch Criterion Collection list for checking
      const criterionSlugs = await getCriterionSlugs();

      // When urlsToEnrich is provided, process all of them (frontend controls batch size)
      // When CSV is provided, limit to batchLimit
      const movieUrls = Object.keys(movieIndex);
      const urlsToProcess = urlsToEnrich ? movieUrls : movieUrls.slice(0, batchLimit);
      console.log('Processing', urlsToProcess.length, 'URLs for enrichment');

      const concurrencyLimit = 4;
      await mapWithConcurrency(urlsToProcess, concurrencyLimit, async (resolved) => {
        console.log('Processing URL:', resolved);
        // Phase 2: Get TMDb ID
        if (!movieIndex[resolved].tmdb_movie_id) {
          // Check cache for Letterboxd -> TMDb ID mapping
          if (redisAvailable) {
            const cached = await getCachedLetterboxdMapping(resolved);
            console.log('Cache lookup for', resolved, ':', cached);
            if (cached) {
              if (typeof cached === 'number') {
                movieIndex[resolved].tmdb_movie_id = cached;
                movieIndex[resolved].tmdb_type = 'movie';
              } else if (typeof cached === 'object' && cached.id) {
                movieIndex[resolved].tmdb_movie_id = cached.id;
                movieIndex[resolved].tmdb_type = cached.type || 'movie';
              }
              cacheHits++;
            }
          }

          // Fetch from Letterboxd if not cached
          if (!movieIndex[resolved].tmdb_movie_id) {
            console.log('Fetching TMDb ID from Letterboxd for:', resolved);
            const tmdbRef = await getTmdbRefFromLetterboxd(resolved);
            console.log('TMDb ref result:', tmdbRef);
            if (tmdbRef?.id) {
              movieIndex[resolved].tmdb_movie_id = tmdbRef.id;
              movieIndex[resolved].tmdb_type = tmdbRef.type || 'movie';
              networkFetches++;

              // Cache the mapping
              if (redisAvailable) {
                await setCachedLetterboxdMapping(resolved, { id: tmdbRef.id, type: tmdbRef.type || 'movie' });
              }
            } else if (tmdbRef?.title) {
              // Fallback: search TMDb by title/year
              const fallback = await searchTmdbByTitle(tmdbRef.title, tmdbRef.year, tmdbApiKey!);
              if (fallback) {
                movieIndex[resolved].tmdb_movie_id = fallback.id;
                movieIndex[resolved].tmdb_type = fallback.type;
                networkFetches++;
                if (redisAvailable) {
                  await setCachedLetterboxdMapping(resolved, { id: fallback.id, type: fallback.type });
                }
              } else {
                movieIndex[resolved].tmdb_error = 'No TMDb ID found on Letterboxd page';
                cacheMisses++;
              }
            } else {
              // Track that we couldn't find a TMDb ID
              movieIndex[resolved].tmdb_error = 'No TMDb ID found on Letterboxd page';
              cacheMisses++;
            }
          }
        }

        // Phase 3: Get TMDb details
        const tmdbId = movieIndex[resolved].tmdb_movie_id;
        const tmdbType = (movieIndex[resolved].tmdb_type || 'movie') as 'movie' | 'tv';
        if (tmdbId && !movieIndex[resolved].tmdb_data) {
          // Check if in Criterion Collection
          const slug = getSlugFromUrl(resolved);
          movieIndex[resolved].is_in_criterion_collection = slug ? criterionSlugs.has(slug) : false;

          // Check cache for TMDb data
          if (redisAvailable) {
            const cachedData = await getCachedTmdbData(tmdbId, tmdbType);
            if (cachedData) {
              movieIndex[resolved].tmdb_data = cachedData;
              cacheHits++;
              processed++;
              return;
            }
          }

          // Fetch from TMDb API
          try {
            let details = await fetchTmdbDetails(tmdbId, tmdbApiKey!, tmdbType);
            let credits = await fetchTmdbCredits(tmdbId, tmdbApiKey!, tmdbType);
            let usedType = tmdbType;

            if (!details && tmdbType === 'movie') {
              const tvDetails = await fetchTmdbDetails(tmdbId, tmdbApiKey!, 'tv');
              const tvCredits = await fetchTmdbCredits(tmdbId, tmdbApiKey!, 'tv');
              if (tvDetails) {
                details = tvDetails;
                credits = tvCredits;
                usedType = 'tv';
                movieIndex[resolved].tmdb_type = 'tv';
              }
            } else if (!details && tmdbType === 'tv') {
              const movieDetails = await fetchTmdbDetails(tmdbId, tmdbApiKey!, 'movie');
              const movieCredits = await fetchTmdbCredits(tmdbId, tmdbApiKey!, 'movie');
              if (movieDetails) {
                details = movieDetails;
                credits = movieCredits;
                usedType = 'movie';
                movieIndex[resolved].tmdb_type = 'movie';
              }
            }

            if (details) {
              const productionCountries = details.production_countries || [];
              const originCountries = details.origin_country || [];
              const countryCodes = productionCountries.length
                ? productionCountries.map((c: any) => c.iso_3166_1)
                : originCountries;
              const countryNames = productionCountries.length
                ? productionCountries.map((c: any) => c.name)
                : [];

              const spokenLanguages = details.spoken_languages || [];
              const languageCodes = spokenLanguages.map((l: any) => l.iso_639_1);
              const languageNames = spokenLanguages.map((l: any) => l.name);

              const originalLanguage = details.original_language || '';
              const isAmerican = countryCodes.includes('US');
              const isEnglish = originalLanguage === 'en';

              // Process credits
              const crew = credits?.crew || [];
              const directors = crew
                .filter((p: any) => p.job === 'Director')
                .map((p: any) => ({ name: p.name, gender: p.gender }));

              const writerJobs = ['Writer', 'Screenplay', 'Story', 'Characters'];
              const writers = crew
                .filter((p: any) => writerJobs.includes(p.job))
                .map((p: any) => ({ name: p.name, job: p.job, gender: p.gender }));

              const directedByWoman = directors.some((d: any) => d.gender === FEMALE_GENDER);
              const writtenByWoman = writers.some((w: any) => w.gender === FEMALE_GENDER);

              const runtime = usedType === 'tv'
                ? (Array.isArray(details.episode_run_time) ? details.episode_run_time[0] : null)
                : details.runtime;

              const tmdbData = {
                title: usedType === 'tv' ? details.name : details.title,
                original_title: usedType === 'tv' ? details.original_name : details.original_title,
                original_language: originalLanguage,
                release_date: usedType === 'tv' ? details.first_air_date : details.release_date,
                overview: details.overview,
                runtime,
                genres: (details.genres || []).map((g: any) => g.name),
                popularity: details.popularity,
                vote_average: details.vote_average,
                vote_count: details.vote_count,
                poster_path: details.poster_path,
                backdrop_path: details.backdrop_path,
                production_countries: { codes: countryCodes, names: countryNames },
                is_american: isAmerican,
                spoken_languages: { codes: languageCodes, names: languageNames },
                is_english: isEnglish,
                directors,
                writers,
                directed_by_woman: directedByWoman,
                written_by_woman: writtenByWoman,
              };

              movieIndex[resolved].tmdb_data = tmdbData;
              networkFetches++;
              cacheMisses++;

              // Cache the TMDb data
              if (redisAvailable) {
                await setCachedTmdbData(tmdbId, usedType, tmdbData);
              }
            } else {
              movieIndex[resolved].tmdb_api_error = 'TMDb API returned no details';
            }
          } catch (e) {
            console.error(`Error fetching TMDb data for ${tmdbId}:`, e);
            movieIndex[resolved].tmdb_api_error = `TMDb API error: ${e instanceof Error ? e.message : String(e)}`;
          }
        } else if (!tmdbId) {
          // No TMDb ID means we couldn't enrich this movie
          if (!movieIndex[resolved].tmdb_error) {
            movieIndex[resolved].tmdb_error = 'No TMDb ID available';
          }
        }

        processed++;
      });
    }

    const totalMovies = Object.keys(movieIndex).length;
    const withTmdbData = Object.values(movieIndex).filter((m: any) => m.tmdb_data).length;
    const withErrors = Object.values(movieIndex).filter((m: any) => m.tmdb_error || m.tmdb_api_error).length;

    return res.status(200).json({
      movieIndex,
      uriMap,
      stats: {
        totalRows,
        uniqueFilms: totalMovies,
        enriched: enrich,
        withTmdbData,
        withErrors,
        cacheHits,
        cacheMisses,
        redisAvailable,
        processed,
        networkFetches,
      },
    });
  } catch (error) {
    console.error('Error processing movies:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
