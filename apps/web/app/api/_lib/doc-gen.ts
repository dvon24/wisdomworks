/**
 * Story 2.12 — Document generation (Word, PowerPoint, Excel, PDF).
 *
 * Each generator returns a Buffer. Caller decides whether to:
 *   - upload to OneDrive/Drive via existing OAuth (live integration)
 *   - return as base64 to the user via WhatsApp (preview / send-as-file)
 *   - persist to a Supabase storage bucket (longer-term archive)
 *
 * All four formats covered:
 *   - .docx via docx (Word)
 *   - .pptx via pptxgenjs (PowerPoint)
 *   - .xlsx via xlsx (Excel)
 *   - .pdf  via pdf-lib (PDF, often generated FROM another doc)
 */

export interface DocSection {
  heading?: string;
  bullets?: string[];
  paragraphs?: string[];
}

// ─── Word ────────────────────────────────────────────────────────────────

export async function generateWordDoc(title: string, sections: DocSection[]): Promise<Buffer> {
  const docxMod: any = await import('docx');
  const { Document, Packer, Paragraph, HeadingLevel, TextRun } = docxMod;

  const children: any[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: title, bold: true, size: 36 })] }),
  ];

  for (const section of sections) {
    if (section.heading) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: section.heading, bold: true })] }));
    }
    for (const p of section.paragraphs ?? []) {
      children.push(new Paragraph({ children: [new TextRun(p)] }));
    }
    for (const b of section.bullets ?? []) {
      children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun(b)] }));
    }
  }

  const doc = new Document({ sections: [{ children }] });
  return await Packer.toBuffer(doc);
}

// ─── PowerPoint ──────────────────────────────────────────────────────────

export interface SlideSpec {
  title: string;
  bullets?: string[];
  body?: string;
  notes?: string;
}

export async function generatePowerPoint(title: string, slides: SlideSpec[]): Promise<Buffer> {
  const pptxMod: any = await import('pptxgenjs');
  const PptxGenJS = pptxMod.default ?? pptxMod;
  const pres = new PptxGenJS();
  pres.title = title;

  // Cover
  const cover = pres.addSlide();
  cover.addText(title, { x: 0.5, y: 2, w: 9, h: 1.5, fontSize: 36, bold: true, align: 'center' });
  cover.addText(new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }), {
    x: 0.5, y: 3.5, w: 9, h: 0.5, fontSize: 14, align: 'center', color: '666666',
  });

  for (const slide of slides) {
    const s = pres.addSlide();
    s.addText(slide.title, { x: 0.5, y: 0.3, w: 9, h: 0.7, fontSize: 28, bold: true });
    let y = 1.2;
    if (slide.body) {
      s.addText(slide.body, { x: 0.5, y, w: 9, h: 1, fontSize: 16 });
      y += 1.2;
    }
    if (slide.bullets?.length) {
      const bulletText = slide.bullets.map((b) => ({ text: b, options: { bullet: true } }));
      s.addText(bulletText, { x: 0.5, y, w: 9, h: 4, fontSize: 14 });
    }
    if (slide.notes) s.addNotes(slide.notes);
  }

  // pptxgenjs returns a Buffer when passed outputType: 'nodebuffer'
  return (await pres.write({ outputType: 'nodebuffer' })) as Buffer;
}

// ─── Excel ───────────────────────────────────────────────────────────────

export interface SheetSpec {
  name: string;
  rows: (string | number | null)[][];
}

export async function generateExcel(sheets: SheetSpec[]): Promise<Buffer> {
  const xlsxMod: any = await import('xlsx');
  const wb = xlsxMod.utils.book_new();
  for (const sheet of sheets) {
    const ws = xlsxMod.utils.aoa_to_sheet(sheet.rows);
    xlsxMod.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31)); // Excel sheet name limit
  }
  return xlsxMod.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

// ─── PDF (simple text-only) ──────────────────────────────────────────────

export async function generatePdf(title: string, sections: DocSection[]): Promise<Buffer> {
  const pdfLib: any = await import('pdf-lib');
  const { PDFDocument, StandardFonts, rgb } = pdfLib;
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page = pdf.addPage([612, 792]); // US Letter
  const margin = 50;
  let y = 792 - margin;

  const wrap = (text: string, charsPerLine: number) => {
    const out: string[] = [];
    const words = text.split(/\s+/);
    let line = '';
    for (const w of words) {
      if ((line + ' ' + w).trim().length > charsPerLine) {
        out.push(line.trim());
        line = w;
      } else {
        line = (line + ' ' + w).trim();
      }
    }
    if (line) out.push(line);
    return out;
  };

  const draw = (text: string, opts: { size?: number; bold?: boolean } = {}) => {
    const size = opts.size ?? 11;
    const f = opts.bold ? bold : font;
    const lines = wrap(text, Math.floor((612 - 2 * margin) / (size * 0.55)));
    for (const line of lines) {
      if (y < margin + size) {
        page = pdf.addPage([612, 792]);
        y = 792 - margin;
      }
      page.drawText(line, { x: margin, y, size, font: f, color: rgb(0, 0, 0) });
      y -= size * 1.4;
    }
  };

  draw(title, { size: 22, bold: true });
  y -= 12;

  for (const section of sections) {
    if (section.heading) {
      y -= 8;
      draw(section.heading, { size: 14, bold: true });
    }
    for (const p of section.paragraphs ?? []) draw(p);
    for (const b of section.bullets ?? []) draw('• ' + b);
    y -= 6;
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

// ─── Upload via OAuth (Drive / OneDrive) ─────────────────────────────────

interface DriveUploadResult {
  ok: boolean;
  fileId?: string;
  webUrl?: string;
  error?: string;
}

/**
 * Upload to Google Drive via the user's stored Google OAuth access token.
 */
export async function uploadToGoogleDrive(
  accessToken: string,
  filename: string,
  mimeType: string,
  buffer: Buffer,
): Promise<DriveUploadResult> {
  // Use Drive's multipart upload — metadata + body in one request
  const boundary = `---wisdomworks-${Date.now()}`;
  const meta = JSON.stringify({ name: filename });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  try {
    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      },
    );
    if (!res.ok) return { ok: false, error: `${res.status}: ${await res.text()}` };
    const data = await res.json();
    return { ok: true, fileId: data.id, webUrl: data.webViewLink };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Upload to OneDrive via the user's stored Microsoft OAuth access token.
 * Drops the file in /Documents/Wisdomworks-Generated.
 */
export async function uploadToOneDrive(
  accessToken: string,
  filename: string,
  buffer: Buffer,
): Promise<DriveUploadResult> {
  const path = `/me/drive/root:/Wisdomworks-Generated/${encodeURIComponent(filename)}:/content`;
  try {
    const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/octet-stream',
      },
      body: buffer as any,
    });
    if (!res.ok) return { ok: false, error: `${res.status}: ${await res.text()}` };
    const data = await res.json();
    return { ok: true, fileId: data.id, webUrl: data.webUrl };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
