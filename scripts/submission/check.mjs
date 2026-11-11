// Submission text checks: the Devpost tagline (140 characters at most), the
// "about" text (500 words at most) and the video shot list (2:55 at most,
// shots back to back). Run after editing docs/DEVPOST.md or docs/VIDEO.md.
//   node scripts/submission/check.mjs
import { readFileSync } from 'node:fs';

const devpost = readFileSync('docs/DEVPOST.md', 'utf8');
const video = readFileSync('docs/VIDEO.md', 'utf8');
const block = (text, name) => {
  const m = text.match(new RegExp(`<!-- ${name} -->([\\s\\S]*?)<!-- /${name} -->`));
  if (!m) throw new Error(`missing <!-- ${name} --> block`);
  return m[1].trim();
};
const problems = [];

const tagline = block(devpost, 'tagline');
console.log(`tagline: ${tagline.length} / 140 characters`);
if (tagline.length > 140) problems.push('tagline over 140 characters');

// Words as Devpost counts them: the visible text, without markdown headings' hashes.
const about = block(devpost, 'about').replace(/^#+\s*/gm, '');
const words = about.split(/\s+/).filter(Boolean).length;
console.log(`about: ${words} / 500 words`);
if (words > 500) problems.push('about text over 500 words');

const toS = (t) => t.split(':').reduce((a, v) => a * 60 + Number(v), 0);
let last = 0;
let n = 0;
for (const row of block(video, 'shots').split('\n').slice(2)) {
  const m = row.match(/^\|\s*(\d+)\s*\|\s*([\d:]+)-([\d:]+)\s*\|/);
  if (!m) continue;
  n++;
  const [start, end] = [toS(m[2]), toS(m[3])];
  if (start !== last) problems.push(`shot ${m[1]} starts at ${m[2]}, previous ended at ${last} s`);
  if (end <= start) problems.push(`shot ${m[1]} ends before it starts`);
  last = end;
}
console.log(`video: ${n} shots, ${Math.floor(last / 60)}:${String(last % 60).padStart(2, '0')} / 2:55`);
if (last > 175) problems.push('video over 2:55');

if (problems.length) {
  console.error('\n' + problems.join('\n'));
  process.exitCode = 1;
} else console.log('ok');
