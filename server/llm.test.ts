import assert from 'node:assert/strict';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { after, before, test } from 'node:test';
import { Coach } from './coach.ts';
import { assembleStory, Dreamer } from './dream.ts';
import { Llm } from './llm.ts';
import { cannedWords } from '../tests/fixtures/dream-words.mjs';

/**
 * A stand-in that speaks both providers' Messages format and records each
 * request. Muse Spark replies start with a thinking block, as a reasoning
 * model's do; an anthropic-version header is refused, as Meta documents.
 */
const seen: { path: string; headers: IncomingHttpHeaders; body: Record<string, unknown> }[] = [];
let stub: Server;
let base = '';

before(async () => {
  stub = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw);
      seen.push({ path: req.url ?? '', headers: req.headers, body });
      if (req.headers['x-goog-api-key']) {
        // Gemini: generateContent, a thought part before the answer.
        const user = body.contents[0].parts[0].text as string;
        const shapes = /shapes: ([a-z, ]+)\./.exec(user)?.[1].split(', ');
        const text = shapes ? cannedWords(shapes) : 'Tuck your thumb along your hand, like a fin.';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Thinking about fins...', thought: true }, { text }] } }] }));
      }
      const meta = String(req.headers.authorization ?? '').startsWith('Bearer ');
      if (meta && req.headers['anthropic-version']) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'anthropic-version is not supported' }));
      }
      const user = (body.messages as { content: string }[])[0].content;
      const shapes = /shapes: ([a-z, ]+)\./.exec(user)?.[1].split(', ');
      const text = shapes ? cannedWords(shapes) : 'Tuck your thumb along your hand, like a fin.';
      const content = meta ? [{ type: 'thinking', thinking: 'The child needs a short tip...' }, { type: 'text', text }] : [{ type: 'text', text }];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ content }));
    });
  });
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
  const address = stub.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});
after(() => stub.close());

test('meta: Bearer token, no anthropic-version, reasoning effort and room for it; text after the thinking block', async () => {
  const coach = new Coach(new Llm('meta', 'meta-key', base), 'muse-spark-1.3');
  const tip = await coach.tip({ shape: 'fish', facts: ['thumb-tuck'], attempt: 0 });
  assert.deepEqual(tip, { line: 'Tuck your thumb along your hand, like a fin.', source: 'ai' });
  const r = seen.at(-1)!;
  assert.equal(r.path, '/v1/messages');
  assert.equal(r.headers.authorization, 'Bearer meta-key');
  assert.equal(r.headers['x-api-key'], undefined);
  assert.equal(r.headers['anthropic-version'], undefined);
  assert.equal(r.body.model, 'muse-spark-1.3');
  assert.deepEqual(r.body.thinking, { type: 'adaptive' });
  assert.deepEqual(r.body.output_config, { effort: 'low' });
  assert.ok((r.body.max_tokens as number) > 1000, 'room for reasoning as well as the tip');
});

test('meta: a dreamed story, at medium effort', async () => {
  const req = { theme: 'forest', shapes: ['rabbit', 'cup'] };
  const story = await new Dreamer(new Llm('meta', 'meta-key', base), 'muse-spark-1.3').dream(req);
  assert.deepEqual(story, assembleStory(req, cannedWords(req.shapes)));
  assert.deepEqual(seen.at(-1)!.body.output_config, { effort: 'medium' });
});

test('anthropic: x-api-key and anthropic-version, no reasoning fields', async () => {
  const coach = new Coach(new Llm('anthropic', 'claude-key', base), 'claude-haiku-4-5-20251001');
  assert.equal((await coach.tip({ shape: 'fish', facts: ['thumb-tuck'], attempt: 1 })).source, 'ai');
  const r = seen.at(-1)!;
  assert.equal(r.headers['x-api-key'], 'claude-key');
  assert.equal(r.headers['anthropic-version'], '2023-06-01');
  assert.equal(r.headers.authorization, undefined);
  assert.equal(r.body.thinking, undefined);
  assert.equal(r.body.max_tokens, 80);
});

test('gemini: generateContent with x-goog-api-key, minimal thinking for a tip; the thought part is skipped', async () => {
  const coach = new Coach(new Llm('gemini', 'gemini-key', base), 'gemini-3.5-flash-lite');
  assert.deepEqual(await coach.tip({ shape: 'fish', facts: ['thumb-tuck'], attempt: 2 }), { line: 'Tuck your thumb along your hand, like a fin.', source: 'ai' });
  const r = seen.at(-1)!;
  assert.equal(r.path, '/v1beta/models/gemini-3.5-flash-lite:generateContent');
  assert.equal(r.headers['x-goog-api-key'], 'gemini-key');
  assert.equal(r.headers.authorization, undefined);
  const config = r.body.generationConfig as { thinkingConfig: { thinkingLevel: string }; maxOutputTokens: number };
  assert.equal(config.thinkingConfig.thinkingLevel, 'minimal');
  assert.ok(config.maxOutputTokens > 1000);
  assert.match(JSON.stringify(r.body.systemInstruction), /You are Mo/);
});

test('gemini: a dreamed story at low thinking', async () => {
  const req = { theme: 'river', shapes: ['fish', 'dog'] };
  assert.deepEqual(await new Dreamer(new Llm('gemini', 'gemini-key', base), 'gemini-3.8-flash').dream(req), assembleStory(req, cannedWords(req.shapes)));
  assert.equal((seen.at(-1)!.body.generationConfig as { thinkingConfig: { thinkingLevel: string } }).thinkingConfig.thinkingLevel, 'low');
});

test('labels name the provider', () => {
  assert.equal(new Llm('gemini', 'k').label, 'gemini');
  assert.equal(new Llm('meta', 'k').label, 'muse-spark');
  assert.equal(new Llm('anthropic', 'k').label, 'claude');
});
