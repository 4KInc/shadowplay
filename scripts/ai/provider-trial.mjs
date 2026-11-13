// Try the model behind Mo's tips and dreamed stories, with the server's own
// code (server/llm.ts, coach.ts, dream.ts), before switching a deploy to it:
// N tips (varied shapes and facts) and M dreamed stories, timed, counting how
// many fall back to the fixed lines or are refused. Stories are written out to
// read (submission/ai-trial/, local only).
//
//   META_API_KEY=... node scripts/ai/provider-trial.mjs meta [tips=30] [stories=20]
//   ANTHROPIC_API_KEY=... node scripts/ai/provider-trial.mjs anthropic 10 3
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Coach } from '../../server/coach.ts';
import { Dreamer, DREAM_SHAPES, THEMES } from '../../server/dream.ts';
import { DEFAULTS, Llm } from '../../server/llm.ts';

const provider = process.argv[2] === 'anthropic' ? 'anthropic' : 'meta';
const tips = Number(process.argv[3] ?? 30);
const stories = Number(process.argv[4] ?? 20);
const key = provider === 'meta' ? process.env.META_API_KEY : process.env.ANTHROPIC_API_KEY;
if (!key) throw new Error(`set ${provider === 'meta' ? 'META_API_KEY' : 'ANTHROPIC_API_KEY'}`);
const llm = new Llm(provider, key);
const coach = new Coach(llm, process.env.COACH_MODEL || DEFAULTS[provider].coachModel);
const dreamer = new Dreamer(llm, process.env.DREAM_MODEL || DEFAULTS[provider].dreamModel);
const OUT = join('submission', 'ai-trial', `${provider}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(OUT, { recursive: true });
const pct = (xs, p) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))] : 0);

const TIP_CASES = [
  ['rabbit', ['ring-curl', 'thumb-touch']], ['rabbit', ['index-straighten', 'middle-straighten']], ['fish', ['thumb-tuck']],
  ['fish', ['fingers-together', 'point-level']], ['dog', ['thumb-out']], ['dog', ['pinky-curl']], ['bird', ['one-hand-seen']],
  ['bird', ['hands-apart']], ['bird', ['fingers-curled', 'hands-stacked']], ['cup', ['index-curl']], ['cup', ['almost']],
  ['snail', ['thumb-touch']], ['swan', ['point-down']], ['rabbit', ['no-hands']], ['fish', ['almost']],
];
const lines = [];
const tipMs = [];
let local = 0;
for (let i = 0; i < tips; i++) {
  const [shape, facts] = TIP_CASES[i % TIP_CASES.length];
  const t0 = performance.now();
  const r = await coach.tip({ shape, facts, attempt: Math.floor(i / TIP_CASES.length) % 6 });
  tipMs.push(Math.round(performance.now() - t0));
  if (r.source === 'local') local++;
  lines.push(`${r.source.padEnd(5)} ${String(tipMs.at(-1)).padStart(5)} ms  ${shape} [${facts}]  ${r.line}`);
}
writeFileSync(join(OUT, 'tips.txt'), lines.join('\n') + '\n');
console.log(`tips: ${tips}, fell back ${local} (${Math.round((100 * local) / Math.max(1, tips))}%), median ${pct(tipMs, 0.5)} ms, p90 ${pct(tipMs, 0.9)} ms`);

const storyMs = [];
let refused = 0;
const themes = Object.keys(THEMES);
for (let i = 0; i < stories; i++) {
  const shapes = [...DREAM_SHAPES].sort(() => Math.random() - 0.5).slice(0, 2 + (i % 2));
  const theme = themes[i % themes.length];
  const t0 = performance.now();
  let story = null;
  try {
    story = await dreamer.dream({ theme, shapes });
  } catch (e) {
    console.log(`  story ${i + 1}: error ${e.message}`);
  }
  storyMs.push(Math.round(performance.now() - t0));
  if (!story) {
    refused++;
    continue;
  }
  const text = story.beats.filter((b) => b.text && b.type !== 'chapter').map((b) => `[${b.type}${b.shape ? '/' + b.shape : ''}] ${b.text}`);
  writeFileSync(join(OUT, `story-${String(i + 1).padStart(2, '0')}.txt`), `${story.title} (${theme}: ${shapes.join(', ')}) ${storyMs.at(-1)} ms\n\n${text.join('\n')}\n`);
}
console.log(`stories: ${stories}, refused ${refused}, median ${Math.round(pct(storyMs, 0.5) / 100) / 10} s, p90 ${Math.round(pct(storyMs, 0.9) / 100) / 10} s`);
console.log(`read them: ${OUT}`);
