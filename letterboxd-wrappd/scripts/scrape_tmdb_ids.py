#!/usr/bin/env python3
"""Build a movie index from a CSV of Letterboxd diary/list data.

Goal
- Read a CSV (your diary export or any sheet you saved as CSV) and pull out all
  Letterboxd film URLs.
- Store them in a Python-friendly structure (a dict keyed by URL), optionally
  enriching each with a TMDb movie ID scraped from the Letterboxd film page.
- Write the result to JSON so you can load it later for analysis.

Inputs
- --csv PATH: path to a CSV file
- --uri-column NAME (optional): the column name that contains the Letterboxd film URL.
  If omitted, the script will try a few common column names and also fall back to
  scanning for any cell that looks like a Letterboxd film URL.

Outputs
- --out PATH: JSON file containing a dict keyed by letterboxd_url

Example
  python scripts/scrape_tmdb_ids.py --csv diary.csv --out movies.json --enrich-tmdb

Then in Python:
  import json
  movies = json.load(open('movies.json'))
  # movies is a dict: {"https://letterboxd.com/film/parasite-2019/": { ... }, ...}
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, Iterable, List, Optional, Set
import os
from pathlib import Path
from typing import Any
import requests

SESSION = requests.Session()

# -----------------
# Persistent caching
# -----------------
CACHE_VERSION = 1

def load_cache(path: str) -> dict[str, Any]:
    p = Path(path)
    try:
        if not p.exists():
            return {
                "version": CACHE_VERSION,
                "shortlink_to_film": {},
                "film_to_tmdb": {},
                "list_cache": {},
                "tmdb_movie_data": {},
            }
        data = json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or data.get("version") != CACHE_VERSION:
            return {
                "version": CACHE_VERSION,
                "shortlink_to_film": {},
                "film_to_tmdb": {},
                "list_cache": {},
                "tmdb_movie_data": {},
            }
        data.setdefault("shortlink_to_film", {})
        data.setdefault("film_to_tmdb", {})
        data.setdefault("list_cache", {})
        data.setdefault("tmdb_movie_data", {})
        return data
    except Exception:
        return {
            "version": CACHE_VERSION,
            "shortlink_to_film": {},
            "film_to_tmdb": {},
            "list_cache": {},
            "tmdb_movie_data": {},
        }

def save_cache(path: str, cache: dict[str, Any]) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, p)


# Helper to compute a stable cache key for a list CSV.
def _list_cache_key(list_csv_path: str, uri_column: Optional[str]) -> str:
    """Build a stable cache key for a list CSV.

    We include the resolved absolute path + mtime so edits to the list file invalidate the cache.
    We include uri_column because it changes how URLs are extracted.
    """
    try:
        p = Path(list_csv_path).resolve()
        mtime = os.path.getmtime(p)
        return f"{p}|{mtime}|{uri_column or ''}"
    except Exception:
        return f"{list_csv_path}|{uri_column or ''}"

# Extract TMDb *movie* IDs embedded on Letterboxd pages.
TMDB_MOVIE_RE = re.compile(r"https?://(?:www\.)?themoviedb\.org/movie/(\d+)")

# Matches canonical film URLs and user-scoped film URLs:
# - https://letterboxd.com/film/<slug>/
# - https://letterboxd.com/<username>/film/<slug>/
LETTERBOXD_FILM_RE = re.compile(r"https?://letterboxd\.com/(?:[^/]+/)?film/[^\s\"\'>]+")
LETTERBOXD_SHORT_RE = re.compile(r"https?://boxd\.it/[^\s\"\'>]+")


def normalize_letterboxd_url(url: str) -> str:
    url = url.strip()
    if not url:
        return url
    # Drop URL fragments.
    url = url.split("#", 1)[0]
    # Ensure trailing slash for consistency.
    if not url.endswith("/"):
        url += "/"
    return url

def canonicalize_letterboxd_film_url(url: str) -> str:
    """Convert user-scoped film URLs to canonical /film/<slug>/ URLs.

    Example:
      https://letterboxd.com/katswnt/film/22-jump-street/ -> https://letterboxd.com/film/22-jump-street/
    """
    url = normalize_letterboxd_url(url)
    m = re.search(r"https?://letterboxd\.com/(?:[^/]+/)?film/([^/]+)/", url)
    if not m:
        return ""
    slug = m.group(1)
    return f"https://letterboxd.com/film/{slug}/"

def resolve_letterboxd_film_url(url: str, *, timeout: int = 30, cache: dict[str, Any] | None = None) -> str:
    """Return a normalized letterboxd.com/film/... URL.

    Accepts either a full film URL or a boxd.it shortlink.
    """
    url = url.strip()
    if not url:
        return url

    # Expand short links.
    if "boxd.it/" in url:
        url = expand_boxd_shortlink(url, timeout=timeout, cache=cache)

    # Normalize and canonicalize to /film/<slug>/
    url = normalize_letterboxd_url(url)
    url = canonicalize_letterboxd_film_url(url)

    return url


class CloudflareBlockedError(Exception):
    """Raised when Cloudflare blocks the request with a challenge page."""
    pass


def fetch_html(url: str, *, timeout: int = 30) -> str:
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
    }
    resp = SESSION.get(url, headers=headers, timeout=timeout)
    resp.raise_for_status()
    html = resp.text

    # Detect Cloudflare challenge page
    if "Just a moment" in html or "cf-browser-verification" in html or "challenge-platform" in html:
        raise CloudflareBlockedError(f"Cloudflare blocked request to {url}")

    return html


def expand_boxd_shortlink(url: str, *, timeout: int = 30, cache: dict[str, Any] | None = None) -> str:
    """Resolve https://boxd.it/... to its final Letterboxd URL via redirects."""
    if cache is not None:
        cached = cache.get("shortlink_to_film", {}).get(url)
        if isinstance(cached, str) and cached:
            return cached
    # Prefer HEAD (lighter), but fall back to GET because some sites don't fully support HEAD.
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
    }
    try:
        resp = SESSION.head(url, headers=headers, timeout=timeout, allow_redirects=True)
        final_url = resp.url
        if final_url:
            if cache is not None:
                cache["shortlink_to_film"][url] = final_url
            return final_url
    except Exception:
        pass

    resp = SESSION.get(url, headers=headers, timeout=timeout, allow_redirects=True)
    final_url = resp.url
    if cache is not None and final_url:
        cache["shortlink_to_film"][url] = final_url
    return final_url


def letterboxd_film_to_tmdb_id(film_url: str, *, timeout: int = 30) -> int:
    """Return the TMDb movie ID for a Letterboxd film URL.

    Raises:
        requests.HTTPError: if the page request fails
        ValueError: if a TMDb movie link can't be found in the HTML
    """
    html = fetch_html(film_url, timeout=timeout)
    m = TMDB_MOVIE_RE.search(html)
    if not m:
        raise ValueError("TMDb movie link not found in page HTML")
    return int(m.group(1))


def extract_urls_from_row(row: Dict[str, str]) -> List[str]:
    urls: List[str] = []
    for v in row.values():
        if not v:
            continue
        # Ensure v is a string (CSV values might be other types)
        v_str = str(v) if v is not None else ""
        if not v_str:
            continue
        for m in LETTERBOXD_FILM_RE.finditer(v_str):
            urls.append(m.group(0))
        for m in LETTERBOXD_SHORT_RE.finditer(v_str):
            urls.append(m.group(0))
    return urls


def guess_uri_column(fieldnames: List[str]) -> Optional[str]:
    if not fieldnames:
        return None

    candidates = [
        "Letterboxd URI",
        "Letterboxd URL",
        "Letterboxd",
        "URI",
        "Url",
        "URL",
        "Link",
        "Film",
        "Film URL",
        "film_url",
        "link",
        "uri",
    ]
    lower_map = {name.lower(): name for name in fieldnames}
    for c in candidates:
        if c.lower() in lower_map:
            return lower_map[c.lower()]
    return None


def read_letterboxd_film_urls(csv_path: str, uri_column: Optional[str], *, timeout: int, cache: dict[str, Any] | None = None) -> tuple[List[str], Dict[str, str]]:
    """Read unique Letterboxd film URLs from a CSV."""
    print("PHASE loading_csv", file=sys.stderr, flush=True)
    raw: List[str] = []

    with open(csv_path, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames is None:
            raise ValueError("CSV has no header row; export with headers and try again")

        chosen_col = uri_column or guess_uri_column(reader.fieldnames)

        for row in reader:
            if chosen_col and row.get(chosen_col):
                raw.append(row[chosen_col])
            else:
                raw.extend(extract_urls_from_row(row))

    # Phase 2: resolve (expands boxd.it, canonicalizes to /film/<slug>/)
    raw = [r for r in (r.strip() for r in raw) if r]
    seen_raw: Set[str] = set()
    deduped_raw: List[str] = []
    for r in raw:
        if r in seen_raw:
            continue
        seen_raw.add(r)
        deduped_raw.append(r)
    raw = deduped_raw
    total = len(raw)
    if total == 0:
        return [], {}

    print("PHASE resolve", file=sys.stderr, flush=True)

    urls: Set[str] = set()
    uri_map: Dict[str, str] = {}

    # Use parallel requests for URL resolution (10 concurrent workers)
    def resolve_one(u: str) -> tuple[str, str | None]:
        resolved = resolve_letterboxd_film_url(u, timeout=timeout, cache=cache)
        return (u, resolved)

    completed = 0
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(resolve_one, u): u for u in raw}
        for future in as_completed(futures):
            u, resolved = future.result()
            if resolved:
                urls.add(resolved)
                uri_map[u] = resolved
            completed += 1
            print(f"PROGRESS {completed} {total}", file=sys.stderr, flush=True)

    return sorted(urls), uri_map


def build_index(urls: Iterable[str]) -> Dict[str, dict]:
    """Return a dict keyed by film URL with a place to attach attributes."""
    return {
        url: {
            "letterboxd_url": url,
            # Add whatever you want here as you grow the pipeline:
            "tmdb_movie_id": None,
            "tags": [],
            "notes": "",
            "attrs": {},
            "is_in_criterion_collection": False,  # Will be set if list provided
        }
        for url in urls
    }


def load_letterboxd_list(list_csv_path: str, uri_column: Optional[str], *, timeout: int, cache: dict[str, Any] | None = None) -> Set[str]:
    """Load Letterboxd film URLs from a list CSV file.
    
    Returns a set of normalized Letterboxd film URLs.
    """
    print("PHASE list_read", file=sys.stderr, flush=True)

    if not list_csv_path or not os.path.exists(list_csv_path):
        return set()

    # Fast path: reuse cached resolved URLs for this list if available
    if cache is not None:
        key = _list_cache_key(list_csv_path, uri_column)
        entry = cache.get("list_cache", {}).get(key)
        if isinstance(entry, dict) and isinstance(entry.get("resolved_urls"), list):
            resolved = {str(u) for u in entry["resolved_urls"] if u}
            if resolved:
                print("PHASE list_cache_hit", file=sys.stderr, flush=True)
                print("PROGRESS 1 1", file=sys.stderr, flush=True)
                return resolved

    raw: List[str] = []

    with open(list_csv_path, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames is None:
            print(f"Warning: List CSV {list_csv_path} has no header row, skipping", file=sys.stderr)
            return set()

        chosen_col = uri_column or guess_uri_column(reader.fieldnames)

        for row in reader:
            if chosen_col and row.get(chosen_col):
                val = row[chosen_col]
                if val:
                    raw.append(str(val))
            else:
                raw.extend(extract_urls_from_row(row))

    # Resolve URLs (expand boxd.it, canonicalize)
    raw = [r for r in (r.strip() for r in raw) if r]
    if not raw:
        return set()

    # Deduplicate raw list values while preserving order
    seen_raw: Set[str] = set()
    deduped_raw: List[str] = []
    for r in raw:
        if r in seen_raw:
            continue
        seen_raw.add(r)
        deduped_raw.append(r)
    raw = deduped_raw

    total = len(raw)
    print("PHASE list_resolve", file=sys.stderr, flush=True)

    resolved_urls: Set[str] = set()
    for i, u in enumerate(raw, start=1):
        resolved = resolve_letterboxd_film_url(u, timeout=timeout, cache=cache)
        if resolved:
            resolved_urls.add(resolved)
        print(f"PROGRESS {i} {total}", file=sys.stderr, flush=True)

    if cache is not None:
        key = _list_cache_key(list_csv_path, uri_column)
        cache.setdefault("list_cache", {})[key] = {
            "resolved_urls": sorted(resolved_urls),
        }
    return resolved_urls


def mark_list_membership(index: Dict[str, dict], list_urls: Set[str]) -> None:
    """Mark movies in the index that are in the provided list.
    
    For Criterion Collection, this would mark is_in_criterion_collection=True.
    """
    for url, data in index.items():
        if url in list_urls:
            data["is_in_criterion_collection"] = True


def fetch_tmdb_movie_details(tmdb_id: int, *, api_key: str, timeout: int = 30) -> dict:
    """Fetch movie details from TMDb API.

    Returns a dict with movie information like title, release_date, overview, etc.
    """
    url = f"https://api.themoviedb.org/3/movie/{tmdb_id}"
    params = {
        "api_key": api_key,
        "language": "en-US",
    }
    headers = {
        "Accept": "application/json",
    }
    resp = SESSION.get(url, params=params, headers=headers, timeout=timeout)
    resp.raise_for_status()
    return resp.json()


def fetch_tmdb_movie_credits(tmdb_id: int, *, api_key: str, timeout: int = 30) -> dict:
    """Fetch movie credits from TMDb API.

    Returns a dict with cast and crew information.
    """
    url = f"https://api.themoviedb.org/3/movie/{tmdb_id}/credits"
    params = {
        "api_key": api_key,
        "language": "en-US",
    }
    headers = {
        "Accept": "application/json",
    }
    resp = SESSION.get(url, params=params, headers=headers, timeout=timeout)
    resp.raise_for_status()
    return resp.json()


def enrich_with_tmdb(
    index: Dict[str, dict],
    *,
    timeout: int,
    sleep_s: float,
    api_key: Optional[str] = None,
    cache: dict[str, Any] | None = None,
) -> None:
    """Mutates index in place by filling tmdb_movie_id when possible.
    
    If api_key is provided, also fetches movie details from TMDb API.
    """
    film_to_tmdb = cache.get("film_to_tmdb", {}) if cache is not None else {}

    # ----------------------------
    # Pass 1: Letterboxd -> TMDb ID
    # ----------------------------
    print("PHASE letterboxd_scrape", file=sys.stderr, flush=True)
    total = len(index)

    def scrape_one(url: str) -> tuple[str, int | None, str | None]:
        """Scrape TMDb ID for a single Letterboxd URL. Returns (url, tmdb_id, error)."""
        # Cache hit: skip scraping Letterboxd page
        if url in film_to_tmdb and isinstance(film_to_tmdb[url], int):
            return (url, int(film_to_tmdb[url]), None)
        try:
            tmdb_id = letterboxd_film_to_tmdb_id(url, timeout=timeout)
            return (url, tmdb_id, None)
        except Exception as e:
            return (url, None, str(e))

    # Use parallel requests (10 concurrent workers)
    completed = 0
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(scrape_one, url): url for url in index.keys()}
        for future in as_completed(futures):
            url, tmdb_id, error = future.result()
            data = index[url]
            if tmdb_id is not None:
                data["tmdb_movie_id"] = tmdb_id
                if cache is not None and url not in film_to_tmdb:
                    film_to_tmdb[url] = int(tmdb_id)
            elif error:
                data["tmdb_error"] = error
            completed += 1
            print(f"PROGRESS {completed} {total}", file=sys.stderr, flush=True)

    # ------------------------------------
    # Pass 2: TMDb API -> details + credits
    # ------------------------------------
    if api_key:
        print("PHASE tmdb_api", file=sys.stderr, flush=True)
        tmdb_movie_data_cache = cache.get("tmdb_movie_data", {}) if cache is not None else {}

        for i, (url, data) in enumerate(index.items(), start=1):
            tmdb_id = data.get("tmdb_movie_id")
            if not isinstance(tmdb_id, int):
                print(f"PROGRESS {i} {total}", file=sys.stderr, flush=True)
                continue

            # Check cache first
            cache_key = str(tmdb_id)
            if cache_key in tmdb_movie_data_cache:
                data["tmdb_data"] = tmdb_movie_data_cache[cache_key]
                print(f"PROGRESS {i} {total}", file=sys.stderr, flush=True)
                continue  # Skip API calls and sleep

            network_used = False
            try:
                tmdb_data = fetch_tmdb_movie_details(tmdb_id, api_key=api_key, timeout=timeout)
                network_used = True

                # Extract production countries (for American/not American classification)
                production_countries = tmdb_data.get("production_countries", [])
                country_codes = [c.get("iso_3166_1") for c in production_countries if c.get("iso_3166_1")]
                country_names = [c.get("name") for c in production_countries if c.get("name")]

                # Extract spoken languages (for reference)
                spoken_languages = tmdb_data.get("spoken_languages", [])
                language_codes = [l.get("iso_639_1") for l in spoken_languages if l.get("iso_639_1")]
                language_names = [l.get("name") for l in spoken_languages if l.get("name")]

                # Get original/primary language (the main language of the film)
                original_language = tmdb_data.get("original_language", "")

                # Helper flags for easy filtering
                is_american = "US" in country_codes
                # Use original_language to determine if primarily in English
                # (not spoken_languages, which includes ANY language spoken)
                is_english = original_language == "en"

                # Fetch credits to get director and writer gender information
                credits_data: dict = {}
                directors: list = []
                writers: list = []
                directed_by_woman = False
                written_by_woman = False

                try:
                    credits = fetch_tmdb_movie_credits(tmdb_id, api_key=api_key, timeout=timeout)
                    crew = credits.get("crew", [])

                    directors = [
                        {"name": person.get("name"), "gender": person.get("gender")}
                        for person in crew
                        if person.get("job") == "Director"
                    ]

                    writer_jobs = ["Writer", "Screenplay", "Story", "Characters"]
                    writers = [
                        {"name": person.get("name"), "job": person.get("job"), "gender": person.get("gender")}
                        for person in crew
                        if person.get("job") in writer_jobs
                    ]

                    directed_by_woman = any(d.get("gender") == 1 for d in directors)
                    written_by_woman = any(w.get("gender") == 1 for w in writers)

                    credits_data = {
                        "directors": directors,
                        "writers": writers,
                        "directed_by_woman": directed_by_woman,
                        "written_by_woman": written_by_woman,
                    }
                except Exception as credits_error:
                    credits_data["credits_error"] = str(credits_error)

                data["tmdb_data"] = {
                    "title": tmdb_data.get("title"),
                    "original_title": tmdb_data.get("original_title"),
                    "original_language": original_language,
                    "release_date": tmdb_data.get("release_date"),
                    "overview": tmdb_data.get("overview"),
                    "runtime": tmdb_data.get("runtime"),
                    "genres": [g.get("name") for g in tmdb_data.get("genres", [])],
                    "popularity": tmdb_data.get("popularity"),
                    "vote_average": tmdb_data.get("vote_average"),
                    "vote_count": tmdb_data.get("vote_count"),
                    "poster_path": tmdb_data.get("poster_path"),
                    "backdrop_path": tmdb_data.get("backdrop_path"),
                    "production_countries": {"codes": country_codes, "names": country_names},
                    "is_american": is_american,
                    "spoken_languages": {"codes": language_codes, "names": language_names},
                    "is_english": is_english,
                    **credits_data,
                }

                # Cache the TMDb data for future runs
                if cache is not None:
                    tmdb_movie_data_cache[cache_key] = data["tmdb_data"]

            except Exception as e:
                data["tmdb_api_error"] = str(e)

            print(f"PROGRESS {i} {total}", file=sys.stderr, flush=True)
            # Only sleep when we actually hit the network
            if sleep_s > 0 and network_used:
                time.sleep(sleep_s)


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Build a dict of Letterboxd film URLs (optionally enriched with TMDb IDs)")
    p.add_argument("--csv", required=True, help="Path to your CSV (e.g. diary.csv)")
    p.add_argument(
        "--uri-column",
        help='Column name that contains the Letterboxd film URL (yours is "Letterboxd URI"; may contain boxd.it shortlinks)',
    )
    p.add_argument("--out", required=True, help="Where to write JSON output")
    p.add_argument("--enrich-tmdb", action="store_true", help="Scrape each film page to extract TMDb movie ID")
    p.add_argument("--tmdb-api-key", help="TMDb API key to fetch movie details (optional, requires --enrich-tmdb)")
    p.add_argument("--criterion-list", help="Path to CSV file containing Letterboxd list (e.g., Criterion Collection list export) to compare against")
    p.add_argument("--timeout", type=int, default=30, help="HTTP timeout per request (seconds)")
    p.add_argument("--sleep", type=float, default=0.25, help="Delay between TMDb API requests (seconds). TMDb allows 40 req/10s.")
    p.add_argument(
        "--cache",
        default=str(Path(".cache") / "letterboxd_tmdb_cache.json"),
        help="Path to a JSON cache file used to avoid re-resolving boxd.it links and re-scraping TMDb IDs",
    )
    return p.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)

    if not args.tmdb_api_key:
        args.tmdb_api_key = os.environ.get("TMDB_API_KEY")

    cache = load_cache(args.cache)

    urls, uri_map = read_letterboxd_film_urls(args.csv, args.uri_column, timeout=args.timeout, cache=cache)
    if not urls:
        print("No Letterboxd film URLs found in the CSV.", file=sys.stderr)
        return 2

    index = build_index(urls)

    # Load and compare against Criterion Collection list (or any other list)
    if args.criterion_list:
        print("PHASE loading_criterion_list", file=sys.stderr, flush=True)
        list_urls = load_letterboxd_list(args.criterion_list, args.uri_column, timeout=args.timeout, cache=cache)
        print(f"Loaded {len(list_urls)} films from list", file=sys.stderr, flush=True)
        mark_list_membership(index, list_urls)
        print(f"Marked {sum(1 for d in index.values() if d.get('is_in_criterion_collection'))} films as in the list", file=sys.stderr, flush=True)

    if args.enrich_tmdb:
        enrich_with_tmdb(index, timeout=args.timeout, sleep_s=args.sleep, api_key=args.tmdb_api_key, cache=cache)

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump({"movieIndex": index, "uriMap": uri_map}, f, ensure_ascii=False, indent=2)

    save_cache(args.cache, cache)

    print(f"Wrote {len(index)} films -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())