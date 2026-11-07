// Copies the version from package.json into src-tauri/Cargo.toml (and Cargo.lock).
// Runs automatically from `npm version` (the "version" script), so `npm run release:minor`
// keeps every app on the same number. The Mac app reads package.json itself (mac/build.sh).
// `node scripts/sync-version.mjs --check` fails instead of writing when they differ (CI, releases).
import { readFileSync, writeFileSync } from 'node:fs';

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const check = process.argv.includes('--check');
let ok = true;

function sync(file, pattern, replace) {
  const text = readFileSync(file, 'utf8');
  const m = text.match(pattern);
  if (!m) throw new Error(`no version found in ${file}`);
  if (m[1] === version) return;
  if (check) {
    console.error(`${file} has version ${m[1]}, package.json has ${version}`);
    ok = false;
  } else {
    writeFileSync(file, text.replace(pattern, replace));
    console.log(`${file}: ${m[1]} -> ${version}`);
  }
}

sync('src-tauri/Cargo.toml', /^version = "([^"]+)"/m, `version = "${version}"`);
sync('src-tauri/Cargo.lock', /name = "workbench3d"\nversion = "([^"]+)"/, `name = "workbench3d"\nversion = "${version}"`);

if (!ok) {
  console.error('Run `node scripts/sync-version.mjs` to fix.');
  process.exit(1);
}
console.log(`version ${version}${check ? ' everywhere' : ''}`);
