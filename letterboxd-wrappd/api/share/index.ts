import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";
import { getCached, getRedis, setCachedWithError } from "../redis.js";

const SHARE_TTL_SECONDS = 60 * 60 * 24 * 180; // 180 days

const getBaseUrl = (req: VercelRequest) => {
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host = req.headers.host || "letterbddy.com";
  return `${proto}://${host}`;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // POST /api/share — create a new share link
  if (req.method === "POST") {
    try {
      if (!getRedis()) {
        return res.status(503).json({ error: "Sharing is not available yet — Redis is not configured for this environment." });
      }

      const snapshot = req.body;
      if (!snapshot || typeof snapshot !== "object") {
        return res.status(400).json({ error: "Missing snapshot" });
      }

      const token = crypto.randomBytes(16).toString("hex");
      const key = `share:${token}`;
      const stored = await setCachedWithError(key, snapshot, SHARE_TTL_SECONDS);
      if (!stored.ok) {
        return res.status(500).json({
          error: "Failed to store snapshot",
          details: stored.error || "Unknown Redis error",
        });
      }

      const url = `${getBaseUrl(req)}/p/${token}`;
      return res.json({ token, url });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || "Failed to create share link" });
    }
  }

  // GET/DELETE /api/share?token=xxx — retrieve or delete a share
  const token = (req.query.token as string) || "";
  if (!token) {
    return res.status(400).json({ error: "Missing token query parameter" });
  }

  const key = `share:${token}`;

  if (req.method === "GET") {
    const snapshot = await getCached<any>(key);
    if (!snapshot) {
      return res.status(404).json({ error: "Not found" });
    }
    return res.json(snapshot);
  }

  if (req.method === "DELETE") {
    const client = getRedis();
    if (!client) {
      return res.status(500).json({ error: "Redis not configured" });
    }
    try {
      await client.del(key);
      return res.json({ ok: true });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || "Failed to delete" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
