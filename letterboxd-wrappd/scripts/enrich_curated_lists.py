#!/usr/bin/env python3
"""Enrich curated-lists.json with TMDb data and Black directors flag."""

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Dict, Optional

import requests

SESSION = requests.Session()

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
PUBLIC_DIR = PROJECT_ROOT / "public"
CACHE_PATH = PROJECT_ROOT / ".cache" / "curated_tmdb_cache.json"
LETTERBOXD_CACHE_PATH = PROJECT_ROOT / ".cache" / "letterboxd_tmdb_cache.json"
BLACK_DIRECTORS_CSV = PROJECT_ROOT / "api" / "black-directors.csv"
BLACK_DIRECTORS_SLUGS = PROJECT_ROOT / "api" / "black-directors-slugs.json"

LETTERBOXD_FILM_RE = re.compile(r"https?://letterboxd.com/(?:[^/]+/)?film/([^/]+)/?", re.I)


def normalize_url(url: str) -> str:
    if not url:
        return ""
    cleaned = url.strip().rstrip("/")
    match = LETTERBOXD_FILM_RE.match(cleaned)
    if match:
        slug = match.group(1)
        return f"https://letterboxd.com/film/{slug}/"
    return cleaned


def extract_slug(url: str) -> str:
    match = LETTERBOXD_FILM_RE.match(url or "")
    return match.group(1).lower() if match else ""


def load_json(path: Path, default):
    try:
        if not path.exists():
            return default
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def save_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def normalize_title(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (value or "").lower())


def load_black_director_sets() -> tuple[set[str], set[str]]:
    slug_set: set[str] = set()
    url_set: set[str] = set()

    data = load_json(BLACK_DIRECTORS_SLUGS, {})
    if isinstance(data, dict):
        slugs = data.get("slugs", [])
        if isinstance(slugs, list):
            slug_set.update([str(s).lower() for s in slugs if s])
    elif isinstance(data, list):
        slug_set.update([str(s).lower() for s in data if s])

    if BLACK_DIRECTORS_CSV.exists():
        import csv

        with BLACK_DIRECTORS_CSV.open("r", encoding="utf-8-sig", newline="") as f:
            lines = list(f)
        header_idx = None
        for i, line in enumerate(lines):
            if line.strip().startswith("Position"):
                header_idx = i
                break
        if header_idx is not None:
            reader = csv.DictReader(lines[header_idx:])
            for row in reader:
                url = normalize_url(row.get("URL", ""))
                if url:
                    url_set.add(url.lower())

    return url_set, slug_set


def expand_shortlink(url: str, cache: dict[str, Any]) -> str:
    if "boxd.it/" not in url:
        return url
    short_map = cache.get("shortlink_to_film", {})
    if isinstance(short_map, dict) and url in short_map:
        return short_map[url]
    short_map = cache.setdefault("shortlink_to_film", {})
    resolved = url
    try:
        resp = SESSION.head(url, allow_redirects=True, timeout=20)
        if resp.status_code >= 400:
            resp = SESSION.get(url, allow_redirects=True, timeout=20)
        resolved = resp.url or url
    except Exception:
        return url
    resolved = normalize_url(resolved)
    short_map[url] = resolved
    return resolved


def tmdb_search(title: str, year: str, api_key: str) -> Optional[dict]:
    params = {"api_key": api_key, "query": title}
    if year:
        params["year"] = year
    resp = SESSION.get("https://api.themoviedb.org/3/search/movie", params=params, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    results = data.get("results") or []
    if not results:
        return None

    norm_title = normalize_title(title)
    for result in results:
        if year and str(result.get("release_date", "")).startswith(str(year)):
            if normalize_title(result.get("title", "")) == norm_title:
                return result

    for result in results:
        if year and str(result.get("release_date", "")).startswith(str(year)):
            return result

    for result in results:
        if normalize_title(result.get("title", "")) == norm_title:
            return result

    return results[0]


def fetch_tmdb_movie(tmdb_id: int, api_key: str) -> dict:
    resp = SESSION.get(f"https://api.themoviedb.org/3/movie/{tmdb_id}", params={"api_key": api_key}, timeout=30)
    resp.raise_for_status()
    return resp.json()


def fetch_tmdb_credits(tmdb_id: int, api_key: str) -> dict:
    resp = SESSION.get(
        f"https://api.themoviedb.org/3/movie/{tmdb_id}/credits",
        params={"api_key": api_key},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def build_tmdb_data(tmdb_id: int, api_key: str) -> dict:
    tmdb_data = fetch_tmdb_movie(tmdb_id, api_key)
    production_countries = tmdb_data.get("production_countries", [])
    country_codes = [c.get("iso_3166_1") for c in production_countries if c.get("iso_3166_1")]
    country_names = [c.get("name") for c in production_countries if c.get("name")]

    spoken_languages = tmdb_data.get("spoken_languages", [])
    language_codes = [l.get("iso_639_1") for l in spoken_languages if l.get("iso_639_1")]
    language_names = [l.get("name") for l in spoken_languages if l.get("name")]

    original_language = tmdb_data.get("original_language", "")
    is_american = "US" in country_codes
    is_english = original_language == "en"

    directors = []
    writers = []
    directed_by_woman = False
    written_by_woman = False

    try:
        credits = fetch_tmdb_credits(tmdb_id, api_key)
        crew = credits.get("crew", [])
        directors = [
            {
                "id": person.get("id"),
                "name": person.get("name"),
                "gender": person.get("gender"),
                "profile_path": person.get("profile_path"),
            }
            for person in crew
            if person.get("job") == "Director"
        ]
        writer_jobs = {"Writer", "Screenplay", "Story", "Characters"}
        writers = [
            {
                "id": person.get("id"),
                "name": person.get("name"),
                "job": person.get("job"),
                "gender": person.get("gender"),
                "profile_path": person.get("profile_path"),
            }
            for person in crew
            if person.get("job") in writer_jobs
        ]
        directed_by_woman = any(d.get("gender") == 1 for d in directors)
        written_by_woman = any(w.get("gender") == 1 for w in writers)
    except Exception as exc:
        return {"tmdb_error": str(exc)}

    return {
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
        "directors": directors,
        "writers": writers,
        "directed_by_woman": directed_by_woman,
        "written_by_woman": written_by_woman,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Enrich curated-lists.json with TMDb data.")
    parser.add_argument("--in", dest="input_path", default=str(PUBLIC_DIR / "curated-lists.json"))
    parser.add_argument("--out", dest="output_path", default=str(PUBLIC_DIR / "curated-lists-enriched.json"))
    parser.add_argument("--tmdb-api-key", dest="tmdb_api_key", default=os.getenv("TMDB_API_KEY", ""))
    parser.add_argument("--sleep", type=float, default=0.25)
    args = parser.parse_args()

    if not args.tmdb_api_key:
        print("Missing TMDB_API_KEY (set env or use --tmdb-api-key).", file=sys.stderr)
        return 1

    data = load_json(Path(args.input_path), {})
    films = data.get("films", [])
    if not isinstance(films, list) or not films:
        print("No films found in curated-lists.json", file=sys.stderr)
        return 1

    cache = load_json(CACHE_PATH, {"tmdb_movie_data": {}, "tmdb_search": {}})
    letterboxd_cache = load_json(LETTERBOXD_CACHE_PATH, {})
    black_url_set, black_slug_set = load_black_director_sets()

    for idx, film in enumerate(films, 1):
        name = str(film.get("name") or "")
        year = str(film.get("year") or "")
        url_raw = str(film.get("url") or "")
        normalized_url = normalize_url(expand_shortlink(url_raw, letterboxd_cache))
        slug = extract_slug(normalized_url)

        film["url"] = normalized_url or url_raw
        film["is_by_black_director"] = False
        if normalized_url.lower() in black_url_set or (slug and slug in black_slug_set):
            film["is_by_black_director"] = True

        if film.get("tmdb_data") and film.get("tmdb_movie_id"):
            continue

        cache_key = f"{name}|{year}"
        if cache_key in cache.get("tmdb_search", {}):
            tmdb_id = cache["tmdb_search"][cache_key]
        else:
            result = tmdb_search(name, year, args.tmdb_api_key)
            tmdb_id = result.get("id") if result else None
            cache["tmdb_search"][cache_key] = tmdb_id

        if not tmdb_id:
            film["tmdb_error"] = "No TMDb match"
            continue

        film["tmdb_movie_id"] = tmdb_id

        tmdb_cache = cache.get("tmdb_movie_data", {})
        cached = tmdb_cache.get(str(tmdb_id))
        if cached and "directed_by_woman" in cached:
            film["tmdb_data"] = cached
            continue

        try:
            tmdb_data = build_tmdb_data(int(tmdb_id), args.tmdb_api_key)
            film["tmdb_data"] = tmdb_data
            if "tmdb_error" not in tmdb_data:
                tmdb_cache[str(tmdb_id)] = tmdb_data
        except Exception as exc:
            film["tmdb_error"] = str(exc)

        if args.sleep:
            time.sleep(args.sleep)

        if idx % 50 == 0:
            save_json(CACHE_PATH, cache)
            print(f"Enriched {idx}/{len(films)} films")

    save_json(CACHE_PATH, cache)
    save_json(Path(args.output_path), data)
    print(f"Wrote {args.output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
