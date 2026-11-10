// Cold-start bytes of a build: everything the page loads before it can run (index.html,
// its entry script and the entry's static imports), raw, gzip and brotli; plus the
// lazily loaded chunks. Run after `npm run build`:  node scripts/sim/bundle-report.mjs [dist]
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';

const dist = process.argv[2] ?? 'dist';
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const sizes = (buf) => ({ raw: buf.length, gz: gzipSync(buf, { level: 9 }).length, br: brotliCompressSync(buf).length });

// Follow static imports from the entry (`import ... from "./x.js"` / `import "./x.js"`), not import().
const entry = [...html.matchAll(/<script[^>]+src="\.?\/?([^"]+\.js)"/g)].map((m) => m[1]);
const seen = new Set();
const queue = [...entry];
while (queue.length) {
  const file = queue.shift();
  if (seen.has(file)) continue;
  seen.add(file);
  const code = readFileSync(join(dist, file), 'utf8');
  for (const m of code.matchAll(/(?:^|[;}\s])import\s*(?:[\w*{}\s,$]+from\s*)?["']\.\/([\w.-]+\.js)["']/g)) queue.push(join('assets', m[1]));
}
let total = sizes(Buffer.from(html));
console.log('critical path:');
console.log(`  ${'index.html'.padEnd(44)} ${kb(total.raw).padStart(8)} ${kb(total.gz).padStart(8)} gz ${kb(total.br).padStart(8)} br`);
for (const f of seen) {
  const s = sizes(readFileSync(join(dist, f)));
  total = { raw: total.raw + s.raw, gz: total.gz + s.gz, br: total.br + s.br };
  console.log(`  ${f.padEnd(44)} ${kb(s.raw).padStart(8)} ${kb(s.gz).padStart(8)} gz ${kb(s.br).padStart(8)} br`);
}
console.log(`  ${'TOTAL'.padEnd(44)} ${kb(total.raw).padStart(8)} ${kb(total.gz).padStart(8)} gz ${kb(total.br).padStart(8)} br`);
const lazy = readdirSync(join(dist, 'assets')).filter((f) => f.endsWith('.js') && !seen.has(join('assets', f)));
console.log(`lazy chunks (${lazy.length}):`);
for (const f of lazy.sort()) console.log(`  ${f.padEnd(44)} ${kb(readFileSync(join(dist, 'assets', f)).length).padStart(8)}`);
