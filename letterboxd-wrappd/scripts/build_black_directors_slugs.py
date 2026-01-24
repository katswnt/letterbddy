#!/usr/bin/env python3
import csv
import json
import re
import sys
import time
from pathlib import Path
from typing import Iterable, Set, Optional

import requests


def extract_slug(url: str) -> Optional[str]:
    m = re.search(r"/film/([^/]+)", url)
    return m.group(1) if m else None


def resolve_url(url: str) -> Optional[str]:
    if "/list/" in url:
        return None
    if "boxd.it" not in url and "/film/" in url:
        return url
    try:
        resp = requests.get(url, allow_redirects=True, timeout=15, headers={"User-Agent": "letterbddy/1.0"})
        final_url = resp.url
        if "/film/" in final_url and "/list/" not in final_url:
            return final_url
    except Exception:
        return None
    return None


def load_urls(csv_path: Path) -> list[str]:
    urls: list[str] = []
    with csv_path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            url = (row.get("URL") or row.get("Url") or row.get("Link") or "").strip()
            if url.startswith("http"):
                urls.append(url)
    return urls


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: build_black_directors_slugs.py /path/to/black-directors.csv", file=sys.stderr)
        return 2
    csv_path = Path(sys.argv[1])
    if not csv_path.exists():
        print(f"CSV not found: {csv_path}", file=sys.stderr)
        return 2

    urls = load_urls(csv_path)
    slugs: Set[str] = set()
    total = len(urls)
    for i, url in enumerate(urls, start=1):
        resolved = resolve_url(url)
        if resolved:
            slug = extract_slug(resolved)
            if slug:
                slugs.add(slug)
        if i % 50 == 0 or i == total:
            print(f"Resolved {i}/{total}...", file=sys.stderr, flush=True)
        time.sleep(0.1)

    out_path = csv_path.parent / "black-directors-slugs.json"
    out_path.write_text(json.dumps(sorted(slugs), indent=2), encoding="utf-8")
    print(f"Wrote {len(slugs)} slugs -> {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
