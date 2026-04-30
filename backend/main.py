"""
DocScanPro Backend — FastAPI
Capabilities: pytesseract OCR, pdf2image, OCRmyPDF, python-docx, reportlab PDF
"""

from fastapi import FastAPI, File, UploadFile, Form, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pathlib import Path
import io, os, re, uuid, tempfile, datetime

# ── Optional library imports ────────────────────────────────────────────────
try:
    import pytesseract
    from PIL import Image
    OCR_AVAILABLE = True
except ImportError:
    OCR_AVAILABLE = False

try:
    from pdf2image import convert_from_bytes
    PDF2IMAGE_AVAILABLE = True
except ImportError:
    PDF2IMAGE_AVAILABLE = False

try:
    import ocrmypdf
    OCRMYPDF_AVAILABLE = True
except ImportError:
    OCRMYPDF_AVAILABLE = False

try:
    from docx import Document as DocxDocument
    from docx.shared import Pt, RGBColor, Cm
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    DOCX_AVAILABLE = True
except ImportError:
    DOCX_AVAILABLE = False

try:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.lib import colors
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, PageBreak,
        HRFlowable, KeepTogether, Table, TableStyle,
    )
    from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY
    REPORTLAB_AVAILABLE = True
except ImportError:
    REPORTLAB_AVAILABLE = False

# ── App ─────────────────────────────────────────────────────────────────────
app = FastAPI(title="DocScanPro API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # Replace with your Pages URL in production
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

TEMP_DIR = Path(tempfile.gettempdir()) / "docscanner"
TEMP_DIR.mkdir(exist_ok=True)

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".tif", ".gif"}

# ── Helpers ─────────────────────────────────────────────────────────────────
def tmp(suffix="") -> Path:
    return TEMP_DIR / f"{uuid.uuid4().hex}{suffix}"

def rm(path):
    try: os.unlink(path)
    except: pass

def safe_name(s: str, max_len=60) -> str:
    return re.sub(r"[^a-zA-Z0-9_\-]", "_", s)[:max_len] or "document"


# ── Structure detection ──────────────────────────────────────────────────────
def detect_structure(text: str) -> list[dict]:
    """
    Heuristically parse raw OCR text into a hierarchy:
      level 0 = preamble (no heading)
      level 1 = chapter   (CHAPTER X / PART X / ALL-CAPS ≥ 8 chars)
      level 2 = section   (1. Title  or  SECTION X)
      level 3 = subsection (1.1 Title)
    Returns a list of section dicts with title, level, type, content.
    """
    lines = text.split("\n")
    sections: list[dict] = []
    cur = {"title": "", "level": 0, "type": "preamble", "content": []}

    for line in lines:
        s = line.strip()
        if not s:
            cur["content"].append("")
            continue

        level, typ = None, None

        # Level 1 — chapter keywords or ALL-CAPS headline
        if re.match(r"^(CHAPTER|PART|TITLE|APPENDIX)\s+[\dIVXivxa-z]", s, re.I):
            level, typ = 1, "chapter"
        elif s.isupper() and 7 <= len(s) <= 90 and sum(c.isalpha() for c in s) > len(s) * 0.55:
            level, typ = 1, "chapter"

        # Level 2 — numbered section or SECTION keyword
        elif re.match(r"^(SECTION|ARTICLE|CLAUSE)\s+\d", s, re.I):
            level, typ = 2, "section"
        elif re.match(r"^\d{1,2}[.)]\s+[A-Z]", s):
            level, typ = 2, "section"

        # Level 3 — sub-section
        elif re.match(r"^\d{1,2}\.\d{1,3}[.):\s]", s):
            level, typ = 3, "subsection"

        if level is not None:
            if cur["title"] or cur["content"]:
                sections.append(cur)
            cur = {"title": s, "level": level, "type": typ, "content": []}
        else:
            cur["content"].append(s)

    if cur["title"] or cur["content"]:
        sections.append(cur)

    return sections


# ── PDF builder (reportlab) ──────────────────────────────────────────────────
def build_pdf(sections: list[dict], title: str, author: str, out: str):
    TEAL   = colors.HexColor("#0F6E56")
    TEAL_L = colors.HexColor("#D1FAE5")
    DARK   = colors.HexColor("#111827")
    GRAY   = colors.HexColor("#6B7280")
    WHITE  = colors.white

    pw, ph = A4
    mg = 2.5 * cm

    def header_footer(canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(TEAL)
        canvas.setLineWidth(0.75)
        canvas.line(mg, ph - mg + 0.4 * cm, pw - mg, ph - mg + 0.4 * cm)
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(GRAY)
        canvas.drawString(mg, ph - mg + 0.6 * cm, title[:70])
        canvas.drawRightString(pw - mg, ph - mg + 0.6 * cm,
                               f"Generated {datetime.date.today().isoformat()}")
        canvas.line(mg, 1.6 * cm, pw - mg, 1.6 * cm)
        canvas.drawString(mg, 1.1 * cm, author or "DocScanPro")
        canvas.drawRightString(pw - mg, 1.1 * cm, f"Page {doc.page}")
        canvas.restoreState()

    doc = SimpleDocTemplate(
        out, pagesize=A4,
        leftMargin=mg, rightMargin=mg,
        topMargin=mg + 0.8 * cm, bottomMargin=mg,
        title=title, author=author or "DocScanPro",
        subject="OCR Processed Document",
    )

    # ── Styles ───────────────────────────────────────────────────────────────
    cover_h   = ParagraphStyle("cover_h",   fontSize=30, fontName="Helvetica-Bold",
                                textColor=TEAL,  alignment=TA_CENTER, spaceAfter=8)
    cover_sub = ParagraphStyle("cover_sub", fontSize=11, fontName="Helvetica",
                                textColor=GRAY,  alignment=TA_CENTER, spaceAfter=4)
    cover_tag = ParagraphStyle("cover_tag", fontSize=9,  fontName="Helvetica-Bold",
                                textColor=WHITE, backColor=TEAL, alignment=TA_CENTER,
                                borderPad=8, spaceAfter=4)
    ch_h      = ParagraphStyle("ch_h",  fontSize=20, fontName="Helvetica-Bold",
                                textColor=TEAL,  spaceBefore=6,  spaceAfter=8)
    sec_h     = ParagraphStyle("sec_h", fontSize=13, fontName="Helvetica-Bold",
                                textColor=DARK,  spaceBefore=14, spaceAfter=6)
    sub_h     = ParagraphStyle("sub_h", fontSize=11, fontName="Helvetica-Bold",
                                textColor=colors.HexColor("#374151"),
                                spaceBefore=10, spaceAfter=4)
    body      = ParagraphStyle("body",  fontSize=9.5, fontName="Helvetica",
                                textColor=DARK,  leading=15, spaceAfter=5,
                                alignment=TA_JUSTIFY)
    toc_ch    = ParagraphStyle("toc_ch",  fontSize=11, fontName="Helvetica-Bold",
                                textColor=DARK,  spaceBefore=5, spaceAfter=1)
    toc_sec   = ParagraphStyle("toc_sec", fontSize=10, fontName="Helvetica",
                                textColor=GRAY,  leftIndent=14, spaceAfter=1)
    toc_sub   = ParagraphStyle("toc_sub", fontSize=9,  fontName="Helvetica",
                                textColor=GRAY,  leftIndent=28, spaceAfter=1)

    story = []

    # ── Cover ─────────────────────────────────────────────────────────────────
    story.append(Spacer(1, 4 * cm))
    story.append(HRFlowable(width="100%", thickness=4, color=TEAL, spaceAfter=24))
    story.append(Paragraph(title or "Untitled Document", cover_h))
    story.append(HRFlowable(width="100%", thickness=1, color=TEAL_L, spaceAfter=20))
    if author:
        story.append(Paragraph(f"Prepared by: {author}", cover_sub))
    story.append(Paragraph(
        datetime.datetime.now().strftime("Generated: %B %d, %Y at %H:%M"), cover_sub))
    story.append(Spacer(1, 0.8 * cm))
    story.append(Paragraph("OCR PROCESSED — AUDIT DOCUMENT", cover_tag))
    story.append(PageBreak())

    # ── Table of Contents ────────────────────────────────────────────────────
    toc_entries = [(s["title"], s["level"]) for s in sections if s.get("title")]
    if toc_entries:
        story.append(Paragraph("Table of Contents", ch_h))
        story.append(HRFlowable(width="100%", thickness=0.5, color=TEAL_L, spaceAfter=10))
        ch_n = sec_n = sub_n = 0
        for ttl, lvl in toc_entries:
            if lvl == 1:
                ch_n += 1; sec_n = 0; sub_n = 0
                story.append(Paragraph(f"{ch_n}.  {ttl}", toc_ch))
            elif lvl == 2:
                sec_n += 1; sub_n = 0
                story.append(Paragraph(f"{ch_n}.{sec_n}  {ttl}", toc_sec))
            elif lvl == 3:
                sub_n += 1
                story.append(Paragraph(f"{ch_n}.{sec_n}.{sub_n}  {ttl}", toc_sub))
        story.append(PageBreak())

    # ── Content ───────────────────────────────────────────────────────────────
    def flush_para(buf):
        txt = " ".join(buf).strip()
        if txt:
            story.append(Paragraph(txt, body))

    for i, sec in enumerate(sections):
        lvl   = sec.get("level", 0)
        title_ = sec.get("title", "")
        lines = sec.get("content", [])

        if title_:
            if lvl <= 1:
                if i > 0:
                    story.append(PageBreak())
                story.append(HRFlowable(width="100%", thickness=2, color=TEAL, spaceAfter=4))
                story.append(Paragraph(title_, ch_h))
                story.append(HRFlowable(width="100%", thickness=0.5, color=TEAL_L, spaceAfter=6))
            elif lvl == 2:
                story.append(Paragraph(title_, sec_h))
            else:
                story.append(Paragraph(title_, sub_h))

        buf = []
        for line in lines:
            if line:
                buf.append(line)
            else:
                flush_para(buf)
                buf = []
                story.append(Spacer(1, 4))
        flush_para(buf)

    doc.build(story, onFirstPage=header_footer, onLaterPages=header_footer)


# ── DOCX builder (python-docx) ───────────────────────────────────────────────
def build_docx(sections: list[dict], title: str, author: str, out: str):
    doc = DocxDocument()

    for sec in doc.sections:
        sec.top_margin    = Cm(2.5)
        sec.bottom_margin = Cm(2.5)
        sec.left_margin   = Cm(3.0)
        sec.right_margin  = Cm(2.5)

    TEAL_RGB = RGBColor(0x0F, 0x6E, 0x56)
    GRAY_RGB = RGBColor(0x6B, 0x72, 0x80)

    # Cover
    h = doc.add_heading(title or "Untitled Document", 0)
    h.alignment = WD_ALIGN_PARAGRAPH.CENTER
    h.runs[0].font.color.rgb = TEAL_RGB

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run(datetime.datetime.now().strftime("Generated: %B %d, %Y"))
    r.font.color.rgb = GRAY_RGB
    r.font.size = Pt(10)

    if author:
        pa = doc.add_paragraph()
        pa.alignment = WD_ALIGN_PARAGRAPH.CENTER
        ra = pa.add_run(f"Prepared by: {author}")
        ra.font.color.rgb = GRAY_RGB
        ra.font.size = Pt(10)

    doc.add_page_break()

    # TOC placeholder
    toc_para = doc.add_paragraph("Table of Contents")
    toc_para.style = "Heading 1"
    toc_para.runs[0].font.color.rgb = TEAL_RGB
    doc.add_paragraph("[Update table of contents in Word: References → Update Table]") \
       .runs[0].italic = True
    doc.add_page_break()

    def flush(buf):
        txt = " ".join(buf).strip()
        if txt:
            doc.add_paragraph(txt)

    for i, sec in enumerate(sections):
        lvl    = sec.get("level", 0)
        title_ = sec.get("title", "")
        lines  = sec.get("content", [])

        if title_:
            h_lvl = min(max(lvl, 1), 4)
            h = doc.add_heading(title_, level=h_lvl)
            if lvl <= 1:
                h.runs[0].font.color.rgb = TEAL_RGB
            if lvl <= 1 and i > 0:
                doc.add_page_break()

        buf = []
        for line in lines:
            if line:
                buf.append(line)
            else:
                flush(buf)
                buf = []
        flush(buf)

    doc.save(out)


# ── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "capabilities": {
            "ocr_pytesseract": OCR_AVAILABLE,
            "pdf2image":       PDF2IMAGE_AVAILABLE,
            "ocrmypdf":        OCRMYPDF_AVAILABLE,
            "docx_export":     DOCX_AVAILABLE,
            "pdf_export":      REPORTLAB_AVAILABLE,
        },
    }


@app.post("/api/ocr")
async def ocr(
    file: UploadFile = File(...),
    language: str    = Form("eng"),
):
    """OCR an image or PDF. Returns text + structural sections."""
    if not OCR_AVAILABLE:
        raise HTTPException(500, "pytesseract / Pillow not installed")

    data = await file.read()
    ext  = Path(file.filename or "").suffix.lower()

    images: list = []

    if ext == ".pdf":
        if not PDF2IMAGE_AVAILABLE:
            raise HTTPException(400, "pdf2image not available — install poppler-utils")
        images = convert_from_bytes(data, dpi=200, fmt="jpeg")
    elif ext in IMAGE_EXTS or file.content_type.startswith("image/"):
        img = Image.open(io.BytesIO(data))
        images = [img]
    else:
        raise HTTPException(400, f"Unsupported type: {ext or file.content_type}")

    page_texts = []
    for i, img in enumerate(images):
        if img.mode not in ("RGB", "L", "RGBA"):
            img = img.convert("RGB")
        text = pytesseract.image_to_string(img, lang=language)
        page_texts.append({"page": i + 1, "text": text.strip()})

    full_text = "\n\n--- Page Break ---\n\n".join(p["text"] for p in page_texts)
    sections  = detect_structure(full_text)

    return JSONResponse({
        "text":       full_text,
        "pages":      len(images),
        "page_texts": page_texts,
        "sections":   sections,
        "word_count": len(full_text.split()),
        "char_count": len(full_text),
    })


@app.post("/api/export/pdf")
async def export_pdf(
    background_tasks: BackgroundTasks,
    text:   str = Form(...),
    title:  str = Form("Document"),
    author: str = Form(""),
):
    if not REPORTLAB_AVAILABLE:
        raise HTTPException(500, "reportlab not installed")
    sections = detect_structure(text)
    out = tmp(".pdf")
    build_pdf(sections, title, author, str(out))
    background_tasks.add_task(rm, str(out))
    return FileResponse(str(out), media_type="application/pdf",
                        filename=f"{safe_name(title)}.pdf")


@app.post("/api/export/docx")
async def export_docx(
    background_tasks: BackgroundTasks,
    text:   str = Form(...),
    title:  str = Form("Document"),
    author: str = Form(""),
):
    if not DOCX_AVAILABLE:
        raise HTTPException(500, "python-docx not installed")
    sections = detect_structure(text)
    out = tmp(".docx")
    build_docx(sections, title, author, str(out))
    background_tasks.add_task(rm, str(out))
    return FileResponse(
        str(out),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=f"{safe_name(title)}.docx",
    )


@app.post("/api/export/txt")
async def export_txt(
    background_tasks: BackgroundTasks,
    text:  str = Form(...),
    title: str = Form("Document"),
):
    out = tmp(".txt")
    header = (
        f"{'='*70}\n"
        f"  {title}\n"
        f"  Generated: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M')}\n"
        f"{'='*70}\n\n"
    )
    out.write_text(header + text, encoding="utf-8")
    background_tasks.add_task(rm, str(out))
    return FileResponse(str(out), media_type="text/plain",
                        filename=f"{safe_name(title)}.txt")


@app.post("/api/ocrmypdf")
async def make_searchable(
    background_tasks: BackgroundTasks,
    file:     UploadFile = File(...),
    language: str        = Form("eng"),
):
    """Run OCRmyPDF on an uploaded PDF/image to create a searchable PDF."""
    if not OCRMYPDF_AVAILABLE:
        raise HTTPException(500, "ocrmypdf not installed")

    data = await file.read()
    ext  = Path(file.filename or "").suffix.lower() or ".pdf"
    inp  = tmp(ext)
    out  = tmp("_searchable.pdf")
    inp.write_bytes(data)

    ocrmypdf.ocr(str(inp), str(out), language=language,
                 skip_text=True, deskew=True, clean=True)

    background_tasks.add_task(rm, str(inp))
    background_tasks.add_task(rm, str(out))
    fname = Path(file.filename or "searchable").stem
    return FileResponse(str(out), media_type="application/pdf",
                        filename=f"{safe_name(fname)}_searchable.pdf")
