// End-to-end checks for the per-OS conventions (Mac and Windows), previewed in Chrome with ?platform=.
// Usage: CHROME_PATH=... node scripts/smoke-platform.mjs [url]
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:4173/';
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const check = (label, cond, info) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`, info !== undefined ? JSON.stringify(info) : '');
  if (!cond) process.exitCode = 1;
};

async function open(platform, theme = 'light') {
  const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${base}?platform=${platform}&theme=${theme}`);
  await page.waitForFunction(() => window.workbench);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('workbench3d.welcomed', '1');
  });
  await page.reload();
  await page.waitForFunction(() => window.workbench);
  // one board to work with
  await page.evaluate(() => {
    const a = window.workbench;
    a.runCommand('lumber.insert');
  });
  await page.waitForSelector('.modal form');
  await page.click('.modal-footer button.primary');
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const a = window.workbench;
    a.setTool('select');
    a.clearSelection();
    a.vp.setStandardView('iso', a.modelBounds());
  });
  return { page, errors };
}

const groupCenter = (page) =>
  page.evaluate(() => {
    const a = window.workbench;
    const g = a.doc.root.children[0];
    const c = g.worldBounds().getCenter(a.vp.target.clone());
    c.z = g.worldBounds().max.z;
    const p = a.vp.project(c);
    const r = a.vp.dom.getBoundingClientRect();
    return [r.left + p.x, r.top + p.y];
  });

// ---------------- Mac
{
  const { page, errors } = await open('mac');
  const menus = await page.$$eval('.menu-btn', (b) => b.map((x) => x.textContent));
  check('mac: app menu comes first', menus[0] === 'Workbench3D', menus);
  await page.click('.menu-btn:text("Workbench3D")');
  const appItems = await page.$$eval('.menu.open .menu-item', (b) => b.map((x) => x.textContent));
  check('mac: About, then Settings… (⌘,) in the app menu', appItems[0].startsWith('About') && appItems[1].includes('Settings…') && appItems[1].includes('⌘,'), appItems);
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 300);
  await page.click('.menu-btn:text("Edit")');
  const undo = await page.$eval('.menu.open [data-cmd="edit.undo"]', (b) => b.textContent);
  check('mac: Undo names the action', undo.startsWith('Undo Insert Lumber') && undo.includes('⌘Z'), undo);
  const redo = await page.$eval('.menu.open [data-cmd="edit.redo"]', (b) => b.textContent);
  check('mac: Redo is ⇧⌘Z', redo.includes('⇧⌘Z'), redo);
  await page.mouse.click(5, 300);
  const file = await page.$$eval('.menu:nth-child(2) .menu-item', (b) => b.map((x) => x.textContent));
  check('mac: Duplicate instead of Save As, New Model', file.some((t) => t.startsWith('Duplicate')) && file.some((t) => t.startsWith('New Model')), file);
  const [cx, cy] = await groupCenter(page);
  await page.mouse.click(cx, cy, { button: 'right' });
  await page.waitForSelector('.context-menu');
  const kbds = await page.$$eval('.context-menu kbd', (k) => k.map((x) => x.textContent).filter(Boolean));
  check('mac: context menu shows no shortcuts', kbds.length === 0, kbds);
  await page.mouse.click(5, 300);
  const tip = await page.$eval('.tool-btn[aria-label="Push/Pull"]', (b) => b.title);
  check('mac: tooltip names the shortcut', tip === 'Push/Pull (P)', tip);
  // copy / paste with ⌘ (Meta)
  await page.mouse.click(cx, cy);
  await page.keyboard.press('Meta+c');
  await page.keyboard.press('Meta+v');
  const after = await page.evaluate(() => ({ groups: window.workbench.doc.root.children.length, tool: window.workbench.tool.id }));
  check('mac: ⌘C ⌘V pastes a copy and picks up Move', after.groups === 2 && after.tool === 'move', after);
  await page.keyboard.press('Escape');
  // settings: tabs, applies at once
  await page.keyboard.press('Meta+,');
  await page.waitForSelector('.settings-tabs');
  const tabs = await page.$$eval('.settings-tabs button', (b) => b.map((x) => x.textContent));
  check('mac: Settings opens with ⌘, and has tabs', tabs.join('|').includes('General') && tabs.join('|').includes('Navigation'), tabs);
  const focused = await page.evaluate(() => document.activeElement?.tagName);
  check('mac: windows open calm (nothing focused)', focused === 'BODY', focused);
  const hasTheme = await page.$('.settings [aria-label="App theme"]');
  check('mac: no app-only appearance setting', !hasTheme);
  await page.click('.settings-tabs button[data-id="navigation"]');
  await page.click('.settings input[aria-label="Two-finger scroll pans the view"]');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('workbench3d.settings')).scrollPans);
  check('mac: settings apply at once', saved === true, saved);
  await page.keyboard.press('Escape');
  // scroll now pans instead of zooming
  const before = await page.evaluate(() => window.workbench.vp.persp.position.distanceTo(window.workbench.vp.target));
  await page.mouse.move(700, 400);
  await page.mouse.wheel(0, 120);
  const after2 = await page.evaluate(() => window.workbench.vp.persp.position.distanceTo(window.workbench.vp.target));
  check('mac: two-finger scroll pans (distance unchanged)', Math.abs(before - after2) < 1e-6, { before, after2 });
  check('mac: no page errors', errors.length === 0, errors);
  await page.close();
}

// ---------------- Windows
{
  const { page, errors } = await open('windows', 'dark');
  const dark = await page.evaluate(() => ({ cls: document.documentElement.className, vp: window.workbench.vp.dark }));
  check('windows: dark theme on chrome and viewport', dark.cls.includes('theme-dark') && dark.vp === true, dark);
  const menus = await page.$$eval('.menu-btn', (b) => b.map((x) => x.textContent));
  check('windows: no app menu; File first', menus[0] === 'File', menus);
  await page.click('.menu-btn:text("View")');
  const view = await page.$$eval('.menu.open .menu-item span:first-child', (b) => b.map((x) => x.textContent));
  check('windows: sentence case labels', view.includes('Zoom extents') && view.some((t) => t === 'Iso view'), view);
  await page.mouse.click(5, 300);
  await page.click('.menu-btn:text("File")');
  const file = await page.$$eval('.menu.open .menu-item span:first-child', (b) => b.map((x) => x.textContent));
  check('windows: Save as and Settings in File', file.includes('Save as…') && file.includes('Settings'), file);
  await page.mouse.click(5, 300);
  const [cx, cy] = await groupCenter(page);
  await page.mouse.move(cx, cy);
  await page.mouse.click(cx, cy);
  await page.keyboard.press('Shift+F10');
  await page.waitForSelector('.context-menu');
  const items = await page.$$eval('.context-menu .menu-item', (b) => b.map((x) => x.textContent));
  check('windows: Shift+F10 opens the context menu, with shortcuts', items.some((t) => t.startsWith('Delete') && t.includes('Del')) && items.some((t) => t.startsWith('Copy') && t.includes('Ctrl+C')), items);
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 300);
  await page.mouse.click(cx, cy);
  await page.keyboard.press('F2');
  const renaming = await page.evaluate(() => document.activeElement?.classList.contains('rename-field'));
  check('windows: F2 renames the selected part', renaming === true, renaming);
  await page.keyboard.type('Leg');
  await page.keyboard.press('Enter');
  const name = await page.evaluate(() => window.workbench.doc.root.children[0].name);
  check('windows: rename applied', name === 'Leg', name);
  await page.click('.settings-btn');
  await page.waitForSelector('.settings-cards');
  const theme = await page.$('.settings select[aria-label="App theme"]');
  check('windows: Settings page has an App theme choice (gear button)', !!theme);
  await page.selectOption('.settings select[aria-label="App theme"]', 'light');
  const light = await page.evaluate(() => ({ cls: document.documentElement.className, vp: window.workbench.vp.dark }));
  // ?theme=dark in the URL still wins in this preview, so only check the setting saved
  const savedTheme = await page.evaluate(() => JSON.parse(localStorage.getItem('workbench3d.settings')).theme);
  check('windows: theme setting saved', savedTheme === 'light', { savedTheme, light });
  await page.keyboard.press('Escape');
  const tip = await page.$eval('.tool-btn[aria-label="Tape measure"]', (b) => b.title);
  check('windows: tooltips in sentence case with shortcut', tip === 'Tape measure (T)', tip);
  // drop a model file on the window
  const json = await page.evaluate(() => window.workbench.doc.serialize());
  await page.evaluate(() => window.workbench.doc.clear());
  await page.evaluate((json) => {
    const dt = new DataTransfer();
    dt.items.add(new File([json], 'dropped.wb3d', { type: 'application/json' }));
    const stage = document.querySelector('.stage');
    stage.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    stage.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, json);
  await page.waitForTimeout(200);
  const dropped = await page.evaluate(() => ({ groups: window.workbench.doc.root.children.length, name: window.workbench.fileName }));
  check('windows: dropping a .wb3d opens it', dropped.groups === 1 && dropped.name === 'dropped.wb3d', dropped);
  check('windows: no page errors', errors.length === 0, errors);
  await page.screenshot({ path: 'platform-windows-dark.png' });
  await page.close();
}

await browser.close();
