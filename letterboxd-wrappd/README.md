# Letterbddy

Letterbddy is a Letterboxd "wrapped" experience for diaries, watchlists, and reviews. Upload your exports (or try Kat's sample files) to explore ratings, decades, gender stats, Criterion hits, and a world map of production countries.

## Highlights

- Upload `diary.csv`, `watchlist.csv`, and `reviews.csv`
- TMDb enrichment (directors, writers, runtime, countries, languages)
- Rating distribution bar chart with click-to-filter
- Decade bars (standard and offset decades) with click-to-filter
- World map with continent/country toggle and filtering
- Watchlist criteria table (women-directed/written, non-US, non-English, Criterion)
- Sample datasets in `public/` ("Try with Kat's")

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create `.env` with your TMDb key:
   ```bash
   TMDB_API_KEY=your_key_here
   ```

3. Run dev frontend:
   ```bash
   npm run dev
   ```

4. Run local API server (for enrichment + long-running jobs):
   ```bash
   npm run server
   ```

Frontend runs at `http://localhost:5173`  
API server runs at `http://localhost:5050`

## CSVs Supported

Exports from Letterboxd (Settings → Import & Export → Export Your Data):

- **diary.csv**: includes `Watched Date` or `Date`, `Name`, `Year`, `Letterboxd URI`, `Rating`, `Rewatch`, etc.
- **watchlist.csv**: includes `Name`, `Year`, `Letterboxd URI`
- **reviews.csv**: includes `Review`

The app accepts either `Watched Date` or `Date` for filtering by year.

## Sample Data ("Try with Kat's")

The repo includes sample exports:

- `public/kat_diary.csv`
- `public/kat_watchlist.csv`
- `public/kat_reviews.csv`

Each uploader has a "Try with Kat's" button so users can explore without uploading their own files.

## TMDb Enrichment

Enrichment runs in two ways:

- **Local dev:** `server.mjs` spawns `scripts/scrape_tmdb_ids.py` and polls job status.
- **Production (Vercel):** `api/movies.ts` handles parsing + TMDb enrichment in batches.

TMDb data powers:
- countries and languages
- director/writer gender checks
- runtime and metadata

## World Map

The map uses:
- `@svg-maps/world` for SVG shapes
- `countries-list` for ISO country → continent mapping

You can toggle **Country** or **Continent** mode, hover for counts, and click to filter the diary list and pie charts.

## Deployment

This is a Vite + Vercel setup:

- Frontend builds to `dist`
- Serverless endpoints are under `api/`
- `vercel.json` sets function duration and rewrites

Deploy with Vercel or your preferred static + serverless host.

## Troubleshooting

- **Low TMDb counts locally:** ensure the API server is running and `TMDB_API_KEY` is set.
- **Watched.csv counts look off:** make sure the file includes `Letterboxd URI`. The app uses `Date` when `Watched Date` is missing.
- **Map looks empty:** check that TMDb enrichment is running (production countries come from TMDb).

## Credits

Built by Kat Swint. Letterboxd and TMDb data belong to their respective owners.
