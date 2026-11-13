// End-to-end smoke test: drives the real UI in a headless Chrome.
// Usage: npm run build && npx vite preview --port 4173 &  then
//        CHROME_PATH=/path/to/chrome node scripts/smoke.mjs [url] [screenshot-dir]
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:4173/';
const out = process.argv[3] ?? '.';
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(url);
await page.waitForFunction(() => window.workbench);
await page.evaluate(() => localStorage.setItem('workbench3d.welcomed', '1'));
await page.reload();
await page.waitForFunction(() => window.workbench);

const canvas = await page.$('canvas');
const box = await canvas.boundingBox();
const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
const state = () =>
  page.evaluate(() => {
    const d = window.workbench.doc;
    let faces = 0;
    let groups = 0;
    for (const g of d.root.walk()) {
      faces += g.mesh.faces.size;
      if (g !== d.root) groups++;
    }
    const b = window.workbench.modelBounds();
    return { faces, groups, size: b.isEmpty() ? null : [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z].map((v) => +v.toFixed(3)) };
  });
const check = (label, cond, info) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`, info ? JSON.stringify(info) : '');
  if (!cond) process.exitCode = 1;
};

// 1. Rectangle with typed dimensions
await page.keyboard.press('r');
await page.mouse.move(...at(0.45, 0.6));
await page.mouse.click(...at(0.45, 0.6));
await page.mouse.move(...at(0.55, 0.55));
await page.keyboard.type('24,48');
await page.keyboard.press('Enter');
let s = await state();
check('rectangle 24 x 48 drawn', s.faces === 1 && s.size && Math.abs(s.size[0] - 24) < 1e-3 && Math.abs(s.size[1] - 48) < 1e-3, s);

// 2. Push/pull with typed distance
await page.keyboard.press('Shift+Z');
await page.keyboard.press('p');
const c = at(0.5, 0.5);
await page.mouse.move(c[0], c[1]);
await page.mouse.click(c[0], c[1]);
await page.mouse.move(c[0], c[1] - 60);
await page.keyboard.type('3/4');
await page.keyboard.press('Enter');
s = await state();
check('push/pull to 3/4" makes a box', s.faces === 6 && s.size && Math.abs(s.size[2] - 0.75) < 1e-3, s);

// 3. Select all + group
await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
await page.keyboard.press(process.platform === 'darwin' ? 'Meta+g' : 'Control+g');
s = await state();
check('grouped', s.groups === 1, s);

// 4. Undo / redo
await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
s = await state();
check('undo group', s.groups === 0, s);
await page.keyboard.press(process.platform === 'darwin' ? 'Meta+y' : 'Control+y');
s = await state();
check('redo group', s.groups === 1, s);

// 5. Lumber add-on through its dialog
await page.evaluate(() => window.workbench.runCommand('lumber.insert'));
await page.waitForSelector('.modal form');
await page.click('.modal-footer button.primary');
await page.waitForTimeout(200);
s = await state();
check('inserted a 2x4 via add-on', s.groups === 2, s);

// 6. Steel add-on
await page.evaluate(() => window.workbench.runCommand('steel.insert'));
await page.waitForSelector('.modal form');
await page.click('.modal-footer button.primary');
await page.waitForTimeout(200);
s = await state();
check('inserted square tube via add-on', s.groups === 3, s);

// 7. Cut list
await page.keyboard.press('Escape');
await page.evaluate(() => window.workbench.runCommand('cutlist.show'));
await page.waitForSelector('table.cutlist');
const rows = await page.$$eval('table.cutlist tbody tr', (r) => r.map((x) => x.textContent));
check('cut list has 3 parts', rows.length === 3, rows);
await page.screenshot({ path: `${out}/cutlist.png` });
await page.click('[role=tab][data-tab=layout]');
const sheets = await page.$$eval('svg.cut-sheet', (s) => s.length);
check('cut list lays the parts out on stock', sheets >= 2, sheets);
await page.screenshot({ path: `${out}/cutlist-layout.png` });
const [pdfDownload] = await Promise.all([page.waitForEvent('download'), page.click('.modal-footer button.primary')]);
const pdfHead = (await (await import('node:fs')).promises.readFile(await pdfDownload.path())).subarray(0, 8).toString();
check('cutting plan downloads as a PDF', pdfDownload.suggestedFilename() === 'cutting-plan.pdf' && pdfHead === '%PDF-1.4', { name: pdfDownload.suggestedFilename(), pdfHead });
await (await import('node:fs')).promises.copyFile(await pdfDownload.path(), `${out}/cutting-plan.pdf`);
await page.click('.modal-footer button:not(.primary)');

await page.keyboard.press('Shift+Z');
await page.waitForTimeout(150);
await page.screenshot({ path: `${out}/model.png` });

// ---------- part 2: modeling on faces ----------
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
await page.evaluate(() => {
  const a = window.workbench;
  a.doc.clear();
  a.setTool('select');
  a.vp.setStandardView('iso', a.modelBounds());
});
const proj = (x, y, z) =>
  page.evaluate(([x, y, z]) => {
    const a = window.workbench;
    const p = a.vp.project(new (Object.getPrototypeOf(a.vp.target).constructor)(x, y, z));
    return [p.x, p.y];
  }, [x, y, z]).then(([px, py]) => [box.x + px, box.y + py]);
const volume = () =>
  page.evaluate(() => {
    let v = 0;
    for (const g of window.workbench.doc.root.walk()) {
      const m = g.mesh;
      const W = g.worldMatrix();
      for (const f of m.faces.values())
        for (const [a, b, c] of m.triangulateFace(f)) {
          const A = m.v(a).clone().applyMatrix4(W), B = m.v(b).clone().applyMatrix4(W), C = m.v(c).clone().applyMatrix4(W);
          v += A.dot(B.clone().cross(C)) / 6;
        }
    }
    return +v.toFixed(3);
  });

// box 24 x 24 x 10 from the origin
await page.keyboard.press('r');
let p = await proj(0, 0, 0);
await page.mouse.move(p[0], p[1]);
await page.mouse.click(p[0], p[1]);
p = await proj(20, 20, 0);
await page.mouse.move(p[0], p[1]);
await page.keyboard.type('24,24');
await page.keyboard.press('Enter');
await page.keyboard.press('Shift+Z');
await page.keyboard.press('p');
p = await proj(12, 12, 0);
await page.mouse.move(p[0], p[1]);
await page.mouse.click(p[0], p[1]);
await page.mouse.move(p[0], p[1] - 80);
await page.keyboard.type('10');
await page.keyboard.press('Enter');
check('box volume 24*24*10', (await volume()) === 5760, await volume());

// rectangle on the top face -> hole + inner face
await page.keyboard.press('Shift+Z');
await page.keyboard.press('r');
p = await proj(6, 6, 10);
await page.mouse.move(p[0], p[1]);
await page.mouse.click(p[0], p[1]);
p = await proj(10, 10, 10);
await page.mouse.move(p[0], p[1]);
await page.keyboard.type('6,6');
await page.keyboard.press('Enter');
s = await state();
check('rectangle on face splits into hole + inner face', s.faces === 7, s);

// push the inner face down 2 -> pocket
await page.keyboard.press('p');
p = await proj(9, 9, 10);
await page.mouse.move(p[0], p[1]);
await page.mouse.click(p[0], p[1]);
await page.mouse.move(p[0], p[1] + 40);
await page.keyboard.type('2');
await page.keyboard.press('Enter');
check('pocket 6x6x2 removed', (await volume()) === 5760 - 72, await volume());

// line across the top from edge midpoint to edge midpoint splits the face
await page.keyboard.press('l');
p = await proj(0, 18, 10);
await page.mouse.move(p[0], p[1]);
await page.mouse.click(p[0], p[1]);
p = await proj(24, 18, 10);
await page.mouse.move(p[0], p[1]);
await page.mouse.click(p[0], p[1]);
await page.keyboard.press('Escape');
const before = (await state()).faces;
await page.keyboard.press('p');
p = await proj(12, 21, 10);
await page.mouse.move(p[0], p[1]);
await page.mouse.click(p[0], p[1]);
await page.mouse.move(p[0], p[1] + 40);
await page.keyboard.type('3');
await page.keyboard.press('Enter');
check('rabbet: split strip pushed down 3', Math.abs((await volume()) - (5760 - 72 - 24 * 6 * 3)) < 0.01, { v: await volume(), facesBefore: before });

// group it, then copy it 3 times along red with Move + Ctrl + "x3"
await page.keyboard.press(`${MOD}+a`);
await page.keyboard.press(`${MOD}+g`);
await page.keyboard.press('m');
await page.keyboard.press(process.platform === 'darwin' ? 'Alt' : 'Control');
p = await proj(24, 0, 0);
await page.mouse.move(p[0], p[1]);
await page.mouse.click(p[0], p[1]);
p = await proj(40, 0, 0);
await page.mouse.move(p[0], p[1]);
await page.keyboard.type('30');
await page.keyboard.press('Enter');
await page.keyboard.type('x3');
await page.keyboard.press('Enter');
s = await state();
check('move-copy array makes 4 parts', s.groups === 4 && Math.abs(s.size[0] - (24 + 90)) < 1e-3, s);

// rotate the selected copy 90 degrees about blue
await page.keyboard.press('Escape');
await page.evaluate(() => {
  const a = window.workbench;
  a.setSelection({ groups: [a.doc.root.children[0].id] });
});
await page.keyboard.press('q');
p = await proj(0, 0, 0);
await page.mouse.move(p[0], p[1]);
await page.mouse.click(p[0], p[1]);
p = await proj(10, 0, 0);
await page.mouse.move(p[0], p[1]);
await page.mouse.click(p[0], p[1]);
p = await proj(0, 10, 0);
await page.mouse.move(p[0], p[1]);
await page.keyboard.type('90');
await page.keyboard.press('Enter');
const rot = await page.evaluate(() => {
  const g = window.workbench.doc.root.children[0];
  const b = g.worldBounds();
  return [b.min.x, b.max.x, b.min.y, b.max.y].map((v) => +v.toFixed(3));
});
check('rotated part now spans -24..0 on red', rot[0] === -24 && rot[1] === 0 && rot[2] === 0 && rot[3] === 24, rot);

// save + load roundtrip keeps everything
const rt = await page.evaluate(() => {
  const a = window.workbench;
  const json = a.doc.serialize();
  a.doc.load(json);
  return a.doc.root.children.length;
});
check('save/load roundtrip', rt === 4, rt);
await page.keyboard.press('Shift+Z');
await page.waitForTimeout(150);
await page.screenshot({ path: `${out}/model2.png` });

// ---------- part 3: third-party add-on loaded from source ----------
const fs = await import('node:fs');
const code = fs.readFileSync(new URL('../examples/addons/cabinet-box.js', import.meta.url), 'utf8');
await page.evaluate(async (code) => {
  window.workbench.doc.clear();
  await window.workbenchAddOns.install(code);
  window.workbench.runCommand('example.cabinet-box.build');
}, code);
await page.waitForSelector('.modal form');
await page.click('.modal-footer button.primary');
await page.waitForTimeout(200);
s = await state();
check('example add-on built a cabinet (1 + 7 parts)', s.groups === 8 && Math.abs(s.size[0] - 30) < 1e-3 && Math.abs(s.size[2] - 36) < 1e-3, s);
await page.evaluate(() => window.workbench.runCommand('cutlist.show'));
await page.waitForSelector('table.cutlist');
const cab = await page.$$eval('table.cutlist tbody tr', (r) => r.map((x) => x.textContent));
check('cut list groups identical panels', cab.length === 5, cab);
await page.screenshot({ path: `${out}/cabinet-cutlist.png` });
await page.click('.modal-footer button:not(.primary)');
await page.keyboard.press('Shift+Z');
await page.waitForTimeout(150);
await page.screenshot({ path: `${out}/cabinet.png` });
// ---------- part 4: edit inside a group, circles, paint, eraser ----------
await page.evaluate(() => {
  const a = window.workbench;
  a.doc.clear();
  a.setTool('select');
  a.vp.setStandardView('iso', a.modelBounds()); // frame the origin again
});
await page.keyboard.press('c');
p = await proj(0, 0, 0);
await page.mouse.move(p[0], p[1]);
await page.mouse.click(p[0], p[1]);
p = await proj(5, 0, 0);
await page.mouse.move(p[0], p[1]);
await page.keyboard.type('4');
await page.keyboard.press('Enter');
await page.keyboard.press('Shift+Z');
await page.keyboard.press('p');
p = await proj(0, 0, 0);
await page.mouse.move(p[0], p[1]);
await page.mouse.click(p[0], p[1]);
await page.mouse.move(p[0], p[1] - 50);
await page.keyboard.type('6');
await page.keyboard.press('Enter');
s = await state();
check('circle push/pulled into a 24-sided cylinder', s.faces === 26 && Math.abs(s.size[2] - 6) < 1e-3, s);
await page.keyboard.press(`${MOD}+a`);
await page.keyboard.press(`${MOD}+g`);
await page.keyboard.press('Escape');
await page.keyboard.press('Shift+Z');
// double-click the group with Select to open it, then push/pull its top inside the group
await page.keyboard.press(' ');
p = await proj(0, 0, 6);
await page.mouse.dblclick(p[0], p[1]);
const ctx = await page.evaluate(() => window.workbench.context.id);
check('double-click opens the group for editing', ctx !== 0, ctx);
await page.keyboard.press('p');
await page.mouse.move(p[0], p[1]);
await page.mouse.click(p[0], p[1]);
await page.mouse.move(p[0], p[1] - 40);
await page.keyboard.type('2');
await page.keyboard.press('Enter');
s = await state();
check('push/pull inside the group', Math.abs(s.size[2] - 8) < 1e-3 && s.groups === 1, s);
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
check('escape closes the group', (await page.evaluate(() => window.workbench.context.id)) === 0);
// paint the group walnut
await page.click('.swatch[title="Walnut"]');
await page.mouse.click(p[0], p[1] - 10);
const colors = await page.evaluate(() => [...new Set([...window.workbench.doc.root.children[0].mesh.faces.values()].map((f) => f.color))]);
check('paint bucket colours the whole group', colors.length === 1 && colors[0] === '#6b4a32', colors);
// erase it
await page.keyboard.press('e');
await page.mouse.click(p[0], p[1] - 10);
s = await state();
check('eraser removes the group', s.groups === 0, s);
await page.keyboard.press(`${MOD}+z`);
s = await state();
check('undo brings it back', s.groups === 1, s);

// ---------- part 5: v0.2 tools ----------
const reset = () =>
  page.evaluate(() => {
    const a = window.workbench;
    a.doc.clear();
    a.setTool('select');
    a.vp.setStandardView('iso', a.modelBounds());
  });
const drag = async (fromW, toW, typed) => {
  let q = await proj(...fromW);
  await page.mouse.move(q[0], q[1]);
  await page.mouse.click(q[0], q[1]);
  q = await proj(...toW);
  await page.mouse.move(q[0], q[1]);
  if (typed) {
    await page.keyboard.type(typed);
    await page.keyboard.press('Enter');
  }
};
const makeBox = async (w, d, h) => {
  await page.keyboard.press('r');
  await drag([0, 0, 0], [w * 0.8, d * 0.8, 0], `${w},${d}`);
  await page.keyboard.press('Shift+Z');
  await page.keyboard.press('p');
  let q = await proj(w / 2, d / 2, 0);
  await page.mouse.move(q[0], q[1]);
  await page.mouse.click(q[0], q[1]);
  await page.mouse.move(q[0], q[1] - 60);
  await page.keyboard.type(String(h));
  await page.keyboard.press('Enter');
  await page.keyboard.press('Shift+Z');
};

// Offset: inset the top of a box by 2, push the inner face down 1
await reset();
await makeBox(20, 20, 4);
await page.keyboard.press('f');
await drag([10, 0.5, 4], [10, 6, 4], '2');
s = await state();
check('offset inset the top face', s.faces === 7, s);
await page.keyboard.press('p');
await drag([10, 10, 4], [10, 10, 2], '1');
check('push/pull the offset face into a tray', Math.abs((await volume()) - (1600 - 16 * 16)) < 0.01, await volume());

// Arc on the ground: 2-point arc with a typed bulge
await reset();
await page.keyboard.press('a');
await drag([0, 0, 0], [10, 0, 0]);
let q = await proj(10, 0, 0);
await page.mouse.click(q[0], q[1]);
q = await proj(5, 3, 0);
await page.mouse.move(q[0], q[1]);
await page.keyboard.type('5');
await page.keyboard.press('Enter');
const arcEdges = await page.evaluate(() => window.workbench.doc.root.mesh.lines.size);
check('arc made 12 edges (half circle)', arcEdges === 12, arcEdges);
// close it with a line: the half-disc becomes a face
await page.keyboard.press('l');
await drag([0, 0, 0], [10, 0, 0]);
q = await proj(10, 0, 0);
await page.mouse.click(q[0], q[1]);
await page.keyboard.press('Escape');
const halfDisc = await page.evaluate(() => {
  const m = window.workbench.doc.root.mesh;
  return [...m.faces.values()].map((f) => +m.area(f).toFixed(2));
});
check('arc + chord closes into a face', halfDisc.length === 1 && Math.abs(halfDisc[0] - 39.06) < 0.3, halfDisc);

// Scale: stretch a grouped box along red to 30" by typing a size
await reset();
await makeBox(10, 10, 10);
await page.keyboard.press(`${MOD}+a`);
await page.keyboard.press(`${MOD}+g`);
await page.keyboard.press('s');
await page.waitForTimeout(100);
q = await proj(10, 5, 5); // +X face-centre grip
await page.mouse.move(q[0], q[1]);
await page.mouse.click(q[0], q[1]);
const q2 = await proj(14, 5, 5);
await page.mouse.move(q2[0], q2[1]);
await page.keyboard.type('30"');
await page.keyboard.press('Enter');
const scaled = await page.evaluate(() => {
  const g = window.workbench.doc.root.children[0];
  const s = g.localBounds().getSize(new (window.workbench.vp.target.constructor)());
  return [s.x, s.y, s.z].map((v) => +v.toFixed(3));
});
check('scale to 30" along red (baked into the group)', scaled[0] === 30 && scaled[1] === 10 && scaled[2] === 10, scaled);

// Components: make one, copy it, edit inside one -> the copy changes too
await page.keyboard.press(' ');
await page.evaluate(() => window.workbench.setSelection({ groups: [window.workbench.doc.root.children[0].id] }));
await page.keyboard.press('g');
await page.waitForSelector('.modal form');
await page.fill('.modal input[type=text]', 'Block');
await page.click('.modal-footer button.primary');
await page.waitForTimeout(100);
await page.keyboard.press('m');
await page.keyboard.press(process.platform === 'darwin' ? 'Alt' : 'Control');
await drag([0, 0, 0], [0, 30, 0], '40');
s = await state();
const comp = await page.evaluate(() => window.workbench.doc.root.children.map((g) => g.componentId));
check('component copied', s.groups === 2 && comp[0] != null && comp[0] === comp[1], { s, comp });
await page.keyboard.press('Escape');
await page.keyboard.press(' ');
await page.evaluate(() => window.workbench.enterGroup(window.workbench.doc.root.children[0].id));
await page.keyboard.press('p');
await drag([15, 5, 10], [15, 5, 14], '2');
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
const heights = await page.evaluate(() => window.workbench.doc.root.children.map((g) => +g.localBounds().getSize(new (window.workbench.vp.target.constructor)()).z.toFixed(3)));
check('editing one instance updates the other', heights[0] === 12 && heights[1] === 12, heights);
await page.screenshot({ path: `${out}/components.png` });

// Right-click context menu on a group
q = await proj(5, 45, 6);
await page.mouse.click(q[0], q[1], { button: 'right' });
await page.waitForSelector('.context-menu');
const menuItems = await page.$$eval('.context-menu .menu-item span', (els) => els.map((e) => e.textContent));
check('context menu offers Make Unique and Explode', menuItems.includes('Make Unique') && menuItems.includes('Explode'), menuItems);
await page.click('.context-menu .menu-item:has-text("Make Unique")');
const comps = await page.evaluate(() => new Set(window.workbench.doc.root.children.map((g) => g.componentId)).size);
check('make unique gives the copy its own definition', comps === 2, comps);

// Tags: tag the second block, hide the tag
await page.evaluate(() => {
  const a = window.workbench;
  a.doc.transact('Tag', () => {
    a.doc.tags.push({ name: 'Blocks', visible: true });
    a.doc.root.children[1].tag = 'Blocks';
  });
  a.doc.transact('Hide Tag', () => (a.doc.tags[0].visible = false));
});
const hiddenHit = await page.evaluate(([x, y]) => {
  const a = window.workbench;
  const r = a.vp.dom.getBoundingClientRect();
  return !!a.vp.raycastFaces(a.vp.ray(x - r.left, y - r.top));
}, q);
check('hidden tag removes the part from view and picking', hiddenHit === false, hiddenHit);

// Scenes: save, move the camera, go back
await page.evaluate(() => window.workbench.runCommand('scene.add'));
const cam0 = await page.evaluate(() => window.workbench.vp.persp.position.toArray().map((v) => +v.toFixed(2)));
await page.evaluate(() => {
  const a = window.workbench;
  a.doc.tags[0].visible = true;
  a.vp.setStandardView('top', a.modelBounds());
});
await page.click('.scene-tabs button');
await page.waitForTimeout(700);
const cam1 = await page.evaluate(() => window.workbench.vp.persp.position.toArray().map((v) => +v.toFixed(2)));
const tagBack = await page.evaluate(() => window.workbench.doc.tags[0].visible);
check('scene restores camera and tag visibility', JSON.stringify(cam0) === JSON.stringify(cam1) && tagBack === false, { cam0, cam1, tagBack });

// Tape measure guide: parallel guide 3" from an edge; dimension; section plane
await reset();
await makeBox(20, 20, 4);
await page.keyboard.press('t');
await drag([10, 0, 4], [10, 2, 4], '3');
const guides = await page.evaluate(() => window.workbench.doc.guides);
check('tape from an edge places a parallel guide 3" away', guides.length === 1 && Math.abs(guides[0].point[1] - 3) < 1e-3 && Math.abs(guides[0].dir[0]) === 1, guides);
await page.evaluate(() => window.workbench.setTool('dimension'));
q = await proj(6, 0, 0);
await page.mouse.move(q[0], q[1]);
await page.mouse.click(q[0], q[1]); // on the front-bottom edge
q = await proj(6, -6, 0);
await page.mouse.move(q[0], q[1]);
await page.mouse.click(q[0], q[1]);
const dimText = await page.$$eval('.dim-label', (els) => els.map((e) => e.textContent));
check('dimension shows the edge length', dimText.length === 1 && dimText[0] === `1' 8"`, dimText);
await page.evaluate(() => window.workbench.setTool('section'));
await drag([10, 0, 2], [10, 5, 2], '10');
const sec = await page.evaluate(() => {
  const a = window.workbench;
  const s = a.doc.sections[0];
  const r = a.vp.dom.getBoundingClientRect();
  return { y: +s.point[1].toFixed(3), active: s.active, clipped: !!a.vp.clipPlane };
});
check('section plane cuts 10" into the box', sec.y === 10 && sec.active && sec.clipped, sec);
await page.keyboard.press('Shift+Z');
await page.waitForTimeout(150);
await page.screenshot({ path: `${out}/section.png` });

// SketchUp import (the parser loads on first use)
await reset();
const skp = (await import('node:fs')).readFileSync(new URL('../tests/fixtures/sample.skp', import.meta.url)).toString('base64');
await page.evaluate(async (b64) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  await window.workbench.importFile('sample.skp', bytes.buffer);
}, skp);
const imported = await page.evaluate(() => {
  const a = window.workbench;
  const top = a.doc.root.children[0];
  return {
    name: top?.name,
    children: top?.children.length,
    components: a.doc.components.length,
    tags: a.doc.tags.map((t) => t.name),
    selected: [...a.selection.groups],
    id: top?.id,
  };
});
check('imports a SketchUp file as one group with its components and tags',
  imported.name === 'sample' && imported.children === 3 && imported.components === 1 && imported.tags.includes('Cabinets') && imported.selected[0] === imported.id, imported);
await page.waitForTimeout(150);
await page.screenshot({ path: `${out}/skp-import.png` });

check('no page errors', errors.length === 0, errors);
await browser.close();
