import OpenAI from "openai";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env") });

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// Single chat call that always returns parsed JSON.
async function chatJSON(system, user) {
  const res = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  const text = res.choices[0]?.message?.content || "{}";
  return JSON.parse(text);
}

// ---- 1. Extract structured criteria + title from a JD ------------------------
export async function extractJdCriteria(rawText) {
  const system = `You are an expert technical recruiter. Read a job description and extract a clean, structured scoring rubric.
Return STRICT JSON with this shape:
{
  "title": "concise job title",
  "summary": "1-2 sentence summary of the role",
  "criteria": [
    { "name": "short criterion name", "weight": <integer 0-100>, "description": "what a strong candidate looks like for this" }
  ]
}
Rules:
- 4 to 7 criteria covering skills, experience, domain, education and soft skills as relevant.
- Weights MUST be integers that sum to exactly 100.
- Keep names short (2-4 words).`;
  const user = `JOB DESCRIPTION:\n"""\n${rawText.slice(0, 12000)}\n"""`;
  const data = await chatJSON(system, user);

  // Normalise weights to sum to 100.
  let criteria = Array.isArray(data.criteria) ? data.criteria : [];
  const total = criteria.reduce((s, c) => s + (Number(c.weight) || 0), 0) || 1;
  criteria = criteria.map((c) => ({
    name: String(c.name || "Criterion"),
    weight: Math.round(((Number(c.weight) || 0) / total) * 100),
    description: c.description || "",
  }));
  return {
    title: data.title || "Untitled Role",
    criteria: { summary: data.summary || "", criteria },
  };
}

// ---- 2. Generate interview questions ----------------------------------------
export async function generateJdQuestions(rawText, criteria, extraContext) {
  const system = `You are a senior hiring manager creating an interview kit.
Return STRICT JSON:
{
  "questions": [
    {
      "question": "the interview question",
      "category": "Technical | Behavioral | System Design | Domain | Culture",
      "difficulty": "Easy | Medium | Hard",
      "green_flag": "what a strong answer sounds like",
      "red_flag": "what a weak/concerning answer sounds like"
    }
  ]
}
Produce 6-10 high-signal questions tailored to the role.`;
  const ctx = extraContext
    ? `\n\nADDITIONAL CONTEXT (weight this slightly higher than the JD):\n"""\n${extraContext}\n"""`
    : "";
  const user = `JOB DESCRIPTION:\n"""\n${rawText.slice(0, 10000)}\n"""\n\nEXTRACTED CRITERIA:\n${JSON.stringify(
    criteria
  )}${ctx}`;
  const data = await chatJSON(system, user);
  return Array.isArray(data.questions) ? data.questions : [];
}

// ---- 3. Score a resume against the JD ---------------------------------------
export async function scoreResume(resumeText, jd) {
  const criteria = jd.criteria?.criteria || [];
  const system = `You are an expert recruiter scoring a candidate's resume against a job's rubric.
Return STRICT JSON:
{
  "candidate_name": "full name or null",
  "email": "email or null",
  "phone": "phone or null",
  "linkedin_url": "url or null",
  "location": "city, country or null",
  "education": "highest/most relevant degree + institution or null",
  "experience_range": "e.g. '5-7 years' or null",
  "current_company": "current employer or null",
  "relevant_skills": ["skill", ...],
  "criteria_scores": [
    { "name": "<must match a rubric criterion name>", "score": <0-100>, "rationale": "1-2 sentences" }
  ],
  "overall_score": <0-100 weighted by the rubric weights>,
  "summary": "2-3 sentence evaluation of fit"
}
Score honestly. If information is missing, score conservatively and say so in the rationale.`;
  const user = `RUBRIC CRITERIA (with weights):\n${JSON.stringify(
    criteria
  )}\n\nRESUME:\n"""\n${resumeText.slice(0, 14000)}\n"""`;
  const data = await chatJSON(system, user);

  // Recompute overall from criteria + weights so it always matches the rubric.
  const cs = Array.isArray(data.criteria_scores) ? data.criteria_scores : [];
  let overall = Number(data.overall_score);
  if (criteria.length && cs.length) {
    const byName = new Map(cs.map((c) => [String(c.name).toLowerCase(), Number(c.score) || 0]));
    let acc = 0, wsum = 0;
    for (const c of criteria) {
      const s = byName.get(String(c.name).toLowerCase());
      if (s != null) { acc += s * (c.weight || 0); wsum += c.weight || 0; }
    }
    if (wsum > 0) overall = Math.round(acc / wsum);
  }
  return {
    candidate_name: data.candidate_name || null,
    email: data.email || null,
    phone: data.phone || null,
    linkedin_url: data.linkedin_url || null,
    location: data.location || null,
    education: data.education || null,
    experience_range: data.experience_range || null,
    current_company: data.current_company || null,
    relevant_skills: Array.isArray(data.relevant_skills) ? data.relevant_skills : [],
    criteria_scores: { criteria_scores: cs },
    overall_score: Number.isFinite(overall) ? Math.round(overall) : null,
    summary: data.summary || null,
  };
}

// ---- 5. Extract must-have skills from a JD + additional notes ----------------
export async function extractMustHaveSkills(jdText, extraContext) {
  const system = `You are an expert technical recruiter. From a job description and the recruiter's additional notes, extract the concrete MUST-HAVE skills used to rank candidates.
Return STRICT JSON:
{
  "skills": [
    { "name": "short skill name (2-4 words)", "description": "what evidence in a resume satisfies this skill" }
  ]
}
Rules:
- 5 to 12 skills. Focus on hard requirements (technologies, tools, domains, concrete competencies), not generic soft skills unless the role clearly demands them.
- Treat the ADDITIONAL NOTES as higher priority than the JD when they conflict or add requirements.
- Keep names short and use them consistently.`;
  const notes = extraContext
    ? `\n\nADDITIONAL NOTES (weight these higher than the JD):\n"""\n${extraContext}\n"""`
    : "";
  const user = `JOB DESCRIPTION:\n"""\n${jdText.slice(0, 12000)}\n"""${notes}`;
  const data = await chatJSON(system, user);
  const skills = Array.isArray(data.skills) ? data.skills : [];
  return skills
    .map((s) => ({ name: String(s.name || "").trim(), description: String(s.description || "").trim() }))
    .filter((s) => s.name);
}

// ---- 6. Assess one resume against a list of must-have skills -----------------
export async function assessSkills(resumeText, skills) {
  if (!skills.length) return [];
  const system = `You assess a candidate's resume against a fixed list of MUST-HAVE skills.
Return STRICT JSON:
{
  "assessments": [
    { "skill": "<must exactly match a provided skill name>", "statement": "1-2 sentence evidence-based statement on how this candidate demonstrates (or lacks) this skill", "score": <0-100> }
  ]
}
Rules:
- Return exactly one assessment for EVERY provided skill, using the same skill name.
- Base statements only on the resume. If there is no evidence, say so plainly and score low.`;
  const user = `MUST-HAVE SKILLS:\n${JSON.stringify(
    skills
  )}\n\nRESUME:\n"""\n${resumeText.slice(0, 14000)}\n"""`;
  const data = await chatJSON(system, user);
  const out = Array.isArray(data.assessments) ? data.assessments : [];
  return out.map((a) => ({
    skill: String(a.skill || "").trim(),
    statement: String(a.statement || "").trim(),
    score: Number.isFinite(Number(a.score)) ? Math.round(Number(a.score)) : null,
  }));
}

// ---- 4. Score a resume vs the shortlisted candidates ------------------------
export async function scoreVsShortlist(resumeText, shortlisted) {
  const profiles = shortlisted
    .map(
      (r, i) =>
        `# Shortlisted profile ${i + 1}: ${r.candidate_name || r.file_name}\n${(
          r.summary || ""
        ).slice(0, 600)}\nSkills: ${(r.relevant_skills || []).join(", ")}`
    )
    .join("\n\n");
  const system = `You compare a candidate against an "ideal profile" derived from already-shortlisted candidates.
Return STRICT JSON:
{
  "score": <0-100 overall alignment with the shortlisted cohort>,
  "summary": "2-3 sentences on how this candidate aligns with the shortlisted bar",
  "parameter_scores": [
    { "name": "skills_overlap | experience_match | domain_fit | seniority", "score": <0-100>, "rationale": "1-2 sentences" }
  ]
}`;
  const user = `SHORTLISTED COHORT:\n${profiles}\n\nCANDIDATE TO EVALUATE:\n"""\n${resumeText.slice(
    0,
    12000
  )}\n"""`;
  const data = await chatJSON(system, user);
  return {
    score: Number.isFinite(Number(data.score)) ? Math.round(Number(data.score)) : null,
    summary: data.summary || null,
    parameter_scores: Array.isArray(data.parameter_scores) ? data.parameter_scores : [],
    compared_against: shortlisted.length,
  };
}
