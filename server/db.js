import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { mkdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "..", "data");
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(join(dataDir, "app.db"));
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS jds (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  criteria TEXT,
  status TEXT NOT NULL DEFAULT 'extracting',
  extra_context TEXT,
  questions_status TEXT NOT NULL DEFAULT 'idle',
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS jd_questions (
  id TEXT PRIMARY KEY,
  jd_id TEXT NOT NULL REFERENCES jds(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  category TEXT,
  difficulty TEXT,
  green_flag TEXT,
  red_flag TEXT,
  order_index INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS resumes (
  id TEXT PRIMARY KEY,
  jd_id TEXT NOT NULL REFERENCES jds(id) ON DELETE CASCADE,
  candidate_name TEXT,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  linkedin_url TEXT,
  location TEXT,
  education TEXT,
  experience_range TEXT,
  current_company TEXT,
  relevant_skills TEXT,
  overall_score REAL,
  criteria_scores TEXT,
  summary TEXT,
  is_shortlisted INTEGER NOT NULL DEFAULT 0,
  shortlist_status TEXT NOT NULL DEFAULT 'idle',
  shortlist_score REAL,
  shortlist_scores TEXT,
  shortlist_summary TEXT,
  status TEXT NOT NULL DEFAULT 'scoring',
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// JSON columns are stored as text; (de)serialize at the edges.
const JSON_FIELDS = {
  jds: ["criteria"],
  resumes: ["relevant_skills", "criteria_scores", "shortlist_scores"],
};

export function hydrate(table, row) {
  if (!row) return row;
  const out = { ...row };
  for (const f of JSON_FIELDS[table] || []) {
    if (out[f] != null) {
      try { out[f] = JSON.parse(out[f]); } catch { out[f] = null; }
    }
  }
  if (table === "resumes") out.is_shortlisted = !!out.is_shortlisted;
  return out;
}

export function hydrateAll(table, rows) {
  return rows.map((r) => hydrate(table, r));
}
