import type { AddOn, WorkbenchAPI } from '../src/plugins/api';

/** Nominal lumber sizes and their actual dressed dimensions (inches). */
const DIMENSIONAL: Record<string, [number, number]> = {
  '1x2': [0.75, 1.5],
  '1x3': [0.75, 2.5],
  '1x4': [0.75, 3.5],
  '1x6': [0.75, 5.5],
  '1x8': [0.75, 7.25],
  '1x10': [0.75, 9.25],
  '1x12': [0.75, 11.25],
  '2x2': [1.5, 1.5],
  '2x3': [1.5, 2.5],
  '2x4': [1.5, 3.5],
  '2x6': [1.5, 5.5],
  '2x8': [1.5, 7.25],
  '2x10': [1.5, 9.25],
  '2x12': [1.5, 11.25],
  '4x4': [3.5, 3.5],
  '6x6': [5.5, 5.5],
};

const SHEETS: Record<string, { t: number; label: string }> = {
  'ply-3/4': { t: 23 / 32, label: '3/4" plywood (23/32" actual)' },
  'ply-1/2': { t: 15 / 32, label: '1/2" plywood (15/32" actual)' },
  'ply-1/4': { t: 7 / 32, label: '1/4" plywood (7/32" actual)' },
  'mdf-3/4': { t: 0.75, label: '3/4" MDF' },
  'mdf-1/2': { t: 0.5, label: '1/2" MDF' },
};

const SPECIES: Record<string, string> = {
  Pine: '#e3c58f',
  'Douglas fir': '#d8b27a',
  Oak: '#c8a26b',
  Maple: '#ecd9b0',
  Cherry: '#b5653f',
  Walnut: '#6b4a32',
  Plywood: '#d9bd8c',
  MDF: '#b89b77',
};

/** Put new parts beside the existing model instead of on top of it. */
export function freeSpot(api: WorkbenchAPI): [number, number, number] {
  const b = api.doc.bounds();
  return b.isEmpty() ? [0, 0, 0] : [b.max.x + 6, b.min.y, 0];
}

const lumber: AddOn = {
  id: 'workbench.lumber',
  name: 'Lumber',
  version: '1.0.0',
  description: 'Insert boards and sheet goods at their real (dressed) sizes, e.g. a 2x4 is 1 1/2" × 3 1/2".',
  activate(api) {
    const insert = async () => {
      const v = await api.ui.form(
        'Insert lumber',
        [
          {
            name: 'stock',
            label: 'Stock',
            type: 'select',
            value: '2x4',
            options: [
              ...Object.keys(DIMENSIONAL).map((k) => ({ value: k, label: `${k}  (${api.units.format(DIMENSIONAL[k][0])} × ${api.units.format(DIMENSIONAL[k][1])})` })),
              ...Object.entries(SHEETS).map(([k, s]) => ({ value: k, label: s.label })),
              { value: 'custom', label: 'Custom size…' },
            ],
          },
          { name: 'length', label: 'Length', type: 'length', value: 96, min: 0.01 },
          { name: 'width', label: 'Width (sheets / custom)', type: 'length', value: 48, min: 0.01 },
          { name: 'thickness', label: 'Thickness (custom)', type: 'length', value: 0.75, min: 0.01 },
          {
            name: 'orient',
            label: 'Orientation',
            type: 'select',
            value: 'x',
            options: [
              { value: 'x', label: 'Lying flat along red' },
              { value: 'y', label: 'Lying flat along green' },
              { value: 'edge', label: 'On edge along red' },
              { value: 'z', label: 'Standing up (blue)' },
            ],
          },
          { name: 'species', label: 'Material', type: 'select', value: 'Pine', options: Object.keys(SPECIES).map((s) => ({ value: s, label: s })) },
          { name: 'qty', label: 'Quantity', type: 'number', value: 1, help: 'Copies are spaced out along green.' },
        ],
        'Insert',
      );
      if (!v) return;
      const stock = String(v.stock);
      let t: number;
      let w: number;
      let label: string;
      if (DIMENSIONAL[stock]) {
        [t, w] = DIMENSIONAL[stock];
        label = stock;
      } else if (SHEETS[stock]) {
        t = SHEETS[stock].t;
        w = v.width as number;
        label = SHEETS[stock].label.split(' (')[0];
      } else {
        t = v.thickness as number;
        w = v.width as number;
        label = `${api.units.format(t)} × ${api.units.format(w)}`;
      }
      const L = v.length as number;
      const species = String(v.species);
      const qty = Math.max(1, Math.min(200, Math.round(v.qty as number)));
      const [ox, oy, oz] = freeSpot(api);
      const size = (() => {
        switch (v.orient) {
          case 'y':
            return { width: w, depth: L, height: t };
          case 'edge':
            return { width: L, depth: t, height: w };
          case 'z':
            return { width: w, depth: t, height: L };
          default:
            return { width: L, depth: w, height: t };
        }
      })();
      const ids: number[] = [];
      api.transact('Insert Lumber', () => {
        for (let i = 0; i < qty; i++) {
          const g = api.createBox({
            ...size,
            origin: [ox, oy + i * (size.depth + 2), oz],
            name: `${label} × ${api.units.format(L)}`,
            color: SPECIES[species],
            attributes: { material: species, stock: label },
          });
          ids.push(g.id);
        }
      });
      api.setSelection({ groups: ids });
      api.setTool('move');
    };

    api.registerCommand({ id: 'lumber.insert', label: 'Insert Lumber…', run: insert });
    api.registerTool({
      id: 'lumber',
      name: 'Insert Lumber',
      icon: api.icons.board,
      hint: 'Pick a board size in the dialog.',
      activate: (app) => {
        insert();
        app.setTool('select');
      },
    });
  },
};

export default lumber;
