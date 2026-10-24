import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

// Local installed packages only; no registry requests or legal compatibility claim.
const root = JSON.parse(execFileSync('pnpm', ['list', '--prod', '--depth', 'Infinity', '--json'], { encoding: 'utf8' }))[0];
const packages = new Map();
function walk(dependencies) {
  for (const [name, item] of Object.entries(dependencies ?? {})) {
    const key = `${name}@${item.version}`;
    if (!packages.has(key)) {
      packages.set(key, { ...item, scope: 'production dependency tree (includes type peers)' });
      walk(item.dependencies);
    }
  }
}
walk(root.dependencies);
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
for (const name of Object.keys(manifest.devDependencies)) {
  const path = join('node_modules', name);
  const pkg = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
  if (!packages.has(`${name}@${pkg.version}`)) packages.set(`${name}@${pkg.version}`, { path, scope: 'direct dev dependency only' });
}
const rows = [...packages].sort(([a], [b]) => a.localeCompare(b)).map(([identity, item]) => {
  const pkg = JSON.parse(readFileSync(join(item.path, 'package.json'), 'utf8'));
  const files = readdirSync(item.path).filter(name => /^(licen[sc]e|copying|notice)(\.|$)/i.test(name));
  return { identity, scope: item.scope, declaredLicense: pkg.license ?? null, licenseFiles: files.map(name => {
    const text = readFileSync(join(item.path, name), 'utf8');
    return { name, sha256: createHash('sha256').update(text).digest('hex'), heading: text.trim().split('\n').slice(0, 3).join(' / ') };
  }) };
});
writeFileSync('docs/research/benchmarks/m1-license-inventory.json', JSON.stringify({ date: new Date().toISOString(),
  scope: 'Installed production tree plus direct dev packages; not full dev transitives, not legal advice or a redistribution approval. Preserve actual notices before publishing.', packages: rows }, null, 2) + '\n');
console.log(`Inspected ${rows.length} packages; ${rows.filter(row => !row.licenseFiles.length).length} without top-level license files.`);
