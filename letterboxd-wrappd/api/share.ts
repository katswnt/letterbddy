import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";
import { getRedis, setCached } from "./redis";

const SHARE_TTL_SECONDS = 60 * 60 * 24 * 180; // 180 days

const getBaseUrl = (req: VercelRequest) => {
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host = req.headers.host || "letterbddy.com";
  return `${proto}://${host}`;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

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
    const stored = await setCached(key, snapshot, SHARE_TTL_SECONDS);
    if (!stored) {
      return res.status(500).json({ error: "Failed to store snapshot" });
    }

    const url = `${getBaseUrl(req)}/p/${token}`;
    return res.json({ token, url });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Failed to create share link" });
  }
}
