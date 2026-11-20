import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(m.text()));
page.on('pageerror', (e) => logs.push('ERR ' + e.message));
await page.goto('file://' + process.cwd() + '/mac/Resources/AddOnHost/index.html');
await page.waitForFunction(() => window.wbHost && window.wbHost.commands().length > 0);
console.log('commands', JSON.stringify(await page.evaluate(() => wbHost.commands())));
const empty = (await import('node:fs')).readFileSync('mac/Tests/Workbench3DKitTests/Fixtures/web-sample.wb3d','utf8');
const r = await page.evaluate((d) => wbHost.run('cabinet-demo.insert', d, 'test.wb3d', 0, []), empty).catch(e => ({ err: String(e) }));
console.log('cabinet run:', r.error ?? '', 'changed', !!r.doc, r.doc ? JSON.parse(r.doc).root.children.length + ' top groups' : '');
// cut list opens a dialog: run without awaiting, check the ui message (console fallback), close it
const p = page.evaluate((d) => wbHost.run('cutlist.show', d, 'test.wb3d', 0, []), r.doc);
await page.waitForSelector('.modal');
await page.click('[role=tab][data-tab=layout]');
const sheets = await page.$$eval('svg.cut-sheet', (s) => s.length);
await page.screenshot({ path: '/tmp/host-cutlist.png' });
await page.click('.modal-footer button.primary'); // Download PDF -> posts download
await page.click('.modal-footer button:not(.primary)');
const r2 = await p;
console.log('cutlist sheets', sheets, 'changed', !!r2.doc);
console.log(logs.filter(l => !l.startsWith('[host] {"type":"toast"')).map(l => l.slice(0, 140)).join('\n'));
await browser.close();
