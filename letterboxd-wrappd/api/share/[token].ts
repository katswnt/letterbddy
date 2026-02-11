import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getCached, getRedis } from "../redis.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const token = (req.query.token as string) || "";
  if (!token) {
    return res.status(400).json({ error: "Missing token" });
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
