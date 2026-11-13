// Cutting layout: fits the parts of a cut list onto stock sheets and boards.
//
// Each piece of stock is a rectangle (a 4×8 sheet, or a board: its width × its length).
// Parts are placed with guillotine cuts, the way a table saw or panel saw works: every cut
// goes straight across the piece it is cutting, so the layout can actually be cut in order.
// The saw kerf is left between parts, and an optional trim margin around the edge (factory
// edges on plywood are rarely clean).
//
// Grain: a part's length runs along the stock's length unless the part may turn.

export interface StockSize {
  /** Across the grain (a sheet's 48", a board's width). */
  width: number;
  /** Along the grain (a sheet's 96", a board's length). */
  length: number;
}

export interface LayoutPart {
  name: string;
  /** Across the grain. */
  width: number;
  /** Along the grain. */
  length: number;
  qty: number;
  /** May the part turn 90° (no grain to respect: MDF, or the user said so)? */
  canRotate: boolean;
}

export interface Placement {
  name: string;
  /** Position on the stock: x across the width, y along the length, from the corner. */
  x: number;
  y: number;
  /** Size as placed (swapped when rotated). */
  width: number;
  length: number;
  rotated: boolean;
}

export interface StockPiece {
  placements: Placement[];
  /** Area of parts / area of the stock, 0..1. */
  used: number;
}

export interface LayoutResult {
  stock: StockSize;
  pieces: StockPiece[];
  /** Parts too big for the stock, even turned. */
  tooBig: { name: string; width: number; length: number }[];
}

export interface LayoutOptions {
  kerf: number;
  /** Kept clear along every edge of the stock. */
  margin: number;
}

interface Free {
  x: number;
  y: number;
  w: number;
  l: number;
}

const EPS = 1e-6;

/** Lay `parts` out on as few pieces of `stock` as it can. */
export function layoutParts(parts: LayoutPart[], stock: StockSize, opts: LayoutOptions): LayoutResult {
  const { kerf, margin } = opts;
  const usableW = stock.width - 2 * margin;
  const usableL = stock.length - 2 * margin;
  const result: LayoutResult = { stock, pieces: [], tooBig: [] };

  // One entry per copy, biggest first (big parts are the hard ones to fit later).
  const queue: LayoutPart[] = [];
  for (const p of parts) for (let i = 0; i < p.qty; i++) queue.push(p);
  queue.sort((a, b) => b.width * b.length - a.width * a.length || Math.max(b.width, b.length) - Math.max(a.width, a.length));

  const sheets: { free: Free[]; piece: StockPiece }[] = [];
  const fits = (w: number, l: number, f: Free) => w <= f.w + EPS && l <= f.l + EPS;

  for (const p of queue) {
    const orients: [number, number, boolean][] = [[p.width, p.length, false]];
    if (p.canRotate && Math.abs(p.width - p.length) > EPS) orients.push([p.length, p.width, true]);
    if (!orients.some(([w, l]) => w <= usableW + EPS && l <= usableL + EPS)) {
      result.tooBig.push({ name: p.name, width: p.width, length: p.length });
      continue;
    }

    // Best fit: the free rectangle that leaves the smallest short-side gap, on any open piece.
    let best: { s: number; fi: number; w: number; l: number; rot: boolean; score: number; long: number } | null = null;
    sheets.forEach((sh, s) => {
      sh.free.forEach((f, fi) => {
        for (const [w, l, rot] of orients) {
          if (!fits(w, l, f)) continue;
          const short = Math.min(f.w - w, f.l - l);
          const long = Math.max(f.w - w, f.l - l);
          if (!best || short < best.score - EPS || (Math.abs(short - best.score) <= EPS && long < best.long)) {
            best = { s, fi, w, l, rot, score: short, long };
          }
        }
      });
    });
    if (!best) {
      sheets.push({ free: [{ x: margin, y: margin, w: usableW, l: usableL }], piece: { placements: [], used: 0 } });
      const s = sheets.length - 1;
      const f = sheets[s].free[0];
      for (const [w, l, rot] of orients) {
        if (fits(w, l, f)) {
          best = { s, fi: 0, w, l, rot, score: 0, long: 0 };
          break;
        }
      }
    }
    const b = best!;
    const sh = sheets[b.s];
    const f = sh.free[b.fi];
    sh.piece.placements.push({ name: p.name, x: f.x, y: f.y, width: b.w, length: b.l, rotated: b.rot });

    // Guillotine split of what's left of f, leaving a kerf beside and above the part.
    // Cut across the shorter leftover first so the bigger offcut stays in one piece.
    const rightW = f.w - b.w - kerf;
    const topL = f.l - b.l - kerf;
    sh.free.splice(b.fi, 1);
    const splitAcrossWidth = f.w - b.w < f.l - b.l;
    const right: Free = { x: f.x + b.w + kerf, y: f.y, w: rightW, l: splitAcrossWidth ? b.l : f.l };
    const top: Free = { x: f.x, y: f.y + b.l + kerf, w: splitAcrossWidth ? f.w : b.w, l: topL };
    for (const r of [right, top]) if (r.w > EPS && r.l > EPS) sh.free.push(r);
  }

  const area = stock.width * stock.length;
  result.pieces = sheets.map((s) => {
    s.piece.used = s.piece.placements.reduce((a, p) => a + p.width * p.length, 0) / area;
    return s.piece;
  });
  return result;
}

/** Standard dressed widths of dimensional lumber, for picking a board to cut a part from. */
export const BOARD_WIDTHS = [1.5, 2.5, 3.5, 5.5, 7.25, 9.25, 11.25];

/** The narrowest standard board a part `width` wide can be cut from (or the width itself if wider). */
export function boardWidthFor(width: number): number {
  return BOARD_WIDTHS.find((w) => w >= width - 1e-6) ?? Math.ceil(width * 4) / 4;
}
