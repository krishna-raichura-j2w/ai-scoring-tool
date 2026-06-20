import { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { useToast } from "./toast.jsx";
import {
  Briefcase, Plus, Upload, FileText, Users, Loader2, Trash2, ChevronRight,
  ChevronDown, ChevronUp, Download, FileSpreadsheet, X, RefreshCw, Star, Sparkles, Pencil,
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
  const [newJobTitle, setNewJobTitle] = useState("");
  const [newJobCode, setNewJobCode] = useState("");
  const [jdFile, setJdFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [minimizedShortlist, setMinimizedShortlist] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [editingJd, setEditingJd] = useState(null);
  const [editDraft, setEditDraft] = useState({ title: "", job_code: "" });

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
      await api.addJd(activeClient, jdText, { title: newJobTitle.trim(), job_code: newJobCode.trim() });
      setJdText(""); setNewJobTitle(""); setNewJobCode("");
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
      await api.uploadJd(activeClient, file, { title: newJobTitle.trim(), job_code: newJobCode.trim() });
      setNewJobTitle(""); setNewJobCode(""); setJdFile(null);
      toast({ title: "JD uploaded", description: "Extracting criteria & generating questions…" });
      await load();
    } catch (e) { toast({ title: "Upload failed", description: e.message, variant: "destructive" }); }
    setBusy(false);
  }

  // Single submit for the JD form: an attached file takes precedence over pasted text.
  function submitJd() {
    if (!activeClient) return toast({ title: "Pick a client first" });
    if (jdFile) return uploadJdFile(jdFile);
    if (!jdText.trim())
      return toast({ title: "JD required", description: "Paste the JD text or attach a file.", variant: "destructive" });
    return addJd();
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

  function startEditJd(jd) {
    setEditingJd(jd.id);
    setEditDraft({ title: jd.title ?? "", job_code: jd.job_code ?? "" });
  }
  async function saveJdMeta(id) {
    try {
      await api.updateJd(id, { title: editDraft.title.trim(), job_code: editDraft.job_code.trim() });
      setEditingJd(null);
      await load();
      toast({ title: "JD updated" });
    } catch (e) { toast({ title: "Update failed", description: e.message, variant: "destructive" }); }
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

  // Skills matrix: one column per must-have skill (from JD + notes); each cell is
  // an AI statement about the candidate for that skill, with the score appended.
  async function exportSkillsMatrix() {
    if (selectedResumes.length === 0) return;
    setExporting(true);
    try {
      const { columns, rows } = await api.skillMatrix(selectedResumes.map((r) => r.id));
      const cellText = (cell) =>
        !cell ? "" : cell.score == null ? cell.statement : `${cell.statement} (${cell.score}/100)`;
      const data = [
        ["Candidate Name", "Job Title", "Job ID", ...columns, "Final Score"],
        ...rows.map((row) => [
          row.candidate ?? "", row.job_title ?? "", row.job_code ?? "",
          ...columns.map((c) => cellText(row.cells?.[c])),
          row.final_score?.toString() ?? "",
        ]),
      ];
      const csv = data.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
      // Filename: <client>_<job title>.csv (falls back gracefully across multiple roles).
      const slug = (s) => String(s || "").trim().replace(/[^\w.-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
      const clientName = clients.find((c) => c.id === activeClient)?.name;
      const titles = [...new Set(rows.map((r) => r.job_title).filter(Boolean))];
      const jobTitle = titles.length === 1 ? titles[0] : titles.length ? `${titles.length}_roles` : "skills_matrix";
      const filename = `${slug(clientName) || "client"}_${slug(jobTitle) || "skills_matrix"}.csv`;
      downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8;" }), filename);
      toast({ title: "Skills matrix exported", description: `${rows.length} candidate(s) × ${columns.length} skill(s)` });
    } catch (e) {
      toast({ title: "Export failed", description: e.message, variant: "destructive" });
    }
    setExporting(false);
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
    <div className="min-h-screen flex w-full text-foreground">
      {/* Sidebar */}
      <aside className="w-72 border-r border-border/70 bg-card/70 backdrop-blur-xl flex flex-col shrink-0">
        <div className="h-[60px] px-5 flex items-center border-b border-border/70 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-[hsl(230_70%_62%)] flex items-center justify-center shadow-card shrink-0">
              <Sparkles className="w-5 h-5 text-primary-foreground" strokeWidth={2.3} />
            </div>
            <div className="leading-none">
              <div className="font-serif text-[15px] font-semibold tracking-tight text-foreground">Resume Matcher</div>
              <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-[0.22em] mt-1.5">Talent Intelligence</div>
            </div>
          </div>
        </div>
        <div className="p-5">
          <div className="relative mb-6">
            <Input placeholder="New client" value={newClient} onChange={(e) => setNewClient(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addClient()} className="pr-11 bg-muted/60 border-transparent" />
            <button onClick={addClient} aria-label="Add client"
              className="absolute right-1.5 top-1.5 h-7 w-7 bg-primary text-primary-foreground rounded-lg flex items-center justify-center shadow-subtle hover:brightness-110 active:scale-95 transition">
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
            <header className="bg-card/70 backdrop-blur-xl border-b border-border/70 px-8 h-[60px] flex items-center justify-between sticky top-0 z-20">
              <div className="flex gap-8">
                <TabBtn active={tab === "jds"} onClick={() => setTab("jds")}>Job Descriptions</TabBtn>
                <TabBtn active={tab === "resumes"} onClick={() => setTab("resumes")}>Resumes</TabBtn>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="uppercase tracking-wider font-semibold text-muted-foreground/70">Client</span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent text-accent-foreground font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                  {clients.find((c) => c.id === activeClient)?.name}
                </span>
              </div>
            </header>

            <div key={tab} className="p-8 max-w-6xl w-full mx-auto space-y-6 animate-fade-up">
              {tab === "jds" && (
                <>
                  <Card className="p-6">
                    <h3 className="font-serif text-lg font-semibold tracking-tight">Add a Job Description</h3>
                    <p className="text-xs text-muted-foreground mt-0.5 mb-4">Set the title &amp; job ID, or leave the title blank to auto-extract it from the JD.</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                      <div>
                        <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Job Title <span className="font-medium normal-case tracking-normal text-muted-foreground/60">· optional</span></label>
                        <Input placeholder="e.g. Senior Backend Engineer" value={newJobTitle}
                          onChange={(e) => setNewJobTitle(e.target.value)} className="mt-1.5" />
                      </div>
                      <div>
                        <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Job ID <span className="font-medium normal-case tracking-normal text-muted-foreground/60">· optional</span></label>
                        <Input placeholder="e.g. ENG-1042" value={newJobCode}
                          onChange={(e) => setNewJobCode(e.target.value)} className="mt-1.5 font-mono" />
                      </div>
                    </div>
                    <input type="file" accept=".pdf,.docx,.txt" id="jd-file-upload" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) setJdFile(f); e.target.value = ""; }} />

                    {jdFile ? (
                      /* A file is attached — show it as a chip; it will be used on submit. */
                      <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3 mb-3 animate-scale-in">
                        <div className="w-9 h-9 rounded-lg bg-accent flex items-center justify-center shrink-0">
                          <FileText className="w-4 h-4 text-accent-foreground" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold truncate">{jdFile.name}</p>
                          <p className="text-xs text-muted-foreground">{Math.max(1, Math.round(jdFile.size / 1024))} KB · ready to extract</p>
                        </div>
                        <label htmlFor="jd-file-upload" className="text-xs font-semibold text-primary hover:underline cursor-pointer">Replace</label>
                        <button onClick={() => setJdFile(null)} className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted" aria-label="Remove file">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      /* Paste text, or drag-and-drop / attach a file into the same field. */
                      <div className="relative mb-3"
                        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                        onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
                        onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) setJdFile(f); }}>
                        <Textarea placeholder="Paste the full Job Description here…" value={jdText}
                          onChange={(e) => setJdText(e.target.value)} rows={8} />
                        <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
                          <Upload className="w-3.5 h-3.5 shrink-0" />
                          <span>Drag &amp; drop or</span>
                          <label htmlFor="jd-file-upload" className="font-semibold text-primary hover:underline cursor-pointer">attach a PDF / DOCX / TXT</label>
                        </div>
                        {dragging && (
                          <div className="absolute inset-0 -m-1 rounded-xl bg-accent/70 backdrop-blur-sm border-2 border-dashed border-primary flex items-center justify-center pointer-events-none">
                            <span className="text-sm font-semibold text-accent-foreground flex items-center gap-2">
                              <Upload className="w-4 h-4" /> Drop JD file to attach
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    <Button onClick={submitJd} disabled={busy}>
                      {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                      {jdFile ? "Upload JD & Extract Criteria" : "Add JD & Extract Criteria"}
                    </Button>
                  </Card>

                  <div className="space-y-3">
                    {clientJds.length === 0 && <p className="text-sm text-muted-foreground">No JDs yet for this client.</p>}
                    {clientJds.map((jd) => (
                      <Card key={jd.id} className="p-6 shadow-sm">
                        <div className="flex items-start justify-between mb-3 gap-3">
                          {editingJd === jd.id ? (
                            <div className="flex-1 min-w-0 space-y-2">
                              <Input value={editDraft.title} placeholder="Job title"
                                onChange={(e) => setEditDraft((d) => ({ ...d, title: e.target.value }))}
                                className="h-9 text-sm font-semibold" />
                              <Input value={editDraft.job_code} placeholder="Job ID (e.g. ENG-1042)"
                                onChange={(e) => setEditDraft((d) => ({ ...d, job_code: e.target.value }))}
                                onKeyDown={(e) => e.key === "Enter" && saveJdMeta(jd.id)}
                                className="h-9 text-sm" />
                              <div className="flex gap-2">
                                <Button size="sm" onClick={() => saveJdMeta(jd.id)}>Save</Button>
                                <Button size="sm" variant="ghost" onClick={() => setEditingJd(null)}>Cancel</Button>
                              </div>
                            </div>
                          ) : (
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h4 className="font-semibold">{jd.title}</h4>
                                {jd.job_code && <Badge variant="outline" className="font-mono text-[10px]">{jd.job_code}</Badge>}
                              </div>
                              <Badge variant={jd.status === "ready" ? "default" : "secondary"} className="mt-1">
                                {jd.status === "extracting" && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                                {jd.status}
                              </Badge>
                            </div>
                          )}
                          <div className="flex gap-2 shrink-0">
                            {jd.status === "error" && (
                              <Button size="sm" variant="outline" onClick={() => retryExtractJd(jd.id)}>
                                <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Retry
                              </Button>
                            )}
                            {editingJd !== jd.id && (
                              <Button size="sm" variant="outline" onClick={() => startEditJd(jd)}>
                                <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit
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
                  <Card className="p-6 shadow-sm">
                    <label className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2">Filter by JD</label>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                      <select value={activeJd ?? "all"} onChange={(e) => { setActiveJd(e.target.value === "all" ? null : e.target.value); setSelected(new Set()); }}
                        className="flex-1 bg-muted/60 border border-border rounded-md h-10 px-3 text-sm font-medium">
                        <option value="all">All JDs ({clientJds.length})</option>
                        {clientJds.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
                      </select>
                      {activeJd ? (
                        <>
                          <input type="file" multiple accept=".pdf,.docx,.txt" id="resume-upload" className="hidden"
                            onChange={(e) => { uploadResumes(e.target.files); e.target.value = ""; }} />
                          <Button asChild disabled={busy} className="w-full sm:w-auto h-10 px-6 shrink-0 shadow-md shadow-primary/10 font-semibold">
                            <label htmlFor="resume-upload" className="cursor-pointer">
                              {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                              Upload Resumes (PDF / DOCX / TXT)
                            </label>
                          </Button>
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground sm:py-0 py-1 shrink-0">Select a specific JD to upload resumes.</p>
                      )}
                    </div>
                    {activeJd && (
                      <p className="text-[10px] text-muted-foreground uppercase tracking-tight mt-2.5 text-right">
                        Uploading to: <span className="text-primary font-bold">{clientJds.find((j) => j.id === activeJd)?.title}</span>
                      </p>
                    )}
                  </Card>

                  {selected.size > 0 && (
                    <div className="sticky top-[60px] z-10 flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2.5 shadow-md">
                      <span className="text-sm font-medium flex-1">{selected.size} selected</span>
                      <Button size="sm" variant="secondary" onClick={exportCsv}><FileSpreadsheet className="w-4 h-4 mr-1.5" /> Details (CSV)</Button>
                      <Button size="sm" variant="secondary" onClick={exportSkillsMatrix} disabled={exporting}>
                        {exporting ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1.5" />}
                        Skills Matrix (CSV)
                      </Button>
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

                          {(r.shortlist_score != null || r.shortlist_summary || r.shortlist_status === "scoring") && (() => {
                            const minimized = minimizedShortlist.has(r.id);
                            const toggleShortlist = () => setMinimizedShortlist((prev) => {
                              const next = new Set(prev);
                              next.has(r.id) ? next.delete(r.id) : next.add(r.id);
                              return next;
                            });
                            return (
                            <div className="border-t border-amber-200 bg-amber-50/40 px-6 py-4 space-y-4">
                              <button onClick={toggleShortlist} className="flex items-center gap-2 w-full text-left group">
                                <Sparkles className="w-4 h-4 text-amber-600 shrink-0" />
                                <span className="text-[11px] font-bold text-amber-800 uppercase tracking-widest flex-1">
                                  Alignment vs Shortlisted Candidates{r.shortlist_scores?.compared_against ? ` (${r.shortlist_scores.compared_against} profiles)` : ""}
                                </span>
                                {r.shortlist_score != null && minimized && (
                                  <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold border-2 ${scoreRing(r.shortlist_score)}`}>{Math.round(r.shortlist_score)}</span>
                                )}
                                {minimized ? <ChevronDown className="w-4 h-4 text-amber-700 shrink-0" /> : <ChevronUp className="w-4 h-4 text-amber-700 shrink-0" />}
                              </button>
                              {!minimized && (<>
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
                              </>)}
                            </div>
                            );
                          })()}
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
  const base = "inline-flex items-center justify-center rounded-lg font-semibold tracking-tight transition-all duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15 active:scale-[0.97] select-none";
  const variants = {
    default: "bg-primary text-primary-foreground shadow-subtle hover:shadow-card hover:brightness-110",
    outline: "border border-border bg-card/70 text-foreground hover:bg-muted hover:border-muted-foreground/25",
    ghost: "text-foreground hover:bg-muted",
    secondary: "bg-card text-foreground border border-border/70 shadow-subtle hover:shadow-card hover:-translate-y-px",
    destructive: "bg-destructive text-destructive-foreground shadow-subtle hover:brightness-110",
  };
  const sizes = { default: "h-10 px-4 text-sm", sm: "h-8 px-3 text-xs", icon: "h-9 w-9" };
  const cls = cx(base, variants[variant], sizes[size], disabled && "opacity-50 pointer-events-none shadow-none", className);
  if (asChild) {
    const child = Array.isArray(children) ? children[0] : children;
    return <span className={cls} aria-disabled={disabled || undefined} {...props}>{child}</span>;
  }
  return <button className={cls} disabled={disabled} {...props}>{children}</button>;
}

function Card({ className, children, ...props }) {
  return <div className={cx("rounded-2xl border border-border/70 bg-card text-card-foreground shadow-card", className)} {...props}>{children}</div>;
}
function Input({ className, ...props }) {
  return <input className={cx("flex h-10 w-full rounded-lg border border-input bg-card px-3.5 text-sm text-foreground placeholder:text-muted-foreground/60 transition-all duration-200 focus:outline-none focus:border-primary focus:ring-4 focus:ring-ring/10", className)} {...props} />;
}
function Textarea({ className, ...props }) {
  return <textarea className={cx("flex w-full rounded-xl border border-input bg-card px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 leading-relaxed transition-all duration-200 focus:outline-none focus:border-primary focus:ring-4 focus:ring-ring/10", className)} {...props} />;
}
function Badge({ variant = "default", className, children }) {
  const variants = {
    default: "bg-primary text-primary-foreground border-transparent shadow-subtle",
    secondary: "bg-secondary text-secondary-foreground border-transparent",
    outline: "border border-border bg-card/60 text-muted-foreground",
  };
  return <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", variants[variant], className)}>{children}</span>;
}
function Checkbox({ checked, onChange }) {
  return <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)}
    className="h-4 w-4 rounded-[5px] border-input text-primary focus:ring-2 focus:ring-ring/30 cursor-pointer accent-[hsl(var(--primary))]" />;
}
function TabBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick}
      className={cx("relative text-sm transition-colors duration-200", active ? "font-bold text-foreground" : "font-medium text-muted-foreground hover:text-foreground")}>
      {children}
      <span className={cx("absolute -bottom-2 left-0 right-0 h-0.5 rounded-full bg-primary transition-all duration-300 origin-left", active ? "scale-x-100 opacity-100" : "scale-x-0 opacity-0")} />
    </button>
  );
}
function EmptyState({ title, desc }) {
  return (
    <div className="flex flex-col items-center justify-center py-32 text-center animate-fade-up">
      <div className="w-20 h-20 rounded-[1.4rem] bg-gradient-to-br from-accent to-card flex items-center justify-center mb-5 shadow-card border border-border/60 rotate-3">
        <Briefcase className="w-8 h-8 text-accent-foreground" />
      </div>
      <h2 className="font-serif text-2xl font-semibold tracking-tight">{title}</h2>
      <p className="text-muted-foreground mt-2 max-w-sm leading-relaxed">{desc}</p>
    </div>
  );
}
