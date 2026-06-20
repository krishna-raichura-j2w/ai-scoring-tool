import express from "express";
import cors from "cors";
import multer from "multer";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { dirname, join, extname } from "path";
import { mkdirSync, existsSync } from "fs";
import { rm } from "fs/promises";
import dotenv from "dotenv";

import { db, hydrate, hydrateAll } from "./db.js";
import { extractText } from "./parse.js";
import * as ai from "./ai.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env") });

const uploadsDir = join(__dirname, "..", "data", "uploads");
mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) =>
    cb(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`),
});
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

// ---------------------------------------------------------------- helpers ----
const now = () => new Date().toISOString();
const j = (v) => (v == null ? null : JSON.stringify(v));

function getJd(id) {
  return hydrate("jds", db.prepare("SELECT * FROM jds WHERE id=?").get(id));
}
function getResume(id) {
  return hydrate("resumes", db.prepare("SELECT * FROM resumes WHERE id=?").get(id));
}

// Resolve a JD's full text, following the `file:` indirection used for uploads.
async function resolveJdText(jd) {
  let text = jd.raw_text || "";
  if (text.startsWith("file:")) text = await extractText(text.slice(5));
  return text;
}

// Extract (and cache) the must-have skills for a JD from its text + notes.
async function ensureJdSkills(jd) {
  const cached = jd.must_have_skills;
  // Re-extract if missing, or if cached from before skills carried a tier.
  if (Array.isArray(cached) && cached.length && cached.every((s) => s.tier)) return cached;
  const text = await resolveJdText(jd);
  const skills = await ai.extractMustHaveSkills(text, jd.extra_context);
  db.prepare("UPDATE jds SET must_have_skills=? WHERE id=?").run(j(skills), jd.id);
  return skills;
}

// ---------------------------------------------- background AI processors -----
async function processJdCriteria(jdId) {
  try {
    const jd = getJd(jdId);
    if (!jd) return;
    let text = jd.raw_text;
    if (text.startsWith("file:")) text = await extractText(text.slice(5));
    const { title, criteria } = await ai.extractJdCriteria(text);
    // Preserve a user-provided title; only fall back to the AI-extracted one.
    const userTitle = jd.title && jd.title !== "Extracting…" ? jd.title : null;
    db.prepare("UPDATE jds SET title=?, criteria=?, status='ready', error=NULL WHERE id=?").run(
      userTitle || title,
      j(criteria),
      jdId
    );
    processJdQuestions(jdId); // auto-generate questions after extraction
  } catch (e) {
    db.prepare("UPDATE jds SET status='error', error=? WHERE id=?").run(String(e.message || e), jdId);
  }
}

async function processJdQuestions(jdId, extraContext) {
  try {
    db.prepare("UPDATE jds SET questions_status='generating' WHERE id=?").run(jdId);
    const jd = getJd(jdId);
    if (!jd) return;
    let text = jd.raw_text;
    if (text.startsWith("file:")) text = await extractText(text.slice(5));
    const ctx = extraContext ?? jd.extra_context;
    const questions = await ai.generateJdQuestions(text, jd.criteria, ctx);
    db.prepare("DELETE FROM jd_questions WHERE jd_id=?").run(jdId);
    const ins = db.prepare(
      `INSERT INTO jd_questions (id, jd_id, question, category, difficulty, green_flag, red_flag, order_index)
       VALUES (?,?,?,?,?,?,?,?)`
    );
    db.exec("BEGIN");
    try {
      questions.forEach((q, i) =>
        ins.run(randomUUID(), jdId, q.question || "", q.category || null, q.difficulty || null,
          q.green_flag || null, q.red_flag || null, i)
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    db.prepare("UPDATE jds SET questions_status='ready' WHERE id=?").run(jdId);
  } catch (e) {
    console.error("[questions] error:", e);
    db.prepare("UPDATE jds SET questions_status='error' WHERE id=?").run(jdId);
  }
}

async function processResumeScore(resumeId) {
  try {
    const r = getResume(resumeId);
    if (!r) return;
    const jd = getJd(r.jd_id);
    const text = await extractText(r.file_path);
    const s = await ai.scoreResume(text, jd);
    db.prepare(
      `UPDATE resumes SET candidate_name=?, email=?, phone=?, linkedin_url=?, location=?, education=?,
        experience_range=?, current_company=?, relevant_skills=?, criteria_scores=?, overall_score=?,
        summary=?, status='scored', error=NULL WHERE id=?`
    ).run(
      s.candidate_name, s.email, s.phone, s.linkedin_url, s.location, s.education,
      s.experience_range, s.current_company, j(s.relevant_skills), j(s.criteria_scores),
      s.overall_score, s.summary, resumeId
    );
  } catch (e) {
    db.prepare("UPDATE resumes SET status='error', error=? WHERE id=?").run(String(e.message || e), resumeId);
  }
}

async function processShortlistScore(resumeId) {
  try {
    const r = getResume(resumeId);
    if (!r) return;
    const shortlisted = hydrateAll(
      "resumes",
      db.prepare("SELECT * FROM resumes WHERE jd_id=? AND is_shortlisted=1 AND id!=?").all(r.jd_id, resumeId)
    );
    if (shortlisted.length === 0) {
      db.prepare("UPDATE resumes SET shortlist_status='error', shortlist_summary=? WHERE id=?")
        .run("No shortlisted candidates to compare against. Star some candidates first.", resumeId);
      return;
    }
    const text = await extractText(r.file_path);
    const out = await ai.scoreVsShortlist(text, shortlisted);
    db.prepare(
      "UPDATE resumes SET shortlist_status='scored', shortlist_score=?, shortlist_scores=?, shortlist_summary=? WHERE id=?"
    ).run(out.score, j(out), out.summary, resumeId);
  } catch (e) {
    db.prepare("UPDATE resumes SET shortlist_status='error', shortlist_summary=? WHERE id=?")
      .run(String(e.message || e), resumeId);
  }
}

// ------------------------------------------------------------- clients -------
app.get("/api/clients", (_req, res) => {
  res.json(db.prepare("SELECT * FROM clients ORDER BY created_at").all());
});
app.post("/api/clients", (req, res) => {
  const name = (req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "name required" });
  const id = randomUUID();
  db.prepare("INSERT INTO clients (id, name, created_at) VALUES (?,?,?)").run(id, name, now());
  res.json(db.prepare("SELECT * FROM clients WHERE id=?").get(id));
});
app.delete("/api/clients/:id", (req, res) => {
  db.prepare("DELETE FROM clients WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- jds --------
app.get("/api/jds", (req, res) => {
  const { client_id } = req.query;
  const rows = client_id
    ? db.prepare("SELECT * FROM jds WHERE client_id=? ORDER BY created_at DESC").all(client_id)
    : db.prepare("SELECT * FROM jds ORDER BY created_at DESC").all();
  res.json(hydrateAll("jds", rows));
});

function createJd(clientId, title, rawText, jobCode) {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO jds (id, client_id, title, raw_text, job_code, status, created_at) VALUES (?,?,?,?,?, 'extracting', ?)"
  ).run(id, clientId, title, rawText, jobCode || null, now());
  processJdCriteria(id);
  return getJd(id);
}

app.post("/api/jds", (req, res) => {
  const { client_id, raw_text, title, job_code } = req.body || {};
  if (!client_id) return res.status(400).json({ error: "client_id required" });
  if (!raw_text?.trim()) return res.status(400).json({ error: "raw_text required" });
  res.json(createJd(client_id, title?.trim() || "Extracting…", raw_text.trim(), job_code?.trim()));
});

app.post("/api/jds/upload", upload.single("file"), (req, res) => {
  const { client_id, title, job_code } = req.body || {};
  if (!client_id) return res.status(400).json({ error: "client_id required" });
  if (!req.file) return res.status(400).json({ error: "file required" });
  res.json(createJd(client_id, title?.trim() || "Extracting…", `file:${req.file.path}`, job_code?.trim()));
});

app.post("/api/jds/:id/retry", (req, res) => {
  db.prepare("UPDATE jds SET status='extracting', error=NULL WHERE id=?").run(req.params.id);
  processJdCriteria(req.params.id);
  res.json(getJd(req.params.id));
});

app.post("/api/jds/:id/questions", (req, res) => {
  const { extra_context } = req.body || {};
  if (extra_context !== undefined)
    // Notes feed must-have-skill extraction, so clear the cache to re-derive them.
    db.prepare("UPDATE jds SET extra_context=?, must_have_skills=NULL WHERE id=?")
      .run(extra_context, req.params.id);
  processJdQuestions(req.params.id, extra_context);
  res.json({ ok: true });
});

app.get("/api/jds/:id/questions", (req, res) => {
  res.json(db.prepare("SELECT * FROM jd_questions WHERE jd_id=? ORDER BY order_index").all(req.params.id));
});

// Update editable JD metadata: human job title and job ID.
app.patch("/api/jds/:id", (req, res) => {
  const { title, job_code } = req.body || {};
  const sets = [], vals = [];
  if (title !== undefined) { sets.push("title=?"); vals.push(String(title).trim() || "Untitled Role"); }
  if (job_code !== undefined) { sets.push("job_code=?"); vals.push(String(job_code).trim() || null); }
  if (!sets.length) return res.status(400).json({ error: "nothing to update" });
  vals.push(req.params.id);
  db.prepare(`UPDATE jds SET ${sets.join(", ")} WHERE id=?`).run(...vals);
  res.json(getJd(req.params.id));
});

app.delete("/api/jds/:id", (req, res) => {
  db.prepare("DELETE FROM jds WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// --------------------------------------------------------------- resumes -----
app.get("/api/resumes", (req, res) => {
  const { client_id, jd_id } = req.query;
  let rows;
  if (jd_id) {
    rows = db.prepare("SELECT * FROM resumes WHERE jd_id=? ORDER BY created_at DESC").all(jd_id);
  } else if (client_id) {
    rows = db
      .prepare(
        "SELECT r.* FROM resumes r JOIN jds j ON r.jd_id=j.id WHERE j.client_id=? ORDER BY r.created_at DESC"
      )
      .all(client_id);
  } else {
    rows = db.prepare("SELECT * FROM resumes ORDER BY created_at DESC").all();
  }
  res.json(hydrateAll("resumes", rows));
});

// Cap per-upload batch size to protect the app and the AI scoring pipeline.
const MAX_RESUMES_PER_UPLOAD = 10;

app.post("/api/resumes/upload", upload.array("files"), async (req, res) => {
  const files = req.files || [];
  const cleanup = () => Promise.all(files.map((f) => rm(f.path, { force: true }).catch(() => {})));
  const { jd_id } = req.body || {};
  if (!jd_id) { await cleanup(); return res.status(400).json({ error: "jd_id required" }); }
  if (files.length > MAX_RESUMES_PER_UPLOAD) {
    await cleanup(); // discard the temp files multer already wrote
    return res.status(400).json({ error: `Upload at most ${MAX_RESUMES_PER_UPLOAD} resumes at a time.` });
  }
  const created = [];
  for (const f of files) {
    const id = randomUUID();
    db.prepare(
      "INSERT INTO resumes (id, jd_id, file_name, file_path, status, created_at) VALUES (?,?,?,?, 'scoring', ?)"
    ).run(id, jd_id, f.originalname, f.path, now());
    processResumeScore(id);
    created.push(id);
  }
  res.json({ ok: true, count: created.length });
});

app.post("/api/resumes/:id/rescore", (req, res) => {
  db.prepare("UPDATE resumes SET status='scoring', error=NULL WHERE id=?").run(req.params.id);
  processResumeScore(req.params.id);
  res.json(getResume(req.params.id));
});

app.post("/api/resumes/:id/shortlist", (req, res) => {
  const val = req.body?.is_shortlisted ? 1 : 0;
  db.prepare("UPDATE resumes SET is_shortlisted=? WHERE id=?").run(val, req.params.id);
  res.json(getResume(req.params.id));
});

app.post("/api/resumes/:id/score-vs-shortlist", (req, res) => {
  db.prepare("UPDATE resumes SET shortlist_status='scoring', shortlist_summary=NULL WHERE id=?")
    .run(req.params.id);
  processShortlistScore(req.params.id);
  res.json(getResume(req.params.id));
});

// Skills-matrix export: for each candidate, a per-must-have-skill statement +
// score (assessed fresh against the resume), pivoted into one column per skill.
app.post("/api/resumes/skill-matrix", async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.resume_ids) ? req.body.resume_ids : [];
    if (!ids.length) return res.status(400).json({ error: "resume_ids required" });
    const resumes = ids.map(getResume).filter(Boolean);
    if (!resumes.length) return res.status(404).json({ error: "no resumes found" });

    // Resolve each involved JD's must-have skills once.
    const jdCache = new Map(); // jd_id -> { jd, skills }
    for (const r of resumes) {
      if (jdCache.has(r.jd_id)) continue;
      const jd = getJd(r.jd_id);
      if (!jd) continue;
      const skills = await ensureJdSkills(jd);
      jdCache.set(r.jd_id, { jd, skills });
    }

    // Union of skill columns across all involved JDs (dedupe by lowercased name),
    // ordered so PRIMARY skills come before SECONDARY ones.
    const colMap = new Map(); // lowerName -> { name, tier }
    for (const { skills } of jdCache.values()) {
      for (const s of skills) {
        const key = s.name.toLowerCase();
        if (!colMap.has(key)) colMap.set(key, { name: s.name, tier: s.tier === "primary" ? "primary" : "secondary" });
      }
    }
    const colDefs = [...colMap.values()];
    const columns = [
      ...colDefs.filter((c) => c.tier === "primary").map((c) => c.name),
      ...colDefs.filter((c) => c.tier !== "primary").map((c) => c.name),
    ];

    // Assess each resume against its own JD's skills (in parallel).
    const rows = await Promise.all(
      resumes.map(async (r) => {
        const entry = jdCache.get(r.jd_id);
        const skills = entry?.skills || [];
        let assessments = [];
        if (skills.length) {
          try {
            const text = await extractText(r.file_path);
            assessments = await ai.assessSkills(text, skills);
          } catch { /* leave cells blank if the resume can't be read */ }
        }
        const byName = new Map(assessments.map((a) => [a.skill.toLowerCase(), a]));
        const cells = {};
        for (const s of skills) {
          const a = byName.get(s.name.toLowerCase());
          if (a) cells[s.name] = { statement: a.statement, score: a.score };
        }
        return {
          candidate: r.candidate_name || r.file_name,
          job_title: entry?.jd.title || "",
          job_code: entry?.jd.job_code || "",
          final_score: r.overall_score ?? null,
          cells,
        };
      })
    );

    res.json({ columns, rows });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.delete("/api/resumes/:id", async (req, res) => {
  const r = getResume(req.params.id);
  if (r?.file_path && existsSync(r.file_path)) await rm(r.file_path, { force: true });
  db.prepare("DELETE FROM resumes WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// ------------------------------------------------- serve built frontend ------
const clientDist = join(__dirname, "..", "client", "dist");
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => res.sendFile(join(clientDist, "index.html")));
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Resume Matcher Pro running on http://localhost:${PORT}`));
