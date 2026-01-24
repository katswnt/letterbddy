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
const BLACK_DIRECTORS_CACHE_KEY = 'black_directors:slugs';
const BLACK_DIRECTORS_CACHE_DURATION = 60 * 60 * 24 * 7; // 7 days
const BLACK_DIRECTORS_LIST_PATH = join(__dirname, 'black-directors.csv');

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

// Load Black directors list slugs from a bundled CSV file
async function getBlackDirectorSlugs(): Promise<Set<string>> {
  const cached = await getCached<string[]>(BLACK_DIRECTORS_CACHE_KEY);
  if (cached) {
    console.log('Black directors list loaded from cache:', cached.length, 'films');
    return new Set(cached);
  }

  try {
    const csvText = readFileSync(BLACK_DIRECTORS_LIST_PATH, 'utf-8');
    const rows = parseCSV(csvText);
    const slugs = rows
      .map((row) => row['Letterboxd URI'] || row['letterboxd_uri'] || row['URL'] || row['Url'] || row['Link'] || '')
      .map((url) => (url ? getSlugFromUrl(url) : null))
      .filter((slug): slug is string => Boolean(slug));

    const unique = Array.from(new Set(slugs));
    console.log('Black directors slugs loaded from file:', unique.length, 'films');

    if (unique.length > 0) {
      await setCached(BLACK_DIRECTORS_CACHE_KEY, unique, BLACK_DIRECTORS_CACHE_DURATION);
    }

    return new Set(unique);
  } catch (error) {
    console.error('Error loading Black directors list:', error);
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
  type: 'movie' | null;
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
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });
    console.log('Letterboxd response status:', response.status);
    const html = await response.text();
    console.log('Got HTML, length:', html.length);

    // Detect Cloudflare challenge page - DO NOT use this data
    if (html.includes('Just a moment') || html.includes('cf-browser-verification') || html.includes('challenge-platform')) {
      console.log('Cloudflare challenge detected, cannot scrape:', canonicalUrl);
      return null;
    }

    // Look for TMDb link in the page (handle both http and https, with or without www)
    const tmdbMovieMatch = html.match(/href=["']https?:\/\/(www\.)?themoviedb\.org\/movie\/(\d+)/);
    if (tmdbMovieMatch) {
      console.log('Found TMDb movie ID:', tmdbMovieMatch[2]);
      const { title, year } = extractTitleYearFromHtml(html);
      return { id: parseInt(tmdbMovieMatch[2], 10), type: 'movie', title, year };
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

async function fetchTmdbDetails(tmdbId: number, apiKey: string): Promise<any> {
  const url = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${apiKey}`;
  const response = await fetch(url);
  if (!response.ok) return null;
  return response.json();
}

async function fetchTmdbCredits(tmdbId: number, apiKey: string): Promise<any> {
  const url = `https://api.themoviedb.org/3/movie/${tmdbId}/credits?api_key=${apiKey}`;
  const response = await fetch(url);
  if (!response.ok) return null;
  return response.json();
}

async function searchTmdbByTitle(
  title: string,
  year: string | null | undefined,
  apiKey: string
): Promise<{ id: number; type: 'movie' } | null> {
  const query = encodeURIComponent(title);
  const movieUrl = `https://api.themoviedb.org/3/search/movie?api_key=${apiKey}&query=${query}${year ? `&year=${year}` : ''}`;

  const [movieRes] = await Promise.all([fetch(movieUrl)]);
  const movieJson = movieRes.ok ? await movieRes.json() : null;

  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const target = normalize(title);

  // STRICT MATCHING: Only return results with high confidence
  // Score >= 2 means exact title match (required)
  // Score >= 3 means exact title + year match (ideal)
  const MIN_SCORE = 2; // Require at least exact title match

  const pickBest = (items: any[], type: 'movie') => {
    let best: any = null;
    let bestScore = -1;
    for (const item of items || []) {
      const itemTitle = item.title;
      if (!itemTitle) continue;
      const itemNorm = normalize(itemTitle);
      const itemYear = item.release_date?.slice(0, 4);
      let score = 0;
      if (itemNorm === target) score += 2;
      if (year && itemYear === year) score += 1;
      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    }
    // Only return if we have a strong match (at least exact title)
    if (bestScore >= MIN_SCORE) {
      console.log(`TMDb search: "${title}" (${year}) -> matched "${best.title}" (${best.release_date?.slice(0,4)}) score=${bestScore}`);
      return { id: best.id, type };
    }
    console.log(`TMDb search: "${title}" (${year}) -> no strong match found (best score=${bestScore})`);
    return null;
  };

  const movieBest = pickBest(movieJson?.results || [], 'movie');
  return movieBest || null;
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
async function getCachedTmdbData(tmdbId: number): Promise<any | null> {
  return getCached(`${CACHE_KEYS.TMDB_DATA}${tmdbId}`);
}

async function setCachedTmdbData(tmdbId: number, data: any): Promise<void> {
  await setCached(`${CACHE_KEYS.TMDB_DATA}${tmdbId}`, data, CACHE_DURATION.TMDB_DATA);
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

      // Get unique URIs and their associated Name/Year from CSV
      const uriColumn = 'Letterboxd URI';
      const nameColumn = 'Name';
      const yearColumn = 'Year';

      // Build a map from URI to the row data (for Name/Year)
      const uriToRowData: Record<string, { name?: string; year?: string }> = {};
      for (const row of rows) {
        const uri = row[uriColumn];
        if (uri && !uriToRowData[uri]) {
          uriToRowData[uri] = {
            name: row[nameColumn] || undefined,
            year: row[yearColumn] || undefined,
          };
        }
      }

      const uniqueUris = Object.keys(uriToRowData);

      // Phase 1: Resolve shortlinks (limited concurrency)
      const resolvedPairs = await mapWithConcurrency(uniqueUris, 6, async (uri) => {
        const resolved = await resolveShortlink(uri);
        return [uri, resolved] as const;
      });

      for (const [uri, resolved] of resolvedPairs) {
        uriMap[uri] = resolved;
        if (!movieIndex[resolved]) {
          const rowData = uriToRowData[uri];
          movieIndex[resolved] = {
            letterboxd_url: resolved,
            // Include name/year from CSV for TMDb search fallback
            csv_name: rowData?.name,
            csv_year: rowData?.year,
          };
        }
      }

      // If parse_only, return early with the movieIndex (includes csv_name/csv_year)
      if (parseOnly) {
        const allUrls = Object.keys(movieIndex);
        return res.status(200).json({
          uriMap,
          urls: allUrls,
          movieIndex, // Include full index with csv_name/csv_year for batch enrichment
          stats: {
            totalRows,
            uniqueFilms: allUrls.length,
            parseOnly: true,
          },
        });
      }
    } else if (urlsToEnrich) {
      // Batch mode: create index from provided URLs (may include name/year from frontend)
      const filmsData = body?.films as Record<string, { name?: string; year?: string }> | undefined;
      for (const url of urlsToEnrich) {
        const filmData = filmsData?.[url];
        movieIndex[url] = {
          letterboxd_url: url,
          csv_name: filmData?.name,
          csv_year: filmData?.year,
        };
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
      const blackDirectorSlugs = await getBlackDirectorSlugs();

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
              } else if (typeof cached === 'object' && cached.id) {
                movieIndex[resolved].tmdb_movie_id = cached.id;
              }
              cacheHits++;
            }
          }

          // If not cached, search TMDb directly using CSV name/year
          // (Skip Letterboxd scraping - Cloudflare blocks it)
          if (!movieIndex[resolved].tmdb_movie_id) {
            const csvName = movieIndex[resolved].csv_name;
            const csvYear = movieIndex[resolved].csv_year;

            if (csvName) {
              console.log(`Searching TMDb for: "${csvName}" (${csvYear || 'no year'})`);
              const searchResult = await searchTmdbByTitle(csvName, csvYear, tmdbApiKey!);

              if (searchResult) {
                movieIndex[resolved].tmdb_movie_id = searchResult.id;
                movieIndex[resolved].tmdb_source = 'csv_title_search';
                networkFetches++;

                // Cache the mapping
                if (redisAvailable) {
                  await setCachedLetterboxdMapping(resolved, searchResult.id);
                }
              } else {
                movieIndex[resolved].tmdb_error = `No strong TMDb match for "${csvName}" (${csvYear || 'no year'})`;
                cacheMisses++;
              }
            } else {
              // No CSV name available, try Letterboxd as last resort
              console.log('No CSV name, trying Letterboxd for:', resolved);
              const tmdbRef = await getTmdbRefFromLetterboxd(resolved);

              if (tmdbRef?.id) {
                movieIndex[resolved].tmdb_movie_id = tmdbRef.id;
                networkFetches++;
                if (redisAvailable) {
                  await setCachedLetterboxdMapping(resolved, tmdbRef.id);
                }
              } else if (tmdbRef?.title) {
                const fallback = await searchTmdbByTitle(tmdbRef.title, tmdbRef.year, tmdbApiKey!);
                if (fallback) {
                  movieIndex[resolved].tmdb_movie_id = fallback.id;
                  movieIndex[resolved].tmdb_source = 'letterboxd_fallback';
                  networkFetches++;
                  if (redisAvailable) {
                    await setCachedLetterboxdMapping(resolved, fallback.id);
                  }
                } else {
                  movieIndex[resolved].tmdb_error = `No TMDb match found`;
                  cacheMisses++;
                }
              } else {
                movieIndex[resolved].tmdb_error = 'No title available for TMDb search';
                cacheMisses++;
              }
            }
          }
        }

        // Phase 3: Get TMDb details
        const tmdbId = movieIndex[resolved].tmdb_movie_id;
        if (tmdbId && !movieIndex[resolved].tmdb_data) {
          // Check if in Criterion Collection
          const slug = getSlugFromUrl(resolved);
          movieIndex[resolved].is_in_criterion_collection = slug ? criterionSlugs.has(slug) : false;
          movieIndex[resolved].is_by_black_director = slug ? blackDirectorSlugs.has(slug) : false;

          // Check cache for TMDb data
          if (redisAvailable) {
            const cachedData = await getCachedTmdbData(tmdbId);
            if (cachedData && "directed_by_woman" in cachedData) {
              movieIndex[resolved].tmdb_data = cachedData;
              cacheHits++;
              processed++;
              return;
            }
          }

          // Fetch from TMDb API
          try {
            const details = await fetchTmdbDetails(tmdbId, tmdbApiKey!);
            const credits = await fetchTmdbCredits(tmdbId, tmdbApiKey!);

            if (details) {
              // Validate: reject likely wrong matches (very short runtime from fallback search)
              const runtime = details.runtime;
              const wasFromFallback = movieIndex[resolved].tmdb_source === 'fallback_search';
              if (wasFromFallback && typeof runtime === 'number' && runtime < 40) {
                console.log(`Rejecting fallback match for ${resolved}: runtime ${runtime}min is too short`);
                movieIndex[resolved].tmdb_error = `Fallback match rejected: ${runtime}min runtime too short`;
                delete movieIndex[resolved].tmdb_movie_id;
                delete movieIndex[resolved].tmdb_source;
                processed++;
                return;
              }

              const productionCountries = details.production_countries || [];
              const countryCodes = productionCountries.map((c: any) => c.iso_3166_1);
              const countryNames = productionCountries.map((c: any) => c.name);

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
                .map((p: any) => ({ name: p.name, gender: p.gender, profile_path: p.profile_path }));

              const writerJobs = ['Writer', 'Screenplay', 'Story', 'Characters'];
              const writers = crew
                .filter((p: any) => writerJobs.includes(p.job))
                .map((p: any) => ({ name: p.name, job: p.job, gender: p.gender, profile_path: p.profile_path }));

              const directedByWoman = directors.some((d: any) => d.gender === FEMALE_GENDER);
              const writtenByWoman = writers.some((w: any) => w.gender === FEMALE_GENDER);

              const tmdbData = {
                title: details.title,
                original_title: details.original_title,
                original_language: originalLanguage,
                release_date: details.release_date,
                overview: details.overview,
                runtime: details.runtime,
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
                await setCachedTmdbData(tmdbId, tmdbData);
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
