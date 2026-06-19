// End-to-end API test suite. Run with: node server/test-api.mjs
// Exercises every endpoint against a running server (default http://localhost:3001).
const BASE = process.env.BASE || "http://localhost:3001";

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log(`  ✓ ${msg}`); } else { fail++; console.error(`  ✗ ${msg}`); } };

const req = async (method, path, body, isForm) => {
  const opts = { method };
  if (body && !isForm) { opts.headers = { "Content-Type": "application/json" }; opts.body = JSON.stringify(body); }
  if (body && isForm) opts.body = body;
  const res = await fetch(BASE + path, opts);
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pollJd = async (id, field, want, max = 30) => {
  for (let i = 0; i < max; i++) {
    const { data } = await req("GET", `/api/jds?client_id=${CID}`);
    const jd = data.find((j) => j.id === id);
    if (jd && (Array.isArray(want) ? want.includes(jd[field]) : jd[field] === want)) return jd;
    await sleep(2000);
  }
  return null;
};
const pollResume = async (id, field, want, max = 30) => {
  for (let i = 0; i < max; i++) {
    const { data } = await req("GET", `/api/resumes?jd_id=${JID}`);
    const r = data.find((x) => x.id === id);
    if (r && (Array.isArray(want) ? want.includes(r[field]) : r[field] === want)) return r;
    await sleep(2000);
  }
  return null;
};

let CID, JID;

console.log("\n== Clients ==");
{
  const c = await req("POST", "/api/clients", { name: "TestCo " + Date.now() });
  ok(c.status === 200 && c.data.id, "create client");
  CID = c.data.id;
  const empty = await req("POST", "/api/clients", { name: "" });
  ok(empty.status === 400, "reject empty client name");
  const list = await req("GET", "/api/clients");
  ok(Array.isArray(list.data) && list.data.some((x) => x.id === CID), "list includes new client");
}

console.log("\n== JD: create + criteria extraction ==");
{
  const noClient = await req("POST", "/api/jds", { raw_text: "x" });
  ok(noClient.status === 400, "reject JD without client_id");
  const noText = await req("POST", "/api/jds", { client_id: CID, raw_text: "" });
  ok(noText.status === 400, "reject JD without text");

  const jd = await req("POST", "/api/jds", {
    client_id: CID,
    raw_text: "Data Scientist. 4+ years Python, ML, pandas, scikit-learn. PhD or MS in stats. Deploy models on GCP.",
  });
  ok(jd.status === 200 && jd.data.status === "extracting", "create JD (status=extracting)");
  JID = jd.data.id;

  const ready = await pollJd(JID, "status", "ready");
  ok(!!ready, "JD reaches status=ready");
  ok(ready && ready.title && ready.title !== "Extracting…", "JD title extracted: " + ready?.title);
  const crit = ready?.criteria?.criteria || [];
  ok(crit.length >= 3, `criteria extracted (${crit.length})`);
  const sum = crit.reduce((s, c) => s + (c.weight || 0), 0);
  ok(Math.abs(sum - 100) <= 1, `criteria weights sum ~100 (got ${sum})`);
}

console.log("\n== JD: interview questions ==");
{
  const ready = await pollJd(JID, "questions_status", ["ready", "error"]);
  ok(ready?.questions_status === "ready", "questions auto-generate to ready");
  const qs = await req("GET", `/api/jds/${JID}/questions`);
  ok(Array.isArray(qs.data) && qs.data.length >= 4, `questions returned (${qs.data?.length})`);
  ok(qs.data?.[0]?.green_flag && qs.data?.[0]?.red_flag, "questions have green/red flags");

  // regenerate with extra context
  await req("POST", `/api/jds/${JID}/questions`, { extra_context: "Focus on MLOps and production deployment." });
  await sleep(1500);
  const gen = await pollJd(JID, "questions_status", ["ready", "error"]);
  ok(gen?.questions_status === "ready", "regenerate with context -> ready");
  ok(gen?.extra_context?.includes("MLOps"), "extra_context persisted");
}

console.log("\n== Resumes: scoring ==");
let R1, R2;
{
  const noJd = await req("POST", "/api/resumes/upload", {});
  ok(noJd.status === 400, "reject resume upload without jd_id");

  const mk = (name, content) => {
    const fd = new FormData();
    fd.append("jd_id", JID);
    fd.append("files", new Blob([content], { type: "text/plain" }), name);
    return fd;
  };
  const up1 = await req("POST", "/api/resumes/upload", mk("alice.txt",
    "Alice Ng\nalice@x.com | Seattle\nSenior Data Scientist, 6 years. Python, scikit-learn, pandas, GCP Vertex AI. MS Statistics, UW. Deployed 20+ ML models."), true);
  ok(up1.status === 200 && up1.data.count === 1, "upload resume 1");
  const up2 = await req("POST", "/api/resumes/upload", mk("carl.txt",
    "Carl Bo\ncarl@x.com\nMarketing manager, 8 years. No coding. BA English."), true);
  ok(up2.status === 200, "upload resume 2");

  const list = await req("GET", `/api/resumes?jd_id=${JID}`);
  ok(list.data.length === 2, "two resumes listed");
  R1 = list.data.find((r) => r.file_name === "alice.txt").id;
  R2 = list.data.find((r) => r.file_name === "carl.txt").id;

  const a = await pollResume(R1, "status", ["scored", "error"]);
  const c = await pollResume(R2, "status", ["scored", "error"]);
  ok(a?.status === "scored", "resume 1 scored");
  ok(c?.status === "scored", "resume 2 scored");
  ok(a?.candidate_name?.includes("Alice"), "resume 1 name extracted: " + a?.candidate_name);
  ok(typeof a?.overall_score === "number", "resume 1 has overall_score: " + a?.overall_score);
  ok((a?.overall_score ?? 0) > (c?.overall_score ?? 100), `relevant candidate scores higher (${a?.overall_score} > ${c?.overall_score})`);
  ok((a?.criteria_scores?.criteria_scores || []).length >= 3, "resume 1 has per-criterion scores");

  // rescore
  const rs = await req("POST", `/api/resumes/${R1}/rescore`);
  ok(rs.status === 200, "rescore endpoint");
  const rescored = await pollResume(R1, "status", "scored");
  ok(!!rescored, "rescore completes");
}

console.log("\n== Shortlist comparison ==");
{
  // no shortlist yet -> error
  await req("POST", `/api/resumes/${R2}/score-vs-shortlist`);
  const noSL = await pollResume(R2, "shortlist_status", ["error", "scored"]);
  ok(noSL?.shortlist_status === "error", "score-vs-shortlist errors with no shortlisted candidates");

  // star Alice
  const star = await req("POST", `/api/resumes/${R1}/shortlist`, { is_shortlisted: true });
  ok(star.status === 200 && star.data.is_shortlisted === true, "star candidate");

  await req("POST", `/api/resumes/${R2}/score-vs-shortlist`);
  const scored = await pollResume(R2, "shortlist_status", ["scored", "error"]);
  ok(scored?.shortlist_status === "scored", "score-vs-shortlist completes");
  ok(typeof scored?.shortlist_score === "number", "shortlist_score present: " + scored?.shortlist_score);
  ok((scored?.shortlist_scores?.parameter_scores || []).length >= 1, "parameter_scores present");
  ok(scored?.shortlist_scores?.compared_against === 1, "compared_against=1");

  // unstar
  const unstar = await req("POST", `/api/resumes/${R1}/shortlist`, { is_shortlisted: false });
  ok(unstar.data.is_shortlisted === false, "unstar candidate");
}

console.log("\n== Cross-client isolation ==");
{
  const all = await req("GET", "/api/jds");
  ok(all.data.some((j) => j.id === JID), "GET /api/jds (all) includes our JD");
  const scoped = await req("GET", `/api/resumes?client_id=${CID}`);
  ok(scoped.data.length === 2, "resumes scoped by client_id");
}

console.log("\n== Deletion + cascade ==");
{
  const dr = await req("DELETE", `/api/resumes/${R2}`);
  ok(dr.status === 200, "delete resume");
  const afterR = await req("GET", `/api/resumes?jd_id=${JID}`);
  ok(afterR.data.length === 1, "resume removed");

  const dj = await req("DELETE", `/api/jds/${JID}`);
  ok(dj.status === 200, "delete JD");
  const afterJ = await req("GET", `/api/resumes?jd_id=${JID}`);
  ok(afterJ.data.length === 0, "JD's resumes cascade-deleted");

  const dc = await req("DELETE", `/api/clients/${CID}`);
  ok(dc.status === 200, "delete client");
  const afterC = await req("GET", "/api/clients");
  ok(!afterC.data.some((c) => c.id === CID), "client removed");
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
