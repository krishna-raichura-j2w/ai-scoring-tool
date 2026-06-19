import { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { useToast } from "./toast.jsx";
import {
  Briefcase, Plus, Upload, FileText, Users, Loader2, Trash2, ChevronRight,
  ChevronDown, ChevronUp, Download, FileSpreadsheet, X, RefreshCw, Star, Sparkles,
} from "lucide-react";
import jsPDF from "jspdf";

const scoreRing = (s) => {
  if (s == null) return "bg-muted text-muted-foreground border-border";
  if (s >= 80) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (s >= 60) return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-rose-50 text-rose-600 border-rose-200";
};
const scoreDot = (s) => {
  if (s == null) return "bg-slate-300";
  if (s >= 80) return "bg-emerald-500";
  if (s >= 60) return "bg-amber-500";
  return "bg-rose-500";
};

export default function Index() {
  const toast = useToast();
  const [clients, setClients] = useState([]);
  const [jds, setJds] = useState([]);
  const [resumes, setResumes] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [activeClient, setActiveClient] = useState(null);
  const [activeJd, setActiveJd] = useState(null);
  const [tab, setTab] = useState("jds");
  const [expandedClients, setExpandedClients] = useState(new Set());
  const [expandedResumes, setExpandedResumes] = useState(new Set());
  const [selected, setSelected] = useState(new Set());
  const [expandedQuestionsJd, setExpandedQuestionsJd] = useState(new Set());
  const [contextDraft, setContextDraft] = useState({});
  const [newClient, setNewClient] = useState("");
  const [jdText, setJdText] = useState("");
  const [busy, setBusy] = useState(false);

  const activeClientRef = useRef(null);
  activeClientRef.current = activeClient;

  useEffect(() => { loadClients(); }, []);
  useEffect(() => { if (activeClient) load(); }, [activeClient]);
  // Keep the active client expanded in the sidebar.
  useEffect(() => {
    if (activeClient)
      setExpandedClients((prev) => (prev.has(activeClient) ? prev : new Set(prev).add(activeClient)));
  }, [activeClient]);

  // Poll while anything is in-flight (replaces Supabase realtime).
  useEffect(() => {
    const t = setInterval(() => {
      if (!activeClientRef.current) return;
      const inFlight =
        jds.some((j) => j.status === "extracting" || j.questions_status === "generating") ||
        resumes.some((r) => r.status === "scoring" || r.shortlist_status === "scoring");
      if (inFlight) load();
    }, 2500);
    return () => clearInterval(t);
  }, [jds, resumes]);

  async function loadClients() {
    const data = await api.getClients();
    setClients(data);
    if (!activeClientRef.current && data[0]) setActiveClient(data[0].id);
  }

  async function load() {
    const clientId = activeClientRef.current;
    // Load ALL jds so the sidebar shows counts / can expand every client.
    const [allClients, allJds] = await Promise.all([api.getClients(), api.getAllJds()]);
    setClients(allClients);
    setJds(allJds);
    if (!clientId) { setResumes([]); setQuestions([]); return; }
    const clientJdList = allJds.filter((x) => x.client_id === clientId);
    const [r, qLists] = await Promise.all([
      api.getResumes(clientId),
      Promise.all(clientJdList.map((x) => api.getQuestions(x.id))),
    ]);
    setResumes(r);
    setQuestions(qLists.flat());
  }

  async function addClient() {
    if (!newClient.trim()) return;
    try {
      const c = await api.addClient(newClient.trim());
      setNewClient("");
      setActiveClient(c.id);
      loadClients();
    } catch (e) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
  }

  async function deleteClient(id) {
    if (!confirm("Delete this client and all its JDs/resumes?")) return;
    await api.deleteClient(id);
    if (activeClient === id) setActiveClient(null);
    loadClients();
  }

  async function addJd() {
    if (!activeClient) return toast({ title: "Pick a client first" });
    if (!jdText.trim()) return toast({ title: "JD required", description: "Paste text or upload a JD file", variant: "destructive" });
    setBusy(true);
    try {
      await api.addJd(activeClient, jdText);
      setJdText("");
      toast({ title: "JD added", description: "Extracting criteria & generating questions…" });
      await load();
    } catch (e) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    setBusy(false);
  }

  async function uploadJdFile(file) {
    if (!file) return;
    if (!activeClient) return toast({ title: "Pick a client first" });
    setBusy(true);
    try {
      await api.uploadJd(activeClient, file);
      toast({ title: "JD uploaded", description: "Extracting criteria & generating questions…" });
      await load();
    } catch (e) { toast({ title: "Upload failed", description: e.message, variant: "destructive" }); }
    setBusy(false);
  }

  async function deleteJd(id) {
    if (!confirm("Delete this JD and its resumes?")) return;
    await api.deleteJd(id);
    if (activeJd === id) setActiveJd(null);
    load();
  }

  async function retryExtractJd(id) {
    try {
      await api.retryJd(id);
      toast({ title: "Retrying extraction…" });
      load();
    } catch (e) { toast({ title: "Retry failed", description: e.message, variant: "destructive" }); }
  }

  async function uploadResumes(files) {
    if (!files || !files.length || !activeJd) return toast({ title: "Pick a JD first" });
    setBusy(true);
    try {
      await api.uploadResumes(activeJd, Array.from(files));
      toast({ title: "Uploaded", description: "Scoring in progress…" });
      await load();
    } catch (e) { toast({ title: "Upload failed", description: e.message, variant: "destructive" }); }
    setBusy(false);
  }

  async function deleteResume(r) {
    await api.deleteResume(r.id);
    load();
  }

  function toggleExpanded(id) {
    const next = new Set(expandedResumes);
    next.has(id) ? next.delete(id) : next.add(id);
    setExpandedResumes(next);
  }
  function toggleSelect(id) {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  }

  const clientJds = jds.filter((j) => j.client_id === activeClient);
  const filteredResumes = activeJd
    ? resumes.filter((r) => r.jd_id === activeJd)
    : resumes.filter((r) => clientJds.some((j) => j.id === r.jd_id));
  const sortedResumes = [...filteredResumes].sort((a, b) => (b.overall_score ?? -1) - (a.overall_score ?? -1));
  const selectedResumes = sortedResumes.filter((r) => selected.has(r.id));

  function exportCsv() {
    if (selectedResumes.length === 0) return;
    const rows = [
      ["Full Name", "Email", "Contact Number", "LinkedIn URL", "Current Location", "Education Background", "Experience Range", "Current Company", "Relevant Skills", "Score", "JD", "File Name"],
      ...selectedResumes.map((r) => [
        r.candidate_name ?? "", r.email ?? "", r.phone ?? "", r.linkedin_url ?? "", r.location ?? "",
        r.education ?? "", r.experience_range ?? "", r.current_company ?? "",
        (r.relevant_skills ?? []).join("; "), r.overall_score?.toString() ?? "",
        jds.find((j) => j.id === r.jd_id)?.title ?? "", r.file_name,
      ]),
    ];
    const csv = rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8;" }), "candidates.csv");
    toast({ title: "CSV exported", description: `${selectedResumes.length} candidate(s)` });
  }

  function exportPdf() {
    if (selectedResumes.length === 0) return;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 48;
    const maxW = pageW - margin * 2;
    const scoreColor = (s) => {
      if (s == null) return [148, 163, 184];
      if (s >= 80) return [34, 197, 94];
      if (s >= 60) return [245, 158, 11];
      return [239, 68, 68];
    };
    const drawScoreCircle = (x, y, radius, score, fontSize) => {
      const [r, g, b] = scoreColor(score);
      doc.setFillColor(r, g, b);
      doc.circle(x, y, radius, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(fontSize);
      const label = score == null ? "—" : String(score);
      doc.text(label, x - doc.getTextWidth(label) / 2, y + fontSize / 2.8);
      doc.setTextColor(0, 0, 0);
    };
    selectedResumes.forEach((r, idx) => {
      if (idx > 0) doc.addPage();
      let y = margin;
      const jd = jds.find((j) => j.id === r.jd_id);
      const hR = 28, hX = margin + hR, hY = y + hR;
      drawScoreCircle(hX, hY, hR, r.overall_score, 18);
      const textX = margin + hR * 2 + 16;
      doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.setTextColor(15, 23, 42);
      doc.text(r.candidate_name || r.file_name, textX, y + 22);
      doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(100, 116, 139);
      doc.text(`${jd?.title ?? ""}  •  Overall ${r.overall_score ?? "—"}/100`, textX, y + 38);
      const contact = [r.email, r.phone, r.linkedin_url, r.location].filter(Boolean).join("  •  ");
      if (contact) doc.text(doc.splitTextToSize(contact, maxW - (textX - margin)), textX, y + 52);
      doc.setTextColor(0, 0, 0);
      y += hR * 2 + 18;
      doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.5); doc.line(margin, y, pageW - margin, y); y += 16;
      if (r.summary) {
        doc.setFontSize(11); doc.setFont("helvetica", "italic"); doc.setTextColor(51, 65, 85);
        const lines = doc.splitTextToSize(r.summary, maxW);
        doc.text(lines, margin, y); y += lines.length * 14 + 14;
        doc.setTextColor(0, 0, 0);
      }
      doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(15, 23, 42);
      doc.text("Criteria Breakdown", margin, y); y += 16;
      const criteria = r.criteria_scores?.criteria_scores ?? [];
      const cR = 12;
      criteria.forEach((c) => {
        if (y > pageH - 80) { doc.addPage(); y = margin; }
        const itemTop = y;
        drawScoreCircle(margin + cR, itemTop + cR, cR, c.score, 9);
        const cTextX = margin + cR * 2 + 12;
        const cTextW = maxW - (cTextX - margin);
        doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(15, 23, 42);
        doc.text(c.name ?? "Criterion", cTextX, itemTop + 11);
        let textY = itemTop + 26;
        if (c.rationale) {
          doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(71, 85, 105);
          const lines = doc.splitTextToSize(c.rationale, cTextW);
          doc.text(lines, cTextX, textY);
          textY += lines.length * 12;
        }
        doc.setTextColor(0, 0, 0);
        y = Math.max(itemTop + cR * 2 + 6, textY + 10);
      });
    });
    downloadBlob(doc.output("blob"), "candidate-reports.pdf");
    toast({ title: "PDF exported", description: `${selectedResumes.length} candidate(s)` });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.rel = "noopener"; a.style.display = "none";
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
  }

  return (
    <div className="min-h-screen flex w-full bg-background text-foreground">
      {/* Sidebar */}
      <aside className="w-72 border-r border-border bg-card flex flex-col shrink-0">
        <div className="p-6">
          <div className="flex items-center gap-2 mb-5">
            <Users className="w-3.5 h-3.5 text-muted-foreground" />
            <h2 className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">Resume Matcher Pro</h2>
          </div>
          <div className="relative mb-6">
            <Input placeholder="New client" value={newClient} onChange={(e) => setNewClient(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addClient()} className="pl-3 pr-10 py-2 bg-muted border-0 rounded-lg text-sm h-9" />
            <button onClick={addClient} className="absolute right-1 top-1 h-7 w-7 bg-primary text-primary-foreground rounded-md flex items-center justify-center hover:opacity-90 transition">
              <Plus className="w-4 h-4" strokeWidth={2.5} />
            </button>
          </div>
          <nav className="space-y-1">
            {clients.length === 0 && <p className="text-xs text-muted-foreground px-2 py-4 text-center">No clients yet</p>}
            {clients.map((c) => {
              const cJds = jds.filter((j) => j.client_id === c.id);
              const expanded = expandedClients.has(c.id);
              const isActive = activeClient === c.id;
              const selectClient = () => {
                setActiveClient(c.id);
                setActiveJd(null);
                setSelected(new Set());
                // toggle expansion (active client is force-expanded by effect on change)
                setExpandedClients((prev) => {
                  const next = new Set(prev);
                  next.has(c.id) ? next.delete(c.id) : next.add(c.id);
                  return next;
                });
              };
              return (
                <div key={c.id}>
                  <div className={`group flex items-center justify-between py-2 px-2 rounded-md text-sm font-medium cursor-pointer ${isActive ? "bg-muted text-foreground" : "text-foreground/80 hover:text-foreground hover:bg-muted/50"}`}
                    onClick={selectClient}>
                    <div className="flex items-center gap-2 min-w-0">
                      {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                      <span className="truncate">{c.name}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] bg-muted-foreground/15 px-1.5 py-0.5 rounded-full text-muted-foreground font-semibold">{cJds.length}</span>
                      <Trash2 className="w-3.5 h-3.5 opacity-0 group-hover:opacity-60 hover:!opacity-100 text-muted-foreground"
                        onClick={(e) => { e.stopPropagation(); deleteClient(c.id); }} />
                    </div>
                  </div>
                  {expanded && (
                    <div className="pl-6 mt-1 mb-2 space-y-1">
                      {cJds.length === 0 && <p className="text-xs text-muted-foreground px-2 py-1">No roles yet</p>}
                      {cJds.map((jd) => (
                        <div key={jd.id}
                          className={`flex items-center gap-2 p-2 text-sm rounded-md cursor-pointer transition-colors ${activeJd === jd.id ? "bg-accent text-accent-foreground font-semibold" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"}`}
                          onClick={() => { setActiveClient(c.id); setActiveJd(jd.id); setTab("resumes"); setSelected(new Set()); }}>
                          <FileText className="w-4 h-4 opacity-60 shrink-0" />
                          <span className="truncate flex-1">{jd.title}</span>
                          {jd.status === "extracting" && <Loader2 className="w-3 h-3 animate-spin shrink-0" />}
                        </div>
                      ))}
                      <button className="flex items-center gap-1.5 p-2 text-xs text-primary hover:underline"
                        onClick={() => { setActiveClient(c.id); setActiveJd(null); setTab("jds"); }}>
                        <Plus className="w-3 h-3" /> Add role / JD
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col overflow-auto">
        {!activeClient ? (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState title="Select or create a client" desc="Add a client on the left to start managing JDs and resumes." />
          </div>
        ) : (
          <>
            <header className="bg-card border-b border-border px-8 py-3 flex items-center justify-between sticky top-0 z-20">
              <div className="flex gap-8">
                <TabBtn active={tab === "jds"} onClick={() => setTab("jds")}>Job Descriptions</TabBtn>
                <TabBtn active={tab === "resumes"} onClick={() => setTab("resumes")}>Resumes</TabBtn>
              </div>
              <div className="text-xs text-muted-foreground">
                <span className="uppercase tracking-wider font-semibold">Client</span>
                <span className="ml-2 text-foreground font-semibold">{clients.find((c) => c.id === activeClient)?.name}</span>
              </div>
            </header>

            <div className="p-8 max-w-5xl w-full mx-auto space-y-6">
              {tab === "jds" && (
                <>
                  <Card className="p-6 shadow-sm">
                    <h3 className="font-semibold mb-1">Upload a Job Description</h3>
                    <p className="text-xs text-muted-foreground mb-3">The job title will be auto-extracted from the JD.</p>
                    <Textarea placeholder="Paste the full Job Description here…" value={jdText}
                      onChange={(e) => setJdText(e.target.value)} rows={8} className="mb-3" />
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={addJd} disabled={busy}>
                        {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                        Add JD & Extract Criteria
                      </Button>
                      <input type="file" accept=".pdf,.docx,.txt" id="jd-file-upload" className="hidden"
                        onChange={(e) => { uploadJdFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
                      <Button asChild variant="outline" disabled={busy}>
                        <label htmlFor="jd-file-upload" className="cursor-pointer">
                          <Upload className="w-4 h-4 mr-2" /> Upload JD File (PDF / DOCX / TXT)
                        </label>
                      </Button>
                    </div>
                  </Card>

                  <div className="space-y-3">
                    {clientJds.length === 0 && <p className="text-sm text-muted-foreground">No JDs yet for this client.</p>}
                    {clientJds.map((jd) => (
                      <Card key={jd.id} className="p-6 shadow-sm">
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <h4 className="font-semibold">{jd.title}</h4>
                            <Badge variant={jd.status === "ready" ? "default" : "secondary"} className="mt-1">
                              {jd.status === "extracting" && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                              {jd.status}
                            </Badge>
                          </div>
                          <div className="flex gap-2">
                            {jd.status === "error" && (
                              <Button size="sm" variant="outline" onClick={() => retryExtractJd(jd.id)}>
                                <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Retry
                              </Button>
                            )}
                            <Button size="sm" variant="outline" onClick={() => { setActiveJd(jd.id); setTab("resumes"); setSelected(new Set()); }}>
                              View Resumes
                            </Button>
                            <Button size="icon" variant="ghost" onClick={() => deleteJd(jd.id)}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                        {jd.error && jd.status === "error" && <p className="text-xs text-destructive mb-2">{jd.error}</p>}
                        {jd.criteria && (
                          <div className="border-t border-border pt-3 mt-3">
                            <p className="text-sm text-muted-foreground mb-2">{jd.criteria.summary}</p>
                            <div className="flex flex-wrap gap-1.5">
                              {jd.criteria.criteria?.map((c, i) => (
                                <Badge key={i} variant="outline" className="font-mono text-xs">{c.name} · {c.weight}%</Badge>
                              ))}
                            </div>
                          </div>
                        )}

                        {jd.status === "ready" && (() => {
                          const jdQs = questions.filter((q) => q.jd_id === jd.id);
                          const isOpen = expandedQuestionsJd.has(jd.id);
                          const isGenerating = jd.questions_status === "generating";
                          const toggleQs = () => {
                            const next = new Set(expandedQuestionsJd);
                            next.has(jd.id) ? next.delete(jd.id) : next.add(jd.id);
                            setExpandedQuestionsJd(next);
                          };
                          const draft = contextDraft[jd.id] ?? jd.extra_context ?? "";
                          const regenerate = (withContext) => {
                            api.genQuestions(jd.id, withContext ? draft : undefined);
                            setJds((prev) => prev.map((x) => x.id === jd.id ? { ...x, questions_status: "generating" } : x));
                            toast({ title: "Generating questions…", description: "Preparing your interview kit." });
                          };
                          return (
                            <div className="border-t border-border pt-4 mt-4">
                              <div className="flex items-center justify-between">
                                <button onClick={toggleQs} className="flex items-center gap-2 text-sm font-semibold">
                                  {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                  Interview Questions
                                  {jdQs.length > 0 && <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full text-muted-foreground font-semibold">{jdQs.length}</span>}
                                  {isGenerating && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                                  {jd.questions_status === "error" && <span className="text-[10px] text-destructive font-semibold">error</span>}
                                </button>
                                <Button size="sm" variant="outline" disabled={isGenerating} onClick={() => regenerate(false)}>
                                  {isGenerating ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
                                  {jdQs.length > 0 ? "Regenerate" : "Generate"}
                                </Button>
                              </div>
                              {isOpen && (
                                <div className="mt-4 space-y-4">
                                  <div className="rounded-lg border border-border bg-muted/30 p-4">
                                    <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Additional Context (optional)</label>
                                    <p className="text-xs text-muted-foreground mt-0.5 mb-2">We'll weight this slightly higher than the JD when generating questions.</p>
                                    <Textarea placeholder="e.g. Focus more on system design and team leadership…" value={draft}
                                      onChange={(e) => setContextDraft({ ...contextDraft, [jd.id]: e.target.value })} rows={3} className="text-sm bg-card" />
                                    <div className="flex justify-end mt-2">
                                      <Button size="sm" disabled={isGenerating} onClick={() => regenerate(true)}>
                                        {isGenerating ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
                                        Save & Regenerate
                                      </Button>
                                    </div>
                                  </div>
                                  {jdQs.length === 0 && !isGenerating && <p className="text-sm text-muted-foreground">No questions yet. Click Generate.</p>}
                                  {jdQs.map((q, qi) => (
                                    <div key={q.id} className="rounded-lg border border-border bg-card p-4">
                                      <div className="flex items-start gap-3">
                                        <span className="text-xs font-bold text-muted-foreground/60 w-5 pt-0.5">{qi + 1}</span>
                                        <div className="flex-1 min-w-0">
                                          <div className="flex flex-wrap gap-1.5 mb-2">
                                            {q.category && <Badge variant="secondary" className="text-[10px]">{q.category}</Badge>}
                                            {q.difficulty && <Badge variant="outline" className="text-[10px]">{q.difficulty}</Badge>}
                                          </div>
                                          <p className="text-sm font-semibold text-foreground leading-snug">{q.question}</p>
                                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3">
                                            <div className="rounded-md bg-emerald-50 border border-emerald-200 p-3">
                                              <div className="flex items-center gap-1.5 mb-1">
                                                <span className="text-emerald-600">🟢</span>
                                                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Green-flag response</span>
                                              </div>
                                              <p className="text-xs text-emerald-900 leading-relaxed">{q.green_flag}</p>
                                            </div>
                                            <div className="rounded-md bg-rose-50 border border-rose-200 p-3">
                                              <div className="flex items-center gap-1.5 mb-1">
                                                <span className="text-rose-600">🔴</span>
                                                <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700">Red-flag response</span>
                                              </div>
                                              <p className="text-xs text-rose-900 leading-relaxed">{q.red_flag}</p>
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </Card>
                    ))}
                  </div>
                </>
              )}

              {tab === "resumes" && (
                <>
                  <Card className="p-6 shadow-sm flex flex-col md:flex-row md:items-end md:justify-between gap-6">
                    <div className="flex-1">
                      <label className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2">Filter by JD</label>
                      <select value={activeJd ?? "all"} onChange={(e) => { setActiveJd(e.target.value === "all" ? null : e.target.value); setSelected(new Set()); }}
                        className="w-full bg-muted/60 border border-border rounded-md h-10 px-3 text-sm font-medium">
                        <option value="all">All JDs ({clientJds.length})</option>
                        {clientJds.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
                      </select>
                    </div>
                    <div className="flex-1 flex flex-col gap-2">
                      {activeJd ? (
                        <>
                          <input type="file" multiple accept=".pdf,.docx,.txt" id="resume-upload" className="hidden"
                            onChange={(e) => { uploadResumes(e.target.files); e.target.value = ""; }} />
                          <Button asChild disabled={busy} className="w-full h-10 shadow-md shadow-primary/10 font-semibold">
                            <label htmlFor="resume-upload" className="cursor-pointer">
                              {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                              Upload Resumes (PDF / DOCX / TXT)
                            </label>
                          </Button>
                          <p className="text-[10px] text-muted-foreground text-center uppercase tracking-tight">
                            Uploading to: <span className="text-primary font-bold">{clientJds.find((j) => j.id === activeJd)?.title}</span>
                          </p>
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground text-center py-3">Select a specific JD above to upload resumes.</p>
                      )}
                    </div>
                  </Card>

                  {selected.size > 0 && (
                    <div className="sticky top-[57px] z-10 flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2.5 shadow-md">
                      <span className="text-sm font-medium flex-1">{selected.size} selected</span>
                      <Button size="sm" variant="secondary" onClick={exportCsv}><FileSpreadsheet className="w-4 h-4 mr-1.5" /> Details (CSV)</Button>
                      <Button size="sm" variant="secondary" onClick={exportPdf}><Download className="w-4 h-4 mr-1.5" /> Reports (PDF)</Button>
                      <Button size="sm" variant="ghost" className="text-primary-foreground hover:bg-primary/80" onClick={() => setSelected(new Set())}><X className="w-4 h-4" /></Button>
                    </div>
                  )}

                  {sortedResumes.length > 0 && (
                    <div className="flex items-center gap-2 px-2">
                      <Checkbox checked={selected.size === sortedResumes.length && sortedResumes.length > 0}
                        onChange={(v) => setSelected(v ? new Set(sortedResumes.map((r) => r.id)) : new Set())} />
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Select all ({sortedResumes.length})</span>
                    </div>
                  )}

                  <div className="space-y-4">
                    {sortedResumes.length === 0 && <p className="text-sm text-muted-foreground">No resumes yet.</p>}
                    {sortedResumes.map((r, idx) => {
                      const jd = jds.find((j) => j.id === r.jd_id);
                      const isExpanded = expandedResumes.has(r.id);
                      const criteria = r.criteria_scores?.criteria_scores ?? [];
                      const topSkills = (r.relevant_skills ?? []).slice(0, 4);
                      const restSkills = (r.relevant_skills ?? []).slice(4);
                      return (
                        <Card key={r.id} className="overflow-hidden shadow-sm">
                          <div className="p-6 flex items-start gap-5">
                            <div className="shrink-0 flex items-center gap-3 pt-1">
                              <Checkbox checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} />
                              <span className="text-xs font-bold text-muted-foreground/60 w-4">{idx + 1}</span>
                              <div className="flex flex-col items-center gap-1">
                                <div className={`relative flex items-center justify-center w-14 h-14 rounded-full border-2 ${scoreRing(r.overall_score)}`}>
                                  {r.status === "scoring" ? <Loader2 className="w-5 h-5 animate-spin" /> :
                                    r.overall_score != null ? <span className="text-lg font-bold">{Math.round(r.overall_score)}</span> : <span className="text-xs">—</span>}
                                </div>
                                <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">JD</span>
                              </div>
                              <div className="flex flex-col items-center gap-1">
                                <div className={`relative flex items-center justify-center w-14 h-14 rounded-full border-2 border-dashed ${scoreRing(r.shortlist_score)}`}
                                  title={r.shortlist_summary ?? "Score this resume against shortlisted candidates"}>
                                  {r.shortlist_status === "scoring" ? <Loader2 className="w-5 h-5 animate-spin" /> :
                                    r.shortlist_score != null ? <span className="text-lg font-bold">{Math.round(r.shortlist_score)}</span> : <span className="text-xs">—</span>}
                                </div>
                                <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">Shortlist</span>
                              </div>
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <h3 className="text-xl font-bold text-foreground truncate">{r.candidate_name || r.file_name}</h3>
                                  <div className="flex items-center gap-2 mt-1">
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-muted text-[11px] font-medium text-muted-foreground rounded max-w-full">
                                      <FileText className="w-3 h-3 shrink-0" /><span className="truncate">{r.file_name}</span>
                                    </span>
                                    {!activeJd && jd && <Badge variant="outline" className="text-xs shrink-0">{jd.title}</Badge>}
                                    {r.is_shortlisted && (
                                      <Badge className="text-xs shrink-0 bg-amber-100 text-amber-800 border-amber-200">
                                        <Star className="w-3 h-3 mr-1 fill-amber-500 text-amber-500" /> Shortlisted
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <Button size="icon" variant="ghost" className="text-muted-foreground" onClick={() => toggleExpanded(r.id)}>
                                    {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                                  </Button>
                                  <Button size="icon" variant="ghost" title={r.is_shortlisted ? "Remove from shortlist" : "Mark as shortlisted (good fit)"}
                                    className={r.is_shortlisted ? "text-amber-500 hover:text-amber-600" : "text-muted-foreground"}
                                    onClick={async () => { await api.setShortlist(r.id, !r.is_shortlisted); load(); }}>
                                    <Star className={`w-5 h-5 ${r.is_shortlisted ? "fill-amber-500" : ""}`} />
                                  </Button>
                                  <Button size="icon" variant="ghost" title="Score vs shortlisted candidates" className="text-muted-foreground"
                                    disabled={r.shortlist_status === "scoring"}
                                    onClick={async () => {
                                      try { await api.scoreVsShortlist(r.id); load(); }
                                      catch (e) { toast({ title: "Shortlist scoring failed", description: e.message, variant: "destructive" }); }
                                    }}>
                                    <Sparkles className="w-5 h-5" />
                                  </Button>
                                  <Button size="icon" variant="ghost" title="Re-score against JD" className="text-muted-foreground"
                                    onClick={async () => { await api.rescore(r.id); load(); }}>
                                    <RefreshCw className="w-5 h-5" />
                                  </Button>
                                  <Button size="icon" variant="ghost" className="text-rose-400 hover:text-rose-600 hover:bg-rose-50" onClick={() => deleteResume(r)}>
                                    <Trash2 className="w-5 h-5" />
                                  </Button>
                                </div>
                              </div>

                              {(r.experience_range || r.current_company || r.education) && (
                                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mt-5 text-xs">
                                  {r.experience_range && (
                                    <div className="flex flex-col"><span className="text-muted-foreground font-bold uppercase tracking-tight">Experience</span>
                                      <span className="text-foreground font-semibold mt-0.5">{r.experience_range}</span></div>
                                  )}
                                  {r.current_company && (
                                    <div className="flex flex-col"><span className="text-muted-foreground font-bold uppercase tracking-tight">Current Company</span>
                                      <span className="text-foreground font-semibold mt-0.5 truncate">{r.current_company}</span></div>
                                  )}
                                  {r.education && (
                                    <div className="flex flex-col sm:col-span-2"><span className="text-muted-foreground font-bold uppercase tracking-tight">Education</span>
                                      <span className="text-foreground font-semibold mt-0.5 truncate">{r.education}</span></div>
                                  )}
                                </div>
                              )}

                              {r.relevant_skills && r.relevant_skills.length > 0 && (
                                <div className="mt-6">
                                  <span className="text-xs font-bold text-muted-foreground uppercase tracking-tight">Relevant Skills</span>
                                  <div className="flex flex-wrap gap-1.5 mt-2">
                                    {topSkills.map((s, i) => <span key={`t-${i}`} className="px-2.5 py-1 bg-accent text-accent-foreground rounded-full text-xs font-semibold border border-accent">{s}</span>)}
                                    {restSkills.map((s, i) => <span key={`r-${i}`} className="px-2.5 py-1 bg-muted text-muted-foreground rounded-full text-xs font-semibold">{s}</span>)}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>

                          {r.summary && (
                            <div className="bg-muted/40 border-t border-border p-6">
                              <div className="flex items-center gap-2 mb-3">
                                <div className="p-1 bg-card rounded border border-border shadow-sm">
                                  <svg className="w-3 h-3 text-primary" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2L14.5 9H22L16 14L18.5 21L12 17L5.5 21L8 14L2 9H9.5L12 2Z" /></svg>
                                </div>
                                <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">AI Evaluation Summary</span>
                              </div>
                              <p className="text-sm text-foreground/80 leading-relaxed">{r.summary}</p>
                            </div>
                          )}

                          {r.status === "error" && <div className="border-t border-border px-6 py-3 text-xs text-destructive">Error: {r.error}</div>}

                          {(criteria.length > 0 || r.email || r.linkedin_url) && (
                            <div className="px-6 py-3 border-t border-border flex items-center justify-between gap-4 flex-wrap">
                              <div className="flex items-center gap-x-5 gap-y-1 flex-wrap">
                                {criteria.slice(0, isExpanded ? criteria.length : 3).map((c, i) => (
                                  <div key={i} className="flex items-center gap-2">
                                    <div className={`w-2 h-2 rounded-full ${scoreDot(c.score)}`}></div>
                                    <span className="text-xs font-medium text-muted-foreground">{c.name}: {c.score}/100</span>
                                  </div>
                                ))}
                                {!isExpanded && criteria.length > 3 && (
                                  <button onClick={() => toggleExpanded(r.id)} className="text-xs text-muted-foreground hover:text-foreground">+{criteria.length - 3} more</button>
                                )}
                              </div>
                              <div className="flex gap-4">
                                {r.email && <a href={`mailto:${r.email}`} className="text-xs font-semibold text-primary hover:underline">{r.email}</a>}
                                {r.linkedin_url && <a href={r.linkedin_url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-muted-foreground hover:text-foreground">LinkedIn</a>}
                                {r.phone && <span className="text-xs font-medium text-muted-foreground">{r.phone}</span>}
                              </div>
                            </div>
                          )}

                          {isExpanded && criteria.length > 0 && (
                            <div className="border-t border-border bg-muted/20 px-6 py-5 space-y-4">
                              {r.location && <p className="text-xs text-muted-foreground">📍 {r.location}</p>}
                              {criteria.map((c, i) => (
                                <div key={i} className="flex gap-3">
                                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold shrink-0 border-2 ${scoreRing(c.score)}`}>{c.score}</div>
                                  <div className="flex-1 min-w-0">
                                    <p className="font-semibold text-sm">{c.name}</p>
                                    {c.rationale && <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">{c.rationale}</p>}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {(r.shortlist_score != null || r.shortlist_summary || r.shortlist_status === "scoring") && (
                            <div className="border-t border-amber-200 bg-amber-50/40 px-6 py-5 space-y-4">
                              <div className="flex items-center gap-2">
                                <Sparkles className="w-4 h-4 text-amber-600" />
                                <span className="text-[11px] font-bold text-amber-800 uppercase tracking-widest">
                                  Alignment vs Shortlisted Candidates{r.shortlist_scores?.compared_against ? ` (${r.shortlist_scores.compared_against} profiles)` : ""}
                                </span>
                              </div>
                              {r.shortlist_status === "scoring" && <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Comparing…</p>}
                              {r.shortlist_status === "error" && r.shortlist_summary && <p className="text-sm text-rose-600">{r.shortlist_summary}</p>}
                              {r.shortlist_status === "scored" && (
                                <>
                                  {r.shortlist_summary && <p className="text-sm text-foreground/80 leading-relaxed">{r.shortlist_summary}</p>}
                                  {Array.isArray(r.shortlist_scores?.parameter_scores) && (
                                    <div className="space-y-3">
                                      {r.shortlist_scores.parameter_scores.map((p, i) => (
                                        <div key={i} className="flex gap-3">
                                          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold shrink-0 border-2 ${scoreRing(p.score)}`}>{p.score}</div>
                                          <div className="flex-1 min-w-0">
                                            <p className="font-semibold text-sm capitalize">{String(p.name).replace(/_/g, " ")}</p>
                                            {p.rationale && <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">{p.rationale}</p>}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          )}
                        </Card>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------- UI primitives ----
function cx(...a) { return a.filter(Boolean).join(" "); }

function Button({ variant = "default", size = "default", asChild, disabled, className, children, ...props }) {
  const base = "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus:outline-none";
  const variants = {
    default: "bg-primary text-primary-foreground hover:opacity-90",
    outline: "border border-border bg-background hover:bg-muted text-foreground",
    ghost: "hover:bg-muted text-foreground",
    secondary: "bg-secondary text-secondary-foreground hover:opacity-90",
  };
  const sizes = { default: "h-9 px-4 py-2", sm: "h-8 px-3 text-xs", icon: "h-9 w-9" };
  const cls = cx(base, variants[variant], sizes[size], disabled && "opacity-50 pointer-events-none", className);
  if (asChild) {
    const child = Array.isArray(children) ? children[0] : children;
    return <span className={cls} aria-disabled={disabled || undefined} {...props}>{child}</span>;
  }
  return <button className={cls} disabled={disabled} {...props}>{children}</button>;
}

function Card({ className, children, ...props }) {
  return <div className={cx("rounded-lg border border-border bg-card text-card-foreground", className)} {...props}>{children}</div>;
}
function Input({ className, ...props }) {
  return <input className={cx("flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40", className)} {...props} />;
}
function Textarea({ className, ...props }) {
  return <textarea className={cx("flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40", className)} {...props} />;
}
function Badge({ variant = "default", className, children }) {
  const variants = {
    default: "bg-primary text-primary-foreground border-transparent",
    secondary: "bg-secondary text-secondary-foreground border-transparent",
    outline: "border border-border text-foreground",
  };
  return <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold", variants[variant], className)}>{children}</span>;
}
function Checkbox({ checked, onChange }) {
  return <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)}
    className="h-4 w-4 rounded border-border text-primary focus:ring-ring/40 cursor-pointer" />;
}
function TabBtn({ active, onClick, children }) {
  return (
    <button className={cx("text-sm pb-3 -mb-3 transition-colors", active ? "font-semibold text-foreground border-b-2 border-primary" : "font-medium text-muted-foreground hover:text-foreground/80")} onClick={onClick}>
      {children}
    </button>
  );
}
function EmptyState({ title, desc }) {
  return (
    <div className="flex flex-col items-center justify-center py-32 text-center">
      <div className="w-16 h-16 rounded-2xl bg-accent flex items-center justify-center mb-4"><Briefcase className="w-7 h-7 text-accent-foreground" /></div>
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="text-muted-foreground mt-2 max-w-sm">{desc}</p>
    </div>
  );
}
