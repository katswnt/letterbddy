import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isRedisAvailable, getCached, setCached, CACHE_KEYS, CACHE_DURATION } from './redis.js';
import { readFileSync } from 'fs';
import { join } from 'path';

// Cache key for Criterion Collection slugs
const CRITERION_CACHE_KEY = 'criterion:slugs';
const CRITERION_CACHE_DURATION = 60 * 60 * 24 * 30; // 30 days

// Load and parse Criterion Collection CSV, resolve shortlinks, return slugs
async function getCriterionSlugs(): Promise<Set<string>> {
  // Check cache first
  const cached = await getCached<string[]>(CRITERION_CACHE_KEY);
  if (cached && cached.length > 0) {
    console.log('Criterion list loaded from cache:', cached.length, 'films');
    return new Set(cached);
  }

  console.log('Loading Criterion Collection from CSV...');
  const slugs: string[] = [];

  try {
    // Read the CSV file
    const csvPath = join(__dirname, 'criterion-collection.csv');
    const csvContent = readFileSync(csvPath, 'utf-8');
    const lines = csvContent.split(/\r?\n/);

    // Find the data section (after "Position,Name,Year,URL,Description")
    let dataStartIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('Position,Name,Year,URL')) {
        dataStartIndex = i + 1;
        break;
      }
    }

    if (dataStartIndex === -1) {
      console.error('Could not find data section in Criterion CSV');
      return new Set();
    }

    // Extract URLs from data rows
    const shortlinks: string[] = [];
    for (let i = dataStartIndex; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Parse CSV line (Position,Name,Year,URL,Description)
      const parts = parseCSVLine(line);
      if (parts.length >= 4 && parts[3]) {
        shortlinks.push(parts[3]);
      }
    }

    console.log('Found', shortlinks.length, 'Criterion films in CSV');

    // Resolve shortlinks to get slugs (batch with rate limiting)
    for (let i = 0; i < shortlinks.length; i++) {
      const shortlink = shortlinks[i];
      try {
        const resolved = await resolveShortlink(shortlink);
        const slug = getSlugFromUrl(resolved);
        if (slug) {
          slugs.push(slug);
        }

        // Log progress every 100 films
        if ((i + 1) % 100 === 0) {
          console.log(`Resolved ${i + 1}/${shortlinks.length} Criterion shortlinks`);
        }

        // Small delay to avoid rate limiting
        if (i < shortlinks.length - 1) {
          await new Promise(r => setTimeout(r, 20));
        }
      } catch (e) {
        console.error('Error resolving shortlink:', shortlink, e);
      }
    }

    console.log('Criterion Collection resolved:', slugs.length, 'slugs');

    // Cache the slugs
    if (slugs.length > 0) {
      await setCached(CRITERION_CACHE_KEY, slugs, CRITERION_CACHE_DURATION);
    }

    return new Set(slugs);
  } catch (error) {
    console.error('Error loading Criterion Collection:', error);
    return new Set();
  }
}

// Extract film slug from URL
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

// Extract TMDb ID from Letterboxd page
async function getTmdbIdFromLetterboxd(url: string): Promise<number | null> {
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
    const tmdbMatch = html.match(/href=["']https?:\/\/(www\.)?themoviedb\.org\/movie\/(\d+)/);
    if (tmdbMatch) {
      console.log('Found TMDb ID:', tmdbMatch[2]);
      return parseInt(tmdbMatch[2], 10);
    }

    // Alternative: look for data attribute
    const dataMatch = html.match(/data-tmdb-id=["'](\d+)["']/);
    if (dataMatch) {
      console.log('Found TMDb ID (data attr):', dataMatch[1]);
      return parseInt(dataMatch[1], 10);
    }

    // Log a snippet of HTML around "themoviedb" to help debug
    const tmdbIndex = html.indexOf('themoviedb');
    if (tmdbIndex > -1) {
      console.log('Found themoviedb at index', tmdbIndex, '- snippet:', html.slice(Math.max(0, tmdbIndex - 50), tmdbIndex + 100));
    }

    console.log('No TMDb ID found in page');
    return null;
  } catch (e) {
    console.error('Error fetching Letterboxd page:', e);
    return null;
  }
}

// Fetch TMDb movie details
async function fetchTmdbDetails(tmdbId: number, apiKey: string): Promise<any> {
  const url = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${apiKey}`;
  const response = await fetch(url);
  if (!response.ok) return null;
  return response.json();
}

// Fetch TMDb movie credits
async function fetchTmdbCredits(tmdbId: number, apiKey: string): Promise<any> {
  const url = `https://api.themoviedb.org/3/movie/${tmdbId}/credits?api_key=${apiKey}`;
  const response = await fetch(url);
  if (!response.ok) return null;
  return response.json();
}

// Sleep helper for rate limiting
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Gender: 1 = Female, 2 = Male, 0 = Unknown
const FEMALE_GENDER = 1;

// Cache helper functions using ioredis
async function getCachedTmdbData(tmdbId: number): Promise<any | null> {
  return getCached(`${CACHE_KEYS.TMDB_DATA}${tmdbId}`);
}

async function setCachedTmdbData(tmdbId: number, data: any): Promise<void> {
  await setCached(`${CACHE_KEYS.TMDB_DATA}${tmdbId}`, data, CACHE_DURATION.TMDB_DATA);
}

async function getCachedLetterboxdMapping(url: string): Promise<number | null> {
  return getCached(`${CACHE_KEYS.LETTERBOXD_MAPPING}${url}`);
}

async function setCachedLetterboxdMapping(url: string, tmdbId: number): Promise<void> {
  await setCached(`${CACHE_KEYS.LETTERBOXD_MAPPING}${url}`, tmdbId, CACHE_DURATION.LETTERBOXD_MAPPING);
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

      // Phase 1: Resolve shortlinks
      for (const uri of uniqueUris) {
        const resolved = await resolveShortlink(uri);
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

      for (const resolved of urlsToProcess) {
        console.log('Processing URL:', resolved);
        // Phase 2: Get TMDb ID
        if (!movieIndex[resolved].tmdb_movie_id) {
          // Check cache for Letterboxd -> TMDb ID mapping
          if (redisAvailable) {
            const cachedId = await getCachedLetterboxdMapping(resolved);
            console.log('Cache lookup for', resolved, ':', cachedId);
            if (cachedId) {
              movieIndex[resolved].tmdb_movie_id = cachedId;
              cacheHits++;
            }
          }

          // Fetch from Letterboxd if not cached
          if (!movieIndex[resolved].tmdb_movie_id) {
            console.log('Fetching TMDb ID from Letterboxd for:', resolved);
            const tmdbId = await getTmdbIdFromLetterboxd(resolved);
            console.log('TMDb ID result:', tmdbId);
            if (tmdbId) {
              movieIndex[resolved].tmdb_movie_id = tmdbId;
              networkFetches++;

              // Cache the mapping
              if (redisAvailable) {
                await setCachedLetterboxdMapping(resolved, tmdbId);
              }
            }
            await sleep(50); // Reduced rate limit
          }
        }

        // Phase 3: Get TMDb details
        const tmdbId = movieIndex[resolved].tmdb_movie_id;
        if (tmdbId && !movieIndex[resolved].tmdb_data) {
          // Check if in Criterion Collection
          const slug = getSlugFromUrl(resolved);
          movieIndex[resolved].is_in_criterion_collection = slug ? criterionSlugs.has(slug) : false;

          // Check cache for TMDb data
          if (redisAvailable) {
            const cachedData = await getCachedTmdbData(tmdbId);
            if (cachedData) {
              movieIndex[resolved].tmdb_data = cachedData;
              cacheHits++;
              processed++;
              continue;
            }
          }

          // Fetch from TMDb API
          try {
            const [details, credits] = await Promise.all([
              fetchTmdbDetails(tmdbId, tmdbApiKey!),
              fetchTmdbCredits(tmdbId, tmdbApiKey!),
            ]);

            if (details) {
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
                .map((p: any) => ({ name: p.name, gender: p.gender }));

              const writerJobs = ['Writer', 'Screenplay', 'Story', 'Characters'];
              const writers = crew
                .filter((p: any) => writerJobs.includes(p.job))
                .map((p: any) => ({ name: p.name, job: p.job, gender: p.gender }));

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
            }
          } catch (e) {
            console.error(`Error fetching TMDb data for ${tmdbId}:`, e);
          }

          await sleep(100); // Reduced rate limit for TMDb API
        }

        processed++;
      }
    }

    const totalMovies = Object.keys(movieIndex).length;

    return res.status(200).json({
      movieIndex,
      uriMap,
      stats: {
        totalRows,
        uniqueFilms: totalMovies,
        enriched: enrich,
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
