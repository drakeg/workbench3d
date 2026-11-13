// A small PDF writer: pages with lines, rectangles and Helvetica text. Enough for printable
// shop documents (cutting diagrams, cut lists) without a PDF library.
// Coordinates are in points (1/72"), from the page's top-left corner, y down.

export type RGB = [number, number, number];

interface Page {
  width: number;
  height: number;
  ops: string[];
}

const num = (n: number) => (Math.round(n * 100) / 100).toString();
const color = (c: RGB) => c.map((v) => num(Math.max(0, Math.min(1, v)))).join(' ');

/** Text for a PDF string in WinAnsi: ASCII as is, a few typographic characters mapped, the rest dropped. */
function pdfText(s: string): string {
  const map: Record<string, string> = { '×': 'x', '″': '"', '′': "'", '–': '-', '—': '-', '½': '1/2', '¼': '1/4', '¾': '3/4', '°': ' deg', '²': '2', '…': '...', '·': '-' };
  let out = '';
  for (const ch of s) {
    const c = map[ch] ?? ch;
    for (const d of c) {
      const code = d.charCodeAt(0);
      if (code < 32 || code > 126) continue;
      out += d === '(' || d === ')' || d === '\\' ? `\\${d}` : d;
    }
  }
  return out;
}

/** Helvetica widths (per 1000 em) of the printable ASCII characters, for measuring text. */
const HELV = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667,
  667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556,
  556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

export function textWidth(s: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of pdfText(s).replace(/\\(.)/g, '$1')) w += HELV[ch.charCodeAt(0) - 32] ?? 556;
  return (w / 1000) * size * (bold ? 1.06 : 1);
}

export class PdfDoc {
  private pages: Page[] = [];
  private cur: Page | null = null;

  /** Start a page. Letter landscape by default. */
  page(width = 792, height = 612): this {
    this.cur = { width, height, ops: [] };
    this.pages.push(this.cur);
    return this;
  }

  private get p(): Page {
    if (!this.cur) this.page();
    return this.cur!;
  }

  private y(y: number): number {
    return this.p.height - y;
  }

  rect(x: number, y: number, w: number, h: number, opts: { fill?: RGB; stroke?: RGB; lineWidth?: number } = {}): this {
    const o = this.p.ops;
    o.push('q');
    if (opts.fill) o.push(`${color(opts.fill)} rg`);
    if (opts.stroke) o.push(`${color(opts.stroke)} RG ${num(opts.lineWidth ?? 0.75)} w`);
    o.push(`${num(x)} ${num(this.y(y + h))} ${num(w)} ${num(h)} re`);
    o.push(opts.fill && opts.stroke ? 'B' : opts.fill ? 'f' : 'S');
    o.push('Q');
    return this;
  }

  line(x1: number, y1: number, x2: number, y2: number, stroke: RGB = [0, 0, 0], lineWidth = 0.75, dash?: number[]): this {
    const d = dash ? `[${dash.map(num).join(' ')}] 0 d ` : '';
    this.p.ops.push(`q ${color(stroke)} RG ${num(lineWidth)} w ${d}${num(x1)} ${num(this.y(y1))} m ${num(x2)} ${num(this.y(y2))} l S Q`);
    return this;
  }

  /** Text with its baseline at y. align: where x is. rotate: degrees counter-clockwise. */
  text(s: string, x: number, y: number, opts: { size?: number; bold?: boolean; color?: RGB; align?: 'left' | 'center' | 'right'; rotate?: number } = {}): this {
    const size = opts.size ?? 10;
    const w = textWidth(s, size, opts.bold);
    const dx = opts.align === 'center' ? -w / 2 : opts.align === 'right' ? -w : 0;
    const font = opts.bold ? 'F2' : 'F1';
    const c = color(opts.color ?? [0, 0, 0]);
    const a = ((opts.rotate ?? 0) * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    // offset along the text direction for alignment
    const tx = x + dx * cos;
    const ty = this.y(y) + dx * sin;
    this.p.ops.push(`BT ${c} rg /${font} ${num(size)} Tf ${num(cos)} ${num(sin)} ${num(-sin)} ${num(cos)} ${num(tx)} ${num(ty)} Tm (${pdfText(s)}) Tj ET`);
    return this;
  }

  /** The finished file. */
  bytes(): Uint8Array {
    if (!this.pages.length) this.page();
    const objs: string[] = [];
    const add = (s: string) => objs.push(s); // object numbers start at 1
    const catalog = add('');
    const pagesObj = add('');
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids: number[] = [];
    for (const pg of this.pages) {
      const content = pg.ops.join('\n');
      const c = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
      kids.push(
        add(
          `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${num(pg.width)} ${num(pg.height)}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R >>`,
        ),
      );
    }
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
    objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

    let out = '%PDF-1.4\n%âãÏÓ\n';
    const offsets: number[] = [];
    objs.forEach((o, i) => {
      offsets.push(out.length);
      out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    // every character is below 256, so one byte each and offsets are byte offsets
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
    return bytes;
  }
}
