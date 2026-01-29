#!/usr/bin/env python3
"""Parse all 13 Letterboxd list export CSVs and produce public/curated-lists.json."""

import csv
import json
import os
import sys
import re

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
PUBLIC_DIR = os.path.join(PROJECT_ROOT, "public")

# Manifest: key -> (filename, display name, ranked)
LISTS = {
    "lb-top-250": ("official-top-250-narrative-feature-films.csv", "Official Top 250 Narrative Feature Films", True),
    "imdb-top-250": ("imdb-top-250.csv", "IMDb Top 250", True),
    "sight-sound": ("sight-and-sounds-greatest-films-of-all-time.csv", "Sight & Sound Greatest Films 2022", True),
    "1001-movies": ("1001-movies-you-must-see-before-you-die-2024.csv", "1001 Movies You Must See Before You Die", False),
    "criterion": ("criterion-collection.csv", "Criterion Collection", False),
    "edgar-wright": ("edgar-wrights-1000-favorite-movies.csv", "Edgar Wright's 1,000 Favorites", True),
    "ebert": ("roger-eberts-great-movies.csv", "Roger Ebert's Great Movies", False),
    "afi-100": ("afis-100-years100-movies-10th-anniversary.csv", "AFI 100 Years...100 Movies", True),
    "nyt-100": ("new-york-times-100-best-movies-of-the-21st.csv", "NYT 100 Best of 21st Century", True),
    "oscar-bp": ("oscar-winning-films-best-picture.csv", "Oscar Best Picture Winners", False),
    "cannes-palme": ("cannes-palme-dor-winners.csv", "Cannes Palme d'Or Winners", False),
    "women-dir-250": ("women-directors-the-official-top-250-narrative.csv", "Women Directors Top 250", True),
    "black-dir-250": ("black-directors-the-official-top-250-narrative.csv", "Black Directors Top 250", True),
}

LETTERBOXD_FILM_RE = re.compile(r"https?://letterboxd.com/(?:[^/]+/)?film/([^/]+)/?", re.I)


def normalize_url(url):
    if not url:
        return ""
    cleaned = url.strip().rstrip("/")
    match = LETTERBOXD_FILM_RE.match(cleaned)
    if match:
        slug = match.group(1)
        return f"https://letterboxd.com/film/{slug}/"
    return cleaned


def parse_list_csv(filepath):
    """Parse a Letterboxd list export v7 CSV. Returns list of (position, name, year, url)."""
    films = []
    with open(filepath, "r", encoding="utf-8") as f:
        lines = f.readlines()

    # Find the data header line starting with "Position,"
    header_idx = None
    for i, line in enumerate(lines):
        if line.startswith("Position,"):
            header_idx = i
            break

    if header_idx is None:
        print(f"  WARNING: Could not find data header in {filepath}", file=sys.stderr)
        return films

    data_text = "".join(lines[header_idx:])
    reader = csv.DictReader(data_text.splitlines())
    for row in reader:
        position = int(row["Position"])
        name = row["Name"]
        year_str = row.get("Year", "")
        year = int(year_str) if year_str else None
        url = normalize_url(row["URL"])
        films.append((position, name, year, url))

    return films


def main():
    # url -> {name, year, lists: {key: position}}
    films_by_url = {}
    lists_manifest = {}

    for key, (filename, display_name, ranked) in LISTS.items():
        filepath = os.path.join(PUBLIC_DIR, filename)
        if not os.path.exists(filepath):
            print(f"  WARNING: Missing file {filename}", file=sys.stderr)
            continue

        films = parse_list_csv(filepath)
        lists_manifest[key] = {"name": display_name, "count": len(films), "ranked": ranked}
        print(f"  {key}: {len(films)} films")

        for position, name, year, url in films:
            if url not in films_by_url:
                films_by_url[url] = {"name": name, "year": year, "url": url, "lists": {}}
            films_by_url[url]["lists"][key] = position

    # Build films array with listCount, sorted by listCount desc then name asc
    films_array = []
    for film in films_by_url.values():
        film["listCount"] = len(film["lists"])
        films_array.append(film)

    films_array.sort(key=lambda f: (-f["listCount"], f["name"]))

    output = {"lists": lists_manifest, "films": films_array}
    out_path = os.path.join(PUBLIC_DIR, "curated-lists.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\nWrote {out_path}")
    print(f"  {len(lists_manifest)} lists, {len(films_array)} unique films")

    # Spot-check: top films by listCount
    print("\nTop 10 films by list count:")
    for film in films_array[:10]:
        print(f"  {film['listCount']} lists — {film['name']} ({film['year']})")


if __name__ == "__main__":
    main()
