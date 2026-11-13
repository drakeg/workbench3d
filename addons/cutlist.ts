import type { AddOn, WorkbenchAPI } from '../src/plugins/api';
import type { Group } from '../src/core/document';
import { LayoutResult, boardWidthFor, layoutParts } from '../src/core/cutlayout';
import { PdfDoc, RGB, textWidth } from '../src/core/pdf';

interface Row {
  name: string;
  material: string;
  /** What the part is cut from, e.g. "2x4" or "3/4" plywood", when the Lumber add-on made it. */
  stock: string;
  t: number;
  w: number;
  l: number;
  qty: number;
}

/** Parts of one material and thickness, cut from the same kind of stock. */
interface StockGroup {
  key: string;
  label: string;
  material: string;
  t: number;
  rows: Row[];
  kind: 'sheet' | 'board';
  width: number;
  length: number;
  /** MDF and similar have no grain, so parts may turn. */
  grainless: boolean;
}

interface Settings {
  kerf: number;
  margin: number;
  respectGrain: boolean;
  /** Per stock group key: kind and size the user chose. */
  stock: Record<string, { kind: 'sheet' | 'board'; width: number; length: number }>;
}

const DEFAULTS: Settings = { kerf: 0.125, margin: 0, respectGrain: true, stock: {} };

/** Every group that holds geometry of its own counts as a part. */
function parts(root: Group): Group[] {
  const out: Group[] = [];
  for (const g of root.walk()) if (g !== root && g.mesh.faces.size > 0 && !g.hidden) out.push(g);
  return out;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const key64 = (n: number) => Math.round(n * 64);

function collectRows(api: WorkbenchAPI): Row[] {
  const rows: Row[] = [];
  for (const g of parts(api.doc.root)) {
    const s = g.mesh.bounds().getSize(new api.THREE.Vector3());
    const [t, w, l] = [s.x, s.y, s.z].sort((a, b) => a - b);
    const material = String(g.attributes.material ?? '');
    const stock = String(g.attributes.stock ?? '');
    const existing = rows.find((r) => r.name === g.name && r.material === material && key64(r.t) === key64(t) && key64(r.w) === key64(w) && key64(r.l) === key64(l));
    if (existing) existing.qty++;
    else rows.push({ name: g.name, material, stock, t, w, l, qty: 1 });
  }
  rows.sort((a, b) => a.material.localeCompare(b.material) || b.t - a.t || b.l - a.l);
  return rows;
}

function stockGroups(rows: Row[], settings: Settings, fmt: (n: number) => string): StockGroup[] {
  const groups = new Map<string, StockGroup>();
  for (const r of rows) {
    const key = `${r.material}|${key64(r.t)}`;
    let g = groups.get(key);
    if (!g) {
      const sheetish = /plywood|mdf|osb|particle|sheet|melamine/i.test(`${r.stock} ${r.material}`);
      g = {
        key,
        label: `${r.material || 'Unnamed material'} ${fmt(r.t)}`,
        material: r.material,
        t: r.t,
        rows: [],
        kind: sheetish ? 'sheet' : 'board',
        width: 48,
        length: 96,
        grainless: /mdf|particle|melamine|hardboard/i.test(`${r.stock} ${r.material}`),
      };
      groups.set(key, g);
    }
    g.rows.push(r);
  }
  for (const g of groups.values()) {
    const metal = g.rows.some((r) => /steel|alumin|metal|tube|angle|channel/i.test(`${r.stock} ${r.material}`));
    if (metal) {
      // bar stock and tube come in 20' sticks, cut to length (no grain, but a profile can't turn)
      g.kind = 'board';
      g.width = Math.max(...g.rows.map((r) => r.w));
      g.length = 240;
    }
    // wide parts can't come from boards
    else if (g.kind === 'board' && g.rows.some((r) => r.w > 11.25 + 1e-6)) g.kind = 'sheet';
    if (g.kind === 'board' && !metal) {
      g.width = boardWidthFor(Math.max(...g.rows.map((r) => r.w)));
      const longest = Math.max(...g.rows.map((r) => r.l));
      g.length = [96, 120, 144, 192].find((L) => L >= longest - 1e-6) ?? Math.ceil(longest / 12) * 12;
    }
    const saved = settings.stock[g.key];
    if (saved) Object.assign(g, saved);
  }
  return [...groups.values()];
}

function layoutGroup(g: StockGroup, s: Settings): LayoutResult {
  return layoutParts(
    g.rows.map((r) => ({ name: r.name, width: r.w, length: r.l, qty: r.qty, canRotate: g.grainless || !s.respectGrain })),
    { width: g.width, length: g.length },
    { kerf: s.kerf, margin: s.margin },
  );
}

// ---------- drawings ----------

const WOOD = '#ead7b0';
const WOOD_RGB: RGB = [0.918, 0.843, 0.69];

/** One piece of stock as SVG, length running left to right. */
function pieceSvg(lay: LayoutResult, i: number, fmt: (n: number) => string, maxWidthPx = 640): string {
  const { width: W, length: L } = lay.stock;
  const scale = Math.min(maxWidthPx / L, 220 / W);
  // Boards are drawn at least 28 px tall so their labels are readable (only across, never along).
  const sy = Math.max(scale, 28 / W);
  const pw = L * scale;
  const ph = W * sy;
  const rects = lay.pieces[i].placements
    .map((p) => {
      const x = p.y * scale;
      const y = p.x * sy;
      const w = p.length * scale;
      const h = p.width * sy;
      const label = `${p.name}`;
      const size = `${fmt(p.length)} × ${fmt(p.width)}`;
      const fs = Math.max(8, Math.min(12, h / 3));
      const showText = w > 40 && h > 14;
      return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${WOOD}" stroke="#7a5a2e" stroke-width="1"/>${
        showText
          ? `<text x="${x + w / 2}" y="${y + h / 2 - (h > 2.4 * fs ? fs * 0.2 : -fs * 0.35)}" font-size="${fs}" text-anchor="middle" fill="#3b2a12">${esc(label)}</text>${
              h > 2.4 * fs ? `<text x="${x + w / 2}" y="${y + h / 2 + fs}" font-size="${fs * 0.85}" text-anchor="middle" fill="#6b5536">${esc(size)}</text>` : ''
            }`
          : ''
      }<title>${esc(label)}: ${esc(size)}${p.rotated ? ' (turned)' : ''}</title></g>`;
    })
    .join('');
  return `<svg class="cut-sheet" viewBox="-1 -1 ${pw + 2} ${ph + 2}" width="${pw + 2}" height="${ph + 2}" role="img" aria-label="Stock piece ${i + 1}">
    <rect x="0" y="0" width="${pw}" height="${ph}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 3"/>${rects}</svg>`;
}

function buildPdf(groups: StockGroup[], layouts: LayoutResult[], rows: Row[], s: Settings, fmt: (n: number) => string, title: string): Uint8Array {
  const pdf = new PdfDoc();
  const M = 36;
  const PW = 792;
  const PH = 612;
  const ink: RGB = [0.1, 0.1, 0.1];
  const muted: RGB = [0.4, 0.4, 0.4];
  const footer = (n: number) => pdf.text(`${title}  ·  Workbench3D cutting plan  ·  page ${n}`, PW / 2, PH - 18, { size: 8, color: muted, align: 'center' });
  let pageNo = 1;

  // Page 1: the cut list and what to buy
  pdf.page(PW, PH);
  pdf.text(`Cut list: ${title}`, M, M + 8, { size: 16, bold: true });
  pdf.text(`Kerf ${fmt(s.kerf)}${s.margin ? `, trim ${fmt(s.margin)} on every edge` : ''}${s.respectGrain ? ', grain along each part\'s length' : ', parts may turn'}`, M, M + 26, {
    size: 9,
    color: muted,
  });
  const cols = [
    { h: 'Qty', w: 34 },
    { h: 'Part', w: 230 },
    { h: 'Material', w: 150 },
    { h: 'T', w: 70 },
    { h: 'W', w: 80 },
    { h: 'L', w: 80 },
    { h: 'Bd ft', w: 60 },
  ];
  let y = M + 50;
  const row = (cells: string[], bold = false) => {
    let x = M;
    cells.forEach((c, i) => {
      let t = c;
      while (t.length > 1 && textWidth(t, 9, bold) > cols[i].w - 6) t = t.slice(0, -2) + '…';
      pdf.text(t, i === 0 || i >= 3 ? x + cols[i].w - 6 : x, y, { size: 9, bold, align: i === 0 || i >= 3 ? 'right' : 'left' });
      x += cols[i].w;
    });
    y += 14;
  };
  row(cols.map((c) => c.h), true);
  pdf.line(M, y - 10, M + cols.reduce((a, c) => a + c.w, 0), y - 10, muted, 0.5);
  for (const r of rows) {
    if (y > PH - 120) {
      footer(pageNo++);
      pdf.page(PW, PH);
      y = M + 10;
    }
    row([String(r.qty), r.name, r.material, fmt(r.t), fmt(r.w), fmt(r.l), ((r.t * r.w * r.l * r.qty) / 144).toFixed(2)]);
  }
  y += 10;
  pdf.text('Stock to buy', M, y, { size: 12, bold: true });
  y += 16;
  groups.forEach((g, i) => {
    const lay = layouts[i];
    const n = lay.pieces.length;
    const avg = n ? lay.pieces.reduce((a, p) => a + p.used, 0) / n : 0;
    const what = g.kind === 'sheet' ? `${n} sheet${n === 1 ? '' : 's'} ${fmt(g.width)} × ${fmt(g.length)}` : `${n} board${n === 1 ? '' : 's'} ${fmt(g.width)} wide × ${fmt(g.length)}`;
    pdf.text(`${g.label}: ${what}  (${Math.round(avg * 100)}% used)`, M, y, { size: 10 });
    y += 14;
    for (const b of lay.tooBig) {
      pdf.text(`  ${b.name} (${fmt(b.length)} × ${fmt(b.width)}) is bigger than the stock`, M, y, { size: 9, color: [0.7, 0.1, 0.1] });
      y += 13;
    }
  });
  footer(pageNo++);

  // Then the diagrams: as many pieces per page as fit, length left to right
  let yy = PH; // start a new page
  groups.forEach((g, gi) => {
    const lay = layouts[gi];
    const { width: W, length: L } = lay.stock;
    const scale = Math.min((PW - 2 * M) / L, g.kind === 'sheet' ? (PH - 2 * M - 60) / W : 1e9);
    const sy = Math.max(scale, 26 / W); // boards at least 26 pt tall so labels fit
    const h = W * sy;
    lay.pieces.forEach((piece, pi) => {
      if (yy + h + 40 > PH - 30) {
        pdf.page(PW, PH);
        footer(pageNo++);
        yy = M;
      }
      const used = Math.round(piece.used * 100);
      pdf.text(`${g.label}: ${g.kind === 'sheet' ? 'sheet' : 'board'} ${pi + 1} of ${lay.pieces.length}  (${used}% used)`, M, yy + 10, { size: 10, bold: true });
      const top = yy + 18;
      pdf.rect(M, top, L * scale, h, { stroke: [0.3, 0.3, 0.3], lineWidth: 0.75 });
      for (const p of piece.placements) {
        const x = M + p.y * scale;
        const y0 = top + p.x * sy;
        const w = p.length * scale;
        const hh = p.width * sy;
        pdf.rect(x, y0, w, hh, { fill: WOOD_RGB, stroke: [0.48, 0.35, 0.18], lineWidth: 0.6 });
        const size = `${fmt(p.length)} x ${fmt(p.width)}`;
        const fs = Math.max(5, Math.min(9, hh / 3));
        if (w > 30 && hh > 9) {
          let name = p.name;
          while (name.length > 1 && textWidth(name, fs, true) > w - 4) name = name.slice(0, -2) + '…';
          pdf.text(name, x + w / 2, y0 + hh / 2 + (hh > 2.6 * fs ? -fs * 0.15 : fs * 0.35), { size: fs, bold: true, align: 'center' });
          if (hh > 2.6 * fs && textWidth(size, fs * 0.9) < w - 4) pdf.text(size, x + w / 2, y0 + hh / 2 + fs, { size: fs * 0.9, align: 'center', color: [0.35, 0.28, 0.18] });
        }
      }
      pdf.text(fmt(L), M + (L * scale) / 2, top + h + 12, { size: 8, color: muted, align: 'center' });
      pdf.text(fmt(W), M + L * scale + 6, top + h / 2 + 3, { size: 8, color: muted });
      yy = top + h + 26;
    });
  });
  void ink;
  return pdf.bytes();
}

// ---------- the dialog ----------

const cutlist: AddOn = {
  id: 'workbench.cutlist',
  name: 'Cut List',
  version: '2.0.0',
  description: 'Lists every part with its thickness × width × length, lays the parts out on sheets and boards (with saw kerf and grain), and exports a printable cutting plan (PDF) and CSV.',
  activate(api) {
    const load = (): Settings => {
      try {
        return { ...DEFAULTS, ...JSON.parse(api.storage.get('settings') ?? '{}') };
      } catch {
        return { ...DEFAULTS };
      }
    };
    const save = (s: Settings) => api.storage.set('settings', JSON.stringify(s));

    const run = async () => {
      const rows = collectRows(api);
      if (!rows.length) {
        api.ui.dialog('Cut list', '<p>No parts yet. Each part needs to be its own group: select it and press Make Group.</p>');
        return;
      }
      const f = api.units.format;
      const settings = load();
      let groups = stockGroups(rows, settings, f);
      let layouts = groups.map((g) => layoutGroup(g, settings));

      const bf = (r: Row) => (r.t * r.w * r.l * r.qty) / 144;
      const totalBF = rows.reduce((s, r) => s + bf(r), 0);

      // a form, so Return in a field applies it instead of pressing the dialog's default button
      const root = document.createElement('form');
      root.className = 'cutlist-view';
      root.addEventListener('submit', (e) => e.preventDefault());
      root.innerHTML = `
        <div class="segmented" role="tablist">
          <button role="tab" data-tab="parts" aria-selected="true">Parts</button>
          <button role="tab" data-tab="layout" aria-selected="false">Layout</button>
        </div>
        <section data-panel="parts">
          <table class="cutlist">
            <thead><tr><th>Qty</th><th>Part</th><th>Material</th><th>T</th><th>W</th><th>L</th><th>Bd ft</th></tr></thead>
            <tbody>${rows
              .map((r) => `<tr><td>${r.qty}</td><td>${esc(r.name)}</td><td>${esc(r.material)}</td><td>${f(r.t)}</td><td>${f(r.w)}</td><td>${f(r.l)}</td><td>${bf(r).toFixed(2)}</td></tr>`)
              .join('')}</tbody>
            <tfoot><tr><td colspan="6">Total board feet (all parts)</td><td>${totalBF.toFixed(2)}</td></tr></tfoot>
          </table>
          <p class="muted">Sizes are each part's own bounding box: thickness, then width, then length (the grain runs along the length).</p>
        </section>
        <section data-panel="layout" hidden>
          <div class="cut-settings">
            <label>Saw kerf <input name="kerf" type="text" value="${esc(f(settings.kerf))}" size="6"></label>
            <label>Trim each edge <input name="margin" type="text" value="${esc(f(settings.margin))}" size="6"></label>
            <label class="check"><input name="grain" type="checkbox" ${settings.respectGrain ? 'checked' : ''}> Keep grain along each part's length</label>
          </div>
          <div class="cut-groups"></div>
        </section>`;

      const groupsEl = root.querySelector<HTMLElement>('.cut-groups')!;
      const render = () => {
        groupsEl.innerHTML = groups
          .map((g, i) => {
            const lay = layouts[i];
            const n = lay.pieces.length;
            const avg = n ? Math.round((lay.pieces.reduce((a, p) => a + p.used, 0) / n) * 100) : 0;
            return `<div class="cut-group" data-key="${esc(g.key)}">
              <div class="cut-group-head">
                <strong>${esc(g.label)}</strong>
                <select name="kind" aria-label="Stock type for ${esc(g.label)}">
                  <option value="sheet" ${g.kind === 'sheet' ? 'selected' : ''}>Sheets</option>
                  <option value="board" ${g.kind === 'board' ? 'selected' : ''}>Boards</option>
                </select>
                <label>${g.kind === 'sheet' ? 'Sheet' : 'Board'} <input name="width" type="text" size="6" value="${esc(f(g.width))}" aria-label="Stock width"></label>
                × <input name="length" type="text" size="6" value="${esc(f(g.length))}" aria-label="Stock length">
                <span class="muted">${n} ${g.kind === 'sheet' ? (n === 1 ? 'sheet' : 'sheets') : n === 1 ? 'board' : 'boards'}, ${avg}% used</span>
              </div>
              ${lay.tooBig.map((b) => `<p class="error">${esc(b.name)} (${f(b.length)} × ${f(b.width)}) doesn't fit on this stock.</p>`).join('')}
              ${lay.pieces.map((_, pi) => pieceSvg(lay, pi, f)).join('')}
            </div>`;
          })
          .join('');
      };
      const recompute = () => {
        groups = stockGroups(rows, settings, f);
        layouts = groups.map((g) => layoutGroup(g, settings));
        render();
      };
      render();

      root.querySelectorAll<HTMLButtonElement>('[role=tab]').forEach((b) =>
        b.addEventListener('click', () => {
          root.querySelectorAll<HTMLButtonElement>('[role=tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
          root.querySelectorAll<HTMLElement>('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== b.dataset.tab));
        }),
      );
      root.addEventListener('change', (e) => {
        const t = e.target as HTMLInputElement | HTMLSelectElement;
        const len = (v: string, fallback: number) => {
          const n = api.units.parse(v);
          return n !== null && n >= 0 ? n : fallback;
        };
        if (t.name === 'kerf') settings.kerf = len(t.value, settings.kerf);
        else if (t.name === 'margin') settings.margin = len(t.value, settings.margin);
        else if (t.name === 'grain') settings.respectGrain = (t as HTMLInputElement).checked;
        else {
          const key = t.closest<HTMLElement>('.cut-group')?.dataset.key;
          const g = groups.find((x) => x.key === key);
          if (!g) return;
          const cur = { kind: g.kind, width: g.width, length: g.length };
          if (t.name === 'kind') {
            cur.kind = t.value as 'sheet' | 'board';
            if (cur.kind === 'sheet') Object.assign(cur, { width: 48, length: 96 });
            else Object.assign(cur, { width: boardWidthFor(Math.max(...g.rows.map((r) => r.w))), length: 96 });
          }
          if (t.name === 'width') cur.width = Math.max(0.25, len(t.value, g.width));
          if (t.name === 'length') cur.length = Math.max(0.25, len(t.value, g.length));
          settings.stock[g.key] = cur;
        }
        save(settings);
        recompute();
      });

      for (;;) {
        const choice = await api.ui.dialog('Cut list', root, ['Close', 'Download CSV', 'Download PDF'], { wide: true });
        if (choice === 'Download CSV') {
          const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
          const csv = ['Qty,Part,Material,Thickness,Width,Length,Thickness (in),Width (in),Length (in)']
            .concat(rows.map((r) => [r.qty, q(r.name), q(r.material), q(f(r.t)), q(f(r.w)), q(f(r.l)), r.t.toFixed(4), r.w.toFixed(4), r.l.toFixed(4)].join(',')))
            .join('\n');
          api.ui.download('cut-list.csv', csv);
        } else if (choice === 'Download PDF') {
          const title = api.modelName();
          const bytes = buildPdf(groups, layouts, rows, settings, f, title);
          api.ui.download('cutting-plan.pdf', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
        } else break;
      }
    };
    api.registerCommand({ id: 'cutlist.show', label: 'Cut List…', run });
    api.registerTool({
      id: 'cutlist',
      name: 'Cut List',
      icon: api.icons.list,
      activate: (app) => {
        run();
        app.setTool('select');
      },
    });
  },
};

export default cutlist;
