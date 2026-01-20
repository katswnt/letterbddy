import { useState, type ChangeEvent } from "react";
import Papa from "papaparse";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

// Shape of one row in diary.csv
type DiaryRow = {
  Date: string;
  Name: string;
  Year: string;
  "Letterboxd URI": string;
  Rating: string;
  Rewatch: string;
  Tags: string;
  "Watched Date": string;
};

// Shape of one row in reviews.csv
type ReviewRow = {
  Date: string;
  Name: string;
  Year: string;
  "Letterboxd URI": string;
  Rating: string;
  Rewatch: string;
  Review: string;
  Tags: string;
  "Watched Date": string;
};

type FilmSummary = {
  key: string;
  name: string;
  year: string;
  entryCount: number;   // how many diary rows for this film
  hasRewatch: boolean;  // did you ever mark it as a rewatch?
};

type DateFilter = "all" | string;

// Shape of one row in watchlist.csv
type WatchlistRow = {
  Date: string;
  Name: string;
  Year: string;
  "Letterboxd URI": string;
};

// Enriched watchlist movie with criteria flags
type WatchlistMovie = {
  name: string;
  year: string;
  uri: string;
  director: string;
  runtime: number | null; // in minutes
  directedByWoman: boolean;
  writtenByWoman: boolean;
  notAmerican: boolean;
  notEnglish: boolean;
  inCriterion: boolean;
  criteriaCount: number;
};

// Runtime filter options
type RuntimeFilter = "all" | "under90" | "under2h" | "under2.5h" | "over2.5h";

// Sort state for watchlist columns
type WatchlistSortState = "default" | "asc" | "desc";
type WatchlistSortColumn = "name" | "director" | "year" | "runtime" | null;

// Cute loading spinner component
const LoadingSpinner = ({ message }: { message?: string }) => (
  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px", padding: "24px" }}>
    <div style={{ position: "relative", width: "48px", height: "48px" }}>
      {/* Outer ring */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          border: "3px solid #456",
          borderTopColor: "#00e054",
          borderRadius: "50%",
          animation: "spin 1s linear infinite",
        }}
      />
      {/* Inner ring */}
      <div
        style={{
          position: "absolute",
          inset: "8px",
          border: "3px solid #345",
          borderBottomColor: "#00e054",
          borderRadius: "50%",
          animation: "spin 0.6s linear infinite reverse",
        }}
      />
    </div>
    {message && (
      <p style={{ color: "#9ab", fontSize: "14px", textAlign: "center" }}>{message}</p>
    )}
    <style>{`
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    `}</style>
  </div>
);

const RatingTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload || payload.length === 0) return null;

  const count = payload[0].value as number;

  return (
    <div className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 shadow-lg">
      <div className="text-sm font-semibold">{label}★</div>
      <div className="mt-1 text-slate-300">
        {count} {count === 1 ? "entry" : "entries"}
      </div>
    </div>
  );
};

// Letterboxd-style pie chart colors
const PIE_COLORS = {
  primary: "#00e054",    // Letterboxd green
  secondary: "#456",     // Muted slate for "other" segment
};

const PieTooltip = ({ active, payload }: any) => {
  if (!active || !payload || payload.length === 0) return null;

  const { name, value } = payload[0];
  const total = payload[0].payload.total;
  const percent = total > 0 ? Math.round((value / total) * 100) : 0;

  return (
    <div className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 shadow-lg">
      <div className="text-sm font-semibold">{name}</div>
      <div className="mt-1 text-slate-300">
        {value} {value === 1 ? "film" : "films"} ({percent}%)
      </div>
    </div>
  );
};

type StatPieChartProps = {
  primaryValue: number;
  primaryLabel: string;
  secondaryValue: number;
  secondaryLabel: string;
  size?: number;
  onClick?: () => void;
  isSelected?: boolean;
};

const StatPieChart = ({
  primaryValue,
  primaryLabel,
  secondaryValue,
  secondaryLabel,
  size = 140,
  onClick,
  isSelected = false,
}: StatPieChartProps) => {
  const total = primaryValue + secondaryValue;
  const primaryPercent = total > 0 ? Math.round((primaryValue / total) * 100) : 0;
  const secondaryPercent = total > 0 ? Math.round((secondaryValue / total) * 100) : 0;

  const data = [
    { name: primaryLabel, value: primaryValue, total },
    { name: secondaryLabel, value: secondaryValue, total },
  ];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        cursor: onClick ? "pointer" : "default",
        padding: "8px",
        borderRadius: "8px",
        backgroundColor: isSelected ? "rgba(0, 224, 84, 0.1)" : "transparent",
        border: isSelected ? "2px solid #00e054" : "2px solid transparent",
        transition: "all 0.2s ease",
      }}
      onClick={onClick}
    >
      {/* Secondary label at top */}
      <div style={{ textAlign: "center", marginBottom: "4px" }}>
        <span style={{ fontSize: "13px", color: "#678" }}>{secondaryLabel}</span>
        <span style={{ fontSize: "13px", color: "#678", marginLeft: "4px" }}>{secondaryPercent}%</span>
      </div>

      {/* Donut chart */}
      <div style={{ width: size, height: size }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={size * 0.35}
              outerRadius={size * 0.48}
              paddingAngle={1}
              dataKey="value"
              startAngle={90}
              endAngle={-270}
              stroke="none"
            >
              <Cell fill={PIE_COLORS.primary} />
              <Cell fill={PIE_COLORS.secondary} />
            </Pie>
            <Tooltip content={<PieTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Primary label at bottom */}
      <div style={{ textAlign: "center", marginTop: "4px" }}>
        <span style={{ fontSize: "13px", fontWeight: 500, color: "#def" }}>{primaryLabel}</span>
        <span style={{ fontSize: "13px", fontWeight: 600, color: "#00e054", marginLeft: "6px" }}>{primaryPercent}%</span>
      </div>
    </div>
  );
};

function App() {
  const [rows, setRows] = useState<DiaryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [movieIndex, setMovieIndex] = useState<Record<string, any> | null>(null);
  const [uriMap, setUriMap] = useState<Record<string, string> | null>(null);
  const [movieLookup, setMovieLookup] = useState<Record<string, any> | null>(null);
  const [scrapeStatus, setScrapeStatus] = useState<string | null>(null);
  const [scrapeProgress, setScrapeProgress] = useState<{ current: number; total: number } | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Reviews state
  const [reviews, setReviews] = useState<ReviewRow[]>([]);

  // Watchlist state
  const [watchlistMovies, setWatchlistMovies] = useState<WatchlistMovie[]>([]);
  const [watchlistStatus, setWatchlistStatus] = useState<string | null>(null);
  const [watchlistProgress, setWatchlistProgress] = useState<{ current: number; total: number } | null>(null);
  const [isWatchlistLoading, setIsWatchlistLoading] = useState<boolean>(false);
  const [watchlistFilters, setWatchlistFilters] = useState<{
    directedByWoman: boolean;
    writtenByWoman: boolean;
    notAmerican: boolean;
    notEnglish: boolean;
    inCriterion: boolean;
  }>({
    directedByWoman: false,
    writtenByWoman: false,
    notAmerican: false,
    notEnglish: false,
    inCriterion: false,
  });
  const [watchlistSortColumn, setWatchlistSortColumn] = useState<WatchlistSortColumn>(null);
  const [watchlistSortState, setWatchlistSortState] = useState<WatchlistSortState>("default");
  const [watchlistRuntimeFilter, setWatchlistRuntimeFilter] = useState<RuntimeFilter>("all");

  // Diary table state (for Film Breakdown section)
  const [diaryFilters, setDiaryFilters] = useState<{
    directedByWoman: boolean;
    writtenByWoman: boolean;
    notAmerican: boolean;
    notEnglish: boolean;
    inCriterion: boolean;
  }>({
    directedByWoman: false,
    writtenByWoman: false,
    notAmerican: false,
    notEnglish: false,
    inCriterion: false,
  });
  const [diarySortColumn, setDiarySortColumn] = useState<WatchlistSortColumn>(null);
  const [diarySortState, setDiarySortState] = useState<WatchlistSortState>("default");
  const [decadeHover, setDecadeHover] = useState<{ label: string; count: number; percent: number } | null>(null);
  const [offsetDecadeHover, setOffsetDecadeHover] = useState<{ label: string; count: number; percent: number } | null>(null);

  const sortMoviesByColumn = <T extends Record<string, any>>(
    items: T[],
    column: WatchlistSortColumn,
    state: WatchlistSortState
  ) => {
    if (!column || state === "default") return items;

    return [...items].sort((a, b) => {
      let aVal = a[column];
      let bVal = b[column];
      // Handle null/undefined values
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      // Case-insensitive string comparison
      if (typeof aVal === "string") aVal = aVal.toLowerCase();
      if (typeof bVal === "string") bVal = bVal.toLowerCase();
      if (aVal < bVal) return state === "asc" ? -1 : 1;
      if (aVal > bVal) return state === "asc" ? 1 : -1;
      return 0;
    });
  };

  async function buildMovieIndex(file: File) {
    setScrapeStatus("Starting TMDb scraping…");
    setScrapeProgress(null);
    setMovieIndex(null);
    setMovieLookup(null);
    setUriMap(null);

    // Detect environment: use local server in dev, relative URL in production
    const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const baseUrl = isLocalDev ? 'http://localhost:5050' : '';

    let json: any;

    if (isLocalDev) {
      // Local development: use the Express server with job polling
      const form = new FormData();
      form.append("file", file);

      const apiUrl = `${baseUrl}/api/movies?enrich=1`;
      const startRes = await fetch(apiUrl, {
        method: "POST",
        body: form,
      });

      if (!startRes.ok) {
        const text = await startRes.text();
        throw new Error(text || `Server error (${startRes.status})`);
      }

      const { jobId } = await startRes.json();

      while (true) {
        const statusRes = await fetch(`${baseUrl}/api/movies/${jobId}/status`);
        if (!statusRes.ok) {
          const text = await statusRes.text();
          throw new Error(text || `Status error (${statusRes.status})`);
        }

        const status = await statusRes.json();

        if (status.state === "error") {
          throw new Error(status.error || "Scraping failed");
        }

        if (typeof status.current === "number" && typeof status.total === "number" && status.total > 0) {
          setScrapeProgress({ current: status.current, total: status.total });
          setScrapeStatus(`Scraping TMDb IDs… ${status.current}/${status.total}`);
        } else {
          setScrapeStatus(status.message || "Working…");
        }

        if (status.state === "done") break;

        await new Promise((r) => setTimeout(r, 750));
      }

      const resultRes = await fetch(`${baseUrl}/api/movies/${jobId}/result`);
      if (!resultRes.ok) {
        const text = await resultRes.text();
        throw new Error(text || `Result error (${resultRes.status})`);
      }

      json = await resultRes.json();
    } else {
      // Production (Vercel): two-phase approach
      // Phase 1: Parse CSV and resolve shortlinks
      setScrapeStatus("Parsing CSV...");

      const csvContent = await file.text();
      const parseResponse = await fetch(`/api/movies?parse_only=1`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: csvContent,
      });

      if (!parseResponse.ok) {
        throw new Error(await parseResponse.text() || `Server error (${parseResponse.status})`);
      }

      const parseResult = await parseResponse.json();
      const uriMap = parseResult.uriMap || {};
      const allUrls: string[] = parseResult.urls || [];
      const totalFilms = allUrls.length;

      setScrapeStatus(`Found ${totalFilms} films. Enriching with TMDb data...`);
      setScrapeProgress({ current: 0, total: totalFilms });

      // Phase 2: Enrich in batches
      let mergedMovieIndex: Record<string, any> = {};
      const batchSize = 10;
      let processed = 0;

      for (let i = 0; i < allUrls.length; i += batchSize) {
        const batch = allUrls.slice(i, i + batchSize);
        const batchNum = Math.floor(i / batchSize) + 1;

        const enrichResponse = await fetch(`/api/movies?enrich=1`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ urls: batch }),
        });

        if (!enrichResponse.ok) {
          throw new Error(await enrichResponse.text() || `Server error (${enrichResponse.status})`);
        }

        const enrichResult = await enrichResponse.json();
        console.log(`Batch ${batchNum} result:`, enrichResult);
        console.log(`Batch ${batchNum} stats:`, enrichResult.stats);

        if (enrichResult.movieIndex) {
          const moviesWithTmdb = Object.values(enrichResult.movieIndex).filter((m: any) => m.tmdb_data).length;
          console.log(`Batch ${batchNum}: ${Object.keys(enrichResult.movieIndex).length} movies, ${moviesWithTmdb} with TMDb data`);
          mergedMovieIndex = { ...mergedMovieIndex, ...enrichResult.movieIndex };
        }

        processed += batch.length;
        setScrapeStatus(`Enriching movies... ${processed}/${totalFilms} (batch ${batchNum})`);
        setScrapeProgress({ current: processed, total: totalFilms });
      }

      json = { movieIndex: mergedMovieIndex, uriMap };
    }
    console.log("Raw result from server:", json);
    console.log("Type of result:", typeof json);
    console.log("Is object?", typeof json === "object" && json !== null);
    
    if (!json || typeof json !== "object") {
      console.error("Invalid JSON result:", json);
      throw new Error("Invalid result format from server");
    }
    
    const extractedIndex: Record<string, any> = (json && typeof json === "object" && (json as any).movieIndex)
      ? ((json as any).movieIndex as Record<string, any>)
      : (json as Record<string, any>);

    const extractedUriMap: Record<string, string> | null = (json && typeof json === "object" && (json as any).uriMap)
      ? ((json as any).uriMap as Record<string, string>)
      : null;

    setMovieIndex(extractedIndex);
    setUriMap(extractedUriMap);

    // Build a lookup keyed by many URI forms so we can match diary shortlinks (boxd.it)
    // and user-scoped URLs to the canonical keys (https://letterboxd.com/film/<slug>/)
    const lookup: Record<string, any> = {};
    for (const [key, movie] of Object.entries(extractedIndex as Record<string, any>)) {
      // Canonical key
      lookup[key] = movie;

      // Common alias fields (be liberal; harmless if missing)
      const aliases: string[] = [];
      if (typeof movie?.letterboxd_url === "string") aliases.push(movie.letterboxd_url);
      if (Array.isArray(movie?.letterboxd_urls)) aliases.push(...movie.letterboxd_urls);
      if (Array.isArray(movie?.source_uris)) aliases.push(...movie.source_uris);
      if (Array.isArray(movie?.aliases)) aliases.push(...movie.aliases);
      if (typeof movie?.original_uri === "string") aliases.push(movie.original_uri);
      if (typeof movie?.shortlink === "string") aliases.push(movie.shortlink);
      if (typeof movie?.boxd_shortlink === "string") aliases.push(movie.boxd_shortlink);

      for (const a of aliases) {
        if (typeof a !== "string") continue;
        const trimmed = a.trim();
        if (!trimmed) continue;
        lookup[trimmed] = movie;
      }

      // Also support user-scoped film URLs by canonicalizing them to /film/<slug>/
      if (typeof key === "string") {
        const m = key.match(/https?:\/\/letterboxd\.com\/(?:[^/]+\/)?film\/([^/]+)\/?/i);
        if (m) {
          const canonical = `https://letterboxd.com/film/${m[1]}/`;
          lookup[canonical] = movie;
        }
      }
    }

    setMovieLookup(lookup);
    setScrapeProgress(null);
    setScrapeStatus(`Movie index ready: ${Object.keys(extractedIndex).length} films`);
    setIsLoading(false);

    // Log the data structure for sanity checking
    console.log("Movie index loaded:", Object.keys(extractedIndex).length, "films");
    console.log("Sample entry:", Object.entries(extractedIndex)[0]);
    const firstEntry = Object.entries(extractedIndex)[0];
    console.log("Sample entry keys:", firstEntry ? Object.keys(firstEntry[1] as any) : "none");
  }

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Please upload a CSV file.");
      setRows([]);
      return;
    }

    setError(null);
    setIsLoading(true);
    setRows([]);

    buildMovieIndex(file).catch((e) => {
      setError(e.message);
      setScrapeStatus(null);
      setScrapeProgress(null);
      setIsLoading(false);
    });

    Papa.parse<DiaryRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        // Filter out completely empty rows, just in case
        const data = result.data.filter(
          (row: DiaryRow) => Object.keys(row).length > 1
        );
        // Optional: peek at the first row in DevTools
        console.log("Sample diary row:", data[0]);
        setRows(data);
        // Note: isLoading will be set to false when buildMovieIndex completes
      },
      error: (err) => {
        setError(err.message);
        setRows([]);
        setIsLoading(false);
      },
    });
  };

  // Watchlist file handler
  const handleWatchlistChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Please upload a CSV file.");
      return;
    }

    setError(null);
    setIsWatchlistLoading(true);
    setWatchlistStatus("Processing watchlist...");
    setWatchlistMovies([]);

    try {
      // Detect environment
      const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const baseUrl = isLocalDev ? 'http://localhost:5050' : '';

      let json: any;

      if (isLocalDev) {
        // Local development: use Express server with job polling
        const form = new FormData();
        form.append("file", file);

        const apiUrl = `${baseUrl}/api/movies?enrich=1`;
        const startRes = await fetch(apiUrl, { method: "POST", body: form });

        if (!startRes.ok) {
          throw new Error(await startRes.text() || `Server error (${startRes.status})`);
        }

        const { jobId } = await startRes.json();

        // Poll for status
        while (true) {
          const statusRes = await fetch(`${baseUrl}/api/movies/${jobId}/status`);
          if (!statusRes.ok) throw new Error(await statusRes.text());

          const status = await statusRes.json();

          if (status.state === "error") throw new Error(status.error || "Processing failed");

          if (typeof status.current === "number" && typeof status.total === "number" && status.total > 0) {
            setWatchlistProgress({ current: status.current, total: status.total });
            setWatchlistStatus(`${status.message} ${status.current}/${status.total}`);
          } else {
            setWatchlistStatus(status.message || "Working…");
          }

          if (status.state === "done") break;
          await new Promise((r) => setTimeout(r, 750));
        }

        // Get results
        const resultRes = await fetch(`${baseUrl}/api/movies/${jobId}/result`);
        if (!resultRes.ok) throw new Error(await resultRes.text());

        json = await resultRes.json();
      } else {
        // Production (Vercel): two-phase approach
        // Phase 1: Parse CSV and resolve shortlinks
        setWatchlistStatus("Parsing watchlist...");

        const csvContent = await file.text();
        const parseResponse = await fetch(`/api/movies?parse_only=1`, {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: csvContent,
        });

        if (!parseResponse.ok) {
          throw new Error(await parseResponse.text() || `Server error (${parseResponse.status})`);
        }

        const parseResult = await parseResponse.json();
        const uriMap = parseResult.uriMap || {};
        const allUrls: string[] = parseResult.urls || [];
        const totalFilms = allUrls.length;

        setWatchlistStatus(`Found ${totalFilms} films. Enriching...`);
        setWatchlistProgress({ current: 0, total: totalFilms });

        // Phase 2: Enrich in batches
        let mergedMovieIndex: Record<string, any> = {};
        const batchSize = 10;
        let processed = 0;

        for (let i = 0; i < allUrls.length; i += batchSize) {
          const batch = allUrls.slice(i, i + batchSize);
          const batchNum = Math.floor(i / batchSize) + 1;

          const enrichResponse = await fetch(`/api/movies?enrich=1`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ urls: batch }),
          });

          if (!enrichResponse.ok) {
            throw new Error(await enrichResponse.text() || `Server error (${enrichResponse.status})`);
          }

          const enrichResult = await enrichResponse.json();
          if (enrichResult.movieIndex) {
            mergedMovieIndex = { ...mergedMovieIndex, ...enrichResult.movieIndex };
          }

          processed += batch.length;
          setWatchlistStatus(`Enriching watchlist... ${processed}/${totalFilms} (batch ${batchNum})`);
          setWatchlistProgress({ current: processed, total: totalFilms });
        }

        json = { movieIndex: mergedMovieIndex, uriMap };
        setWatchlistProgress(null);
      }

      const index = json?.movieIndex || json || {};
      const uriMap = json?.uriMap || {};

      // Parse the original CSV to get movie names/years
      const csvText = await file.text();
      const parsed = Papa.parse<WatchlistRow>(csvText, { header: true, skipEmptyLines: true });

      // Build enriched watchlist
      const enrichedMovies: WatchlistMovie[] = [];

      for (const row of parsed.data) {
        const originalUri = row["Letterboxd URI"];
        if (!originalUri) continue;

        // Resolve shortlink to canonical URL using uriMap, then look up in index
        const resolvedUri = uriMap[originalUri] || originalUri;
        const movie = index[resolvedUri];
        const tmdbData = movie?.tmdb_data;

        const directedByWoman = tmdbData?.directed_by_woman === true;
        const writtenByWoman = tmdbData?.written_by_woman === true;
        const notAmerican = tmdbData?.is_american === false;
        const notEnglish = tmdbData?.is_english === false;
        const inCriterion = movie?.is_in_criterion_collection === true;
        const runtime = typeof tmdbData?.runtime === "number" ? tmdbData.runtime : null;

        // Extract director names
        const directors = tmdbData?.directors || [];
        const directorNames = directors.map((d: any) => d.name).filter(Boolean).join(", ");

        const criteriaCount = [directedByWoman, writtenByWoman, notAmerican, notEnglish, inCriterion]
          .filter(Boolean).length;

        // Include all movies with TMDb data (runtime filter can apply to any movie)
        if (tmdbData) {
          enrichedMovies.push({
            name: row.Name,
            year: row.Year,
            uri: resolvedUri,
            director: directorNames || "Unknown",
            runtime,
            directedByWoman,
            writtenByWoman,
            notAmerican,
            notEnglish,
            inCriterion,
            criteriaCount,
          });
        }
      }

      // Sort by criteria count (descending), randomize within same tier
      enrichedMovies.sort((a, b) => {
        if (b.criteriaCount !== a.criteriaCount) {
          return b.criteriaCount - a.criteriaCount;
        }
        // Same criteria count - randomize
        return Math.random() - 0.5;
      });

      setWatchlistMovies(enrichedMovies);
      setWatchlistStatus(`Found ${enrichedMovies.length} movies matching criteria`);
    } catch (err: any) {
      setError(err.message);
      setWatchlistStatus(null);
    } finally {
      setIsWatchlistLoading(false);
      setWatchlistProgress(null);
    }
  };

// Extract unique years from diary entries, sorted descending (newest first)
const availableYears = Array.from(
  new Set(
    rows
      .map((row) => (row["Watched Date"] || "").trim().slice(0, 4))
      .filter((year) => year && /^\d{4}$/.test(year))
  )
).sort((a, b) => parseInt(b) - parseInt(a));

// Filter rows based on selected time range
const filteredRows = rows.filter((row) => {
  if (dateFilter === "all") return true;

  // diary "Watched Date" is "YYYY-MM-DD" as a string
  const watched = (row["Watched Date"] || "").trim();
  if (!watched) return false;

  const year = watched.slice(0, 4); // "2025-04-12" -> "2025"
  return year === dateFilter;
});

  // Build a map of unique films (dedupe rewatches)
  const filmMap = new Map<string, FilmSummary>();

  for (const row of filteredRows) {
    const name = (row.Name ?? "").trim();
    const year = (row.Year ?? "").trim();

    if (!name) continue; // skip malformed rows

    const key = `${name} (${year || "????"})`;
    const isRewatch = (row.Rewatch || "").toLowerCase() === "yes";

    const existing = filmMap.get(key);
    if (!existing) {
      filmMap.set(key, {
        key,
        name,
        year,
        entryCount: 1,
        hasRewatch: isRewatch,
      });
    } else {
      existing.entryCount += 1;
      existing.hasRewatch = existing.hasRewatch || isRewatch;
    }
  }

  const films = Array.from(filmMap.values());

  // Basic stats
  const totalEntries = filteredRows.length; // diary rows incl. rewatches
  const uniqueFilmCount = films.length; // each film counted once
  const rewatchedFilmCount = films.filter(
    (film) => film.hasRewatch || film.entryCount > 1
  ).length; // films you rewatched at least once

  // TMDb stats (from movieIndex, filtered to match current date range)
  // Get unique Letterboxd URIs from filtered diary rows
  const filteredUris = new Set(
    filteredRows
      .map((row) => (row["Letterboxd URI"] || "").trim())
      .filter((uri) => uri)
  );
  
  // Normalize URIs for matching - convert user-scoped URLs to canonical /film/<slug>/ format,
  // and canonicalize boxd.it shortlinks using uriMap if available
  const canonicalizeUri = (uri: string): string => {
    uri = (uri || "").trim();
    if (!uri) return uri;

    // Normalize trailing slash handling
    uri = uri.replace(/\/+$/, "");

    // If it's a boxd.it shortlink, prefer the server-provided mapping
    if (/^https?:\/\/boxd\.it\//i.test(uri)) {
      const mapped = uriMap ? uriMap[uri] : null;
      if (typeof mapped === "string" && mapped.trim()) {
        return mapped.trim();
      }
      return uri;
    }

    // Canonicalize Letterboxd film URLs (including user-scoped)
    const match = uri.match(/https?:\/\/letterboxd\.com\/(?:[^/]+\/)?film\/([^/]+)/i);
    if (match) {
      return `https://letterboxd.com/film/${match[1]}/`;
    }

    return uri;
  };
  
  // Create sets of both original and canonicalized URIs for matching
  const canonicalizedFilteredUris = new Set(
    Array.from(filteredUris).map(canonicalizeUri)
  );
  
  // Match movieIndex entries to filtered diary entries using the alias lookup
  const moviesWithData = movieLookup
    ? (() => {
        const matched = new Map<string, any>();
        for (const raw of filteredUris) {
          const canon = canonicalizeUri(raw);
          const movie = movieLookup[canon] || movieLookup[raw];
          if (movie) {
            const idKey = (movie.letterboxd_url as string) || canon || raw;
            matched.set(idKey, movie);
          }
        }
        return Array.from(matched.values()).filter((m: any) => m.tmdb_data);
      })()
    : [];
  const totalMoviesWithData = moviesWithData.length;
  
  const directedByWoman = moviesWithData.filter((m: any) => m.tmdb_data?.directed_by_woman === true).length;
  const writtenByWoman = moviesWithData.filter((m: any) => m.tmdb_data?.written_by_woman === true).length;
  const notAmerican = moviesWithData.filter((m: any) => m.tmdb_data?.is_american === false).length;
  const notEnglish = moviesWithData.filter((m: any) => m.tmdb_data?.is_english === false).length;
  const inCriterion = moviesWithData.filter((m: any) => m.is_in_criterion_collection === true).length;
  
  // Debug logging - always log to help diagnose
  console.log("=== TMDb Stats Debug ===", {
    hasMovieIndex: !!movieIndex,
    hasMovieLookup: !!movieLookup,
    hasUriMap: !!uriMap,
    uriMapSize: uriMap ? Object.keys(uriMap).length : 0,
    movieIndexSize: movieIndex ? Object.keys(movieIndex).length : 0,
    movieLookupSize: movieLookup ? Object.keys(movieLookup).length : 0,
    movieIndexKeys: movieIndex ? Object.keys(movieIndex).slice(0, 3) : [],
    filteredUrisCount: filteredUris.size,
    filteredUrisSample: Array.from(filteredUris).slice(0, 3),
    canonicalizedFilteredUrisSample: Array.from(canonicalizedFilteredUris).slice(0, 3),
    moviesWithDataCount: totalMoviesWithData,
    allMoviesInIndex: movieIndex ? Object.values(movieIndex).slice(0, 2).map((m: any) => ({
      hasTmdbData: !!m.tmdb_data,
      uri: m.letterboxd_url,
    })) : [],
    sampleMovieWithData: moviesWithData[0] ? {
      hasTmdbData: !!moviesWithData[0].tmdb_data,
      directedByWoman: moviesWithData[0].tmdb_data?.directed_by_woman,
      writtenByWoman: moviesWithData[0].tmdb_data?.written_by_woman,
      isAmerican: moviesWithData[0].tmdb_data?.is_american,
      isEnglish: moviesWithData[0].tmdb_data?.is_english,
      inCriterion: moviesWithData[0].is_in_criterion_collection,
      tmdbDataKeys: Object.keys(moviesWithData[0].tmdb_data || {}),
    } : null,
    stats: {
      directedByWoman,
      writtenByWoman,
      notAmerican,
      notEnglish,
      inCriterion,
    },
  });

  // Rewatch vs first-watch stats (entry-based, not deduped by film)
  const rewatchEntryCount = filteredRows.filter(
    (row) => (row.Rewatch || "").toLowerCase() === "yes"
  ).length;
  const firstWatchEntryCount = totalEntries - rewatchEntryCount;


    // Rating stats for the current range (only rows with a numeric Rating)
    const numericRatings = filteredRows
    .map((row) => parseFloat(row.Rating))
    .filter((r) => !Number.isNaN(r));

  const ratingCount = numericRatings.length;
  const ratingSum = numericRatings.reduce((sum, r) => sum + r, 0);
  const averageRating = ratingCount === 0 ? 0 : ratingSum / ratingCount;

  // Median rating
  const sortedRatings = [...numericRatings].sort((a, b) => a - b);
  let medianRating = 0;
  if (ratingCount > 0) {
    const mid = Math.floor(ratingCount / 2);
    if (ratingCount % 2 === 1) {
      medianRating = sortedRatings[mid];
    } else {
      medianRating = (sortedRatings[mid - 1] + sortedRatings[mid]) / 2;
    }
  }

  const fourPlusCount = numericRatings.filter((r) => r >= 4).length;

  // Bucket ratings in 0.5 steps from 0.5 to 5.0
  const ratingBuckets: Record<string, number> = {
    "0.5": 0,
    "1.0": 0,
    "1.5": 0,
    "2.0": 0,
    "2.5": 0,
    "3.0": 0,
    "3.5": 0,
    "4.0": 0,
    "4.5": 0,
    "5.0": 0,
  };

  numericRatings.forEach((r) => {
    const key = r.toFixed(1); // e.g. 3.5 -> "3.5"
    if (ratingBuckets[key] !== undefined) {
      ratingBuckets[key] += 1;
    }
  });

  const bucketEntries = Object.entries(ratingBuckets);

  const ratingChartData = bucketEntries.map(([rating, count]) => ({
    rating,
    count,
  }));

  return (
    <main style={{ minHeight: "100vh", backgroundColor: "#14181c", color: "#ccd", display: "flex", flexDirection: "column", alignItems: "center", padding: "40px 16px" }}>
      <div style={{ width: "100%", maxWidth: "800px", display: "flex", flexDirection: "column", gap: "32px" }}>
        <header style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: "28px", fontWeight: 600, color: "#fff", marginBottom: "8px" }}>
            Letterboxd Wrapped
          </h1>
          <p style={{ fontSize: "14px", color: "#9ab" }}>
            Upload your diary.csv to get started
          </p>
        </header>

        {/* Input section */}
        <section style={{ backgroundColor: "rgba(68, 85, 102, 0.2)", borderRadius: "8px", padding: "24px" }}>
          <div>
            <label style={{ fontSize: "14px", color: "#def", display: "block", marginBottom: "8px" }}>
              Upload Diary CSV
            </label>
            <p style={{ fontSize: "12px", color: "#678", marginBottom: "12px" }}>
              Export from Letterboxd: Settings → Import & Export → Export Your Data
            </p>
            <input
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              style={{
                display: "block",
                width: "100%",
                padding: "10px",
                borderRadius: "4px",
                border: "1px solid #456",
                backgroundColor: "#14181c",
                color: "#9ab",
                fontSize: "14px",
              }}
            />
          </div>

          {/* Loading state with spinner - only show when actively loading */}
          {isLoading && (
            <div style={{ marginTop: "16px" }}>
              <LoadingSpinner message={scrapeStatus || "Loading..."} />
              <div style={{ marginTop: "8px" }}>
                <div style={{
                  height: "6px",
                  width: "100%",
                  backgroundColor: "rgba(68, 85, 102, 0.3)",
                  borderRadius: "3px",
                  overflow: "hidden"
                }}>
                  {scrapeProgress && scrapeProgress.total > 0 ? (
                    <div
                      style={{
                        height: "100%",
                        borderRadius: "3px",
                        backgroundColor: "#00e054",
                        width: `${Math.min(100, Math.round((scrapeProgress.current / scrapeProgress.total) * 100))}%`,
                        transition: "width 0.3s ease",
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        height: "100%",
                        borderRadius: "3px",
                        backgroundColor: "#00e054",
                        width: "30%",
                        animation: "indeterminate 1.5s ease-in-out infinite",
                      }}
                    />
                  )}
                </div>
                {scrapeProgress && scrapeProgress.total > 0 ? (
                  <p style={{ fontSize: "12px", color: "#678", marginTop: "8px", textAlign: "center" }}>
                    {scrapeProgress.current} / {scrapeProgress.total} ({Math.round((scrapeProgress.current / scrapeProgress.total) * 100)}%)
                  </p>
                ) : (
                  <p style={{ fontSize: "12px", color: "#678", marginTop: "8px", textAlign: "center" }}>
                    Connecting to server...
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Error state */}
          {error && (
            <p style={{ color: "#f87171", fontSize: "14px", marginTop: "12px" }}>
              {error}
            </p>
          )}

          {/* Success state */}
          {!isLoading && rows.length > 0 && !error && (
            <div style={{ marginTop: "16px", padding: "12px", backgroundColor: "rgba(0, 224, 84, 0.1)", borderRadius: "6px", textAlign: "center" }}>
              <p style={{ color: "#00e054", fontSize: "14px", fontWeight: 500 }}>
                ✓ Loaded {rows.length} diary entries
              </p>
              {movieIndex && (
                <p style={{ color: "#9ab", fontSize: "12px", marginTop: "4px" }}>
                  {Object.keys(movieIndex).length} unique films indexed
                </p>
              )}
            </div>
          )}

          {/* Reviews upload (optional) */}
          {rows.length > 0 && (
            <div style={{ marginTop: "20px", paddingTop: "16px", borderTop: "1px solid #345" }}>
              <label style={{ fontSize: "14px", color: "#def", display: "block", marginBottom: "8px" }}>
                Upload Reviews CSV (optional)
              </label>
              <p style={{ fontSize: "12px", color: "#678", marginBottom: "12px" }}>
                For review word count analysis
              </p>
              <input
                type="file"
                accept=".csv"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  Papa.parse<ReviewRow>(file, {
                    header: true,
                    skipEmptyLines: true,
                    complete: (result) => {
                      const data = result.data.filter(
                        (row: ReviewRow) => row.Review && row.Review.trim().length > 0
                      );
                      setReviews(data);
                    },
                  });
                }}
                style={{
                  display: "block",
                  width: "100%",
                  padding: "10px",
                  borderRadius: "4px",
                  border: "1px solid #456",
                  backgroundColor: "#14181c",
                  color: "#9ab",
                  fontSize: "14px",
                }}
              />
              {reviews.length > 0 && (
                <p style={{ color: "#00e054", fontSize: "12px", marginTop: "8px" }}>
                  ✓ Loaded {reviews.length} reviews
                </p>
              )}
            </div>
          )}

        </section>

        {/* Time range selector */}
        {rows.length > 0 && availableYears.length > 0 && (
          <section style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: "8px" }}>
            <button
              type="button"
              onClick={() => setDateFilter("all")}
              style={{
                padding: "8px 16px",
                borderRadius: "4px",
                fontSize: "14px",
                fontWeight: 500,
                border: "none",
                cursor: "pointer",
                backgroundColor: dateFilter === "all" ? "#00e054" : "rgba(68, 85, 102, 0.3)",
                color: dateFilter === "all" ? "#14181c" : "#9ab",
              }}
            >
              All time
            </button>
            {availableYears.map((year) => (
              <button
                key={year}
                type="button"
                onClick={() => setDateFilter(year)}
                style={{
                  padding: "8px 16px",
                  borderRadius: "4px",
                  fontSize: "14px",
                  fontWeight: 500,
                  border: "none",
                  cursor: "pointer",
                  backgroundColor: dateFilter === year ? "#00e054" : "rgba(68, 85, 102, 0.3)",
                  color: dateFilter === year ? "#14181c" : "#9ab",
                }}
              >
                {year}
              </button>
            ))}
          </section>
        )}  

        {/* Stats for the currently selected time range, deduped by film */}
        {films.length > 0 && (
          <section style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "24px" }}>
            {/* Key metrics row */}
            <div style={{ display: "flex", justifyContent: "center", gap: "48px", textAlign: "center" }}>
              <div>
                <div style={{ fontSize: "36px", fontWeight: 600, color: "#fff" }}>{totalEntries}</div>
                <div style={{ fontSize: "11px", color: "#9ab", marginTop: "4px", textTransform: "uppercase", letterSpacing: "1px" }}>Films</div>
              </div>
              <div>
                <div style={{ fontSize: "36px", fontWeight: 600, color: "#fff" }}>{uniqueFilmCount}</div>
                <div style={{ fontSize: "11px", color: "#9ab", marginTop: "4px", textTransform: "uppercase", letterSpacing: "1px" }}>Unique</div>
              </div>
              <div>
                <div style={{ fontSize: "36px", fontWeight: 600, color: "#fff" }}>{rewatchedFilmCount}</div>
                <div style={{ fontSize: "11px", color: "#9ab", marginTop: "4px", textTransform: "uppercase", letterSpacing: "1px" }}>Rewatched</div>
              </div>
            </div>

            {/* Watches vs Rewatches pie chart */}
            <div style={{ display: "flex", justifyContent: "center", padding: "16px 0" }}>
              <StatPieChart
                primaryValue={firstWatchEntryCount}
                primaryLabel="New watches"
                secondaryValue={rewatchEntryCount}
                secondaryLabel="Rewatched"
                size={160}
              />
            </div>
          </section>
        )}

        {/* TMDb enrichment stats - Always show if movieIndex exists or if we should debug */}
        {(movieIndex || scrapeStatus?.includes("ready")) && (
          <section style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "24px" }}>
            <div style={{ borderTop: "1px solid rgba(68, 85, 102, 0.5)", paddingTop: "24px", width: "100%", textAlign: "center" }}>
              <h2 style={{ fontSize: "18px", fontWeight: 600, color: "#fff", marginBottom: "4px" }}>Film Breakdown</h2>
              {!movieIndex && (
                <p style={{ fontSize: "14px", color: "#f87171", textAlign: "center" }}>
                  Warning: movieIndex is null/undefined. Check console for errors.
                </p>
              )}
            </div>
            {totalMoviesWithData > 0 ? (
              <>
                <p style={{ fontSize: "12px", color: "#9ab", textAlign: "center" }}>
                  Based on {totalMoviesWithData} films with TMDb data
                </p>

                {/* Pie charts grid */}
                <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "24px", padding: "8px 0" }}>
                  <StatPieChart
                    primaryValue={directedByWoman}
                    primaryLabel="Directed by women"
                    secondaryValue={totalMoviesWithData - directedByWoman}
                    secondaryLabel="Not women"
                  />
                  <StatPieChart
                    primaryValue={writtenByWoman}
                    primaryLabel="Written by women"
                    secondaryValue={totalMoviesWithData - writtenByWoman}
                    secondaryLabel="Not women"
                  />
                  <StatPieChart
                    primaryValue={notAmerican}
                    primaryLabel="Non-American"
                    secondaryValue={totalMoviesWithData - notAmerican}
                    secondaryLabel="American"
                  />
                  <StatPieChart
                    primaryValue={notEnglish}
                    primaryLabel="Non-English"
                    secondaryValue={totalMoviesWithData - notEnglish}
                    secondaryLabel="English"
                  />
                  <StatPieChart
                    primaryValue={inCriterion}
                    primaryLabel="In Criterion"
                    secondaryValue={totalMoviesWithData - inCriterion}
                    secondaryLabel="Not in Criterion"
                  />
                </div>

                {/* Diary films table */}
                {(() => {
                  // Build diary movie list from moviesWithData
                  const diaryMovieList = moviesWithData.map((movie: any) => {
                    const tmdbData = movie.tmdb_data || {};
                    const directors = tmdbData.directors || [];
                    const directorNames = directors.map((d: any) => d.name).filter(Boolean).join(", ");

                    return {
                      name: tmdbData.title || "Unknown Title",
                      year: tmdbData.release_date?.slice(0, 4) || "",
                      uri: movie.letterboxd_url || "",
                      director: directorNames || "Unknown",
                      runtime: typeof tmdbData.runtime === "number" ? tmdbData.runtime : null,
                      directedByWoman: tmdbData.directed_by_woman === true,
                      writtenByWoman: tmdbData.written_by_woman === true,
                      notAmerican: tmdbData.is_american === false,
                      notEnglish: tmdbData.is_english === false,
                      inCriterion: movie.is_in_criterion_collection === true,
                      criteriaCount: [
                        tmdbData.directed_by_woman === true,
                        tmdbData.written_by_woman === true,
                        tmdbData.is_american === false,
                        tmdbData.is_english === false,
                        movie.is_in_criterion_collection === true,
                      ].filter(Boolean).length,
                    };
                  });

                  // Filter based on active filters
                  const hasActiveFilter = Object.values(diaryFilters).some(Boolean);
                  let filteredDiaryMovies = hasActiveFilter
                    ? diaryMovieList.filter((movie) => {
                        if (diaryFilters.directedByWoman && !movie.directedByWoman) return false;
                        if (diaryFilters.writtenByWoman && !movie.writtenByWoman) return false;
                        if (diaryFilters.notAmerican && !movie.notAmerican) return false;
                        if (diaryFilters.notEnglish && !movie.notEnglish) return false;
                        if (diaryFilters.inCriterion && !movie.inCriterion) return false;
                        return true;
                      })
                    : [...diaryMovieList];

                  // Apply sorting (default mirrors watchlist: criteria count desc, random within tier)
                  if (diarySortColumn && diarySortState !== "default") {
                    filteredDiaryMovies = sortMoviesByColumn(filteredDiaryMovies, diarySortColumn, diarySortState);
                  } else {
                    filteredDiaryMovies = [...filteredDiaryMovies].sort((a, b) => {
                      if (b.criteriaCount !== a.criteriaCount) {
                        return b.criteriaCount - a.criteriaCount;
                      }
                      return Math.random() - 0.5;
                    });
                  }

                  const toggleFilter = (key: keyof typeof diaryFilters) => {
                    setDiaryFilters((prev) => ({ ...prev, [key]: !prev[key] }));
                  };

                  const toggleSort = (column: WatchlistSortColumn) => {
                    if (diarySortColumn !== column) {
                      setDiarySortColumn(column);
                      setDiarySortState("asc");
                    } else {
                      if (diarySortState === "asc") {
                        setDiarySortState("desc");
                      } else if (diarySortState === "desc") {
                        setDiarySortState("default");
                        setDiarySortColumn(null);
                      } else {
                        setDiarySortState("asc");
                      }
                    }
                  };

                  const getSortIndicator = (column: WatchlistSortColumn) => {
                    if (diarySortColumn !== column) return "";
                    if (diarySortState === "asc") return " ↑";
                    if (diarySortState === "desc") return " ↓";
                    return "";
                  };

                  const filterHeaderStyle = (isActive: boolean) => ({
                    textAlign: "center" as const,
                    padding: "12px 4px",
                    fontWeight: 600,
                    width: "40px",
                    cursor: "pointer",
                    userSelect: "none" as const,
                    color: isActive ? "#14181c" : "#def",
                    backgroundColor: isActive ? "#00e054" : "transparent",
                    borderRadius: "4px",
                    transition: "all 0.2s ease",
                  });

                  const sortHeaderStyle = (column: WatchlistSortColumn) => ({
                    textAlign: column === "name" ? "left" as const : "center" as const,
                    padding: "12px 8px",
                    fontWeight: 600,
                    cursor: "pointer",
                    userSelect: "none" as const,
                    color: diarySortColumn === column ? "#00e054" : "#def",
                    width: column === "year" ? "60px" : column === "director" ? "150px" : undefined,
                  });

                  return (
                    <div style={{ width: "100%", marginTop: "24px" }}>
                      <h3 style={{ fontSize: "14px", fontWeight: 500, color: "#9ab", marginBottom: "12px", textAlign: "center" }}>
                        All Films ({filteredDiaryMovies.length}{hasActiveFilter ? ` of ${diaryMovieList.length}` : ""})
                      </h3>
                      {hasActiveFilter && (
                        <p style={{ fontSize: "12px", color: "#9ab", marginBottom: "8px", textAlign: "center" }}>
                          <button
                            onClick={() => setDiaryFilters({
                              directedByWoman: false,
                              writtenByWoman: false,
                              notAmerican: false,
                              notEnglish: false,
                              inCriterion: false,
                            })}
                            style={{
                              padding: "2px 8px",
                              fontSize: "11px",
                              backgroundColor: "transparent",
                              border: "1px solid #456",
                              borderRadius: "4px",
                              color: "#9ab",
                              cursor: "pointer",
                            }}
                          >
                            Clear filters
                          </button>
                        </p>
                      )}
                      <div style={{ overflowX: "auto", maxHeight: "400px", overflowY: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
                          <thead style={{ position: "sticky", top: 0, backgroundColor: "#14181c", zIndex: 1 }}>
                            <tr style={{ borderBottom: "2px solid #456" }}>
                              <th
                                style={sortHeaderStyle("name")}
                                title="Click to sort by title"
                                onClick={() => toggleSort("name")}
                              >
                                Title{getSortIndicator("name")}
                              </th>
                              <th
                                style={sortHeaderStyle("director")}
                                title="Click to sort by director"
                                onClick={() => toggleSort("director")}
                              >
                                Director{getSortIndicator("director")}
                              </th>
                              <th
                                style={sortHeaderStyle("year")}
                                title="Click to sort by year"
                                onClick={() => toggleSort("year")}
                              >
                                Year{getSortIndicator("year")}
                              </th>
                              <th
                                style={filterHeaderStyle(diaryFilters.directedByWoman)}
                                title="Directed by Woman (click to filter)"
                                onClick={() => toggleFilter("directedByWoman")}
                              >
                                Dir♀
                              </th>
                              <th
                                style={filterHeaderStyle(diaryFilters.writtenByWoman)}
                                title="Written by Woman (click to filter)"
                                onClick={() => toggleFilter("writtenByWoman")}
                              >
                                Writ♀
                              </th>
                              <th
                                style={filterHeaderStyle(diaryFilters.notAmerican)}
                                title="Not American (click to filter)"
                                onClick={() => toggleFilter("notAmerican")}
                              >
                                !US
                              </th>
                              <th
                                style={filterHeaderStyle(diaryFilters.notEnglish)}
                                title="Not in English (click to filter)"
                                onClick={() => toggleFilter("notEnglish")}
                              >
                                !EN
                              </th>
                              <th
                                style={filterHeaderStyle(diaryFilters.inCriterion)}
                                title="Criterion Collection (click to filter)"
                                onClick={() => toggleFilter("inCriterion")}
                              >
                                CC
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredDiaryMovies.map((movie, idx) => (
                              <tr
                                key={movie.uri || idx}
                                style={{
                                  borderBottom: "1px solid #345",
                                  backgroundColor: idx % 2 === 0 ? "transparent" : "rgba(68, 85, 102, 0.1)"
                                }}
                              >
                                <td style={{ padding: "10px 8px", color: "#fff" }}>
                                  <a
                                    href={movie.uri}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ color: "#fff", textDecoration: "none" }}
                                    onMouseOver={(e) => (e.currentTarget.style.color = "#00e054")}
                                    onMouseOut={(e) => (e.currentTarget.style.color = "#fff")}
                                  >
                                    {movie.name}
                                  </a>
                                </td>
                                <td style={{ padding: "10px 8px", color: "#9ab" }}>{movie.director}</td>
                                <td style={{ textAlign: "center", padding: "10px 8px", color: "#9ab" }}>{movie.year}</td>
                                <td style={{ textAlign: "center", padding: "10px 4px", color: movie.directedByWoman ? "#00e054" : "#456" }}>
                                  {movie.directedByWoman ? "✓" : "✗"}
                                </td>
                                <td style={{ textAlign: "center", padding: "10px 4px", color: movie.writtenByWoman ? "#00e054" : "#456" }}>
                                  {movie.writtenByWoman ? "✓" : "✗"}
                                </td>
                                <td style={{ textAlign: "center", padding: "10px 4px", color: movie.notAmerican ? "#00e054" : "#456" }}>
                                  {movie.notAmerican ? "✓" : "✗"}
                                </td>
                                <td style={{ textAlign: "center", padding: "10px 4px", color: movie.notEnglish ? "#00e054" : "#456" }}>
                                  {movie.notEnglish ? "✓" : "✗"}
                                </td>
                                <td style={{ textAlign: "center", padding: "10px 4px", color: movie.inCriterion ? "#00e054" : "#456" }}>
                                  {movie.inCriterion ? "✓" : "✗"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}

                {/* Decade distribution bar */}
                {(() => {
                  // Group movies by decade
                  const decadeCounts: Record<string, number> = {};
                  for (const movie of moviesWithData) {
                    const releaseDate = (movie as any).tmdb_data?.release_date;
                    if (typeof releaseDate === "string" && releaseDate.length >= 4) {
                      const year = parseInt(releaseDate.slice(0, 4), 10);
                      if (!isNaN(year)) {
                        const decade = `${Math.floor(year / 10) * 10}s`;
                        decadeCounts[decade] = (decadeCounts[decade] || 0) + 1;
                      }
                    }
                  }

                  // Sort decades chronologically
                  const sortedDecades = Object.entries(decadeCounts)
                    .sort((a, b) => parseInt(a[0]) - parseInt(b[0]));

                  if (sortedDecades.length === 0) return null;

                  // Color palette for decades (gradient from warm to cool)
                  const decadeColors: Record<string, string> = {
                    "1920s": "#8b4513",
                    "1930s": "#cd853f",
                    "1940s": "#daa520",
                    "1950s": "#f4a460",
                    "1960s": "#ff6347",
                    "1970s": "#ff4500",
                    "1980s": "#9932cc",
                    "1990s": "#4169e1",
                    "2000s": "#00ced1",
                    "2010s": "#32cd32",
                    "2020s": "#00e054",
                  };

                  const getDecadeColor = (decade: string) => {
                    return decadeColors[decade] || "#678";
                  };

                  return (
                    <div style={{ width: "100%", marginTop: "24px" }}>
                      <h3 style={{ fontSize: "14px", fontWeight: 500, color: "#9ab", marginBottom: "12px", textAlign: "center" }}>
                        Films by Decade
                      </h3>
                      <div style={{ minHeight: "16px", textAlign: "center", marginBottom: "8px" }}>
                        {decadeHover ? (
                          <span style={{ fontSize: "12px", color: "#9ab" }}>
                            {decadeHover.label}: {decadeHover.count} films ({Math.round(decadeHover.percent)}%)
                          </span>
                        ) : (
                          <span style={{ fontSize: "12px", color: "transparent" }}>.</span>
                        )}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          width: "100%",
                          height: "32px",
                          borderRadius: "6px",
                          overflow: "hidden",
                          backgroundColor: "#345",
                        }}
                      >
                        {sortedDecades.map(([decade, count]) => {
                          const percent = (count / totalMoviesWithData) * 100;
                          return (
                            <div
                              key={decade}
                              style={{
                                width: `${percent}%`,
                                height: "100%",
                                backgroundColor: getDecadeColor(decade),
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: "default",
                                transition: "opacity 0.2s ease",
                                minWidth: percent > 3 ? "auto" : "0",
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.opacity = "0.8";
                                setDecadeHover({ label: decade, count, percent });
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.opacity = "1";
                                setDecadeHover(null);
                              }}
                            >
                              {percent >= 8 && (
                                <span style={{ fontSize: "11px", fontWeight: 600, color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}>
                                  {decade.slice(0, 4)}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {/* Legend */}
                      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "12px", marginTop: "12px" }}>
                        {sortedDecades.map(([decade, count]) => {
                          const percent = Math.round((count / totalMoviesWithData) * 100);
                          return (
                            <div key={decade} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                              <div style={{ width: "12px", height: "12px", borderRadius: "2px", backgroundColor: getDecadeColor(decade) }} />
                              <span style={{ fontSize: "11px", color: "#9ab" }}>{decade} ({percent}%)</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* Offset decade bar (1906-1915, 1916-1925, etc.) */}
                {(() => {
                  // Group movies by offset decades (years ending in 6 to years ending in 5)
                  const offsetDecadeCounts: Record<string, number> = {};
                  for (const movie of moviesWithData) {
                    const releaseDate = (movie as any).tmdb_data?.release_date;
                    if (typeof releaseDate === "string" && releaseDate.length >= 4) {
                      const year = parseInt(releaseDate.slice(0, 4), 10);
                      if (!isNaN(year)) {
                        // Calculate offset decade: 1906-1915, 1916-1925, etc.
                        const decadeStart = Math.floor((year - 6) / 10) * 10 + 6;
                        const decadeEnd = decadeStart + 9;
                        const decadeLabel = `${decadeStart}-${decadeEnd}`;
                        offsetDecadeCounts[decadeLabel] = (offsetDecadeCounts[decadeLabel] || 0) + 1;
                      }
                    }
                  }

                  // Sort decades chronologically
                  const sortedOffsetDecades = Object.entries(offsetDecadeCounts)
                    .sort((a, b) => parseInt(a[0]) - parseInt(b[0]));

                  if (sortedOffsetDecades.length === 0) return null;

                  // Color palette for offset decades (different hues)
                  const offsetDecadeColors: Record<string, string> = {
                    "1896-1905": "#4a1c6b",
                    "1906-1915": "#6b2d5b",
                    "1916-1925": "#8b3d4b",
                    "1926-1935": "#ab4d3b",
                    "1936-1945": "#cb6d2b",
                    "1946-1955": "#db8d1b",
                    "1956-1965": "#dbad0b",
                    "1966-1975": "#bbcd0b",
                    "1976-1985": "#7bcd2b",
                    "1986-1995": "#3bbd4b",
                    "1996-2005": "#1b9d6b",
                    "2006-2015": "#0b7d8b",
                    "2016-2025": "#1b5dab",
                  };

                  const getOffsetDecadeColor = (decade: string) => {
                    return offsetDecadeColors[decade] || "#678";
                  };

                  return (
                    <div style={{ width: "100%", marginTop: "20px" }}>
                      <h3 style={{ fontSize: "14px", fontWeight: 500, color: "#9ab", marginBottom: "12px", textAlign: "center" }}>
                        Films by Offset Decade
                      </h3>
                      <div style={{ minHeight: "16px", textAlign: "center", marginBottom: "8px" }}>
                        {offsetDecadeHover ? (
                          <span style={{ fontSize: "12px", color: "#9ab" }}>
                            {offsetDecadeHover.label}: {offsetDecadeHover.count} films ({Math.round(offsetDecadeHover.percent)}%)
                          </span>
                        ) : (
                          <span style={{ fontSize: "12px", color: "transparent" }}>.</span>
                        )}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          width: "100%",
                          height: "32px",
                          borderRadius: "6px",
                          overflow: "hidden",
                          backgroundColor: "#345",
                        }}
                      >
                        {sortedOffsetDecades.map(([decade, count]) => {
                          const percent = (count / totalMoviesWithData) * 100;
                          return (
                            <div
                              key={decade}
                              style={{
                                width: `${percent}%`,
                                height: "100%",
                                backgroundColor: getOffsetDecadeColor(decade),
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: "default",
                                transition: "opacity 0.2s ease",
                                minWidth: percent > 3 ? "auto" : "0",
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.opacity = "0.8";
                                setOffsetDecadeHover({ label: decade, count, percent });
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.opacity = "1";
                                setOffsetDecadeHover(null);
                              }}
                            >
                              {percent >= 10 && (
                                <span style={{ fontSize: "10px", fontWeight: 600, color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}>
                                  {decade.slice(2, 4)}-{decade.slice(-2)}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {/* Legend */}
                      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "12px", marginTop: "12px" }}>
                        {sortedOffsetDecades.map(([decade, count]) => {
                          const percent = Math.round((count / totalMoviesWithData) * 100);
                          return (
                            <div key={decade} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                              <div style={{ width: "12px", height: "12px", borderRadius: "2px", backgroundColor: getOffsetDecadeColor(decade) }} />
                              <span style={{ fontSize: "11px", color: "#9ab" }}>{decade} ({percent}%)</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </>
            ) : (
              <div className="text-sm text-slate-400 space-y-2">
                <p>
                  No TMDb data available for the current filter. Make sure you enabled TMDb enrichment when uploading your diary.
                </p>
                <div className="text-xs space-y-1 mt-2 p-2 bg-slate-800/50 rounded">
                  <p className="font-medium">Debug info:</p>
                  <p>• Movies in index: {movieIndex ? Object.keys(movieIndex).length : 0} (lookup: {movieLookup ? Object.keys(movieLookup).length : 0})</p>
                  <p>• URI map entries: {uriMap ? Object.keys(uriMap).length : 0}</p>
                  <p>• URIs in filtered rows: {filteredUris.size}</p>
                  <p>• Canonicalized URIs: {canonicalizedFilteredUris.size}</p>
                  <p>• Movies with TMDb data: {totalMoviesWithData}</p>
                  {movieIndex && Object.keys(movieIndex).length > 0 && (
                    <p>• Sample movieIndex key: {Object.keys(movieIndex)[0]}</p>
                  )}
                  {filteredUris.size > 0 && (
                    <p>• Sample filtered URI: {Array.from(filteredUris)[0]}</p>
                  )}
                  {canonicalizedFilteredUris.size > 0 && (
                    <p>• Sample canonicalized: {Array.from(canonicalizedFilteredUris)[0]}</p>
                  )}
                  {movieIndex && Object.keys(movieIndex).length > 0 && (
                    <p>• Sample movie from index has tmdb_data: {String(!!(Object.values(movieIndex)[0] as any)?.tmdb_data)}</p>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {/* Rating breakdown for this range */}
        {ratingCount > 0 && (
          <section style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "24px" }}>
            <div style={{ borderTop: "1px solid rgba(68, 85, 102, 0.5)", paddingTop: "24px", width: "100%", textAlign: "center" }}>
              <h2 style={{ fontSize: "18px", fontWeight: 600, color: "#fff", marginBottom: "16px" }}>Ratings</h2>
            </div>

            {/* Rating stats row */}
            <div style={{ display: "flex", justifyContent: "center", gap: "48px", textAlign: "center" }}>
              <div>
                <div style={{ fontSize: "32px", fontWeight: 600, color: "#fff" }}>{averageRating.toFixed(1)}</div>
                <div style={{ fontSize: "11px", color: "#9ab", marginTop: "4px", textTransform: "uppercase", letterSpacing: "1px" }}>Average</div>
              </div>
              <div>
                <div style={{ fontSize: "32px", fontWeight: 600, color: "#fff" }}>{medianRating.toFixed(1)}</div>
                <div style={{ fontSize: "11px", color: "#9ab", marginTop: "4px", textTransform: "uppercase", letterSpacing: "1px" }}>Median</div>
              </div>
              <div>
                <div style={{ fontSize: "32px", fontWeight: 600, color: "#fff" }}>{ratingCount}</div>
                <div style={{ fontSize: "11px", color: "#9ab", marginTop: "4px", textTransform: "uppercase", letterSpacing: "1px" }}>Rated</div>
              </div>
              <div>
                <div style={{ fontSize: "32px", fontWeight: 600, color: "#fff" }}>{fourPlusCount}</div>
                <div style={{ fontSize: "11px", color: "#9ab", marginTop: "4px", textTransform: "uppercase", letterSpacing: "1px" }}>4★+</div>
              </div>
            </div>

            {/* Bar chart */}
            <div style={{ width: "100%", height: 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={ratingChartData}
                  margin={{ top: 10, right: 10, left: 0, bottom: 10 }}
                >
                  <XAxis
                    dataKey="rating"
                    tick={{ fontSize: 11, fill: "#9ab" }}
                    tickLine={false}
                    axisLine={{ stroke: "#456" }}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 10, fill: "#9ab" }}
                    tickLine={false}
                    axisLine={false}
                    width={30}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(68, 85, 102, 0.3)" }}
                    content={<RatingTooltip />}
                  />
                  <Bar dataKey="count" fill="#00e054" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Review stats - only show if reviews have been uploaded */}
            {reviews.length > 0 && (() => {
              // Calculate word counts for each review
              const wordCounts = reviews.map((review) => {
                const text = review.Review || "";
                const words = text.trim().split(/\s+/).filter(w => w.length > 0);
                return words.length;
              });

              // Calculate median word count
              const sortedWordCounts = [...wordCounts].sort((a, b) => a - b);
              const mid = Math.floor(sortedWordCounts.length / 2);
              const medianWordCount = sortedWordCounts.length % 2 === 1
                ? sortedWordCounts[mid]
                : Math.round((sortedWordCounts[mid - 1] + sortedWordCounts[mid]) / 2);

              // Calculate average for comparison
              const totalWords = wordCounts.reduce((sum, count) => sum + count, 0);
              const avgWordCount = Math.round(totalWords / wordCounts.length);

              return (
                <div style={{ borderTop: "1px solid rgba(68, 85, 102, 0.5)", paddingTop: "24px", marginTop: "24px", width: "100%" }}>
                  <h3 style={{ fontSize: "16px", fontWeight: 600, color: "#fff", marginBottom: "16px", textAlign: "center" }}>
                    Reviews
                  </h3>
                  <div style={{ display: "flex", justifyContent: "center", gap: "48px", textAlign: "center" }}>
                    <div>
                      <div style={{ fontSize: "32px", fontWeight: 600, color: "#fff" }}>{reviews.length}</div>
                      <div style={{ fontSize: "11px", color: "#9ab", marginTop: "4px", textTransform: "uppercase", letterSpacing: "1px" }}>Reviews</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "32px", fontWeight: 600, color: "#fff" }}>{medianWordCount}</div>
                      <div style={{ fontSize: "11px", color: "#9ab", marginTop: "4px", textTransform: "uppercase", letterSpacing: "1px" }}>Median Words</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "32px", fontWeight: 600, color: "#fff" }}>{avgWordCount}</div>
                      <div style={{ fontSize: "11px", color: "#9ab", marginTop: "4px", textTransform: "uppercase", letterSpacing: "1px" }}>Avg Words</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "32px", fontWeight: 600, color: "#fff" }}>{totalWords.toLocaleString()}</div>
                      <div style={{ fontSize: "11px", color: "#9ab", marginTop: "4px", textTransform: "uppercase", letterSpacing: "1px" }}>Total Words</div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </section>
        )}

        {/* Watchlist Analysis Section */}
        <section style={{ backgroundColor: "rgba(68, 85, 102, 0.2)", borderRadius: "8px", padding: "24px", marginTop: "32px" }}>
          <h2 style={{ fontSize: "20px", fontWeight: 600, color: "#fff", marginBottom: "16px", textAlign: "center" }}>
            Watchlist Analysis
          </h2>
          <p style={{ fontSize: "12px", color: "#678", marginBottom: "16px", textAlign: "center" }}>
            Upload your watchlist.csv to find films matching your criteria
          </p>

          <div style={{ marginBottom: "16px" }}>
            <input
              type="file"
              accept=".csv"
              onChange={handleWatchlistChange}
              disabled={isWatchlistLoading}
              style={{
                display: "block",
                width: "100%",
                padding: "10px",
                borderRadius: "4px",
                border: "1px solid #456",
                backgroundColor: "#14181c",
                color: "#9ab",
                fontSize: "14px",
              }}
            />
          </div>

          {/* Loading state */}
          {isWatchlistLoading && (
            <div style={{ marginTop: "16px" }}>
              <LoadingSpinner message={watchlistStatus || "Processing..."} />
              <div style={{ marginTop: "8px" }}>
                <div style={{
                  height: "6px",
                  width: "100%",
                  backgroundColor: "rgba(68, 85, 102, 0.3)",
                  borderRadius: "3px",
                  overflow: "hidden"
                }}>
                  {watchlistProgress && watchlistProgress.total > 0 ? (
                    <div
                      style={{
                        height: "100%",
                        borderRadius: "3px",
                        backgroundColor: "#00e054",
                        width: `${Math.min(100, Math.round((watchlistProgress.current / watchlistProgress.total) * 100))}%`,
                        transition: "width 0.3s ease"
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        height: "100%",
                        borderRadius: "3px",
                        backgroundColor: "#00e054",
                        width: "30%",
                        animation: "indeterminate 1.5s ease-in-out infinite",
                      }}
                    />
                  )}
                </div>
                {watchlistProgress && watchlistProgress.total > 0 ? (
                  <p style={{ fontSize: "12px", color: "#678", textAlign: "center", marginTop: "4px" }}>
                    {watchlistProgress.current} / {watchlistProgress.total} ({Math.round((watchlistProgress.current / watchlistProgress.total) * 100)}%)
                  </p>
                ) : (
                  <p style={{ fontSize: "12px", color: "#678", textAlign: "center", marginTop: "4px" }}>
                    Connecting to server...
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Status message when not loading */}
          {!isWatchlistLoading && watchlistStatus && (
            <p style={{ fontSize: "14px", color: "#9ab", textAlign: "center", marginBottom: "16px" }}>
              {watchlistStatus}
            </p>
          )}

          {/* Results table */}
          {watchlistMovies.length > 0 && (() => {
            // Helper to format runtime
            const formatRuntime = (minutes: number | null) => {
              if (minutes === null) return "—";
              const h = Math.floor(minutes / 60);
              const m = minutes % 60;
              return h > 0 ? `${h}h ${m}m` : `${m}m`;
            };

            // Apply runtime filter
            const passesRuntimeFilter = (runtime: number | null) => {
              if (watchlistRuntimeFilter === "all") return true;
              if (runtime === null) return false;
              if (watchlistRuntimeFilter === "under90") return runtime < 90;
              if (watchlistRuntimeFilter === "under2h") return runtime < 120;
              if (watchlistRuntimeFilter === "under2.5h") return runtime < 150;
              if (watchlistRuntimeFilter === "over2.5h") return runtime >= 150;
              return true;
            };

            // Filter movies based on active filters
            const hasActiveFilter = Object.values(watchlistFilters).some(Boolean);
            const hasActiveRuntimeFilter = watchlistRuntimeFilter !== "all";
            let filteredMovies = watchlistMovies.filter((movie) => {
              // Check criteria filters
              if (watchlistFilters.directedByWoman && !movie.directedByWoman) return false;
              if (watchlistFilters.writtenByWoman && !movie.writtenByWoman) return false;
              if (watchlistFilters.notAmerican && !movie.notAmerican) return false;
              if (watchlistFilters.notEnglish && !movie.notEnglish) return false;
              if (watchlistFilters.inCriterion && !movie.inCriterion) return false;
              // Check runtime filter
              if (!passesRuntimeFilter(movie.runtime)) return false;
              return true;
            });

            // Apply sorting if a column is selected
            filteredMovies = sortMoviesByColumn(filteredMovies, watchlistSortColumn, watchlistSortState);

            const toggleFilter = (key: keyof typeof watchlistFilters) => {
              setWatchlistFilters((prev) => ({ ...prev, [key]: !prev[key] }));
            };

            const toggleSort = (column: WatchlistSortColumn) => {
              if (watchlistSortColumn !== column) {
                // New column - start with ascending
                setWatchlistSortColumn(column);
                setWatchlistSortState("asc");
              } else {
                // Same column - cycle through: asc -> desc -> default
                if (watchlistSortState === "asc") {
                  setWatchlistSortState("desc");
                } else if (watchlistSortState === "desc") {
                  setWatchlistSortState("default");
                  setWatchlistSortColumn(null);
                } else {
                  setWatchlistSortState("asc");
                }
              }
            };

            const getSortIndicator = (column: WatchlistSortColumn) => {
              if (watchlistSortColumn !== column) return "";
              if (watchlistSortState === "asc") return " ↑";
              if (watchlistSortState === "desc") return " ↓";
              return "";
            };

            const filterHeaderStyle = (isActive: boolean) => ({
              textAlign: "center" as const,
              padding: "12px 4px",
              fontWeight: 600,
              width: "40px",
              cursor: "pointer",
              userSelect: "none" as const,
              color: isActive ? "#14181c" : "#def",
              backgroundColor: isActive ? "#00e054" : "transparent",
              borderRadius: "4px",
              transition: "all 0.2s ease",
            });

            const sortHeaderStyle = (column: WatchlistSortColumn) => ({
              textAlign: column === "name" ? "left" as const : "center" as const,
              padding: "12px 8px",
              fontWeight: 600,
              cursor: "pointer",
              userSelect: "none" as const,
              color: watchlistSortColumn === column ? "#00e054" : "#def",
              width: column === "year" ? "60px" : column === "director" ? "150px" : column === "runtime" ? "70px" : undefined,
            });

            const runtimeButtonStyle = (filter: RuntimeFilter) => ({
              padding: "6px 12px",
              borderRadius: "4px",
              fontSize: "13px",
              fontWeight: 500,
              border: "none",
              cursor: "pointer",
              backgroundColor: watchlistRuntimeFilter === filter ? "#00e054" : "rgba(68, 85, 102, 0.3)",
              color: watchlistRuntimeFilter === filter ? "#14181c" : "#9ab",
              transition: "all 0.2s ease",
            });

            const hasAnyFilter = hasActiveFilter || hasActiveRuntimeFilter;

            return (
              <div style={{ overflowX: "auto" }}>
                {/* Runtime filter buttons */}
                <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: "8px", marginBottom: "16px" }}>
                  <span style={{ fontSize: "13px", color: "#9ab", alignSelf: "center", marginRight: "8px" }}>Runtime:</span>
                  <button
                    style={runtimeButtonStyle("all")}
                    onClick={() => setWatchlistRuntimeFilter("all")}
                  >
                    All
                  </button>
                  <button
                    style={runtimeButtonStyle("under90")}
                    onClick={() => setWatchlistRuntimeFilter("under90")}
                  >
                    Under 90 min
                  </button>
                  <button
                    style={runtimeButtonStyle("under2h")}
                    onClick={() => setWatchlistRuntimeFilter("under2h")}
                  >
                    Under 2 hrs
                  </button>
                  <button
                    style={runtimeButtonStyle("under2.5h")}
                    onClick={() => setWatchlistRuntimeFilter("under2.5h")}
                  >
                    Under 2½ hrs
                  </button>
                  <button
                    style={runtimeButtonStyle("over2.5h")}
                    onClick={() => setWatchlistRuntimeFilter("over2.5h")}
                  >
                    Over 2½ hrs
                  </button>
                </div>

                {hasAnyFilter && (
                  <p style={{ fontSize: "12px", color: "#9ab", marginBottom: "8px", textAlign: "center" }}>
                    Showing {filteredMovies.length} of {watchlistMovies.length} movies
                    <button
                      onClick={() => {
                        setWatchlistFilters({
                          directedByWoman: false,
                          writtenByWoman: false,
                          notAmerican: false,
                          notEnglish: false,
                          inCriterion: false,
                        });
                        setWatchlistRuntimeFilter("all");
                      }}
                      style={{
                        marginLeft: "8px",
                        padding: "2px 8px",
                        fontSize: "11px",
                        backgroundColor: "transparent",
                        border: "1px solid #456",
                        borderRadius: "4px",
                        color: "#9ab",
                        cursor: "pointer",
                      }}
                    >
                      Clear all filters
                    </button>
                  </p>
                )}
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #456" }}>
                      <th
                        style={sortHeaderStyle("name")}
                        title="Click to sort by title"
                        onClick={() => toggleSort("name")}
                      >
                        Title{getSortIndicator("name")}
                      </th>
                      <th
                        style={sortHeaderStyle("director")}
                        title="Click to sort by director"
                        onClick={() => toggleSort("director")}
                      >
                        Director{getSortIndicator("director")}
                      </th>
                      <th
                        style={sortHeaderStyle("year")}
                        title="Click to sort by year"
                        onClick={() => toggleSort("year")}
                      >
                        Year{getSortIndicator("year")}
                      </th>
                      <th
                        style={sortHeaderStyle("runtime")}
                        title="Click to sort by runtime"
                        onClick={() => toggleSort("runtime")}
                      >
                        Time{getSortIndicator("runtime")}
                      </th>
                      <th
                        style={filterHeaderStyle(watchlistFilters.directedByWoman)}
                        title="Directed by Woman (click to filter)"
                        onClick={() => toggleFilter("directedByWoman")}
                      >
                        Dir♀
                      </th>
                      <th
                        style={filterHeaderStyle(watchlistFilters.writtenByWoman)}
                        title="Written by Woman (click to filter)"
                        onClick={() => toggleFilter("writtenByWoman")}
                      >
                        Writ♀
                      </th>
                      <th
                        style={filterHeaderStyle(watchlistFilters.notAmerican)}
                        title="Not American (click to filter)"
                        onClick={() => toggleFilter("notAmerican")}
                      >
                        !US
                      </th>
                      <th
                        style={filterHeaderStyle(watchlistFilters.notEnglish)}
                        title="Not in English (click to filter)"
                        onClick={() => toggleFilter("notEnglish")}
                      >
                        !EN
                      </th>
                      <th
                        style={filterHeaderStyle(watchlistFilters.inCriterion)}
                        title="Criterion Collection (click to filter)"
                        onClick={() => toggleFilter("inCriterion")}
                      >
                        CC
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMovies.map((movie, idx) => (
                      <tr
                        key={movie.uri}
                        style={{
                          borderBottom: "1px solid #345",
                          backgroundColor: idx % 2 === 0 ? "transparent" : "rgba(68, 85, 102, 0.1)"
                        }}
                      >
                        <td style={{ padding: "10px 8px", color: "#fff" }}>
                          <a
                            href={movie.uri}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: "#fff", textDecoration: "none" }}
                            onMouseOver={(e) => (e.currentTarget.style.color = "#00e054")}
                            onMouseOut={(e) => (e.currentTarget.style.color = "#fff")}
                          >
                            {movie.name}
                          </a>
                        </td>
                        <td style={{ padding: "10px 8px", color: "#9ab" }}>{movie.director}</td>
                        <td style={{ textAlign: "center", padding: "10px 8px", color: "#9ab" }}>{movie.year}</td>
                        <td style={{ textAlign: "center", padding: "10px 8px", color: "#9ab", fontSize: "12px" }}>{formatRuntime(movie.runtime)}</td>
                        <td style={{ textAlign: "center", padding: "10px 4px", color: movie.directedByWoman ? "#00e054" : "#456" }}>
                          {movie.directedByWoman ? "✓" : "✗"}
                        </td>
                        <td style={{ textAlign: "center", padding: "10px 4px", color: movie.writtenByWoman ? "#00e054" : "#456" }}>
                          {movie.writtenByWoman ? "✓" : "✗"}
                        </td>
                        <td style={{ textAlign: "center", padding: "10px 4px", color: movie.notAmerican ? "#00e054" : "#456" }}>
                          {movie.notAmerican ? "✓" : "✗"}
                        </td>
                        <td style={{ textAlign: "center", padding: "10px 4px", color: movie.notEnglish ? "#00e054" : "#456" }}>
                          {movie.notEnglish ? "✓" : "✗"}
                        </td>
                        <td style={{ textAlign: "center", padding: "10px 4px", color: movie.inCriterion ? "#00e054" : "#456" }}>
                          {movie.inCriterion ? "✓" : "✗"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </section>
      </div>
    </main>
  );
}

export default App;
