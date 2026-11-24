import type { CostEstimate } from './materialCost';

/** Dimensions are internal inches. Display labels use the active document units. */
export interface CutListCsvRow {
  qty: number;
  name: string;
  material: string;
  t: number;
  w: number;
  l: number;
}

const quote = (value: string): string => '"' + value.replace(/"/g, '""') + '"';

/**
 * Export editable cut-list data. The explicit inch columns use four decimal places
 * independently of the display preference so fractional measurements remain exact.
 */
export function exportCutListCsv(rows: readonly CutListCsvRow[], estimate: CostEstimate, formatLength: (inches: number) => string): string {
  return ['Qty,Part,Material,Thickness,Width,Length,Thickness (in),Width (in),Length (in)']
    .concat(rows.map((r) => [
      r.qty, quote(r.name), quote(r.material),
      quote(formatLength(r.t)), quote(formatLength(r.w)), quote(formatLength(r.l)),
      r.t.toFixed(4), r.w.toFixed(4), r.l.toFixed(4),
    ].join(',')))
    .concat(['', 'Stock,Stock units,USD per stock unit,Extended USD,Unplaced parts'])
    .concat(estimate.lines.map((line) => [
      quote(line.label), line.count, line.unitPrice ?? '', line.extended ?? '', line.unplaced,
    ].join(',')))
    .concat([
      `Quoted subtotal USD,${estimate.quotedSubtotal.toFixed(2)}`,
      `Estimated material total USD,${estimate.grandTotal === null ? 'INCOMPLETE' : estimate.grandTotal.toFixed(2)}`,
    ])
    .join('\n');
}
