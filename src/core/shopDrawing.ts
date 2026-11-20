import { Box3, Vector3 } from 'three';
import { Group } from './document';
import { PdfDoc, type RGB } from './pdf';

type Axis = 'x' | 'y' | 'z';
export interface DrawingEdge { start: Vector3; end: Vector3 }
export interface ShopDrawingData {
  edges: DrawingEdge[];
  bounds: Box3;
  /** Denominator of the actual print ratio, e.g. 8 means 1:8 when printed at 100%. */
  scale: number;
}

const INK: RGB = [0.12, 0.17, 0.24];
const MUTED: RGB = [0.38, 0.43, 0.5];
const PANEL = { width: 220, height: 348 };
const VIEW_MAX_W = 180;
const VIEW_MAX_H = 270;
const PRINT_SCALES = [1, 2, 4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256];
const axes: { name: string; horizontal: Axis; vertical: Axis }[] = [
  { name: 'Top — XY', horizontal: 'x', vertical: 'y' },
  { name: 'Front — XZ', horizontal: 'x', vertical: 'z' },
  { name: 'Right — YZ', horizontal: 'y', vertical: 'z' },
];

/** Visible world-space edges, including loose geometry. Does not flatten or change the model. */
export function collectShopDrawing(root: Group, isTagVisible: (tag: string) => boolean = () => true): ShopDrawingData {
  const edges: DrawingEdge[] = [];
  const bounds = new Box3().makeEmpty();
  const visit = (g: Group): void => {
    if (g.hidden || (g.tag && !isTagVisible(g.tag))) return;
    const matrix = g.worldMatrix();
    for (const [, [a, b]] of g.mesh.allEdges()) {
      const start = g.mesh.v(a).clone().applyMatrix4(matrix);
      const end = g.mesh.v(b).clone().applyMatrix4(matrix);
      if (![...start.toArray(), ...end.toArray()].every(Number.isFinite)) throw new Error('Cannot draw a model with non-finite coordinates');
      if (start.distanceToSquared(end) < 1e-12) continue;
      edges.push({ start, end });
      if (edges.length > 100_000) throw new Error('Too many edges for a printable drawing');
      bounds.expandByPoint(start);
      bounds.expandByPoint(end);
    }
    for (const child of g.children) visit(child);
  };
  visit(root);
  if (edges.length === 0 || bounds.isEmpty()) throw new Error('Model has no visible edges to draw');
  const dims = bounds.getSize(new Vector3());
  const limit = Math.max(
    dims.x * 72 / VIEW_MAX_W,
    dims.y * 72 / VIEW_MAX_W,
    dims.y * 72 / VIEW_MAX_H,
    dims.z * 72 / VIEW_MAX_H,
  );
  const scale = PRINT_SCALES.find((n) => n >= limit) ?? Math.ceil(limit);
  return { edges, bounds, scale };
}

/**
 * Letter landscape PDF with three aligned, dimensioned orthographic wireframe views.
 * All three views use the same fixed paper scale, in the model's internal inches.
 * Not a hidden-line drawing or a manufacturing sign-off document.
 */
export function exportShopDrawing(root: Group, title = 'Workbench3D model', isTagVisible: (tag: string) => boolean = () => true): Uint8Array {
  const { edges, bounds, scale } = collectShopDrawing(root, isTagVisible);
  const pdf = new PdfDoc().page();
  const pt = 72 / scale;
  const size = bounds.getSize(new Vector3());
  pdf.text('Workbench3D — orthographic shop views', 40, 45, { size: 18, bold: true });
  pdf.text(title, 40, 65, { size: 11 });
  pdf.text(`Scale 1:${scale} (print at 100%, no fit-to-page) | Dimensions in inches`, 40, 82, { size: 9, color: MUTED });

  for (let i = 0; i < axes.length; i++) {
    const view = axes[i];
    const left = 40 + i * 237;
    const top = 105;
    pdf.rect(left, top, PANEL.width, PANEL.height, { stroke: [0.75, 0.78, 0.83], lineWidth: 0.5 });
    pdf.text(view.name, left + 9, top + 20, { size: 12, bold: true, color: INK });

    const originX = left + 18;
    const originY = top + 45;
    const minH = bounds.min[view.horizontal];
    const maxV = bounds.max[view.vertical];
    const width = size[view.horizontal];
    const height = size[view.vertical];
    const projected = (point: Vector3): [number, number] => [
      originX + (point[view.horizontal] - minH) * pt,
      originY + (maxV - point[view.vertical]) * pt,
    ];
    for (const edge of edges) {
      const [x1, y1] = projected(edge.start);
      const [x2, y2] = projected(edge.end);
      if (Math.hypot(x2 - x1, y2 - y1) > 0.05) pdf.line(x1, y1, x2, y2, INK, 0.45);
    }

    const right = originX + width * pt;
    const bottom = originY + height * pt;
    // Dimension extension lines and labels use the exact model bounding extents.
    pdf.line(originX, bottom + 12, originX, bottom + 27, MUTED, 0.45);
    pdf.line(right, bottom + 12, right, bottom + 27, MUTED, 0.45);
    pdf.line(originX, bottom + 20, right, bottom + 20, MUTED, 0.45);
    pdf.text(`${width.toFixed(3)} in`, (originX + right) / 2, bottom + 34, { size: 8, align: 'center', color: INK });

    pdf.line(right + 10, originY, right + 23, originY, MUTED, 0.45);
    pdf.line(right + 10, bottom, right + 23, bottom, MUTED, 0.45);
    pdf.line(right + 17, originY, right + 17, bottom, MUTED, 0.45);
    pdf.text(`${height.toFixed(3)} in`, right + 22, (originY + bottom) / 2, { size: 8, rotate: 90, align: 'center', color: INK });
  }
  pdf.text(`Overall envelope: ${size.x.toFixed(3)} W × ${size.y.toFixed(3)} D × ${size.z.toFixed(3)} H in`, 40, 490, { size: 11, bold: true });
  pdf.text('Wireframe projections. Overlapping/hidden edges may show. Verify dimensions and joinery before fabrication.', 40, 515, { size: 9, color: MUTED });
  pdf.text('This drawing represents visible model geometry only; no allowances for fasteners, saw kerf or tolerances.', 40, 533, { size: 9, color: MUTED });
  return pdf.bytes();
}
