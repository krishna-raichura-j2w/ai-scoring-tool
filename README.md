# Resume Matcher Pro

Score and rank resumes against job descriptions using AI (OpenAI). A self-contained
re-build of the Lovable "Resume Matcher Pro" app — no Supabase required. Data lives in
a local SQLite database; uploaded files live on local disk.

## Features

- **Clients → JDs → Resumes** hierarchy in a sidebar.
- **JD criteria extraction** — paste or upload a JD (PDF/DOCX/TXT); AI extracts a weighted
  scoring rubric and the job title.
- **Interview kit** — AI generates tailored interview questions with green-/red-flag answers.
  Add extra context to bias regeneration.
- **Resume scoring** — upload resumes (PDF/DOCX/TXT); AI extracts candidate metadata and
  scores each against the JD rubric, with per-criterion rationale and an overall weighted score.
- **Shortlist** — star strong candidates, then score any candidate against the shortlisted cohort.
- **Export** — selected candidates to CSV (details) or PDF (per-candidate report cards).

## Setup

The OpenAI key is read from `.env` in the project root:

```
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```

Install dependencies:

```bash
npm install
npm --prefix client install
```

## Run

**Development** (Vite dev server + API with hot reload):

```bash
npm run dev
# open http://localhost:5173
```

**Production** (build the frontend, server serves it):

```bash
npm run build
npm start
# open http://localhost:3001
```

## Architecture

- `server/` — Express API, SQLite (`better-sqlite3`), file parsing (`pdftotext`, `mammoth`),
  OpenAI calls. AI work runs in the background; the UI polls for status.
- `client/` — React + Vite + Tailwind. Reproduces the original UI; talks to the REST API.
