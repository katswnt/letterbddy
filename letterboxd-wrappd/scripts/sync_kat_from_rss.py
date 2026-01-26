#!/usr/bin/env python3
import argparse
import csv
import re
import urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from datetime import datetime


DIARY_DEFAULT = "public/kat_diary.csv"
WATCHLIST_DEFAULT = "public/kat_watchlist.csv"

DIARY_HEADERS = ["Date", "Name", "Year", "Letterboxd URI", "Rating", "Rewatch", "Tags", "Watched Date"]
WATCHLIST_HEADERS = ["Date", "Name", "Year", "Letterboxd URI"]


def norm(s):
    return (s or "").strip()


def fetch_rss(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req) as resp:
        return resp.read().decode("utf-8", errors="replace")


def find_text_by_suffix(elem, suffix):
    for child in elem:
        if child.tag.endswith(suffix):
            return norm(child.text)
    return ""


def parse_pubdate(pub_date):
    if not pub_date:
        return ""
    try:
        return parsedate_to_datetime(pub_date).date().isoformat()
    except Exception:
        return ""


# Handles:
#  "Microhabitat, 2017 - ★★★★"
#  "Drop Dead Gorgeous, 1999 - ★★★★½"
#  "Rudolph the Red-Nosed Reindeer, 1964 (contains spoilers)"
#  "Dahomey, 2024"
TITLE_YEAR_RE = re.compile(r"^(.*?),\s*(\d{4})(?:\s*\([^)]*\))?(?:\s*-\s*.*)?$")


def parse_name_year(title_raw):
    t = norm(title_raw)
    m = TITLE_YEAR_RE.match(t)
    if m:
        return m.group(1).strip(), m.group(2)
    # fallback: keep title as-is
    return t, ""


def parse_rss_entries(xml_text):
    root = ET.fromstring(xml_text)
    channel = root.find("channel") or next((e for e in root.iter() if e.tag.endswith("channel")), None)
    if channel is None:
        return []

    out = []
    for item in channel.findall("item"):
        title_raw = find_text_by_suffix(item, "title")
        link = find_text_by_suffix(item, "link")
        pub_date = find_text_by_suffix(item, "pubDate")

        name, year = parse_name_year(title_raw)
        date_iso = parse_pubdate(pub_date)

        out.append(
            {
                "Date": date_iso,
                "Name": name,
                "Year": year,
                "Letterboxd URI": link,  # RSS uses letterboxd.com links; fine
                "Rating": "",
                "Rewatch": "",
                "Tags": "",
                "Watched Date": date_iso,
            }
        )
    return out


def load_csv(path):
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        return (reader.fieldnames or []), list(reader)


def write_csv(path, headers, rows):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=headers)
        w.writeheader()
        w.writerows(rows)


def key_name_year(row):
    return (norm(row.get("Name")).lower(), norm(row.get("Year")))


def parse_iso_date(s):
    s = norm(s)
    if not s:
        return None
    try:
        return datetime.strptime(s, "%Y-%m-%d")
    except Exception:
        return None


def diary_recency_key(row):
    # Prefer Watched Date, else Date. Treat missing as very old.
    wd = parse_iso_date(row.get("Watched Date"))
    if wd:
        return wd
    d = parse_iso_date(row.get("Date"))
    if d:
        return d
    return datetime(1900, 1, 1)


def project(headers, row):
    return {h: row.get(h, "") for h in headers}


def main():
    parser = argparse.ArgumentParser(
        description="Sync latest Letterboxd RSS diary entries into kat_diary.csv and remove matches from kat_watchlist.csv."
    )
    parser.add_argument("--username", required=True, help="Letterboxd username (e.g., katswnt)")
    parser.add_argument("--dry-run", action="store_true", help="Do not write any files")
    parser.add_argument("--diary-csv", default=DIARY_DEFAULT, help="Path to diary CSV")
    parser.add_argument("--watchlist-csv", default=WATCHLIST_DEFAULT, help="Path to watchlist CSV")
    parser.add_argument("--limit", type=int, default=100, help="Max RSS items to fetch/consider (default 100)")
    parser.add_argument("--stop-after", type=int, default=2, help="Stop after N consecutive matches with most recent diary entries (default 2)")
    args = parser.parse_args()

    rss_url = "https://letterboxd.com/{}/rss/".format(args.username)
    rss_rows = parse_rss_entries(fetch_rss(rss_url))[: max(0, args.limit)]

    diary_headers, diary_rows = load_csv(args.diary_csv)
    watch_headers, watch_rows = load_csv(args.watchlist_csv)

    if not diary_headers:
        diary_headers = DIARY_HEADERS[:]
    if not watch_headers:
        watch_headers = WATCHLIST_HEADERS[:]

    # All-time set for dedupe
    diary_set = set(key_name_year(r) for r in diary_rows if norm(r.get("Name")))

    # Most-recent diary sequence for "stop when we overlap" logic
    diary_sorted = sorted(diary_rows, key=diary_recency_key, reverse=True)
    recent_seq = [key_name_year(r) for r in diary_sorted if norm(r.get("Name"))]

    new_rows = []
    new_keys = set()

    recent_idx = 0
    consecutive = 0

    for r in rss_rows:
        k = key_name_year(r)

        # overlap detection: are we now matching the top of the diary?
        if recent_idx < len(recent_seq) and k == recent_seq[recent_idx]:
            consecutive += 1
            recent_idx += 1
            if consecutive >= args.stop_after:
                break
        else:
            consecutive = 0

        # normal "add if missing" logic
        if k[0] and k not in diary_set:
            diary_set.add(k)
            new_keys.add(k)
            new_rows.append(r)

    diary_out = diary_rows + [project(diary_headers, r) for r in new_rows]

    removed = 0
    filtered_watch = []
    for r in watch_rows:
        if key_name_year(r) in new_keys:
            removed += 1
            continue
        filtered_watch.append(r)

    print("RSS entries fetched:", len(rss_rows))
    print("New diary rows:", len(new_rows))
    print("Watchlist rows removed:", removed)

    if args.dry_run:
        print("Dry run: no files written.")
        return 0

    write_csv(args.diary_csv, diary_headers, diary_out)
    write_csv(args.watchlist_csv, watch_headers, filtered_watch)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
