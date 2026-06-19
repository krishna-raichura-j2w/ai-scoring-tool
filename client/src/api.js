const json = (r) => r.then(async (res) => {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
});

export const api = {
  // clients
  getClients: () => json(fetch("/api/clients")),
  addClient: (name) =>
    json(fetch("/api/clients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) })),
  deleteClient: (id) => json(fetch(`/api/clients/${id}`, { method: "DELETE" })),

  // jds
  getAllJds: () => json(fetch("/api/jds")),
  getJds: (clientId) => json(fetch(`/api/jds?client_id=${clientId}`)),
  addJd: (client_id, raw_text) =>
    json(fetch("/api/jds", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id, raw_text }) })),
  uploadJd: (client_id, file) => {
    const fd = new FormData();
    fd.append("client_id", client_id);
    fd.append("file", file);
    return json(fetch("/api/jds/upload", { method: "POST", body: fd }));
  },
  retryJd: (id) => json(fetch(`/api/jds/${id}/retry`, { method: "POST" })),
  deleteJd: (id) => json(fetch(`/api/jds/${id}`, { method: "DELETE" })),
  getQuestions: (id) => json(fetch(`/api/jds/${id}/questions`)),
  genQuestions: (id, extra_context) =>
    json(fetch(`/api/jds/${id}/questions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ extra_context }) })),

  // resumes
  getResumes: (clientId) => json(fetch(`/api/resumes?client_id=${clientId}`)),
  uploadResumes: (jd_id, files) => {
    const fd = new FormData();
    fd.append("jd_id", jd_id);
    for (const f of files) fd.append("files", f);
    return json(fetch("/api/resumes/upload", { method: "POST", body: fd }));
  },
  rescore: (id) => json(fetch(`/api/resumes/${id}/rescore`, { method: "POST" })),
  setShortlist: (id, is_shortlisted) =>
    json(fetch(`/api/resumes/${id}/shortlist`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_shortlisted }) })),
  scoreVsShortlist: (id) => json(fetch(`/api/resumes/${id}/score-vs-shortlist`, { method: "POST" })),
  deleteResume: (id) => json(fetch(`/api/resumes/${id}`, { method: "DELETE" })),
};
