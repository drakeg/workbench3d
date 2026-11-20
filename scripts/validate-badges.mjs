// Repository README badge contract. Run with: node scripts/validate-badges.mjs
// Every badge is evidence-based; update this validator when the real stack changes.
import { existsSync, readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const readme = read('README.md');
const manifest = JSON.parse(read('package.json'));
const start = '<!-- badges:start -->';
const end = '<!-- badges:end -->';
const errors = [];
const verify = (ok, message) => { if (!ok) errors.push(message); };
const first = readme.indexOf(start);
const last = readme.indexOf(end);
verify(first >= 0 && last > first, 'README badge block markers must exist in order.');
const block = first >= 0 && last > first ? readme.slice(first, last + end.length) : '';
const title = readme.indexOf('<h1 align="center">Workbench3D</h1>');
const description = readme.indexOf('An open-source push/pull');
verify(title >= 0 && first > title && (description < 0 || last < description), 'Badges must be directly below the title and above the description.');
verify((readme.match(/<!-- badges:start -->/g) ?? []).length === 1 && (readme.match(/<!-- badges:end -->/g) ?? []).length === 1, 'Use exactly one badge block.');

const matches = [...block.matchAll(/<a\s+href="([^"]+)"[^>]*>\s*<img\s+alt="([^"]+)"\s+src="([^"]+)"\s*>\s*<\/a>/g)];
verify(matches.length > 0, 'No clickable badges found.');
const badges = new Map(matches.map((m) => [m[2], { href: m[1], src: m[3] }]));
verify(matches.length === (block.match(/<img\b/g) ?? []).length, 'Every badge must have a descriptive alt and a clickable link.');
verify(badges.size === matches.length, 'Badge alt labels must be unique.');
verify((block.match(/<p align="center">/g) ?? []).length <= 3, 'Keep badges within three compact rows.');
for (const [name, { href, src }] of badges) {
  verify(/^https:\/\//.test(src), `${name}: image URL must be HTTPS`);
  verify(src.startsWith('https://img.shields.io/') || src.startsWith('https://github.com/drakeg/workbench3d/actions/workflows/'), `${name}: only Shields.io and official workflow status badges are allowed`);
  verify(href.startsWith('https://') || (href === 'CONTRIBUTING.md' && existsSync(href)), `${name}: invalid target link`);
}
const expectedTech = {
  'TypeScript': existsSync('tsconfig.json') && !!manifest.devDependencies?.typescript,
  'JavaScript': existsSync('scripts/smoke.mjs'),
  'Rust': existsSync('src-tauri/Cargo.toml'),
  'Swift': existsSync('mac/Package.swift'),
  'Three.js': !!manifest.dependencies?.three,
  'Vite': !!manifest.devDependencies?.vite,
  'Tauri': !!manifest.dependencies?.['@tauri-apps/api'] && existsSync('src-tauri/Cargo.toml'),
};
for (const [name, supported] of Object.entries(expectedTech)) verify(badges.has(name) === supported, `${name}: badge must reflect repository configuration`);
const workflows = { CI: 'ci.yml', 'Mac app': 'mac.yml', 'Deploy web app': 'pages.yml', 'Release desktop app': 'release.yml' };
for (const [name, filename] of Object.entries(workflows)) {
  const path = `.github/workflows/${filename}`;
  const badge = badges.get(name);
  verify(badge?.href === `https://github.com/drakeg/workbench3d/actions/workflows/${filename}` &&
    badge?.src === `https://github.com/drakeg/workbench3d/actions/workflows/${filename}/badge.svg` &&
    existsSync(path), `${name}: workflow badge must be dynamic and link to a real workflow`);
}
const github = 'https://img.shields.io/github/';
const required = {
  'Latest release': `${github}v/release/drakeg/workbench3d`,
  'License': `${github}license/drakeg/workbench3d`,
  'Open issues': `${github}issues/drakeg/workbench3d`,
  'Open pull requests': `${github}issues-pr/drakeg/workbench3d`,
};
for (const [name, prefix] of Object.entries(required)) verify(badges.get(name)?.src.startsWith(prefix), `${name}: expected a dynamic GitHub Shields.io badge`);
verify(existsSync('LICENSE') === badges.has('License'), 'A license badge requires an actual LICENSE file.');
verify(existsSync('CONTRIBUTING.md') === badges.has('Contributing'), 'A contribution badge requires CONTRIBUTING.md.');
verify(!/Docker|PostgreSQL|MySQL|AWS|Vercel/.test([...badges.keys()].join(' ')), 'Do not claim infrastructure unsupported by this repository.');
verify(!/badge\/(?:build|tests|security)-(?:passing|green)/i.test(block), 'Do not hardcode successful test or security results.');
if (errors.length) {
  for (const error of errors) console.error(`Badge validation failed: ${error}`);
  process.exit(1);
}
console.log(`Validated ${badges.size} grounded, linked README badges.`);
