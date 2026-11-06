import type { AddOn } from '../src/plugins/api';
import { freeSpot } from './lumber';

type P = [number, number];

/** Common wall thicknesses by gauge (inches), for tube and sheet. */
const GAUGES: Record<string, number> = {
  '16 ga (0.065")': 0.065,
  '14 ga (0.083")': 0.083,
  '11 ga (0.120")': 0.12,
  '3/16"': 0.1875,
  '1/4"': 0.25,
};

function circle(r: number, n = 32): P[] {
  return Array.from({ length: n }, (_, i) => [r * Math.cos((i / n) * Math.PI * 2), r * Math.sin((i / n) * Math.PI * 2)] as P);
}

function rect(x0: number, y0: number, x1: number, y1: number): P[] {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

const steel: AddOn = {
  id: 'workbench.steel',
  name: 'Steel Profiles',
  version: '1.0.0',
  description: 'Insert square/rectangular/round tube, angle, channel and flat bar for welding and fabrication projects.',
  activate(api) {
    const insert = async () => {
      const v = await api.ui.form(
        'Insert steel',
        [
          {
            name: 'profile',
            label: 'Profile',
            type: 'select',
            value: 'square',
            options: [
              { value: 'square', label: 'Square tube' },
              { value: 'rect', label: 'Rectangular tube' },
              { value: 'round', label: 'Round tube / pipe' },
              { value: 'angle', label: 'Angle' },
              { value: 'channel', label: 'Channel' },
              { value: 'flat', label: 'Flat bar' },
              { value: 'rod', label: 'Round bar' },
            ],
          },
          { name: 'a', label: 'Width / outside diameter', type: 'length', value: 1.5, min: 0.01 },
          { name: 'b', label: 'Height (rect tube, angle, channel)', type: 'length', value: 1.5, min: 0.01 },
          {
            name: 'wall',
            label: 'Wall / thickness',
            type: 'select',
            value: '14 ga (0.083")',
            options: [...Object.keys(GAUGES).map((g) => ({ value: g, label: g })), { value: 'custom', label: 'Custom (below)' }],
          },
          { name: 'customWall', label: 'Custom thickness', type: 'length', value: 0.125, min: 0.001 },
          { name: 'length', label: 'Length', type: 'length', value: 48, min: 0.01 },
          {
            name: 'axis',
            label: 'Runs along',
            type: 'select',
            value: 'x',
            options: [
              { value: 'x', label: 'Red axis' },
              { value: 'y', label: 'Green axis' },
              { value: 'z', label: 'Blue axis (vertical)' },
            ],
          },
        ],
        'Insert',
      );
      if (!v) return;
      const a = v.a as number;
      const b = v.profile === 'square' ? a : (v.b as number);
      const t = v.wall === 'custom' ? (v.customWall as number) : GAUGES[String(v.wall)];
      if (['square', 'rect', 'round', 'channel'].includes(String(v.profile)) && 2 * t >= Math.min(a, b)) {
        api.ui.toast('The wall is too thick for that size.', 'error');
        return;
      }
      let profile: P[];
      let holes: P[][] = [];
      let name: string;
      const f = api.units.format;
      switch (v.profile) {
        case 'round':
          profile = circle(a / 2);
          holes = [circle(a / 2 - t)];
          name = `Round tube ${f(a)} OD`;
          break;
        case 'rod':
          profile = circle(a / 2);
          name = `Round bar ${f(a)}`;
          break;
        case 'angle':
          profile = [
            [0, 0],
            [a, 0],
            [a, t],
            [t, t],
            [t, b],
            [0, b],
          ];
          name = `Angle ${f(a)} × ${f(b)}`;
          break;
        case 'channel':
          profile = [
            [0, 0],
            [a, 0],
            [a, b],
            [a - t, b],
            [a - t, t],
            [t, t],
            [t, b],
            [0, b],
          ];
          name = `Channel ${f(a)} × ${f(b)}`;
          break;
        case 'flat':
          profile = rect(0, 0, a, t);
          name = `Flat bar ${f(a)} × ${f(t)}`;
          break;
        default:
          profile = rect(0, 0, a, b);
          holes = [rect(t, t, a - t, b - t)];
          name = `${v.profile === 'square' ? 'Square' : 'Rect'} tube ${f(a)} × ${f(b)}`;
      }
      const L = v.length as number;
      const [ox, oy, oz] = freeSpot(api);
      const lift = v.profile === 'round' || v.profile === 'rod' ? a / 2 : 0;
      const g = api.transact('Insert Steel', () =>
        api.createExtrusion({
          profile,
          holes,
          length: L,
          axis: v.axis as 'x' | 'y' | 'z',
          origin: [ox + (v.axis === 'x' ? 0 : lift), oy + (v.axis === 'y' ? 0 : lift), oz + (v.axis === 'z' ? 0 : lift)],
          name: `${name} × ${f(L)}`,
          color: '#8c949c',
          attributes: { material: 'Steel', wall: f(t) },
        }),
      );
      api.setSelection({ groups: [g.id] });
      api.setTool('move');
    };
    api.registerCommand({ id: 'steel.insert', label: 'Insert Steel…', run: insert });
    api.registerTool({
      id: 'steel',
      name: 'Insert Steel',
      icon: api.icons.steel,
      activate: (app) => {
        insert();
        app.setTool('select');
      },
    });
  },
};

export default steel;
