import { Color } from 'three';
import { Group } from './document';

const METERS_PER_INCH = 0.0254;
type JsonObject = Record<string, unknown>;
type GltfFile = {
  asset: { version: string; generator: string };
  scene: number;
  scenes: { nodes: number[] }[];
  nodes: JsonObject[];
  meshes: { primitives: JsonObject[] }[];
  materials: JsonObject[];
  buffers: { byteLength: number; uri?: string }[];
  bufferViews: JsonObject[];
  accessors: JsonObject[];
};

function buildModel(root: Group): { model: GltfFile; bin: Uint8Array } {
  const model: GltfFile = {
    asset: { version: '2.0', generator: 'Workbench3D' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Workbench3D — Z-up to glTF Y-up', rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2], children: [1] }],
    meshes: [],
    materials: [],
    buffers: [{ byteLength: 0 }],
    bufferViews: [],
    accessors: [],
  };
  const chunks: Uint8Array[] = [];
  let size = 0;
  const materialIds = new Map<string, number>();
  const append = (bytes: Uint8Array, target: number): number => {
    const pad = (4 - (size % 4)) % 4;
    if (pad) {
      chunks.push(new Uint8Array(pad));
      size += pad;
    }
    const idx = model.bufferViews.length;
    model.bufferViews.push({ buffer: 0, byteOffset: size, byteLength: bytes.byteLength, target });
    chunks.push(bytes);
    size += bytes.byteLength;
    return idx;
  };
  const accessor = (view: number, count: number, type: string, componentType: number, bounds?: { min: number[]; max: number[] }): number => {
    const index = model.accessors.length;
    model.accessors.push({ bufferView: view, componentType, count, type, ...(bounds ?? {}) });
    return index;
  };
  const bytesOf = (input: Float32Array | Uint32Array): Uint8Array => new Uint8Array(input.buffer, input.byteOffset, input.byteLength).slice();
  const material = (color: string): number => {
    if (materialIds.has(color)) return materialIds.get(color)!;
    const c = new Color(color);
    const id = model.materials.length;
    model.materials.push({ name: color, pbrMetallicRoughness: { baseColorFactor: [c.r, c.g, c.b, 1], metallicFactor: 0, roughnessFactor: 0.8 }, doubleSided: true });
    materialIds.set(color, id);
    return id;
  };

  const addGroup = (group: Group): number => {
    const index = model.nodes.length;
    const matrix = group.matrix.toArray();
    matrix[12] *= METERS_PER_INCH;
    matrix[13] *= METERS_PER_INCH;
    matrix[14] *= METERS_PER_INCH;
    const node: JsonObject = { name: group.name, matrix };
    model.nodes.push(node);
    const facesByColor = new Map<string, number[][]>();
    for (const face of group.mesh.faces.values()) {
      const color = face.color ?? '#cccccc';
      const triangles = facesByColor.get(color) ?? [];
      for (const ids of group.mesh.triangulateFace(face)) triangles.push(ids);
      facesByColor.set(color, triangles);
    }
    const primitives: JsonObject[] = [];
    for (const [color, triangles] of facesByColor) {
      const positions: number[] = [];
      const normals: number[] = [];
      const indices: number[] = [];
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (const tri of triangles) {
        const pts = tri.map((id) => group.mesh.v(id));
        const normal = pts[1].clone().sub(pts[0]).cross(pts[2].clone().sub(pts[0])).normalize();
        for (const point of pts) {
          const xyz = [point.x, point.y, point.z].map((v) => v * METERS_PER_INCH);
          for (let k = 0; k < 3; k++) {
            min[k] = Math.min(min[k], xyz[k]);
            max[k] = Math.max(max[k], xyz[k]);
          }
          positions.push(...xyz);
          normals.push(normal.x, normal.y, normal.z);
          indices.push(indices.length);
        }
      }
      if (!indices.length) continue;
      const positionView = append(bytesOf(new Float32Array(positions)), 34962);
      const normalView = append(bytesOf(new Float32Array(normals)), 34962);
      const indexView = append(bytesOf(new Uint32Array(indices)), 34963);
      primitives.push({
        attributes: {
          POSITION: accessor(positionView, positions.length / 3, 'VEC3', 5126, { min, max }),
          NORMAL: accessor(normalView, normals.length / 3, 'VEC3', 5126),
        },
        indices: accessor(indexView, indices.length, 'SCALAR', 5125),
        material: material(color),
        mode: 4,
      });
    }
    if (primitives.length) {
      node.mesh = model.meshes.length;
      model.meshes.push({ primitives });
    }
    const children = group.children.filter((child) => !child.hidden).map(addGroup);
    if (children.length) node.children = children;
    return index;
  };

  addGroup(root);
  const bin = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bin.set(chunk, offset);
    offset += chunk.byteLength;
  }
  model.buffers[0].byteLength = size;
  return { model, bin };
}

/** Export standard glTF 2.0 with self-contained, base64-embedded geometry. */
export function exportGLTF(root: Group): string {
  const { model, bin } = buildModel(root);
  let encoded = '';
  // Chunk the byte-to-string conversion to stay below browser argument limits.
  for (let i = 0; i < bin.length; i += 0x8000) encoded += String.fromCharCode(...bin.subarray(i, i + 0x8000));
  model.buffers[0].uri = `data:application/octet-stream;base64,${btoa(encoded)}`;
  return JSON.stringify(model, null, 2);
}

/** Export binary glTF 2.0 (.glb), with JSON and geometry in one file. */
export function exportGLB(root: Group): ArrayBuffer {
  const { model, bin } = buildModel(root);
  const utf8 = new TextEncoder().encode(JSON.stringify(model));
  const jsonSize = (utf8.length + 3) & ~3;
  const binSize = (bin.length + 3) & ~3;
  const output = new ArrayBuffer(12 + 8 + jsonSize + (binSize ? 8 + binSize : 0));
  const view = new DataView(output);
  view.setUint32(0, 0x46546c67, true); // glTF
  view.setUint32(4, 2, true);
  view.setUint32(8, output.byteLength, true);
  view.setUint32(12, jsonSize, true);
  view.setUint32(16, 0x4e4f534a, true); // JSON
  const arr = new Uint8Array(output);
  arr.fill(0x20, 20, 20 + jsonSize);
  arr.set(utf8, 20);
  if (binSize) {
    const binOffset = 20 + jsonSize;
    view.setUint32(binOffset, binSize, true);
    view.setUint32(binOffset + 4, 0x004e4942, true); // BIN
    arr.set(bin, binOffset + 8);
  }
  return output;
}
