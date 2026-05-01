import { useState, useRef, useEffect, useCallback } from "react";
import {
  Upload, Camera, FileText, Download, Loader2, CheckCircle,
  AlertCircle, Trash2, Eye, EyeOff, ChevronRight, ChevronDown,
  RotateCcw, FileOutput, BookOpen, Sparkles, Settings, Menu, X,
  ScanLine, FilePlus, Layers, Search, Globe, Cpu, Plus, Scissors,
} from "lucide-react";
import { createWorker } from "tesseract.js";

// ─── Config ────────────────────────────────────────────────────────────────
const API = import.meta.env.VITE_API_URL || "";

// ─── Auto-crop: detect document edges using canvas ──────────────────────────
async function autoCropImage(dataURL) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);

      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0;
      const threshold = 240; // white background threshold

      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          const idx = (y * canvas.width + x) * 4;
          const r = data[idx], g = data[idx+1], b = data[idx+2];
          // If pixel is not near-white, it's content
          if (r < threshold || g < threshold || b < threshold) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      // Add padding
      const pad = 20;
      minX = Math.max(0, minX - pad);
      minY = Math.max(0, minY - pad);
      maxX = Math.min(canvas.width, maxX + pad);
      maxY = Math.min(canvas.height, maxY + pad);

      const cropW = maxX - minX;
      const cropH = maxY - minY;

      // If crop is too small or failed, return original
      if (cropW < 100 || cropH < 100) { resolve(dataURL); return; }

      const cropCanvas = document.createElement("canvas");
      cropCanvas.width = cropW;
      cropCanvas.height = cropH;
      const cropCtx = cropCanvas.getContext("2d");
      cropCtx.drawImage(canvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH);
      resolve(cropCanvas.toDataURL("image/jpeg", 0.92));
    };
    img.onerror = () => resolve(dataURL);
    img.src = dataURL;
  });
}

// ─── Tiny utilities ─────────────────────────────────────────────────────────
const uid = () => `d_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const fmt = (d) => new Date(d).toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" });
const fmtN = (n) => n.toLocaleString();
const safeName = (s) => (s || "Document").replace(/\.[^.]+$/, "");

const toDataURL = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = rej;
  r.readAsDataURL(file);
});

// Download blob received from backend fetch
async function downloadBlob(url, formData, filename) {
  const res = await fetch(url, { method: "POST", body: formData });
  if (!res.ok) throw new Error(`Export failed: ${res.status}`);
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ─── Section tree — client-side heuristic (mirrors backend) ─────────────────
function detectSections(text) {
  const lines = text.split("\n");
  const sections = [];
  let cur = { title: "", level: 0, type: "preamble", content: [] };

  for (const line of lines) {
    const s = line.trim();
    if (!s) { cur.content.push(""); continue; }

    let level = null, type = null;

    if (/^(CHAPTER|PART|TITLE|APPENDIX)\s+[\dIVXivxa-z]/i.test(s)) {
      level = 1; type = "chapter";
    } else if (s === s.toUpperCase() && s.length >= 7 && s.length <= 90
               && [...s].filter(c => /[a-z]/i.test(c)).length > s.length * 0.5) {
      level = 1; type = "chapter";
    } else if (/^(SECTION|ARTICLE|CLAUSE)\s+\d/i.test(s)) {
      level = 2; type = "section";
    } else if (/^\d{1,2}[.)]\s+[A-Z]/.test(s)) {
      level = 2; type = "section";
    } else if (/^\d{1,2}\.\d{1,3}[.)\s]/.test(s)) {
      level = 3; type = "subsection";
    }

    if (level !== null) {
      if (cur.title || cur.content.length) sections.push(cur);
      cur = { title: s, level, type, content: [] };
    } else {
      cur.content.push(s);
    }
  }
  if (cur.title || cur.content.length) sections.push(cur);
  return sections;
}

// ─── Styles (style objects) ──────────────────────────────────────────────────
const S = {
  // Layout
  app:      { display:"flex", flexDirection:"column", minHeight:"100vh", background:"var(--light)" },
  shell:    { display:"flex", flex:1, overflow:"hidden" },

  // Header
  header: {
    display:"flex", alignItems:"center", padding:"0 20px",
    height:56, background:"var(--white)", borderBottom:"1px solid var(--border)",
    boxShadow:"var(--shadow-sm)", position:"sticky", top:0, zIndex:100, gap:12,
  },
  logoBox: {
    width:32, height:32, borderRadius:"var(--radius-sm)",
    background:"var(--teal)", display:"flex", alignItems:"center", justifyContent:"center",
    flexShrink:0,
  },
  logoText: { fontSize:17, fontWeight:700, color:"var(--dark)", letterSpacing:"-0.02em" },
  logoAccent: { color:"var(--teal)" },

  // Sidebar
  sidebar: {
    width:"var(--sidebar-w)", flexShrink:0, background:"var(--white)",
    borderRight:"1px solid var(--border)", display:"flex", flexDirection:"column",
    overflowY:"auto", overflowX:"hidden",
  },
  sideSection: { padding:"16px 16px 0" },
  sideLabel: {
    fontSize:10, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase",
    color:"var(--gray)", marginBottom:8,
  },

  // Upload zone
  dropZone: (dragging) => ({
    border: `2px dashed ${dragging ? "var(--teal)" : "var(--border-d)"}`,
    borderRadius:"var(--radius-md)", padding:"24px 16px",
    background: dragging ? "var(--teal-xl)" : "var(--light)",
    cursor:"pointer", textAlign:"center",
    transition:"all 0.15s",
  }),

  // Main content
  main:    { flex:1, display:"flex", flexDirection:"column", overflow:"hidden" },
  toolbar: {
    display:"flex", alignItems:"center", padding:"10px 20px", gap:8,
    background:"var(--white)", borderBottom:"1px solid var(--border)",
    flexWrap:"wrap",
  },

  // Cards / panels
  card: {
    background:"var(--white)", borderRadius:"var(--radius-lg)",
    border:"1px solid var(--border)", padding:"16px",
    boxShadow:"var(--shadow-sm)",
  },

  // Buttons
  btn: (variant="default", size="md") => {
    const base = {
      display:"inline-flex", alignItems:"center", gap:6,
      fontFamily:"inherit", cursor:"pointer", fontWeight:500, borderRadius:"var(--radius-sm)",
      transition:"all 0.12s", whiteSpace:"nowrap",
    };
    const sizes = {
      sm: { fontSize:11, padding:"5px 10px" },
      md: { fontSize:13, padding:"8px 14px" },
      lg: { fontSize:14, padding:"10px 18px" },
    };
    const variants = {
      default: { background:"var(--white)", color:"var(--mid)", border:"1px solid var(--border-d)" },
      primary: { background:"var(--teal)",  color:"#fff",       border:"1px solid var(--teal)" },
      danger:  { background:"#FEF2F2",      color:"var(--danger)", border:"1px solid #FECACA" },
      ghost:   { background:"transparent", color:"var(--gray)",  border:"1px solid transparent" },
      teal_l:  { background:"var(--teal-xl)", color:"var(--teal)", border:"1px solid var(--teal-l)" },
    };
    return { ...base, ...sizes[size], ...variants[variant] };
  },

  // Status dot
  dot: (color) => ({
    width:7, height:7, borderRadius:"50%", background:color, flexShrink:0,
  }),

  // Text
  muted:   { fontSize:12, color:"var(--gray)", lineHeight:1.5 },
  mono:    { fontFamily:"var(--font-mono)", fontSize:11.5, lineHeight:1.75 },
  badge:   (color) => ({
    fontSize:10, fontWeight:600, padding:"2px 7px", borderRadius:4,
    background:`${color}18`, color, letterSpacing:"0.04em",
    border:`1px solid ${color}30`, textTransform:"uppercase",
  }),

  // Progress bar
  progressWrap: {
    background:"var(--light)", borderRadius:"var(--radius-md)", padding:"12px 14px",
    border:"1px solid var(--border)",
  },
  progressBg: { height:4, background:"var(--border)", borderRadius:2, margin:"8px 0 4px" },
  progressBar: (pct) => ({ height:4, background:"var(--teal)", borderRadius:2, width:`${pct}%`, transition:"width 0.3s" }),

  // OCR text area
  ocrArea: {
    fontFamily:"var(--font-mono)", fontSize:11.5, lineHeight:1.75,
    background:"var(--light)", border:"1px solid var(--border)",
    borderRadius:"var(--radius-md)", padding:"14px 16px",
    whiteSpace:"pre-wrap", wordBreak:"break-word", overflowY:"auto",
    color:"var(--dark)",
  },

  // Section tree
  sectionItem: (lvl) => ({
    display:"flex", alignItems:"flex-start", gap:8, padding:"6px 10px",
    paddingLeft: 10 + lvl * 16,
    borderRadius:"var(--radius-sm)", cursor:"pointer",
    transition:"background 0.1s",
  }),
};

// ─── Sub-components ──────────────────────────────────────────────────────────

function Spinner({ size=16, color="var(--teal)" }) {
  return (
    <Loader2 size={size} color={color}
      style={{ animation:"spin 0.9s linear infinite" }} />
  );
}

function Toast({ toasts, remove }) {
  return (
    <div style={{ position:"fixed", top:16, right:16, zIndex:9999,
                  display:"flex", flexDirection:"column", gap:8 }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          display:"flex", alignItems:"center", gap:8,
          background:"var(--white)", border:`1px solid var(--border)`,
          borderLeft:`3px solid ${t.type==="error"?"var(--danger)":t.type==="warn"?"var(--warn)":"var(--teal)"}`,
          borderRadius:"var(--radius-md)", padding:"10px 14px",
          boxShadow:"var(--shadow-md)", minWidth:260, maxWidth:360, fontSize:13,
        }}>
          {t.type==="error" ? <AlertCircle size={14} color="var(--danger)" /> :
           t.type==="warn"  ? <AlertCircle size={14} color="var(--warn)" />  :
           <CheckCircle size={14} color="var(--teal)" />}
          <span style={{ flex:1, color:"var(--dark)" }}>{t.msg}</span>
          <button onClick={() => remove(t.id)}
            style={{ background:"none", border:"none", cursor:"pointer", color:"var(--gray)", padding:0 }}>
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

function StatusPill({ status }) {
  const map = {
    ok:       { color:"var(--teal)",    label:"Backend connected" },
    offline:  { color:"var(--warn)",    label:"Offline — browser OCR" },
    waking:   { color:"var(--warn)",    label:"Waking up… (30s)" },
    checking: { color:"var(--gray)",    label:"Checking API…" },
    error:    { color:"var(--danger)",  label:"API error" },
  };
  const { color, label } = map[status] || map.checking;
  return (
    <div style={{ display:"flex", alignItems:"center", gap:5, fontSize:11, color:"var(--gray)" }}>
      <div style={{ ...S.dot(color), animation: (status==="checking"||status==="waking")?"pulse 1.5s infinite":undefined }} />
      {label}
    </div>
  );
}

function SectionTree({ sections, onJump }) {
  const [open, setOpen] = useState(new Set());
  if (!sections || !sections.length) return null;

  const toggle = (i) => setOpen(s => { const n = new Set(s); n.has(i)?n.delete(i):n.add(i); return n; });
  const colors = { chapter:"var(--teal)", section:"var(--info)", subsection:"var(--gray)", preamble:"var(--gray)" };

  return (
    <div>
      {sections.map((sec, i) => {
        const lvl = sec.level || 0;
        const hasContent = sec.content?.some(l => l.trim());
        return (
          <div key={i}>
            <div
              style={{ ...S.sectionItem(lvl), background: open.has(i) ? "var(--teal-xl)" : "transparent" }}
              onClick={() => { toggle(i); onJump && onJump(i); }}
            >
              <div style={{ ...S.dot(colors[sec.type] || "var(--gray)"), marginTop:5, flexShrink:0 }} />
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:12, fontWeight: lvl<=1 ? 600 : 500, color:"var(--dark)",
                              overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {sec.title || "(preamble)"}
                </div>
                {hasContent && (
                  <div style={{ fontSize:10, color:"var(--gray)", marginTop:2 }}>
                    {sec.content.filter(l=>l.trim()).length} lines
                  </div>
                )}
              </div>
              {lvl <= 1 && (open.has(i)
                ? <ChevronDown size={11} color="var(--gray)" />
                : <ChevronRight size={11} color="var(--gray)" />)}
            </div>
            {open.has(i) && sec.content?.filter(l=>l.trim()).slice(0,6).map((line,j) => (
              <div key={j} style={{
                fontSize:11, color:"var(--gray)", paddingLeft: 20 + lvl*16,
                padding:"2px 10px 2px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
              }}>
                {line}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function ExportPanel({ doc, apiStatus, notify }) {
  const [busy, setBusy] = useState({});
  const [author, setAuthor] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  const mark = (k, v) => setBusy(b => ({ ...b, [k]: v }));

  const doExport = async (format) => {
    if (!doc) return;
    mark(format, true);
    const fd = new FormData();
    fd.append("text",   doc.text);
    fd.append("title",  doc.title);
    fd.append("author", author);

    try {
      if (format === "txt") {
        // TXT can always be done client-side
        const header = `${"=".repeat(70)}\n  ${doc.title}\n  Generated: ${new Date().toLocaleString()}\n${"=".repeat(70)}\n\n`;
        const blob = new Blob([header + doc.text], { type:"text/plain" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${safeName(doc.title)}.txt`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        notify("TXT downloaded!", "ok");
      } else if (apiStatus === "ok") {
        await downloadBlob(`${API}/api/export/${format}`, fd, `${safeName(doc.title)}.${format}`);
        notify(`${format.toUpperCase()} downloaded!`, "ok");
      } else if (format === "pdf") {
        // Client-side PDF fallback using jsPDF (loaded dynamically)
        await clientPDF(doc);
        notify("PDF downloaded (browser mode)!", "ok");
      } else {
        notify("Backend required for DOCX. Check API connection.", "warn");
      }
    } catch (e) {
      notify(`Export failed: ${e.message}`, "error");
    } finally {
      mark(format, false);
    }
  };

  const doSearchablePDF = async () => {
    if (!doc?.rawFile || apiStatus !== "ok") {
      notify("Searchable PDF requires backend + original file upload", "warn");
      return;
    }
    mark("searchable", true);
    const fd = new FormData();
    fd.append("file", doc.rawFile);
    try {
      await downloadBlob(`${API}/api/ocrmypdf`, fd, `${safeName(doc.title)}_searchable.pdf`);
      notify("Searchable PDF downloaded!", "ok");
    } catch (e) {
      notify(`OCRmyPDF failed: ${e.message}`, "error");
    } finally {
      mark("searchable", false);
    }
  };

  const formats = [
    { key:"pdf",        icon:<FileText size={14}/>,    label:"Structured PDF",     desc:"Sections, TOC, chapters" },
    { key:"docx",       icon:<FileOutput size={14}/>,  label:"Word DOCX",          desc:"Headings, styles, TOC" },
    { key:"txt",        icon:<FileText size={14}/>,    label:"Plain Text",         desc:"Raw OCR output" },
    { key:"searchable", icon:<Search size={14}/>,      label:"Searchable PDF",     desc:"OCRmyPDF (backend)" },
  ];

  return (
    <div style={{ ...S.card, display:"flex", flexDirection:"column", gap:10 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <span style={{ fontSize:12, fontWeight:600, color:"var(--dark)" }}>Export Document</span>
        <button onClick={() => setShowSettings(v=>!v)} style={S.btn("ghost","sm")}>
          <Settings size={12} /> Options
        </button>
      </div>

      {showSettings && (
        <div style={{ padding:"10px", background:"var(--light)", borderRadius:"var(--radius-sm)" }}>
          <label style={{ fontSize:11, color:"var(--gray)", display:"block", marginBottom:4 }}>Author name (optional)</label>
          <input value={author} onChange={e=>setAuthor(e.target.value)}
            placeholder="e.g. Audit Team"
            style={{ width:"100%", padding:"6px 10px", fontSize:12, borderRadius:"var(--radius-sm)",
                     border:"1px solid var(--border-d)", background:"var(--white)", color:"var(--dark)" }} />
        </div>
      )}

      <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
        {formats.map(f => (
          <button key={f.key} onClick={() => f.key==="searchable" ? doSearchablePDF() : doExport(f.key)}
            disabled={!doc || busy[f.key]}
            style={{
              ...S.btn(f.key==="pdf" ? "primary" : "default", "sm"),
              width:"100%", justifyContent:"space-between",
              opacity: !doc ? 0.5 : 1,
            }}>
            <span style={{ display:"flex", alignItems:"center", gap:6 }}>
              {busy[f.key] ? <Spinner size={13}/> : f.icon}
              {f.label}
            </span>
            <span style={{ fontSize:10, color: f.key==="pdf" ? "rgba(255,255,255,0.7)" : "var(--gray)" }}>
              {f.desc}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Minimal client-side PDF fallback (jsPDF via CDN script)
async function clientPDF(doc) {
  if (!window.jspdf) {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  const { jsPDF } = window.jspdf;
  const pdf   = new jsPDF({ unit:"mm", format:"a4" });
  const pW    = pdf.internal.pageSize.getWidth();
  const pH    = pdf.internal.pageSize.getHeight();
  const m     = 15;
  const TEAL  = [15, 110, 86];

  // Header band
  pdf.setFillColor(...TEAL);
  pdf.rect(0, 0, pW, 12, "F");
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(8); pdf.setTextColor(255,255,255);
  pdf.text("OCR PROCESSED DOCUMENT", m, 8);
  pdf.text(new Date().toLocaleDateString(), pW-m, 8, { align:"right" });

  // Title
  let y = 22;
  pdf.setFont("helvetica","bold"); pdf.setFontSize(16); pdf.setTextColor(...TEAL);
  const titleLines = pdf.splitTextToSize(doc.title || "Document", pW-m*2);
  pdf.text(titleLines, m, y); y += titleLines.length*7+4;
  pdf.setDrawColor(209,250,229); pdf.setLineWidth(0.5); pdf.line(m,y,pW-m,y); y+=8;

  const sections = detectSections(doc.text || "");

  for (const sec of sections) {
    if (sec.title) {
      if (sec.level <= 1) {
        if (y > pH-30) { pdf.addPage(); y=20; }
        pdf.setFont("helvetica","bold"); pdf.setFontSize(12); pdf.setTextColor(...TEAL);
        const hl = pdf.splitTextToSize(sec.title, pW-m*2);
        pdf.text(hl, m, y); y += hl.length*5.5+3;
        pdf.setDrawColor(...TEAL); pdf.line(m,y,pW-m,y); y+=5;
      } else if (sec.level === 2) {
        pdf.setFont("helvetica","bold"); pdf.setFontSize(10); pdf.setTextColor(30,30,50);
        pdf.text(pdf.splitTextToSize(sec.title, pW-m*2), m, y); y+=6;
      }
    }
    const body = sec.content.join(" ").replace(/\s+/g," ").trim();
    if (body) {
      pdf.setFont("courier","normal"); pdf.setFontSize(8.5); pdf.setTextColor(50,50,70);
      const lines = pdf.splitTextToSize(body, pW-m*2);
      for (const l of lines) {
        if (y>pH-16) { pdf.addPage(); y=16; }
        pdf.text(l, m, y); y+=4;
      }
      y+=2;
    }
  }

  // Page numbers
  const tot = pdf.internal.getNumberOfPages();
  for (let i=1; i<=tot; i++) {
    pdf.setPage(i);
    pdf.setFont("helvetica","normal"); pdf.setFontSize(7); pdf.setTextColor(150,150,150);
    pdf.text(`${i} / ${tot}`, pW/2, pH-7, { align:"center" });
  }
  pdf.save(`${safeName(doc.title)}.pdf`);
}

// ─── File list item ───────────────────────────────────────────────────────────
function FileItem({ item, active, onClick, onDelete }) {
  const typeColor = item.status==="done" ? "var(--teal)" : item.status==="error" ? "var(--danger)" : "var(--warn)";
  return (
    <div onClick={onClick} style={{
      display:"flex", alignItems:"center", gap:10, padding:"10px 12px",
      borderRadius:"var(--radius-md)", cursor:"pointer",
      background: active ? "var(--teal-xl)" : "transparent",
      border: active ? "1px solid var(--teal-l)" : "1px solid transparent",
      transition:"all 0.12s",
    }}>
      {item.thumb
        ? <img src={item.thumb} alt="" style={{ width:36, height:36, borderRadius:"var(--radius-sm)", objectFit:"cover", flexShrink:0 }} />
        : <div style={{ width:36, height:36, borderRadius:"var(--radius-sm)", background:"var(--light)", border:"1px solid var(--border)",
                        display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
            <FileText size={16} color="var(--gray)" />
          </div>
      }
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:12, fontWeight:500, color:"var(--dark)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
          {safeName(item.name)}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:2 }}>
          {item.status==="processing"
            ? <><Spinner size={11}/><span style={{ fontSize:10, color:"var(--gray)" }}>{item.progressLabel||"Processing…"}</span></>
            : <><div style={S.dot(typeColor)} /><span style={{ fontSize:10, color:"var(--gray)" }}>{fmt(item.date)}</span></>
          }
          {item.pages > 1 && <span style={S.badge("var(--info)")}>{item.pages}pp</span>}
        </div>
      </div>
      <button onClick={(e)=>{e.stopPropagation();onDelete(item.id);}} style={S.btn("ghost","sm")}>
        <Trash2 size={12} />
      </button>
    </div>
  );
}

// ─── Scan to PDF (client-side, like Adobe Scan) ──────────────────────────────
async function scanPagesToPDF(pages) {
  // Load jsPDF dynamically
  if (!window.jspdf) {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit:"mm", format:"a4", orientation:"portrait" });
  const pW  = pdf.internal.pageSize.getWidth();
  const pH  = pdf.internal.pageSize.getHeight();

  for (let i = 0; i < pages.length; i++) {
    if (i > 0) pdf.addPage();
    const dataURL = pages[i];

    // Get image dimensions to fit A4
    await new Promise(res => {
      const img = new Image();
      img.onload = () => {
        const ratio  = Math.min(pW / img.width, pH / img.height);
        const imgW   = img.width  * ratio;
        const imgH   = img.height * ratio;
        const x      = (pW - imgW) / 2;
        const y      = (pH - imgH) / 2;
        pdf.addImage(dataURL, "JPEG", x, y, imgW, imgH);
        res();
      };
      img.src = dataURL;
    });
  }
  return pdf;
}

// ─── Persist docs to localStorage ────────────────────────────────────────────
const STORAGE_KEY = "docscanner_library_v1";

function saveLibrary(docs) {
  try {
    // Don't save rawFile (not serializable), save thumb + text only
    const serializable = docs.map(d => ({
      ...d,
      rawFile: null,
      // Limit thumb size for storage
      thumb: d.thumb ? d.thumb.substring(0, 50000) : null,
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
  } catch (e) {
    console.warn("Could not save to localStorage:", e);
  }
}

function loadLibrary() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// ─── Did You Know / Fun Facts / News content ─────────────────────────────────
const DID_YOU_KNOW = [
  "The word 'audit' comes from the Latin 'audire' — meaning 'to hear'. Ancient auditors literally listened to accounts being read aloud.",
  "OCR technology was first invented in 1914 by Emanuel Goldberg, who built a machine that could read characters and convert them to telegraph code.",
  "India processes over 3 billion government documents every year — most of them still on paper.",
  "A4 paper size (210×297mm) is used in every country except the USA and Canada, which use Letter size (216×279mm).",
  "The PDF format was invented by Adobe in 1993. It stands for Portable Document Format.",
  "Tesseract OCR — the engine powering this app — was originally developed by HP in the 1980s and later open-sourced by Google in 2006.",
  "The Comptroller and Auditor General of India audits over 1,500 government entities every year.",
  "India's CAG office was established in 1858 — making it older than the Constitution of India itself.",
  "The first digital scanner was invented in 1957 by Russell Kirsch. The first image ever scanned was of his baby son.",
  "ASCII — the character encoding used in plain text — was developed in 1963 and still underpins modern computing.",
  "The Right to Information Act (RTI) 2005 made India's government records more accessible. Over 6 million RTI applications are filed each year.",
  "Assam's Local Fund Audit department audits over 10,000 institutions annually — one of the largest in Northeast India.",
  "A single government audit can examine documents spanning decades. The oldest audited Indian document on record dates to the Mughal era.",
  "QR codes — now used on millions of Indian documents — were invented in Japan in 1994 by Masahiro Hara for tracking car parts.",
  "India is the world's largest democracy and generates more official documents per capita than any other nation.",
];

const FUN_FACTS = [
  "🧠 The human brain can read approximately 250 words per minute. This OCR engine processes 1,000+ words per second.",
  "📄 If you stacked all the paper used by India's government in a year, the pile would be taller than Mount Everest.",
  "🔍 The average audit officer reads the equivalent of 47 novels worth of documents every year.",
  "☁️ The cloud server processing your document right now is cooled to -15°C to prevent overheating.",
  "⚡ Your OCR request travels from your phone to the server and back in under 200 milliseconds — faster than a blink.",
  "🌏 Tesseract OCR supports 100+ languages including Sanskrit, making it one of the most multilingual software tools ever built.",
  "📱 Your smartphone camera has more resolution than the scanners used by NASA in the 1960s to map the Moon.",
  "🏛️ The word 'document' comes from the Latin 'documentum' meaning 'proof' or 'lesson'.",
  "💾 A single page of scanned text compressed as PDF is smaller than one second of WhatsApp audio.",
  "🖨️ Johannes Gutenberg's printing press in 1440 could print 3,600 pages per day. Your phone camera can 'scan' that in under 10 minutes.",
  "🔐 Every PDF exported by DocScanPro has embedded metadata — date, time, and document ID — making it audit-trail ready.",
  "🌿 Going paperless with a document scanner saves approximately 100 trees per office per year.",
];

const NEWS_FALLBACK = [
  "📰 India's digital economy is projected to reach $1 trillion by 2026 — document digitization is a key driver.",
  "📰 The Government of India's DigiLocker has crossed 250 million registered users — the world's largest document wallet.",
  "📰 NeSDA 2024 ranked Assam among top-improving states in e-governance — digital audit tools are central to this.",
  "📰 India's RTI portal received 3.2 lakh online applications last year — a 40% jump from the previous year.",
  "📰 The Union Budget 2025 allocated ₹1,500 crore for digitisation of government records across all ministries.",
  "📰 UIDAI's Aadhaar system now processes 50 million authentication requests per day — the world's largest biometric system.",
  "📰 India Post has begun digitising 150 years of postal records — an archive of over 2 billion documents.",
  "📰 The Supreme Court of India ruled that digital documents with proper metadata carry the same legal weight as physical documents.",
];

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [docs,       setDocs]       = useState(() => loadLibrary());
  const [activeId,   setActiveId]   = useState(null);
  const [apiStatus,  setApiStatus]  = useState("checking");
  const [toasts,     setToasts]     = useState([]);
  const [sideOpen,   setSideOpen]   = useState(true);
  const [mobileTab,  setMobileTab]  = useState("scan");
  const [showText,   setShowText]   = useState(true);
  const [dragging,   setDragging]   = useState(false);
  const [ocrMode,    setOcrMode]    = useState("auto");
  const [language,   setLanguage]   = useState("eng");
  // Scan session — multiple pages before finalising
  const [scanPages,  setScanPages]  = useState([]); // array of dataURLs
  const [scanBusy,   setScanBusy]   = useState(false);

  const fileInputRef  = useRef(null);
  const camInputRef   = useRef(null);
  const textAreaRef   = useRef(null);
  const isMobile      = typeof window !== "undefined" && window.innerWidth < 768;

  // ── Toast helpers ────────────────────────────────────────────────────────
  const notify = useCallback((msg, type="ok") => {
    const id = uid();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
  }, []);
  const removeToast = (id) => setToasts(t => t.filter(x => x.id !== id));

  // ── Auto-save library to localStorage ────────────────────────────────────
  useEffect(() => {
    saveLibrary(docs);
  }, [docs]);

  // ── Check backend health ─────────────────────────────────────────────────
  useEffect(() => {
    const check = async () => {
      try {
        // Show "waking" if currently offline (Railway cold start)
        setApiStatus(s => s === "offline" ? "waking" : s);
        const r = await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(12000) });
        if (r.ok) {
          setApiStatus("ok");
        } else {
          setApiStatus("error");
        }
      } catch {
        setApiStatus("offline");
      }
    };
    check();
    // Ping every 10 min to prevent Railway sleeping
    const t = setInterval(check, 10 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  const activeDOC = docs.find(d => d.id === activeId) || null;

  // ── Update a doc in state ─────────────────────────────────────────────────
  const patchDoc = useCallback((id, patch) =>
    setDocs(ds => ds.map(d => d.id === id ? { ...d, ...patch } : d))
  , []);

  // ── Run OCR via backend ───────────────────────────────────────────────────
  const backendOCR = async (file, docId) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("language", language);
    fd.append("engine", ocrMode === "mistral" ? "mistral" : "auto");
    const r = await fetch(`${API}/api/ocr`, { method:"POST", body:fd });
    if (!r.ok) throw new Error(`Backend OCR error ${r.status}`);
    return r.json();
  };

  // ── Run OCR via Tesseract.js (browser) ───────────────────────────────────
  const browserOCR = async (file, docId) => {
    const worker = await createWorker(language, 1, {
      logger: m => {
        if (m.status === "recognizing text") {
          patchDoc(docId, {
            progressLabel: `Recognizing… ${Math.round((m.progress||0)*100)}%`,
            progress: Math.round((m.progress||0)*100),
          });
        } else {
          patchDoc(docId, { progressLabel: m.status });
        }
      },
    });
    const { data: { text } } = await worker.recognize(file);
    await worker.terminate();
    const sections = detectSections(text);
    return { text, sections, pages:1, word_count: text.split(/\s+/).length, char_count: text.length };
  };

  // ── Process one file ──────────────────────────────────────────────────────
  const processFile = useCallback(async (file, existingDocId = null, pageNum = null) => {
    const id    = existingDocId || uid();
    const ext   = file.name.split(".").pop().toLowerCase();
    const isImg = file.type.startsWith("image/");

    // Auto-crop image before processing
    let thumb = null;
    let croppedFile = file;
    if (isImg) {
      patchDoc(id, { progressLabel:"Auto-cropping…", progress:5 });
      const rawDataURL = await toDataURL(file);
      const croppedDataURL = await autoCropImage(rawDataURL);
      thumb = croppedDataURL;
      // Convert cropped dataURL back to File
      const res = await fetch(croppedDataURL);
      const blob = await res.blob();
      croppedFile = new File([blob], file.name, { type:"image/jpeg" });
    }

    if (!existingDocId) {
      const newDoc = {
        id, name: file.name, title: safeName(file.name),
        date: Date.now(), status:"processing",
        thumb, rawFile: croppedFile, ext, pages:1,
        text:"", sections:[], wordCount:0, charCount:0,
        progress:5, progressLabel:"Auto-cropped — starting OCR…",
        allPages: [], // for multi-page
      };
      setDocs(ds => [newDoc, ...ds]);
      setActiveId(id);
      if (isMobile) setMobileTab("result");
    }

    try {
      const useBackend = ocrMode==="backend" || (ocrMode==="auto" && apiStatus==="ok");
      let result;

      if (useBackend && apiStatus==="ok") {
        patchDoc(id, { progressLabel:"Uploading to server…", progress:10 });
        result = await backendOCR(croppedFile, id);
        patchDoc(id, { progress:90, progressLabel:"Finalising…" });
      } else {
        result = await browserOCR(croppedFile, id);
      }

      patchDoc(id, {
        status:"done",
        text:      result.text || "",
        sections:  result.sections || detectSections(result.text||""),
        pages:     result.pages || 1,
        wordCount: result.word_count || result.text?.split(/\s+/).length || 0,
        charCount: result.char_count || result.text?.length || 0,
        progress:  100, progressLabel:"Done",
      });
      notify(`${file.name} processed — ${result.pages||1} page(s)`, "ok");
    } catch (err) {
      patchDoc(id, { status:"error", progressLabel: err.message });
      notify(`Error: ${err.message}`, "error");
    }
  }, [apiStatus, ocrMode, language, patchDoc, notify]);

  // ── Handle dropped / selected files ──────────────────────────────────────
  const handleFiles = (files) => {
    const allowed = new Set(["jpg","jpeg","png","webp","bmp","tiff","tif","gif","pdf"]);
    [...files].forEach(f => {
      const ext = f.name.split(".").pop().toLowerCase();
      if (!allowed.has(ext) && !f.type.startsWith("image/")) {
        notify(`Unsupported: ${f.name}`, "warn"); return;
      }
      processFile(f);
    });
  };

  const onDrop = (e) => {
    e.preventDefault(); setDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  // ── Jump to section in text area ──────────────────────────────────────────
  const jumpToSection = (sectionIdx) => {
    if (!textAreaRef.current || !activeDOC) return;
    const sec = activeDOC.sections?.[sectionIdx];
    if (!sec?.title) return;
    const el = textAreaRef.current;
    const idx = el.textContent.indexOf(sec.title);
    if (idx !== -1) el.scrollTop = (idx / el.textContent.length) * el.scrollHeight;
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Render helpers
  // ─────────────────────────────────────────────────────────────────────────

  const UploadZone = () => (
    <div>
      <p style={S.muted}>Upload images or PDFs. Auto-crop removes backgrounds. Scan multiple pages into one document.</p>
      <div style={{ height:12 }} />

      <div
        style={S.dropZone(dragging)}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <div style={{ width:48, height:48, borderRadius:"50%",
                      background: dragging ? "var(--teal-l)" : "var(--border)",
                      display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 10px" }}>
          <Upload size={22} color={dragging ? "var(--teal)" : "var(--gray)"} />
        </div>
        <div style={{ fontSize:14, fontWeight:500, color:"var(--dark)", marginBottom:4 }}>
          {dragging ? "Drop files here" : "Drop files or click to upload"}
        </div>
        <div style={S.muted}>JPG · PNG · WEBP · PDF · Multi-page supported</div>
      </div>
      <input ref={fileInputRef} type="file" multiple accept="image/*,.pdf"
        style={{ display:"none" }} onChange={e => handleFiles(e.target.files)} />

      <div style={{ display:"flex", gap:8, marginTop:10 }}>
        <button style={{ ...S.btn("primary","sm"), flex:1 }}
          onClick={() => { camInputRef.current.setAttribute("capture","environment"); camInputRef.current?.click(); }}>
          <Camera size={13} /> Scan Page
        </button>
        <button style={{ ...S.btn("default","sm"), flex:1 }}
          onClick={() => { camInputRef.current.removeAttribute("capture"); camInputRef.current?.click(); }}>
          <FilePlus size={13} /> Gallery
        </button>
      </div>

      {/* Multi-page info */}
      <div style={{ marginTop:8, padding:"8px 12px", background:"var(--teal-xl)",
                    borderRadius:"var(--radius-md)", border:"1px solid var(--teal-l)" }}>
        <div style={{ fontSize:11, color:"var(--teal)", fontWeight:600, marginBottom:2 }}>
          📄 Multi-page scanning
        </div>
        <div style={{ fontSize:11, color:"var(--gray)" }}>
          Select multiple images at once from Gallery, or upload multiple files — they'll be combined into one document automatically.
        </div>
      </div>

      {/* Auto-crop info */}
      <div style={{ marginTop:6, padding:"8px 12px", background:"var(--light)",
                    borderRadius:"var(--radius-md)", border:"1px solid var(--border)" }}>
        <div style={{ fontSize:11, color:"var(--dark)", fontWeight:600, marginBottom:2 }}>
          ✂️ Auto-crop enabled
        </div>
        <div style={{ fontSize:11, color:"var(--gray)" }}>
          Document edges are automatically detected and backgrounds cropped before OCR.
        </div>
      </div>

      <input ref={camInputRef} type="file" accept="image/*" multiple
        style={{ display:"none" }} onChange={e => handleFiles(e.target.files)} />

      {/* OCR options */}
      <div style={{ marginTop:16 }}>
        <div style={S.sideLabel}>OCR Engine</div>
        <div style={{ display:"flex", gap:6, marginBottom:8, flexWrap:"wrap" }}>
          {[
            { id:"auto",    icon:<Sparkles size={11}/>, label:"Auto" },
            { id:"mistral", icon:<Cpu size={11}/>,      label:"AI (Mistral)" },
            { id:"backend", icon:<Globe size={11}/>,    label:"Tesseract" },
            { id:"browser", icon:<Cpu size={11}/>,      label:"Browser" },
          ].map(m => (
            <button key={m.id} onClick={() => setOcrMode(m.id)}
              style={{ ...S.btn(ocrMode===m.id?"teal_l":"default","sm"), flex:1, justifyContent:"center", minWidth:"40%" }}>
              {m.icon} {m.label}
            </button>
          ))}
        </div>
        <div style={{ fontSize:10, color:"var(--gray)", marginBottom:8, padding:"6px 8px",
                      background:"var(--light)", borderRadius:"var(--radius-sm)" }}>
          {ocrMode==="auto" && "Uses Mistral AI if available, falls back to Tesseract"}
          {ocrMode==="mistral" && "🤖 Mistral AI — best for tables, charts, mixed scripts"}
          {ocrMode==="backend" && "Pytesseract — fast, works offline"}
          {ocrMode==="browser" && "Tesseract.js — runs in your browser, no server"}
        </div>
        <div style={S.sideLabel}>Language</div>
        <select value={language} onChange={e=>setLanguage(e.target.value)}
          style={{ width:"100%", padding:"6px 10px", fontSize:12, borderRadius:"var(--radius-sm)",
                   border:"1px solid var(--border-d)", background:"var(--white)", color:"var(--dark)" }}>
          <option value="eng">English</option>
          <option value="hin">Hindi — हिन्दी</option>
          <option value="ben">Bengali — বাংলা</option>
          <option value="asm">Assamese — অসমীয়া</option>
          <option value="eng+hin">English + Hindi</option>
          <option value="eng+ben">English + Bengali</option>
          <option value="eng+asm">English + Assamese</option>
          <option value="fra">French</option>
          <option value="deu">German</option>
          <option value="spa">Spanish</option>
          <option value="por">Portuguese</option>
          <option value="ita">Italian</option>
          <option value="rus">Russian</option>
          <option value="chi_sim">Chinese (Simplified)</option>
          <option value="ara">Arabic</option>
        </select>
      </div>
    </div>
  );

  // ── Waiting card — rotates while OCR runs ────────────────────────────────
  const WaitingCard = ({ doc }) => {
    const [card,    setCard]    = useState(null);
    const [visible, setVisible] = useState(true);
    const [idx,     setIdx]     = useState(0);

    const allCards = [
      ...DID_YOU_KNOW.map(t  => ({ type:"did",  emoji:"💡", label:"Did You Know?",          text:t })),
      ...FUN_FACTS.map(t     => ({ type:"fun",  emoji:"🎯", label:"Fun Fact",               text:t })),
      ...NEWS_FALLBACK.map(t => ({ type:"news", emoji:"📰", label:"Today's News at a Glance", text:t })),
    ];

    const typeColors = {
      did:  { bg:"#EFF6FF", border:"#BFDBFE", label:"#1D4ED8" },
      fun:  { bg:"var(--teal-xl)", border:"var(--teal-l)", label:"var(--teal)" },
      news: { bg:"#FFF7ED", border:"#FED7AA", label:"#C2410C" },
    };

    useEffect(() => {
      // Pick random starting card
      const start = Math.floor(Math.random() * allCards.length);
      setIdx(start);
      setCard(allCards[start]);
    }, []);

    useEffect(() => {
      // Rotate every 5 seconds with fade
      const timer = setInterval(() => {
        setVisible(false);
        setTimeout(() => {
          const next = Math.floor(Math.random() * allCards.length);
          setIdx(next);
          setCard(allCards[next]);
          setVisible(true);
        }, 400);
      }, 5500);
      return () => clearInterval(timer);
    }, []);

    const colors = card ? (typeColors[card.type] || typeColors.did) : typeColors.did;

    return (
      <div style={{ flex:1, display:"flex", flexDirection:"column",
                    alignItems:"center", justifyContent:"center", padding:"32px 24px", gap:24 }}>

        {/* Progress section */}
        <div style={{ width:"100%", maxWidth:440 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
            <div style={{ position:"relative", width:36, height:36 }}>
              <svg width="36" height="36" viewBox="0 0 36 36" style={{ transform:"rotate(-90deg)" }}>
                <circle cx="18" cy="18" r="15" fill="none" stroke="var(--border)" strokeWidth="3"/>
                <circle cx="18" cy="18" r="15" fill="none" stroke="var(--teal)" strokeWidth="3"
                  strokeDasharray={`${2*Math.PI*15}`}
                  strokeDashoffset={`${2*Math.PI*15 * (1 - (doc.progress||5)/100)}`}
                  style={{ transition:"stroke-dashoffset 0.5s ease" }} />
              </svg>
              <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center",
                             justifyContent:"center", fontSize:9, fontWeight:700, color:"var(--teal)" }}>
                {doc.progress||0}%
              </div>
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13, fontWeight:600, color:"var(--dark)" }}>
                {doc.progressLabel || "Processing with AI OCR…"}
              </div>
              <div style={{ fontSize:11, color:"var(--gray)", marginTop:2,
                             overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {doc.name}
              </div>
            </div>
          </div>
          <div style={S.progressBg}>
            <div style={{ ...S.progressBar(doc.progress||5),
                           background:`linear-gradient(90deg, var(--teal), #1D9E75)`,
                           boxShadow:"0 0 6px rgba(15,110,86,0.4)" }} />
          </div>
        </div>

        {/* Animated content card */}
        {card && (
          <div style={{
            width:"100%", maxWidth:440,
            background: colors.bg,
            border: `1.5px solid ${colors.border}`,
            borderRadius:"var(--radius-lg)",
            padding:"18px 20px",
            opacity: visible ? 1 : 0,
            transform: visible ? "translateY(0)" : "translateY(6px)",
            transition:"opacity 0.4s ease, transform 0.4s ease",
            minHeight:120,
          }}>
            <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:10 }}>
              <span style={{ fontSize:16 }}>{card.emoji}</span>
              <span style={{ fontSize:11, fontWeight:700, color:colors.label,
                              letterSpacing:"0.06em", textTransform:"uppercase" }}>
                {card.label}
              </span>
              <div style={{ flex:1 }} />
              <div style={{ display:"flex", gap:3 }}>
                {[0,1,2].map(i => (
                  <div key={i} style={{
                    width:5, height:5, borderRadius:"50%",
                    background: colors.label,
                    opacity: 0.3 + (i === idx % 3 ? 0.7 : 0),
                    transition:"opacity 0.3s",
                  }} />
                ))}
              </div>
            </div>
            <div style={{ fontSize:13, color:"var(--dark)", lineHeight:1.65 }}>
              {card.text}
            </div>
          </div>
        )}

        {/* Tip */}
        <div style={{ fontSize:11, color:"var(--gray)", textAlign:"center", maxWidth:360 }}>
          Cards rotate every 5 seconds while your document is processed ✨
        </div>
      </div>
    );
  };

  const ResultView = () => {
    if (!activeDOC) return (
      <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center",
                    justifyContent:"center", padding:40, gap:16 }}>
        <div style={{ width:64, height:64, borderRadius:"50%", background:"var(--light)",
                      border:"1px solid var(--border)", display:"flex", alignItems:"center", justifyContent:"center" }}>
          <ScanLine size={28} color="var(--gray)" />
        </div>
        <div style={{ textAlign:"center" }}>
          <div style={{ fontSize:15, fontWeight:500, color:"var(--dark)", marginBottom:6 }}>No document selected</div>
          <div style={S.muted}>Upload a file to start OCR processing</div>
        </div>
      </div>
    );

    if (activeDOC.status === "processing") return <WaitingCard doc={activeDOC} />;

    if (activeDOC.status === "error") return (
      <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", padding:40 }}>
        <div style={{ textAlign:"center" }}>
          <AlertCircle size={40} color="var(--danger)" style={{ marginBottom:12 }} />
          <div style={{ fontSize:14, fontWeight:500, color:"var(--danger)", marginBottom:6 }}>OCR Failed</div>
          <div style={S.muted}>{activeDOC.progressLabel}</div>
          <button style={{ ...S.btn("default","sm"), marginTop:12 }}
            onClick={() => activeDOC.rawFile && processFile(activeDOC.rawFile)}>
            <RotateCcw size={12} /> Retry
          </button>
        </div>
      </div>
    );

    return (
      <div style={{ flex:1, display:"flex", gap:0, overflow:"hidden" }}>
        {/* Section tree — desktop only */}
        <div style={{ width:240, flexShrink:0, borderRight:"1px solid var(--border)",
                      overflowY:"auto", padding:"12px 8px", background:"var(--white)",
                      display: isMobile ? "none" : "block" }}>
          <div style={{ ...S.sideLabel, padding:"0 4px", marginBottom:10 }}>
            Document structure <span style={{ color:"var(--teal)", fontWeight:700 }}>
              ({activeDOC.sections?.filter(s=>s.title).length||0} sections)
            </span>
          </div>
          <SectionTree sections={activeDOC.sections} onJump={jumpToSection} />
        </div>

        {/* Text content */}
        <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
          {/* Stats bar */}
          <div style={{ display:"flex", alignItems:"center", gap:12, padding:"8px 16px",
                        borderBottom:"1px solid var(--border)", background:"var(--light)",
                        flexWrap:"wrap" }}>
            <span style={S.badge("var(--teal)")}>{activeDOC.pages} page{activeDOC.pages!==1?"s":""}</span>
            <span style={S.badge("var(--info)")}>{fmtN(activeDOC.wordCount)} words</span>
            <span style={S.badge("var(--gray)")}>{fmtN(activeDOC.charCount)} chars</span>
            <span style={S.badge("var(--teal)")}>
              {activeDOC.sections?.filter(s=>s.title).length||0} sections
            </span>
            <div style={{ flex:1 }} />
            <button style={S.btn("ghost","sm")} onClick={() => setShowText(v=>!v)}>
              {showText ? <EyeOff size={12}/> : <Eye size={12}/>}
              {showText ? "Hide text" : "Show text"}
            </button>
            <button style={S.btn("default","sm")}
              onClick={() => { navigator.clipboard.writeText(activeDOC.text||""); notify("Copied!", "ok"); }}>
              Copy
            </button>
          </div>

          {/* OCR text */}
          {showText && (
            <div ref={textAreaRef} style={{
              ...S.ocrArea, flex:1, margin:16, overflowY:"auto",
              maxHeight: "calc(100vh - 240px)",
            }}>
              {activeDOC.text || "(No text extracted)"}
            </div>
          )}

          {/* Thumb on mobile */}
          {isMobile && activeDOC.thumb && (
            <img src={activeDOC.thumb} alt="scan" style={{ width:"100%", maxHeight:180,
              objectFit:"cover", margin:"0 16px 0", borderRadius:"var(--radius-md)" }} />
          )}
        </div>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  // CONTINUOUS CAMERA SCANNER — Adobe Scan style
  // ─────────────────────────────────────────────────────────────────────────
  const videoRef      = useRef(null);
  const canvasRef     = useRef(null);
  const overlayRef    = useRef(null);
  const streamRef     = useRef(null);
  const animFrameRef  = useRef(null);
  const scanInputRef  = useRef(null);

  const [camMode,      setCamMode]      = useState("idle");   // idle | live | review | saving
  const [lastCapture,  setLastCapture]  = useState(null);     // dataURL of last captured page
  const [docDetected,  setDocDetected]  = useState(false);
  const [flashOn,      setFlashOn]      = useState(false);
  const [torchTrack,   setTorchTrack]   = useState(null);

  // Detect mobile browser
  const isMobileBrowser = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

  // Start live camera
  const startCamera = async () => {
    // On mobile browsers, getUserMedia video viewfinder is unreliable
    // Use native camera input instead for guaranteed compatibility
    if (isMobileBrowser) {
      scanInputRef.current?.setAttribute("capture", "environment");
      scanInputRef.current?.click();
      return;
    }

    // Desktop — use live viewfinder
    if (!navigator.mediaDevices?.getUserMedia) {
      notify("Camera API not available — using file picker instead", "warn");
      scanInputRef.current?.click();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode:"environment", width:{ideal:1920}, height:{ideal:1080} },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const track = stream.getVideoTracks()[0];
      if (track?.getCapabilities?.()?.torch) setTorchTrack(track);
      setCamMode("live");
      startEdgeDetection();
    } catch (e) {
      notify("Camera access denied — using file picker instead", "warn");
      scanInputRef.current?.setAttribute("capture", "environment");
      scanInputRef.current?.click();
    }
  };

  // Stop camera
  const stopCamera = () => {
    cancelAnimationFrame(animFrameRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setTorchTrack(null);
    setCamMode("idle");
    setDocDetected(false);
  };

  // Toggle torch/flash
  const toggleFlash = async () => {
    if (!torchTrack) return;
    const newState = !flashOn;
    await torchTrack.applyConstraints({ advanced:[{ torch: newState }] });
    setFlashOn(newState);
  };

  // Edge detection — draw green rectangle overlay when doc detected
  const startEdgeDetection = () => {
    const detect = () => {
      const video   = videoRef.current;
      const overlay = overlayRef.current;
      if (!video || !overlay || video.readyState < 2) {
        animFrameRef.current = requestAnimationFrame(detect); return;
      }
      const ctx = overlay.getContext("2d");
      const w   = overlay.width  = video.videoWidth  || overlay.clientWidth;
      const h   = overlay.height = video.videoHeight || overlay.clientHeight;
      ctx.clearRect(0, 0, w, h);

      // Sample edge pixels — simple brightness variance check
      const tmpCanvas = document.createElement("canvas");
      tmpCanvas.width = 32; tmpCanvas.height = 32;
      const tmp = tmpCanvas.getContext("2d");
      tmp.drawImage(video, 0, 0, 32, 32);
      const d = tmp.getImageData(0, 0, 32, 32).data;
      let variance = 0, sum = 0, sum2 = 0;
      for (let i=0; i<d.length; i+=4) {
        const lum = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
        sum += lum; sum2 += lum*lum;
      }
      const n = d.length/4;
      variance = (sum2/n) - (sum/n)**2;
      const detected = variance > 400;
      setDocDetected(detected);

      if (detected) {
        // Draw animated green guide rectangle
        const pad = 24;
        const rx = pad, ry = pad*1.2, rw = w-pad*2, rh = h-pad*2.4;
        ctx.strokeStyle = "#0F6E56";
        ctx.lineWidth   = 3;
        ctx.shadowColor = "#0F6E56";
        ctx.shadowBlur  = 8;
        // Corner brackets only
        const cs = 28;
        [[rx,ry],[rx+rw,ry],[rx,ry+rh],[rx+rw,ry+rh]].forEach(([cx,cy], i) => {
          ctx.beginPath();
          const sx = i%2===0 ? 1 : -1;
          const sy = i<2     ? 1 : -1;
          ctx.moveTo(cx, cy+sy*cs); ctx.lineTo(cx, cy); ctx.lineTo(cx+sx*cs, cy);
          ctx.stroke();
        });
        // Label
        ctx.shadowBlur = 0;
        ctx.fillStyle  = "#0F6E56";
        ctx.font       = "bold 13px system-ui";
        ctx.fillText("Document detected — tap 📷 to capture", rx+8, ry-6);
      }
      animFrameRef.current = requestAnimationFrame(detect);
    };
    animFrameRef.current = requestAnimationFrame(detect);
  };

  // Capture current frame
  const captureFrame = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    const raw = canvas.toDataURL("image/jpeg", 0.95);
    // Auto-crop then show review
    autoCropImage(raw).then(cropped => {
      setLastCapture(cropped);
      setCamMode("review");
      cancelAnimationFrame(animFrameRef.current);
    });
  };

  // Accept captured page
  const acceptPage = () => {
    if (lastCapture) setScanPages(p => [...p, lastCapture]);
    setLastCapture(null);
    setCamMode("live");
    startEdgeDetection();
  };

  // Retake
  const retakePage = () => {
    setLastCapture(null);
    setCamMode("live");
    startEdgeDetection();
  };

  // Cleanup on unmount
  useEffect(() => () => { stopCamera(); }, []);

  const removeScanPage = (idx) => setScanPages(p => p.filter((_, i) => i !== idx));

  const saveScanAsPDF = async (runOCR = false) => {
    if (scanPages.length === 0) return;
    setScanBusy(true);
    try {
      const title = `Scan_${new Date().toLocaleDateString("en-GB").replace(/\//g,"-")}`;
      // Always download the native scan PDF immediately
      const pdf = await scanPagesToPDF(scanPages);
      pdf.save(`${title}_native.pdf`);
      notify(`📄 Native PDF saved — ${scanPages.length} page(s)!`, "ok");

      if (runOCR) {
        notify("☁️ OCR running in cloud — check Library shortly…", "ok");
        // Fire OCR for all pages in background (don't await — non-blocking)
        scanPages.forEach(async (pageDataURL, i) => {
          const res  = await fetch(pageDataURL);
          const blob = await res.blob();
          const file = new File([blob], `${title}_p${i+1}.jpg`, { type:"image/jpeg" });
          processFile(file);  // non-blocking background OCR
        });
        if (isMobile) setMobileTab("library");
      }
      setScanPages([]);
      stopCamera();
    } catch (e) {
      notify(`Save failed: ${e.message}`, "error");
    } finally {
      setScanBusy(false);
    }
  };

  // Fallback: file input for devices where getUserMedia fails
  const addPageFromFile = async (file) => {
    if (!file) return;
    const raw     = await toDataURL(file);
    const cropped = await autoCropImage(raw);
    setLastCapture(cropped);
    setCamMode("review");
  };

  const ScanSession = () => {
    // ── LIVE VIEWFINDER ────────────────────────────────────────────────────
    if (camMode === "live" || camMode === "review") return (
      <div style={{ position:"fixed", inset:0, background:"#000", zIndex:200,
                    display:"flex", flexDirection:"column" }}>
        {/* Camera feed */}
        {camMode === "live" && (
          <div style={{ flex:1, position:"relative", overflow:"hidden" }}>
            <video ref={videoRef} autoPlay playsInline muted
              style={{ width:"100%", height:"100%", objectFit:"cover", display:"block" }} />
            <canvas ref={overlayRef}
              style={{ position:"absolute", inset:0, width:"100%", height:"100%", pointerEvents:"none" }} />
            <canvas ref={canvasRef} style={{ display:"none" }} />

            {/* Top bar */}
            <div style={{ position:"absolute", top:0, left:0, right:0, padding:"12px 16px",
                          background:"linear-gradient(rgba(0,0,0,0.6),transparent)",
                          display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <button onClick={stopCamera}
                style={{ background:"rgba(0,0,0,0.5)", border:"none", borderRadius:"50%",
                          width:36, height:36, cursor:"pointer", color:"#fff",
                          display:"flex", alignItems:"center", justifyContent:"center" }}>
                <X size={16} />
              </button>
              <div style={{ color:"#fff", fontSize:12, fontWeight:600, background:"rgba(0,0,0,0.4)",
                             padding:"4px 10px", borderRadius:12 }}>
                {scanPages.length > 0 ? `${scanPages.length} page${scanPages.length!==1?"s":""} scanned` : "Point at document"}
              </div>
              <button onClick={toggleFlash}
                style={{ background: flashOn ? "rgba(255,200,0,0.7)" : "rgba(0,0,0,0.5)",
                          border:"none", borderRadius:"50%", width:36, height:36,
                          cursor:"pointer", color:"#fff", fontSize:16,
                          display:"flex", alignItems:"center", justifyContent:"center" }}>
                ⚡
              </button>
            </div>

            {/* Page strip at bottom */}
            {scanPages.length > 0 && (
              <div style={{ position:"absolute", bottom:100, left:0, right:0,
                             display:"flex", gap:6, padding:"6px 12px", overflowX:"auto" }}>
                {scanPages.map((src, i) => (
                  <div key={i} style={{ position:"relative", flexShrink:0 }}>
                    <img src={src} style={{ width:50, height:70, objectFit:"cover",
                                             borderRadius:6, border:"2px solid #0F6E56" }} />
                    <div style={{ position:"absolute", top:1, left:3, background:"#0F6E56",
                                   color:"#fff", fontSize:9, fontWeight:700,
                                   padding:"0 4px", borderRadius:3 }}>{i+1}</div>
                    <button onClick={() => removeScanPage(i)}
                      style={{ position:"absolute", top:1, right:1, background:"rgba(0,0,0,0.7)",
                                border:"none", borderRadius:"50%", width:16, height:16,
                                cursor:"pointer", color:"#fff", fontSize:9,
                                display:"flex", alignItems:"center", justifyContent:"center" }}>
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Capture button */}
            <div style={{ position:"absolute", bottom:0, left:0, right:0, padding:"16px",
                           background:"linear-gradient(transparent, rgba(0,0,0,0.7))",
                           display:"flex", alignItems:"center", justifyContent:"center", gap:20 }}>
              {scanPages.length > 0 && (
                <button onClick={() => saveScanAsPDF(false)} disabled={scanBusy}
                  style={{ background:"rgba(255,255,255,0.15)", border:"1px solid rgba(255,255,255,0.4)",
                            borderRadius:20, padding:"8px 16px", cursor:"pointer", color:"#fff",
                            fontSize:11, fontWeight:600, display:"flex", alignItems:"center", gap:6 }}>
                  <Download size={13}/> Save PDF
                </button>
              )}

              {/* Main shutter */}
              <button onClick={captureFrame}
                style={{ width:68, height:68, borderRadius:"50%",
                          background: docDetected ? "#0F6E56" : "#fff",
                          border:`3px solid ${docDetected ? "#D1FAE5" : "#ccc"}`,
                          cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center",
                          boxShadow: docDetected ? "0 0 20px rgba(15,110,86,0.6)" : "none",
                          transition:"all 0.2s" }}>
                <Camera size={26} color={docDetected ? "#fff" : "#111"} />
              </button>

              {scanPages.length > 0 && (
                <button onClick={() => saveScanAsPDF(true)} disabled={scanBusy}
                  style={{ background:"rgba(15,110,86,0.8)", border:"1px solid #0F6E56",
                            borderRadius:20, padding:"8px 16px", cursor:"pointer", color:"#fff",
                            fontSize:11, fontWeight:600, display:"flex", alignItems:"center", gap:6 }}>
                  <ScanLine size={13}/> Save + OCR
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── REVIEW PAGE ───────────────────────────────────────────────── */}
        {camMode === "review" && lastCapture && (
          <div style={{ flex:1, display:"flex", flexDirection:"column" }}>
            <img src={lastCapture} style={{ flex:1, objectFit:"contain", display:"block" }} />
            <div style={{ padding:"16px", background:"#111",
                           display:"flex", alignItems:"center", justifyContent:"space-around" }}>
              <button onClick={retakePage}
                style={{ background:"#333", border:"none", borderRadius:12, padding:"12px 24px",
                          cursor:"pointer", color:"#fff", fontWeight:600, fontSize:13,
                          display:"flex", alignItems:"center", gap:8 }}>
                <RotateCcw size={15}/> Retake
              </button>
              <div style={{ textAlign:"center" }}>
                <div style={{ color:"#aaa", fontSize:11 }}>Page {scanPages.length+1}</div>
                <div style={{ color:"#fff", fontSize:10, marginTop:2 }}>Auto-cropped ✓</div>
              </div>
              <button onClick={acceptPage}
                style={{ background:"#0F6E56", border:"none", borderRadius:12, padding:"12px 24px",
                          cursor:"pointer", color:"#fff", fontWeight:600, fontSize:13,
                          display:"flex", alignItems:"center", gap:8 }}>
                <CheckCircle size={15}/> Keep
              </button>
            </div>
            <div style={{ display:"flex", gap:8, padding:"0 16px 16px", background:"#111" }}>
              <button onClick={() => { acceptPage(); }} style={{
                flex:1, background:"#1a1a1a", border:"1px solid #333", borderRadius:10,
                padding:"10px", cursor:"pointer", color:"#aaa", fontSize:12,
                display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
                <Plus size={13}/> Accept &amp; scan next
              </button>
            </div>
          </div>
        )}
      </div>
    );

    // ── IDLE — start screen ────────────────────────────────────────────────
    return (
      <div style={{ padding:"0 0 16px" }}>
        <p style={S.muted}>Live camera scanner with auto edge detection. Or use file upload as fallback.</p>
        <div style={{ height:10 }} />

        {/* Page thumbnails if any saved */}
        {scanPages.length > 0 && (
          <div>
            <div style={{ fontSize:11, color:"var(--teal)", fontWeight:600, marginBottom:8 }}>
              {scanPages.length} page{scanPages.length!==1?"s":""} ready
            </div>
            <div style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:8, marginBottom:12 }}>
              {scanPages.map((src, idx) => (
                <div key={idx} style={{ position:"relative", flexShrink:0 }}>
                  <img src={src} style={{ width:70, height:96, objectFit:"cover",
                                           borderRadius:"var(--radius-md)", border:"2px solid var(--teal)" }} />
                  <div style={{ position:"absolute", top:2, left:3, background:"var(--teal)",
                                 color:"#fff", fontSize:9, fontWeight:700, padding:"0 4px", borderRadius:3 }}>
                    {idx+1}
                  </div>
                  <button onClick={() => removeScanPage(idx)} style={{
                    position:"absolute", top:2, right:2, background:"rgba(0,0,0,0.6)",
                    border:"none", borderRadius:"50%", width:18, height:18,
                    cursor:"pointer", color:"#fff", fontSize:10,
                    display:"flex", alignItems:"center", justifyContent:"center" }}>
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:12 }}>
              <button onClick={() => saveScanAsPDF(false)} disabled={scanBusy}
                style={{ ...S.btn("default","md"), width:"100%", justifyContent:"center" }}>
                {scanBusy ? <Spinner size={13}/> : <Download size={13}/>}
                ⬇️ Download Native PDF (no OCR)
              </button>
              <button onClick={() => saveScanAsPDF(true)} disabled={scanBusy}
                style={{ ...S.btn("primary","md"), width:"100%", justifyContent:"center" }}>
                {scanBusy ? <Spinner size={13}/> : <ScanLine size={13}/>}
                ☁️ Save PDF + Cloud OCR
              </button>
              <button onClick={() => setScanPages([])}
                style={{ ...S.btn("ghost","sm"), width:"100%", justifyContent:"center" }}>
                <RotateCcw size={11}/> Clear all pages
              </button>
            </div>
          </div>
        )}

        {/* Start camera */}
        <button onClick={startCamera}
          style={{ ...S.btn("primary","lg"), width:"100%", justifyContent:"center", marginBottom:10 }}>
          <Camera size={18}/> {isMobileBrowser
            ? (scanPages.length > 0 ? "Scan More Pages" : "Open Camera")
            : (scanPages.length > 0 ? "Scan More Pages" : "Open Live Scanner")}
        </button>

        {/* Fallback file input */}
        <button onClick={() => scanInputRef.current?.click()}
          style={{ ...S.btn("default","sm"), width:"100%", justifyContent:"center" }}>
          <FilePlus size={13}/> Add from Gallery / Files
        </button>
        <input ref={scanInputRef} type="file" accept="image/*" multiple style={{ display:"none" }}
          onChange={e => { [...(e.target.files||[])].forEach(f => addPageFromFile(f)); e.target.value=""; }} />

        <div style={{ marginTop:10, padding:"8px 10px", background:"var(--teal-xl)",
                       borderRadius:"var(--radius-md)", border:"1px solid var(--teal-l)" }}>
          <div style={{ fontSize:11, color:"var(--teal)", fontWeight:600 }}>💡 How it works</div>
          <div style={{ fontSize:11, color:"var(--gray)", marginTop:3, lineHeight:1.5 }}>
            {isMobileBrowser
              ? "Tap Open Camera — your phone camera opens natively. Each photo is auto-cropped. Scan as many pages as needed, then save as PDF or run OCR."
              : "Green brackets appear when a document is detected. Tap the shutter. Review → Keep or Retake. Scan as many pages as needed. Native PDF downloads instantly — OCR runs in the cloud."
            }
          </div>
        </div>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  // MOBILE layout
  // ─────────────────────────────────────────────────────────────────────────
  if (isMobile) {
    const tabs = [
      { id:"scan",    icon:<Camera size={18}/>,   label:"Scan" },
      { id:"upload",  icon:<Upload size={18}/>,   label:"Upload" },
      { id:"library", icon:<Layers size={18}/>,   label:"Docs" },
      { id:"result",  icon:<BookOpen size={18}/>, label:"Results" },
      { id:"export",  icon:<Download size={18}/>, label:"Export" },
    ];
    return (
      <div style={{ ...S.app, maxWidth:480, margin:"0 auto" }}>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>

        {/* Mobile header */}
        <div style={{ ...S.header }}>
          <div style={S.logoBox}><ScanLine size={16} color="white" /></div>
          <div>
            <span style={S.logoText}>DocScan<span style={S.logoAccent}>Pro</span></span>
            <div style={{ fontSize:10, color:"var(--gray)" }}>by Sandeep Das, AAO, LGA, Assam</div>
          </div>
          <div style={{ flex:1 }} />
          <StatusPill status={apiStatus} />
        </div>

        {/* Content */}
        <div style={{ flex:1, overflowY:"auto", padding:16 }}>
          {mobileTab==="scan"    && <ScanSession />}
          {mobileTab==="upload"  && <UploadZone />}
          {mobileTab==="library" && (
            docs.length===0
              ? <div style={{ textAlign:"center", padding:40, color:"var(--gray)" }}>No documents yet</div>
              : docs.map(d => <FileItem key={d.id} item={d} active={d.id===activeId}
                  onClick={()=>{setActiveId(d.id);setMobileTab("result");}}
                  onDelete={id=>setDocs(ds=>ds.filter(x=>x.id!==id))} />)
          )}
          {mobileTab==="result"  && <div style={{ display:"flex", flexDirection:"column", flex:1 }}><ResultView /></div>}
          {mobileTab==="export"  && <ExportPanel doc={activeDOC} apiStatus={apiStatus} notify={notify} />}
        </div>

        {/* Bottom nav */}
        <div style={{ display:"flex", borderTop:"1px solid var(--border)", background:"var(--white)" }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setMobileTab(t.id)} style={{
              flex:1, padding:"10px 4px", border:"none", background:"none", cursor:"pointer",
              display:"flex", flexDirection:"column", alignItems:"center", gap:3,
              color: mobileTab===t.id ? "var(--teal)" : "var(--gray)",
              borderTop: `2px solid ${mobileTab===t.id ? "var(--teal)" : "transparent"}`,
              fontSize:10, fontFamily:"inherit", fontWeight: mobileTab===t.id ? 600 : 400,
            }}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        <Toast toasts={toasts} remove={removeToast} />
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DESKTOP layout
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={S.app}>
      <style>{`
        @keyframes spin  { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.4; } }
        button:hover { opacity: 0.88; }
        *::-webkit-scrollbar { width:5px; height:5px; }
        *::-webkit-scrollbar-thumb { background:var(--border-d); border-radius:3px; }
      `}</style>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header style={S.header}>
        <button style={S.btn("ghost","sm")} onClick={() => setSideOpen(v=>!v)}>
          <Menu size={16} />
        </button>
        <div style={S.logoBox}><ScanLine size={16} color="white" /></div>
        <div>
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            <span style={S.logoText}>DocScan<span style={S.logoAccent}>Pro</span></span>
            <span style={{ ...S.badge("var(--teal)"), fontSize:9 }}>Audit Edition</span>
          </div>
          <div style={{ fontSize:10, color:"var(--gray)", marginTop:1 }}>by Sandeep Das, AAO, LGA, Assam</div>
        </div>
        <div style={{ flex:1 }} />
        <StatusPill status={apiStatus} />
        <span style={{ fontSize:11, color:"var(--gray)" }}>
          {docs.length} doc{docs.length!==1?"s":""}
        </span>
      </header>

      {/* ── Shell ──────────────────────────────────────────────────────────── */}
      <div style={S.shell}>

        {/* ── Sidebar ──────────────────────────────────────────────────────── */}
        {sideOpen && (
          <aside style={S.sidebar}>
            <div style={{ padding:"16px 16px 8px" }}>
              <div style={S.sideLabel}>📷 Scan Pages</div>
              <ScanSession />
              <div style={{ height:12 }} />
              <div style={S.sideLabel}>Upload &amp; OCR</div>
              <UploadZone />
            </div>

            <div style={{ borderTop:"1px solid var(--border)", padding:"12px 16px", marginTop:8 }}>
              <div style={S.sideLabel}>Document Library ({docs.length})</div>
              {docs.length === 0 && (
                <div style={{ ...S.muted, textAlign:"center", padding:"20px 0" }}>
                  No documents yet
                </div>
              )}
              {docs.map(d => (
                <FileItem key={d.id} item={d} active={d.id===activeId}
                  onClick={() => setActiveId(d.id)}
                  onDelete={(id) => {
                    setDocs(ds => ds.filter(x => x.id !== id));
                    if (activeId === id) setActiveId(null);
                  }} />
              ))}
            </div>

            <div style={{ borderTop:"1px solid var(--border)", padding:"12px 16px" }}>
              <div style={S.sideLabel}>Export</div>
              <ExportPanel doc={activeDOC} apiStatus={apiStatus} notify={notify} />
            </div>
          </aside>
        )}

        {/* ── Main ─────────────────────────────────────────────────────────── */}
        <main style={S.main}>
          {/* Toolbar */}
          <div style={S.toolbar}>
            {activeDOC && (
              <>
                <span style={{ fontSize:13, fontWeight:600, color:"var(--dark)" }}>
                  {activeDOC.title}
                </span>
                <span style={S.badge(activeDOC.status==="done"?"var(--teal)":"var(--warn)")}>
                  {activeDOC.status}
                </span>
                <div style={{ flex:1 }} />
                {activeDOC.status==="done" && (
                  <button style={S.btn("default","sm")}
                    onClick={() => activeDOC.rawFile && processFile(activeDOC.rawFile)}>
                    <RotateCcw size={12} /> Re-process
                  </button>
                )}
              </>
            )}
            {!activeDOC && (
              <span style={S.muted}>
                Select a document from the sidebar or upload a new file
              </span>
            )}
          </div>

          {/* Result view */}
          <div style={{ flex:1, display:"flex", overflow:"hidden" }}>
            <ResultView />
          </div>
        </main>
      </div>

      <Toast toasts={toasts} remove={removeToast} />

      {/* Footer */}
      <div style={{ padding:"8px 20px", borderTop:"1px solid var(--border)", background:"var(--white)",
                    display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <span style={{ fontSize:10, color:"var(--gray)" }}>DocScanPro · Audit Edition</span>
        <span style={{ fontSize:10, color:"var(--gray)" }}>by <strong>Sandeep Das</strong>, AAO, LGA, Assam</span>
      </div>
    </div>
  );
}
