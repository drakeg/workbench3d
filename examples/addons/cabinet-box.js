// Example Workbench3D add-on: a simple cabinet / shelf unit builder.
// Load it with Add-ons → Add-on Manager → Load add-on file…
// It's a plain ES module, no build step needed. See docs/ADDONS.md.

export default {
  id: 'example.cabinet-box',
  name: 'Cabinet Box',
  version: '1.0.0',
  description: 'Builds a carcass (sides, top, bottom, shelves and back) from overall dimensions. Each panel is its own part for the cut list.',

  activate(api) {
    async function build() {
      const v = await api.ui.form(
        'Cabinet box',
        [
          { name: 'width', label: 'Overall width', type: 'length', value: 30 },
          { name: 'depth', label: 'Overall depth', type: 'length', value: 12 },
          { name: 'height', label: 'Overall height', type: 'length', value: 36 },
          { name: 't', label: 'Panel thickness', type: 'length', value: 0.75 },
          { name: 'back', label: 'Back thickness (0 = none)', type: 'length', value: 0.25, min: 0 },
          { name: 'shelves', label: 'Fixed shelves', type: 'number', value: 2 },
        ],
        'Build',
      );
      if (!v) return;
      const { width: W, depth: D, height: H, t, back } = v;
      const shelves = Math.max(0, Math.round(v.shelves));
      if (2 * t >= W || 2 * t >= H || back >= D) return api.ui.toast('Those panels are too thick for that size.', 'error');

      const b = api.doc.bounds();
      const x0 = b.isEmpty() ? 0 : b.max.x + 6;
      const color = '#d9bd8c';
      const material = 'Plywood';
      const inner = W - 2 * t;
      const ids = [];

      api.transact('Cabinet Box', () => {
        // The cabinet is a group of parts, so it moves as one but every panel still lists separately.
        const cab = api.doc.newGroup('Cabinet');
        api.context().add(cab);
        cab.matrix.makeTranslation(x0, 0, 0);
        const part = (name, w, d, h, x, y, z) =>
          api.createBox({ width: w, depth: d, height: h, origin: [x, y, z], name, color, parent: cab, attributes: { material } });

        part('Side', t, D, H, 0, 0, 0);
        part('Side', t, D, H, W - t, 0, 0);
        part('Bottom', inner, D - back, t, t, 0, 0);
        part('Top', inner, D - back, t, t, 0, H - t);
        const gap = (H - 2 * t - shelves * t) / (shelves + 1);
        for (let i = 1; i <= shelves; i++) part('Shelf', inner, D - back, t, t, 0, t + i * gap + (i - 1) * t);
        // front faces -green (toward the default camera); the back sits at the rear
        if (back > 0) part('Back', inner, back, H, t, D - back, 0);
        ids.push(cab.id);
      });
      api.setSelection({ groups: ids });
      api.ui.toast('Cabinet built. Double-click it to edit individual panels; run Cut List for the parts.');
    }

    api.registerCommand({ id: 'example.cabinet-box.build', label: 'Cabinet Box…', run: build });
  },
};
