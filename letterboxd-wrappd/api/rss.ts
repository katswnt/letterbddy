import type { VercelRequest, VercelResponse } from "@vercel/node";
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({ ignoreAttributes: false });

const getText = (value: any): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object" && "#text" in value) return String((value as any)["#text"] ?? "");
  return "";
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const rawUsername = (req.query.username as string) || "";
  const username = rawUsername.trim().replace(/^@/, "");
  if (!username) {
    return res.status(400).json({ error: "Missing username" });
  }

  const url = `https://letterboxd.com/${encodeURIComponent(username)}/rss/`;

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "letterbddy/1.0" },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Letterboxd returned ${response.status}` });
    }

    // Trim leading whitespace to avoid XML parsing errors.
    const xml = (await response.text()).trim();
    const parsed = parser.parse(xml);
    const rawItems = parsed?.rss?.channel?.item;
    const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

    const entries = items
      .map((item: any) => {
        const filmTitle = getText(item["letterboxd:filmTitle"]);
        if (!filmTitle) return null;
        return {
          title: filmTitle,
          year: getText(item["letterboxd:filmYear"]),
          rating: getText(item["letterboxd:memberRating"]),
          watchedDate: getText(item["letterboxd:watchedDate"]),
          rewatch: getText(item["letterboxd:rewatch"]),
          link: getText(item.link),
          pubDate: getText(item.pubDate),
        };
      })
      .filter(Boolean);

    return res.json({ username, count: entries.length, entries });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Failed to fetch RSS" });
  }
}
