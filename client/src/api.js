// All requests are prefixed with the app's base path (e.g. /j2w-ai-scoring-agent)
// so they work when the app is served under a subpath behind the reverse proxy.
// import.meta.env.BASE_URL is set from vite.config.js `base` and ends with "/".
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const url = (p) => `${BASE}${p}`;

const json = (r) => r.then(async (res) => {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
});

export const api = {
  // clients
  getClients: () => json(fetch(url("/api/clients"))),
  addClient: (name) =>
    json(fetch(url("/api/clients"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) })),
  deleteClient: (id) => json(fetch(url(`/api/clients/${id}`), { method: "DELETE" })),

  // jds
  getAllJds: () => json(fetch(url("/api/jds"))),
  getJds: (clientId) => json(fetch(url(`/api/jds?client_id=${clientId}`))),
  addJd: (client_id, raw_text) =>
    json(fetch(url("/api/jds"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id, raw_text }) })),
  uploadJd: (client_id, file) => {
    const fd = new FormData();
    fd.append("client_id", client_id);
    fd.append("file", file);
    return json(fetch(url("/api/jds/upload"), { method: "POST", body: fd }));
  },
  retryJd: (id) => json(fetch(url(`/api/jds/${id}/retry`), { method: "POST" })),
  deleteJd: (id) => json(fetch(url(`/api/jds/${id}`), { method: "DELETE" })),
  getQuestions: (id) => json(fetch(url(`/api/jds/${id}/questions`))),
  genQuestions: (id, extra_context) =>
    json(fetch(url(`/api/jds/${id}/questions`), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ extra_context }) })),

  // resumes
  getResumes: (clientId) => json(fetch(url(`/api/resumes?client_id=${clientId}`))),
  uploadResumes: (jd_id, files) => {
    const fd = new FormData();
    fd.append("jd_id", jd_id);
    for (const f of files) fd.append("files", f);
    return json(fetch(url("/api/resumes/upload"), { method: "POST", body: fd }));
  },
  rescore: (id) => json(fetch(url(`/api/resumes/${id}/rescore`), { method: "POST" })),
  setShortlist: (id, is_shortlisted) =>
    json(fetch(url(`/api/resumes/${id}/shortlist`), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_shortlisted }) })),
  scoreVsShortlist: (id) => json(fetch(url(`/api/resumes/${id}/score-vs-shortlist`), { method: "POST" })),
  deleteResume: (id) => json(fetch(url(`/api/resumes/${id}`), { method: "DELETE" })),
};
