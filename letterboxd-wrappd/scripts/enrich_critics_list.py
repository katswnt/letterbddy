#!/usr/bin/env python3
"""Enrich a Letterboxd critics list CSV with TMDb data for the Watchlist Builder.

Reads a Letterboxd list export CSV (Position, Name, Year, URL), resolves URLs,
fetches TMDb details + credits, checks against criterion/black-directors slug lists,
and outputs a flat JSON array ready for the frontend.

Usage:
  python scripts/enrich_critics_list.py \
    --csv /path/to/critics-list.csv \
    --out public/critics-enriched.json

Requires TMDB_API_KEY env var or --tmdb-api-key flag.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import StringIO
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

import requests

SESSION = requests.Session()

# ---------------------------------------------------------------------------
# Persistent cache (reuses format from scrape_tmdb_ids.py)
# ---------------------------------------------------------------------------
CACHE_VERSION = 1


def load_cache(path: str) -> dict[str, Any]:
    p = Path(path)
    try:
        if not p.exists():
            return _empty_cache()
        data = json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or data.get("version") != CACHE_VERSION:
            return _empty_cache()
        for key in ("shortlink_to_film", "film_to_tmdb", "tmdb_movie_data"):
            data.setdefault(key, {})
        return data
    except Exception:
        return _empty_cache()


def _empty_cache() -> dict[str, Any]:
    return {
        "version": CACHE_VERSION,
        "shortlink_to_film": {},
        "film_to_tmdb": {},
        "tmdb_movie_data": {},
    }


def save_cache(path: str, cache: dict[str, Any]) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, p)


# ---------------------------------------------------------------------------
# URL helpers
# ---------------------------------------------------------------------------
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}

TMDB_MOVIE_RE = re.compile(r"https?://(?:www\.)?themoviedb\.org/movie/(\d+)")


def expand_shortlink(url: str, cache: dict[str, Any]) -> str:
    cached = cache.get("shortlink_to_film", {}).get(url)
    if isinstance(cached, str) and cached:
        return cached
    try:
        resp = SESSION.head(url, headers=HEADERS, timeout=15, allow_redirects=True)
        final = resp.url
        if final:
            cache.setdefault("shortlink_to_film", {})[url] = final
            return final
    except Exception:
        pass
    try:
        resp = SESSION.get(url, headers=HEADERS, timeout=15, allow_redirects=True)
        final = resp.url
        if final:
            cache.setdefault("shortlink_to_film", {})[url] = final
            return final
    except Exception:
        pass
    return url


def extract_slug(url: str) -> Optional[str]:
    m = re.search(r"/film/([^/]+)", url)
    return m.group(1) if m else None


def canonicalize(url: str, cache: dict[str, Any]) -> Optional[str]:
    """Return canonical /film/<slug>/ URL, resolving shortlinks as needed."""
    url = url.strip()
    if not url:
        return None
    if "boxd.it" in url:
        url = expand_shortlink(url, cache)
    m = re.search(r"https?://letterboxd\.com/(?:[^/]+/)?film/([^/]+)", url)
    if m:
        return f"https://letterboxd.com/film/{m.group(1)}/"
    return None


# ---------------------------------------------------------------------------
# CSV reading (Letterboxd list export format)
# ---------------------------------------------------------------------------
def read_list_csv(csv_path: str) -> List[dict]:
    """Read a Letterboxd list export CSV. Returns list of {position, name, year, url}."""
    with open(csv_path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    # Find the data header (starts with "Position,")
    data_start = 0
    for i, line in enumerate(lines):
        if line.strip().startswith("Position,"):
            data_start = i
            break

    csv_text = "".join(lines[data_start:])
    reader = csv.DictReader(StringIO(csv_text))
    rows = []
    for row in reader:
        url = (row.get("URL") or row.get("Url") or "").strip()
        name = (row.get("Name") or "").strip()
        year = (row.get("Year") or "").strip()
        position = (row.get("Position") or "").strip()
        if url.startswith("http"):
            rows.append({
                "position": int(position) if position.isdigit() else len(rows) + 1,
                "name": name,
                "year": int(year) if year.isdigit() else 0,
                "url": url,
            })
    return rows


# ---------------------------------------------------------------------------
# TMDb fetching
# ---------------------------------------------------------------------------
def scrape_tmdb_id(film_url: str, cache: dict[str, Any]) -> Optional[int]:
    """Scrape TMDb ID from a Letterboxd film page (with cache)."""
    cached = cache.get("film_to_tmdb", {}).get(film_url)
    if isinstance(cached, int):
        return cached
    try:
        resp = SESSION.get(film_url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        m = TMDB_MOVIE_RE.search(resp.text)
        if m:
            tmdb_id = int(m.group(1))
            cache.setdefault("film_to_tmdb", {})[film_url] = tmdb_id
            return tmdb_id
    except Exception as e:
        print(f"  TMDb scrape error for {film_url}: {e}", file=sys.stderr)
    return None


def fetch_tmdb_details(tmdb_id: int, api_key: str) -> Optional[dict]:
    try:
        resp = SESSION.get(
            f"https://api.themoviedb.org/3/movie/{tmdb_id}",
            params={"api_key": api_key, "language": "en-US"},
            headers={"Accept": "application/json"},
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"  TMDb details error for {tmdb_id}: {e}", file=sys.stderr)
        return None


def fetch_tmdb_credits(tmdb_id: int, api_key: str) -> Optional[dict]:
    try:
        resp = SESSION.get(
            f"https://api.themoviedb.org/3/movie/{tmdb_id}/credits",
            params={"api_key": api_key, "language": "en-US"},
            headers={"Accept": "application/json"},
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"  TMDb credits error for {tmdb_id}: {e}", file=sys.stderr)
        return None


# ---------------------------------------------------------------------------
# Main enrichment pipeline
# ---------------------------------------------------------------------------
def enrich(rows: List[dict], *, api_key: str, cache: dict[str, Any],
           criterion_slugs: Set[str], black_director_slugs: Set[str],
           sleep_s: float = 0.25) -> List[dict]:
    """Enrich list rows with TMDb data. Returns flat JSON-ready dicts."""
    total = len(rows)
    results: List[dict] = []
    tmdb_cache = cache.get("tmdb_movie_data", {})

    for i, row in enumerate(rows, start=1):
        url = row["url"]
        canonical = canonicalize(url, cache)
        if not canonical:
            print(f"  [{i}/{total}] Could not resolve: {url}", file=sys.stderr)
            continue

        slug = extract_slug(canonical) or ""
        name = row["name"]
        year = row["year"]
        position = row["position"]

        # --- TMDb ID ---
        tmdb_id = scrape_tmdb_id(canonical, cache)
        if not tmdb_id:
            print(f"  [{i}/{total}] No TMDb ID: {name} ({year})", file=sys.stderr)
            continue

        # --- TMDb details + credits (cached) ---
        cache_key = str(tmdb_id)
        cached_data = tmdb_cache.get(cache_key)
        network_used = False

        if cached_data and "directed_by_woman" in cached_data:
            tmdb_data = cached_data
        else:
            details = fetch_tmdb_details(tmdb_id, api_key)
            credits = fetch_tmdb_credits(tmdb_id, api_key)
            network_used = True
            if not details:
                print(f"  [{i}/{total}] TMDb details failed: {name}", file=sys.stderr)
                continue

            # Production countries
            country_codes = [c.get("iso_3166_1") for c in details.get("production_countries", []) if c.get("iso_3166_1")]
            original_language = details.get("original_language", "")

            # Directors + writers from credits
            crew = (credits or {}).get("crew", [])
            directors = [
                {"name": p.get("name"), "gender": p.get("gender")}
                for p in crew if p.get("job") == "Director"
            ]
            writer_jobs = ["Writer", "Screenplay", "Story", "Characters"]
            writers = [
                {"name": p.get("name"), "gender": p.get("gender")}
                for p in crew if p.get("job") in writer_jobs
            ]

            tmdb_data = {
                "title": details.get("title"),
                "vote_average": details.get("vote_average"),
                "vote_count": details.get("vote_count"),
                "popularity": details.get("popularity"),
                "runtime": details.get("runtime"),
                "genres": [g.get("name") for g in details.get("genres", [])],
                "directors": directors,
                "writers": writers,
                "production_countries": {"codes": country_codes},
                "original_language": original_language,
                "is_american": "US" in country_codes,
                "is_english": original_language == "en",
                "directed_by_woman": any(d.get("gender") == 1 for d in directors),
                "written_by_woman": any(w.get("gender") == 1 for w in writers),
            }
            tmdb_cache[cache_key] = tmdb_data

        # Build output record
        country_codes = tmdb_data.get("production_countries", {}).get("codes", [])
        directors = tmdb_data.get("directors", [])

        film = {
            "slug": slug,
            "title": tmdb_data.get("title") or name,
            "year": year,
            "url": canonical,
            "vote_average": tmdb_data.get("vote_average", 0),
            "vote_count": tmdb_data.get("vote_count", 0),
            "popularity": tmdb_data.get("popularity", 0),
            "runtime": tmdb_data.get("runtime"),
            "genres": tmdb_data.get("genres", []),
            "directors": directors,
            "countries": country_codes,
            "original_language": tmdb_data.get("original_language", ""),
            "is_american": tmdb_data.get("is_american", False),
            "is_english": tmdb_data.get("is_english", False),
            "directed_by_woman": tmdb_data.get("directed_by_woman", False),
            "written_by_woman": tmdb_data.get("written_by_woman", False),
            "is_criterion": slug in criterion_slugs,
            "is_black_director": slug in black_director_slugs,
            "position": position,
        }
        results.append(film)

        if i % 25 == 0 or i == total:
            print(f"  [{i}/{total}] Enriched {len(results)} films so far", file=sys.stderr, flush=True)

        if network_used and sleep_s > 0:
            time.sleep(sleep_s)

    return results


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Enrich a Letterboxd critics list with TMDb data")
    p.add_argument("--csv", required=True, help="Path to Letterboxd list export CSV")
    p.add_argument("--out", required=True, help="Output JSON path (e.g. public/critics-enriched.json)")
    p.add_argument("--tmdb-api-key", help="TMDb API key (or set TMDB_API_KEY env var)")
    p.add_argument("--cache", default=str(Path(".cache") / "critics_enrich_cache.json"),
                    help="Path to cache file")
    p.add_argument("--sleep", type=float, default=0.25,
                    help="Delay between TMDb API requests (seconds)")
    return p.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    api_key = args.tmdb_api_key or os.environ.get("TMDB_API_KEY")
    if not api_key:
        print("Error: TMDB_API_KEY not set. Use --tmdb-api-key or set env var.", file=sys.stderr)
        return 1

    # Load cache
    cache = load_cache(args.cache)

    # Load slug lists
    api_dir = Path(__file__).resolve().parent.parent / "api"
    criterion_path = api_dir / "criterion-slugs.json"
    black_dir_path = api_dir / "black-directors-slugs.json"

    criterion_slugs: Set[str] = set()
    if criterion_path.exists():
        criterion_slugs = set(json.loads(criterion_path.read_text(encoding="utf-8")))
        print(f"Loaded {len(criterion_slugs)} Criterion slugs", file=sys.stderr)

    black_director_slugs: Set[str] = set()
    if black_dir_path.exists():
        black_director_slugs = set(json.loads(black_dir_path.read_text(encoding="utf-8")))
        print(f"Loaded {len(black_director_slugs)} Black director slugs", file=sys.stderr)

    # Read CSV
    rows = read_list_csv(args.csv)
    print(f"Read {len(rows)} entries from CSV", file=sys.stderr)

    # Enrich
    results = enrich(
        rows,
        api_key=api_key,
        cache=cache,
        criterion_slugs=criterion_slugs,
        black_director_slugs=black_director_slugs,
        sleep_s=args.sleep,
    )

    # Write output
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(results)} films -> {args.out}")

    # Save cache
    save_cache(args.cache, cache)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
