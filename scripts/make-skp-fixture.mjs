// Writes tests/fixtures/sample.skp with openskp's writer: a small SketchUp file for the
// import smoke test (a face with a hole, a component placed twice, a group, a tag).
import { create } from 'openskp';
import { writeFileSync } from 'node:fs';

const b = create();
const red = b.addMaterial('Red', [200, 30, 30, 255]);
const tag = b.addLayer('Cabinets');
const leg = b.addComponentDefinition('Leg', (d) => {
  d.addFace([[0, 0, 0], [2, 0, 0], [2, 2, 0], [0, 2, 0]]);
  d.addFace([[0, 0, 0], [0, 0, 10], [2, 0, 10], [2, 0, 0]]);
});
b.addGroup((d) => d.addFace([[0, 0, 0], [4, 0, 0], [4, 4, 0]]), { name: 'Tri', translation: [0, 20, 1] });
b.addFace([[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]], { holes: [[[3, 3, 0], [7, 3, 0], [7, 7, 0], [3, 7, 0]]], material: red });
b.addInstance(leg, { name: 'Leg A', translation: [20, 0, 0] });
b.addInstance(leg, { name: 'Leg B', translation: [30, 5, 0], matrix3x3: [0, 1, 0, -1, 0, 0, 0, 0, 1], layer: tag });
writeFileSync('tests/fixtures/sample.skp', b.toBytes());
console.log('wrote tests/fixtures/sample.skp');
