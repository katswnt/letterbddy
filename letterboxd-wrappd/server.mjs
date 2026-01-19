import express from "express";
import multer from "multer";
import cors from "cors";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const CACHE_PATH = path.join(process.cwd(), ".cache", "letterboxd_tmdb_cache.json");

import dotenv from "dotenv";
dotenv.config();

const jobs = new Map();

function makeJobId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function pruneJobs(maxAgeMs = 30 * 60 * 1000) {
  const now = Date.now();
  for (const [id, job] of jobs.entries()) {
    if (now - job.createdAt > maxAgeMs) jobs.delete(id);
  }
}

const app = express();

// Allow your dev frontend (Vite) to call this API
// Vite may use alternate ports (5174, 5175, etc.) if 5173 is busy
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:5175",
      "http://127.0.0.1:5173",
      "http://127.0.0.1:5174",
      "http://127.0.0.1:5175",
    ],
  })
);


const upload = multer({ dest: os.tmpdir() });

// Path to Criterion Collection list (hardcoded)
const CRITERION_LIST_PATH = "/Users/kathrynswint/Downloads/criterion-collection.csv";

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Register GET routes before POST handler (Express 5 compatibility)
console.log("Registering GET /api/test");
app.get("/api/test", (req, res) => {
  res.json({ test: "working" });
});

console.log("Registering GET /api/movies/:id/status");
app.get("/api/movies/:id/status", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });

  res.json({
    id: job.id,
    state: job.state,
    current: job.current,
    total: job.total,
    message: job.message,
    error: job.state === "error" ? job.error : "",
  });
});

console.log("Registering GET /api/movies/:id/result");
app.get("/api/movies/:id/result", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).send("Job not found");
  if (job.state === "running") return res.status(202).send("Not ready");
  if (job.state === "error") return res.status(500).send(job.error || "Job failed");
  res.type("json").send(job.resultText);
});

console.log("Registering POST /api/movies");
app.post("/api/movies", upload.single("file"), async (req, res) => {
  pruneJobs();

  const enrich = req.query.enrich === "1";
  const tmdbApiKey = req.query.tmdb_api_key || process.env.TMDB_API_KEY;
  if (!req.file) return res.status(400).send("Missing file field 'file'.");

  const jobId = makeJobId();
  const csvPath = req.file.path;
  // Use hardcoded Criterion Collection path if it exists
  let criterionListPath = null;
  try {
    await fs.access(CRITERION_LIST_PATH);
    criterionListPath = CRITERION_LIST_PATH;
    console.log(`[Job ${jobId}] Using Criterion Collection list: ${CRITERION_LIST_PATH}`);
  } catch {
    // File doesn't exist, that's okay - just won't mark Criterion films
    console.log(`[Job ${jobId}] Criterion Collection list not found at ${CRITERION_LIST_PATH}, skipping`);
  }
  const outPath = path.join(os.tmpdir(), `movies-${jobId}.json`);
  const cwd = process.cwd();

  const job = {
    id: jobId,
    createdAt: Date.now(),
    state: "running", // running | done | error
    current: 0,
    total: 0,
    message: enrich ? "Starting TMDb scraping…" : "Building index…",
    error: "",
    resultText: "",
  };
  jobs.set(jobId, job);

  const args = [
    "scripts/scrape_tmdb_ids.py",
    "--csv",
    csvPath,
    "--uri-column",
    "Letterboxd URI",
    "--out",
    outPath,
  ];
  if (enrich) {
    args.push("--enrich-tmdb");
    if (tmdbApiKey) {
      args.push("--tmdb-api-key");
      args.push(tmdbApiKey);
    }
  }
  if (criterionListPath) {
    args.push("--criterion-list");
    args.push(criterionListPath);
  }

  const p = spawn("python3", args, { cwd });

  let stderrBuf = "";
  p.stderr.on("data", (d) => {
    const text = d.toString();
    stderrBuf += text;

    const lines = stderrBuf.split(/\r?\n/);
    stderrBuf = lines.pop() || "";

    for (const line of lines) {
      console.log("[PY]", line);
      const pm = line.match(/^PHASE\s+(.+?)\s*$/);
      if (pm) {
        // Normalize phase to avoid hidden characters causing mismatches
        const rawPhase = pm[1];
        const phase = rawPhase
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_\-]/g, "");

        // Reset progress whenever we enter a new phase so we don't show 302/302 forever.
        job.current = 0;
        job.total = 0;

        if (phase === "loading_csv") job.message = "Loading CSV…";
        else if (phase === "loading_list") job.message = "Loading list…";
        else if (phase === "loading_criterion_list") job.message = "Loading Criterion list…";
        else if (phase === "resolve") job.message = "Resolving film URLs…";
        else if (phase === "tmdb") job.message = "Fetching TMDb data…";
        else job.message = `Working (${phase || "unknown"})…`;

        console.log(`[Job ${jobId}] PHASE: ${rawPhase} -> ${job.message}`);
        continue;
      }

      const m = line.match(/^PROGRESS\s+(\d+)\s+(\d+)\s*$/);
      if (m) {
        job.current = Number(m[1]);
        job.total = Number(m[2]);
        console.log(`[Job ${jobId}] PROGRESS: ${job.current}/${job.total}`);
        continue;
      }

      if (line.trim()) {
        console.log(`[Job ${jobId}] stderr line: ${line}`);
        job.error += line + "\n";
      }
    }
  });

  p.on("close", async (code) => {
    try {
      if (code !== 0) {
        job.state = "error";
        if (!job.error.trim()) job.error = `Python exited with code ${code}`;
        return;
      }
      job.resultText = await fs.readFile(outPath, "utf-8");
      let parsed = null;
      try {
        parsed = JSON.parse(job.resultText);
      } catch (e) {
        parsed = null;
      }

      // Normalize output: always { movieIndex, uriMap }
      if (parsed && typeof parsed === "object" && parsed.movieIndex) {
        job.result = parsed;
      } else if (parsed && typeof parsed === "object") {
        job.result = { movieIndex: parsed, uriMap: null };
      } else {
        job.result = { movieIndex: {}, uriMap: null };
        job.error += "\nFailed to parse output JSON.";
      }

      // If Python didn't include uriMap, try to populate it from the persistent cache
      if (job.result && (job.result.uriMap == null || Object.keys(job.result.uriMap || {}).length === 0)) {
        try {
          const cacheText = await fs.readFile(CACHE_PATH, "utf-8");
          const cacheJson = JSON.parse(cacheText);
          const shortMap = cacheJson && typeof cacheJson === "object" ? cacheJson.shortlink_to_film : null;
          if (shortMap && typeof shortMap === "object") {
            job.result.uriMap = shortMap;
            console.log(`[Job ${jobId}] Loaded uriMap from cache: ${Object.keys(shortMap).length} entries`);
          }
        } catch (e) {
          // It's okay if cache doesn't exist yet
        }
      }

      // Ensure resultText matches the normalized shape (useful for debugging)
      job.resultText = JSON.stringify(job.result);
      console.log(`[Job ${jobId}] Result keys:`, Object.keys(job.result || {}));
      job.state = "done";
      job.message = "Ready";
    } catch (e) {
      job.state = "error";
      job.error += String(e);
    } finally {
      try { await fs.unlink(csvPath); } catch {}
      try { await fs.unlink(outPath); } catch {}
    }
  });

  res.json({ jobId });
});


const PORT = 5050;
console.log("About to start server...");
app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
