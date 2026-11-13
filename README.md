# Shadowplay: Bedtime Across the World

**Bedtime stories told with your hands, for a child who is far away.**

Hands only, no controllers. Seated. Works on any wall, or none.

**Video:** _link added with the submission_
<!-- Hero image: docs/hero.jpg, a still from the headset capture (added after the device sessions). -->

A parent puts on a Meta Quest and tells a shadow-puppet story on their own wall:
a virtual desk lamp throws the shadows of their real, tracked hands, and when
they make a rabbit, a fish or a bird, the shadow comes alive and carries the
story on. Their child, at home on a phone or tablet, watches it, plays along with
their own hands through the camera, and sends a goodnight back.

For the soldier on deployment, the parent working in another country, the
grandparent across an ocean.

Built with [IWSDK](https://iwsdk.dev) (WebXR) for the Meta VR Start Developer
Competition 2026 (Entertainment track, New Experience division).

## Try it

| | |
| --- | --- |
| In a Meta Quest browser | https://shadowplay-1031148889398.us-central1.run.app (press **Enter XR**) |
| Family viewer (phone, tablet, desktop) | https://shadowplay-1031148889398.us-central1.run.app/?viewer |

On first launch both sides come with a labelled sample family, so you can try
everything alone: the viewer has a story *from Dad* to watch and join in, and the
headset has a goodnight *from Mia* waiting (pinch the Shadow Journal on the desk,
then **Goodnights**).

### Your first minute

1. Open the link in the Quest Browser, press **Enter XR** and allow room access
   (it finds your wall).
2. **Keep the room lights on.** Shadowplay dims the room for you, and hand
   tracking needs light.
3. Put the controllers down. Raise a hand into the lamplight: Mo the moth follows
   your fingertip. When asked, make the shape the ghost hand shows and hold it
   still for a moment; the shadow comes alive.

Two fallbacks: with no wall straight ahead, the story plays on a floating paper
screen; if the stage lands somewhere odd, pinch the book on the desk, then
**Move stage here**, and look at the wall you want.

## What it does

**In the headset (the storyteller)**
- A stage on your real wall, found from the room's detected planes (a floating
  paper screen when there is no usable wall, and **Move stage here** to put it
  where you look), with the room dimmed like a theatre and a lamp you can drag
  to sweep the light.
- Five narrated stories, picked from the journal: *The Moth Who Borrowed Light*
  (twenty minutes in chapters, a branching wolf encounter, a lighthouse finale),
  *Goodnight Across the Sea*, *The Letter That Took the Slow Way*, *The Brave
  Little Dog* and *Counting Stars* (three minutes, for the littlest ones).
  Eleven hand shapes, from a rabbit to a two-handed crocodile; the story never
  fails: it shows a ghost hand, waits, and becomes more forgiving.
- **Record a story** (hands, story and your voice) and **Send to family**: a
  private family code (three words and a number, like `lantern-otter-moss-417`),
  no accounts.
- **Go live**: your family joins with the code and sees your shadows on their
  screen in real time; talk to each other; **Take turns** so the child makes
  every other creature.
- **Goodnights**: what your family sent back plays on your wall.
- Accessibility: recognition tolerance, show-me hints, one-hand mode (one-hand
  mode and forgiving shapes are also on the first screen, before entering XR).
- Pauses when you open the Quest menu or take the headset off, and picks up on
  the same line; a story left mid-way continues from its chapter next time.

**On the phone or tablet (the family)**
- Watch a story someone recorded for you, in their voice, with your name in it.
- **Join in**: at each shape the story waits for *your* hands (camera, after a
  grown-up allows it).
- **Join live** with a family code; talk, show your hands, take turns.
- **Send a goodnight back**: twenty seconds of your shadow creature and, if a
  grown-up switches it on, your voice.

## Privacy and safety

- No accounts and no public listing. A shared story is reachable only by its
  private family code and is deleted after 30 days.
- The camera starts only after a grown-up allows it on that device. Video never
  leaves the device; only hand positions are used (and, in Live, sent).
- The microphone opens only when the person presses Record with voice or Talk.
- Live rooms hold one storyteller and one family member. The server relays only
  protocol messages and stores nothing.
- Uploads are strictly validated; rate limits and room limits are per client.
- Diagnostics are off unless the page is opened with `?diag`; then it sends
  anonymous technical data (frame times, quality level, recognition results,
  room detection, device type and error messages), never audio, video, names
  or family codes.

## How it works

```
Quest (WebXR, IWSDK)                                  Phone / tablet (same web app, ?viewer)
  hand joints -> capsule shadow casters                  recorded or live hands -> the same stage
  joint-angle shape recognition                          MediaPipe hands (camera, on device)
  story engine (JSON beats)  --story tap-->  recorder ----> /api/stories (family code)
                                         \-> Live -------> /live WebSocket room <---- Live
```

- **Stage** (`src/stage-setup.ts`, `src/wall-choice.ts`): picks the wall straight
  ahead (labelled walls first, clear of doors and windows) or a paper screen;
  adaptive quality steps down in four levels if frames are missed, judged
  against the headset's refresh rate.
- **Recognition** (`src/hand-features.ts`, `src/recognition-rules.ts`): smoothed
  joint angles matched to per-shape templates, with pair rules for two-hand
  shapes and a resting-hand reject; a shape must be held half a second.
- **Performance stream** (`src/performance/`): both hands at 30 Hz in
  stage-relative millimetres, story beats, creature wakes and releases, lamp and
  staging events, plus voice. It replays on any stage, any size.
- **Live** (`src/live/`): the same events and 20 Hz hands over a WebSocket room;
  16 kHz voice through AudioWorklets with an adaptive jitter buffer; reconnects
  through dropouts (the room waits 45 s for the storyteller).
- **Server** (`server/`): one Node process (TypeScript run directly) serves the
  app, the sharing API and Live rooms; stories live on disk locally or in a Cloud
  Storage bucket in production. See [docs/DEPLOY.md](docs/DEPLOY.md).
- **Narration** is generated with [Kokoro](https://github.com/hexgrad/kokoro)
  (Apache-2.0), locally, by `scripts/narration/generate.py`; recorded clips can
  replace it at any time.

## Credits and licences

The stories, characters, shadow puppets, lamp, scenery and sound effects are
original to Shadowplay (the sound is synthesised in the browser; the models are
built in code). It uses:

| Work | Used for | Licence |
| --- | --- | --- |
| [Kokoro-82M](https://github.com/hexgrad/kokoro) (hexgrad) | the storyteller voice, generated offline into `public/narration/` | Apache-2.0 |
| [MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) (Google) | camera hands in the family viewer, on the device; see `public/models/NOTICE.md` | Apache-2.0 |
| [Inter](https://rsms.me/inter/) (The Inter Project Authors) | typeface of the headset panels (via `@pmndrs/msdfonts`) | SIL OFL 1.1 |
| [Lucide](https://lucide.dev) (Lucide Contributors) | two interface icons | ISC |
| [three.js](https://threejs.org) | 3D rendering | MIT |
| [Immersive Web SDK](https://github.com/facebook/immersive-web-sdk) (Meta Platforms, Inc.) | WebXR framework | MIT |
| [uikit](https://github.com/pmndrs/uikit) (Bela Bohlender) | headset user interface | MIT |

The same list is in the app: **Credits** on the first screen and in the family viewer.

## Develop

```sh
npm install
npm run dev        # IWSDK dev server + managed browser with the Quest emulator (https://localhost:8082)
npm run server     # sharing API and Live rooms on :8787 (the dev server proxies /api and /live)
npm test           # typecheck, unit tests, server tests, recognition sweep
```

`iwsdk.config.json` is the project authority (scene, assets, XR features);
systems are registered in `src/index.ts`. See `AGENTS.md` for IWSDK conventions.

### Simulations (no headset, no second person)

Everything family-facing was tested without a Quest or a second person, using
headless browsers, the IWSDK emulator and Chrome's fake camera and microphone
(files, never real devices). With the dev server running:

| Script | What it proves |
| --- | --- |
| `node scripts/sim/live-family.mjs` | A parent and a child in two browsers through a degraded network (delay, jitter, a dropout): story sync, hands, voice both ways, duet turns, reconnects |
| `node scripts/sim/voice-lab.mjs` | Mouth-to-ear voice delay per network condition (56 ms on a clean line) |
| `node scripts/sim/playtest.mjs` | Bot children (perfect, small hands, shaky, wrong shape first, slow, wanderer) play the whole story: no stalls, help arrives; fails if draw calls, triangles or shadow casters exceed the budget |
| `node scripts/sim/rooms.mjs` | 17 room cases with fake planes: no planes, floor only, walls too close, too far or at a steep angle, doors and windows, late room data, recenter, Move stage here by pinch |
| `node scripts/sim/session-life.mjs` | First-screen options, Quest menu and headset off mid-line, the first ghost hand, continuing next launch |
| `node scripts/sim/hands-only.mjs` | Every interaction with emulated hands and no controllers: journal and lamp by pinch, every panel button by hand ray |
| `node scripts/sim/narration-stall.mjs` | A narration clip whose download stalls does not stall the story |
| `node scripts/sim/first-minutes.mjs` | Time from Enter XR to the first creature on a first launch |
| `node scripts/sim/smoke.mjs <url>` | A deployed site end to end, including the family viewer and diagnostics in a browser |

Peak load measured through a whole story at full quality: 72 draw calls, 41k
triangles, about 0.6 ms of app work per frame (desktop), with a budget enforced
by the playtest.

### Device testing

Open the app with `?diag` for an overlay under the stage (frame times, quality
level, hands and recognition, room detection) and diagnostics sent to the
server: numbers and short identifiers only, never audio, video or names. Without
`?diag` none of it loads. After a session, `scripts/diag/pull.sh` fetches and
summarizes it. Builds for headset sessions deploy beside the public one with
their own URL (see [docs/DEPLOY.md](docs/DEPLOY.md)); the checklist is
[docs/DEVICE-TEST.md](docs/DEVICE-TEST.md).

## Status

Complete and deployed, and hardened for the competition: diagnostics,
performance, cold start (about 560 KB to first render), recognition, untested
rooms, the first five minutes, and compliance with the rules. Tested in the IWSDK
Quest emulator and in simulation.
Not yet run on a physical Quest.
