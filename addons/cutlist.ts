import type { AddOn } from '../src/plugins/api';
import type { Group } from '../src/core/document';

interface Row {
  name: string;
  material: string;
  t: number;
  w: number;
  l: number;
  qty: number;
}

/** Every group that holds geometry of its own counts as a part. */
function parts(root: Group): Group[] {
  const out: Group[] = [];
  for (const g of root.walk()) if (g !== root && g.mesh.faces.size > 0 && !g.hidden) out.push(g);
  return out;
}

const cutlist: AddOn = {
  id: 'workbench.cutlist',
  name: 'Cut List',
  version: '1.0.0',
  description: 'Lists every part (group) with its thickness × width × length, groups identical parts, and exports CSV.',
  activate(api) {
    const run = async () => {
      const rows: Row[] = [];
      const key = (n: number) => Math.round(n * 64);
      for (const g of parts(api.doc.root)) {
        const s = g.mesh.bounds().getSize(new api.THREE.Vector3());
        const [t, w, l] = [s.x, s.y, s.z].sort((a, b) => a - b);
        const material = String(g.attributes.material ?? '');
        const existing = rows.find((r) => r.name === g.name && r.material === material && key(r.t) === key(t) && key(r.w) === key(w) && key(r.l) === key(l));
        if (existing) existing.qty++;
        else rows.push({ name: g.name, material, t, w, l, qty: 1 });
      }
      if (!rows.length) {
        api.ui.dialog('Cut list', '<p>No parts yet. Each part needs to be its own group: select it and press Make Group.</p>');
        return;
      }
      rows.sort((a, b) => a.material.localeCompare(b.material) || b.t - a.t || b.l - a.l);
      const f = api.units.format;
      const bf = (r: Row) => (r.t * r.w * r.l * r.qty) / 144;
      const totalBF = rows.reduce((s, r) => s + bf(r), 0);
      const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
      const html = `
        <table class="cutlist">
          <thead><tr><th>Qty</th><th>Part</th><th>Material</th><th>T</th><th>W</th><th>L</th><th>Bd ft</th></tr></thead>
          <tbody>${rows
            .map((r) => `<tr><td>${r.qty}</td><td>${esc(r.name)}</td><td>${esc(r.material)}</td><td>${f(r.t)}</td><td>${f(r.w)}</td><td>${f(r.l)}</td><td>${bf(r).toFixed(2)}</td></tr>`)
            .join('')}</tbody>
          <tfoot><tr><td colspan="6">Total board feet (all parts)</td><td>${totalBF.toFixed(2)}</td></tr></tfoot>
        </table>
        <p class="muted">Sizes are each part's own bounding box, smallest first. Make every part a separate group for an accurate list.</p>`;
      const choice = await api.ui.dialog('Cut list', html, ['Close', 'Download CSV']);
      if (choice === 'Download CSV') {
        const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
        const csv = ['Qty,Part,Material,Thickness,Width,Length,Thickness (in),Width (in),Length (in)']
          .concat(rows.map((r) => [r.qty, q(r.name), q(r.material), q(f(r.t)), q(f(r.w)), q(f(r.l)), r.t.toFixed(4), r.w.toFixed(4), r.l.toFixed(4)].join(',')))
          .join('\n');
        api.ui.download('cut-list.csv', csv);
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
