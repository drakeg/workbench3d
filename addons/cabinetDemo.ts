import type { AddOn } from '../src/plugins/api';
import { insertCabinetDemo } from '../src/core/sampleCabinet';

const cabinetDemo: AddOn = {
  id: 'workbench.cabinet-demo',
  name: 'Sample Cabinet',
  version: '1.0.0',
  description: 'Insert a 24 × 24 × 30 in six-panel plywood demo for the cut-list workflow.',
  activate(api) {
    api.registerCommand({
      id: 'cabinet-demo.insert',
      label: 'Insert Sample Cabinet…',
      run: () => {
        const bounds = api.doc.bounds();
        const origin: [number, number, number] = bounds.isEmpty() ? [0, 0, 0] : [bounds.max.x + 6, bounds.min.y, 0];
        const cabinet = api.transact('Insert Sample Cabinet', () => insertCabinetDemo(api.doc, api.context(), origin));
        api.setSelection({ groups: [cabinet.id] });
        api.ui.toast('Sample cabinet inserted. Open Add-ons → Cut List to view panel dimensions and cutting layouts.');
      },
    });
  },
};
export default cabinetDemo;
