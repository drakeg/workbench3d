import { describe, expect, it } from 'vitest';
import { Vector3, Matrix4 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WorkbenchDocument } from '../src/core/document';
import { exportGLB, exportGLTF } from '../src/core/exportGltf';

function fixture() {
  const doc = new WorkbenchDocument();
  const cabinet = doc.newGroup('Cabinet');
  cabinet.matrix.makeTranslation(12, 24, 36);
  const face = [
    cabinet.mesh.newVertex(new Vector3(0, 0, 0)),
    cabinet.mesh.newVertex(new Vector3(4, 0, 0)),
    cabinet.mesh.newVertex(new Vector3(0, 3, 0)),
  ];
  cabinet.mesh.addFace(face, [], '#ff0000');
  const shelf = doc.newGroup('Shelf');
  shelf.matrix.makeTranslation(0, 0, 6);
  shelf.mesh.addFace([
    shelf.mesh.newVertex(new Vector3(0, 0, 0)),
    shelf.mesh.newVertex(new Vector3(2, 0, 0)),
    shelf.mesh.newVertex(new Vector3(0, 2, 0)),
  ], [], '#0000ff');
  cabinet.add(shelf);
  doc.root.add(cabinet);
  const hidden = doc.newGroup('Hidden panel');
  hidden.hidden = true;
  doc.root.add(hidden);
  return doc;
}

describe('glTF 2.0 export', () => {
  it('writes a self-contained glTF document with hierarchy, colors, and metre units', () => {
    const json = JSON.parse(exportGLTF(fixture().root));
    expect(json.asset.version).toBe('2.0');
    expect(json.scenes[0].nodes).toEqual([0]);
    expect(json.nodes[0].children).toEqual([1]);
    expect(json.nodes[1].name).toBe('Model');
    expect(json.nodes[2].name).toBe('Cabinet');
    expect(json.nodes[3].name).toBe('Shelf');
    expect(json.nodes.map((n: { name: string }) => n.name)).not.toContain('Hidden panel');
    expect(json.nodes[2].matrix[12]).toBeCloseTo(12 * 0.0254, 8);
    expect(json.nodes[2].matrix[13]).toBeCloseTo(24 * 0.0254, 8);
    expect(json.nodes[2].matrix[14]).toBeCloseTo(36 * 0.0254, 8);
    expect(json.nodes[3].matrix[14]).toBeCloseTo(6 * 0.0254, 8);
    expect(json.meshes).toHaveLength(2);
    expect(json.materials).toHaveLength(2);
    expect(json.materials[0].pbrMetallicRoughness.baseColorFactor[0]).toBeCloseTo(1);
    expect(json.materials[1].pbrMetallicRoughness.baseColorFactor[2]).toBeCloseTo(1);
    expect(json.accessors[0].max[0]).toBeCloseTo(4 * 0.0254, 6);
    expect(json.buffers[0].uri).toMatch(/^data:application\/octet-stream;base64,/);
  });

  it('produces a valid glb header, padded JSON and embedded BIN chunks', () => {
    const buffer = exportGLB(fixture().root);
    const dv = new DataView(buffer);
    expect(dv.getUint32(0, true)).toBe(0x46546c67);
    expect(dv.getUint32(4, true)).toBe(2);
    expect(dv.getUint32(8, true)).toBe(buffer.byteLength);
    const jsonSize = dv.getUint32(12, true);
    expect(jsonSize % 4).toBe(0);
    expect(dv.getUint32(16, true)).toBe(0x4e4f534a);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonSize)));
    expect(json.buffers[0].uri).toBeUndefined();
    expect(dv.getUint32(20 + jsonSize + 4, true)).toBe(0x004e4942);
    expect(json.buffers[0].byteLength).toBeGreaterThan(0);
  });

  it('can reopen the exported GLB with the standard Three.js glTF loader', async () => {
    const bytes = exportGLB(fixture().root);
    const loaded = await new Promise<Awaited<ReturnType<GLTFLoader['loadAsync']>>>((resolve, reject) => {
      new GLTFLoader().parse(bytes, '', resolve, reject);
    });
    const model = loaded.scene.getObjectByName('Model');
    const cabinet = loaded.scene.getObjectByName('Cabinet');
    const shelf = loaded.scene.getObjectByName('Shelf');
    expect(model).toBeDefined();
    expect(cabinet).toBeDefined();
    expect(shelf).toBeDefined();
    expect(cabinet!.parent).toBe(model);
    expect(shelf!.parent).toBe(cabinet);
    const world = shelf!.getWorldPosition(new Vector3());
    expect(world.length()).toBeGreaterThan(0.1);
  });
});
