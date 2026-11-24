import { describe, expect, it } from 'vitest';
import { exportCutListCsv } from '../src/core/cutlistCsv';
import { estimateStockCost } from '../src/core/materialCost';
import { formatLength, parseLength } from '../src/core/units';
import { layoutParts } from '../src/core/cutlayout';
import { WorkbenchDocument } from '../src/core/document';
import { insertCabinetDemo } from '../src/core/sampleCabinet';
import { exportShopDrawing } from '../src/core/shopDrawing';

describe('WB-019 cut list and shop exports', () => {
  it('preserves exact 1/8 and 3/16 inch dimensions in cut-list CSV', () => {
    const rows = [{ qty: 2, name: 'Shelf, "short"', material: 'Plywood', t: 0.1875, w: 0.125, l: 24 }];
    const estimate = estimateStockCost([{ key: 'a', label: 'Plywood', count: 1, unitPrice: 40, unplaced: 0 }]);
    const csv = exportCutListCsv(rows, estimate, (n) => formatLength(n));
    expect(csv).toContain('"Shelf, ""short"""');
    expect(csv).toContain('"3/16"');
    expect(csv).toContain('"1/8"');
    expect(csv).toContain('0.1875,0.1250,24.0000');
    expect(csv).toContain('Estimated material total USD,40.00');
    const values = csv.split('\n')[1].match(/0\.1875,0\.1250,24\.0000$/);
    expect(values).not.toBeNull();
    expect(parseLength('3/16')).toBe(0.1875);
    expect(parseLength('1/8')).toBe(0.125);
  });

  it('exports unchanged physical inch columns when display switches to millimetres', () => {
    const estimate = estimateStockCost([{ key: 'a', label: 'A', count: 1, unitPrice: null, unplaced: 0 }]);
    const csv = exportCutListCsv(
      [{ qty: 1, name: 'Part', material: 'MDF', t: 0.125, w: 0.1875, l: 12 }],
      estimate,
      (n) => formatLength(n, { system: 'metric', fraction: 16, mmDecimals: 4 }),
    );
    expect(csv).toContain('"3.175 mm"');
    expect(csv).toContain('"4.7625 mm"');
    expect(csv).toContain('0.1250,0.1875,12.0000');
    expect(csv).toContain('Estimated material total USD,INCOMPLETE');
  });

  it('keeps fractional cutting dimensions and PDF envelope based on the model, not the displayed rounding', () => {
    const cut = layoutParts([{ name: 'Test', width: 0.1875, length: 12.125, qty: 2, canRotate: false }],
      { width: 1, length: 30 }, { kerf: 0.125, margin: 0 });
    expect(cut.tooBig).toHaveLength(0);
    expect(cut.pieces.flatMap((p) => p.placements).map((p) => p.length)).toEqual([12.125, 12.125]);
    const doc = new WorkbenchDocument();
    doc.transact('Demo', () => insertCabinetDemo(doc));
    const pdf = new TextDecoder('latin1').decode(exportShopDrawing(doc.root));
    expect(pdf).toContain('(24.000 in)');
    expect(pdf).toContain('(30.000 in)');
  });
});
