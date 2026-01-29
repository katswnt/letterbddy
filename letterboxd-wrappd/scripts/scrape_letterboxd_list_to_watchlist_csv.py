#!/usr/bin/env python3
import argparse
import csv
import datetime as dt
import re
import sys
from typing import List, Optional, Tuple
from urllib.parse import urljoin

try:
    import requests
except Exception:
    print("Missing dependency: requests. Install with: pip install requests", file=sys.stderr)
    raise

try:
    from bs4 import BeautifulSoup
except Exception:
    print("Missing dependency: beautifulsoup4. Install with: pip install beautifulsoup4", file=sys.stderr)
    raise

FILM_HREF_RE = re.compile(r"^/film/[^/]+/?$")
YEAR_RE = re.compile(r"\b(18|19|20)\d{2}\b")


def guess_year(container_text: str) -> Optional[str]:
    match = YEAR_RE.search(container_text)
    return match.group(0) if match else None


def extract_entries(html: str, base_url: str) -> List[Tuple[str, str, str]]:
    soup = BeautifulSoup(html, "html.parser")

    anchors = soup.select('li a[href^="/film/"]')
    if not anchors:
        anchors = soup.select('div a[href^="/film/"]')
    if not anchors:
        anchors = soup.select('a[href^="/film/"]')

    results: List[Tuple[str, str, str]] = []
    seen = set()

    for a in anchors:
        href = a.get("href")
        if not href or not FILM_HREF_RE.match(href):
            continue

        title = a.get_text(strip=True)
        if not title:
            continue

        year = None
        parent = a.find_parent(["li", "div", "section", "article"])
        if parent:
            year = guess_year(parent.get_text(" ", strip=True))

        if not year:
            sib_text = " ".join(
                s.get_text(" ", strip=True)
                for s in a.find_all_next(limit=4)
                if getattr(s, "get_text", None)
            )
            year = guess_year(sib_text)

        if not year:
            continue

        url = urljoin(base_url, href)
        key = (title, year, url)
        if key in seen:
            continue
        seen.add(key)
        results.append(key)

    return results


def fetch(url: str) -> str:
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Cache-Control": "max-age=0",
    }
    resp = requests.get(url, headers=headers, timeout=30)
    resp.raise_for_status()
    return resp.text


def main() -> int:
    parser = argparse.ArgumentParser(description="Scrape a Letterboxd list into watchlist-style CSV.")
    parser.add_argument("list_url", help="Letterboxd list URL")
    parser.add_argument("output_csv", help="Output CSV path")
    parser.add_argument(
        "--date",
        default=dt.date.today().isoformat(),
        help="Date to write in the CSV (YYYY-MM-DD). Defaults to today.",
    )
    args = parser.parse_args()

    list_url = args.list_url.rstrip("/") + "/detail/"

    html = fetch(list_url)
    entries = extract_entries(html, base_url=list_url)

    if len(entries) < 200:
        print(
            f"Warning: extracted only {len(entries)} entries. The page layout may have changed.",
            file=sys.stderr,
        )

    with open(args.output_csv, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["Date", "Name", "Year", "Letterboxd URI"])
        for title, year, url in entries:
            writer.writerow([args.date, title, year, url])

    print(f"Wrote {len(entries)} entries to {args.output_csv}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
