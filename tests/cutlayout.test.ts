import { describe, expect, it } from 'vitest';
import { LayoutResult, boardWidthFor, layoutParts } from '../src/core/cutlayout';
import { PdfDoc } from '../src/core/pdf';

const sheet = { width: 48, length: 96 };
const opts = { kerf: 0.125, margin: 0 };

/** No two parts overlap (with the kerf between them), and every part is on the stock. */
function valid(r: LayoutResult, kerf: number, margin = 0): boolean {
  for (const piece of r.pieces) {
    const ps = piece.placements;
    for (const p of ps) {
      if (p.x < margin - 1e-9 || p.y < margin - 1e-9) return false;
      if (p.x + p.width > r.stock.width - margin + 1e-9 || p.y + p.length > r.stock.length - margin + 1e-9) return false;
    }
    for (let i = 0; i < ps.length; i++)
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i];
        const b = ps[j];
        const apart = a.x + a.width + kerf <= b.x + 1e-9 || b.x + b.width + kerf <= a.x + 1e-9 || a.y + a.length + kerf <= b.y + 1e-9 || b.y + b.length + kerf <= a.y + 1e-9;
        if (!apart) return false;
      }
  }
  return true;
}

describe('cutting layout', () => {
  it('fits two half sheets on one sheet, kerf permitting', () => {
    const r = layoutParts([{ name: 'Side', width: 23.9, length: 96, qty: 2, canRotate: false }], sheet, opts);
    expect(r.pieces).toHaveLength(1);
    expect(valid(r, 0.125)).toBe(true);
  });

  it('needs a second sheet when the kerf eats the room', () => {
    const r = layoutParts([{ name: 'Side', width: 24, length: 96, qty: 2, canRotate: false }], sheet, opts);
    expect(r.pieces).toHaveLength(2);
  });

  it('lays out a cabinet carcass without overlaps', () => {
    const parts = [
      { name: 'Side', width: 23.25, length: 34.5, qty: 2, canRotate: false },
      { name: 'Bottom', width: 23.25, length: 34.5, qty: 1, canRotate: false },
      { name: 'Shelf', width: 22, length: 33, qty: 2, canRotate: false },
      { name: 'Stretcher', width: 4, length: 34.5, qty: 2, canRotate: false },
      { name: 'Back', width: 34.5, length: 34.5, qty: 1, canRotate: false },
    ];
    const r = layoutParts(parts, sheet, opts);
    expect(valid(r, 0.125)).toBe(true);
    expect(r.pieces.reduce((n, p) => n + p.placements.length, 0)).toBe(8);
    expect(r.pieces.length).toBeLessThanOrEqual(3);
    expect(r.tooBig).toHaveLength(0);
  });

  it('keeps the grain: a part longer than the sheet is wide never turns', () => {
    const r = layoutParts([{ name: 'Rail', width: 3, length: 40, qty: 6, canRotate: false }], sheet, opts);
    for (const p of r.pieces.flatMap((x) => x.placements)) {
      expect(p.rotated).toBe(false);
      expect(p.length).toBe(40);
    }
  });

  it('turns grainless parts when that saves stock', () => {
    // 60 x 40: only fits turned (length along the sheet's 96")
    const fixed = layoutParts([{ name: 'Top', width: 60, length: 40, qty: 1, canRotate: false }], sheet, opts);
    expect(fixed.tooBig).toHaveLength(1);
    const free = layoutParts([{ name: 'Top', width: 60, length: 40, qty: 1, canRotate: true }], sheet, opts);
    expect(free.tooBig).toHaveLength(0);
    expect(free.pieces[0].placements[0].rotated).toBe(true);
  });

  it('keeps a trim margin clear', () => {
    const r = layoutParts([{ name: 'P', width: 10, length: 10, qty: 30, canRotate: false }], sheet, { kerf: 0.125, margin: 0.5 });
    expect(valid(r, 0.125, 0.5)).toBe(true);
  });

  it('cuts boards: several parts from 8-foot 2x4s, first fit by length', () => {
    const r = layoutParts([{ name: 'Leg', width: 3.5, length: 29, qty: 4, canRotate: false }, { name: 'Rail', width: 3.5, length: 40, qty: 2, canRotate: false }], { width: 3.5, length: 96 }, opts);
    expect(valid(r, 0.125)).toBe(true);
    // 40+40 = 80 on one board, 29+29+29 = 87.4 with kerfs on another, one leg left
    expect(r.pieces).toHaveLength(3);
  });

  it('picks the narrowest standard board', () => {
    expect(boardWidthFor(3)).toBe(3.5);
    expect(boardWidthFor(3.5)).toBe(3.5);
    expect(boardWidthFor(6)).toBe(7.25);
    expect(boardWidthFor(13)).toBe(13);
  });
});

describe('PDF writer', () => {
  it('writes a well-formed PDF with a correct cross-reference table', () => {
    const pdf = new PdfDoc().page();
    pdf.text('Cut list: (test) 3/4" × 2\\', 36, 50, { size: 14, bold: true });
    pdf.rect(36, 60, 200, 100, { fill: [0.9, 0.8, 0.6], stroke: [0, 0, 0] });
    pdf.page().line(0, 0, 100, 100);
    const bytes = pdf.bytes();
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/Count 2');
    expect(text).toContain('(Cut list: \\(test\\) 3/4" x 2\\\\) Tj');
    // every xref offset points at its "n 0 obj"
    const xrefAt = Number(/startxref\n(\d+)/.exec(text)![1]);
    const lines = text.slice(xrefAt).split('\n');
    const count = Number(lines[1].split(' ')[1]);
    for (let i = 1; i < count; i++) {
      const off = Number(lines[2 + i].slice(0, 10));
      expect(text.slice(off, off + `${i} 0 obj`.length)).toBe(`${i} 0 obj`);
    }
  });
});
