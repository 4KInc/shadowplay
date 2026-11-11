# Shadowplay: Bedtime Across the World

**Bedtime stories told with your hands, for a child who is far away.**

A parent puts on a Meta Quest and tells a shadow-puppet story on their own wall:
a virtual desk lamp throws the shadows of their real, tracked hands, and when
they make a rabbit, a fish or a bird, the shadow comes alive and carries the
story on. Their child, at home on a phone or tablet, watches it, plays along with
their own hands through the camera, and sends a goodnight back.

For the soldier on deployment, the parent working in another country, the
grandparent across an ocean.

Built with [IWSDK](https://iwsdk.dev) (WebXR) for the Meta VR Start Developer
Competition 2026 (Entertainment track). The full concept and build notes are in
[docs/shadowplay-idea-brief.pdf](docs/shadowplay-idea-brief.pdf).

## Try it

| | |
| --- | --- |
| In a Meta Quest browser | https://shadowplay-1031148889398.us-central1.run.app (press **Enter XR**) |
| Family viewer (phone, tablet, desktop) | https://shadowplay-1031148889398.us-central1.run.app/?viewer |

On first launch both sides come with a labelled sample family, so you can try
everything alone: the viewer has a story *from Dad* to watch and join in, and the
headset has a goodnight *from Mia* waiting (pinch the Shadow Journal on the desk,
then **Goodnights**).

## What it does

**In the headset (the storyteller)**
- A stage on your real wall, found from the room's detected planes, with the room
  dimmed like a theatre and a lamp you can drag to sweep the light.
- Two narrated stories: *The Moth Who Borrowed Light* (five chapters, a branching
  wolf encounter, a lighthouse finale) and *Goodnight Across the Sea* (six
  minutes, written for families apart). Eleven hand shapes, from a rabbit to a
  two-handed crocodile; the story never fails, it waits and helps.
- **Record a story** (hands, story and your voice) and **Send to family**: a
  private three-word family code, no accounts.
- **Go live**: your family joins with the code and sees your shadows on their
  screen in real time; talk to each other; **Take turns** so the child makes
  every other creature.
- **Goodnights**: what your family sent back plays on your wall.
- Accessibility: recognition tolerance, show-me hints, one-hand mode.

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

## How it works

```
Quest (WebXR, IWSDK)                                  Phone / tablet (same web app, ?viewer)
  hand joints -> capsule shadow casters                  recorded or live hands -> the same stage
  joint-angle + silhouette shape recognition             MediaPipe hands (camera, on device)
  story engine (JSON beats)  --story tap-->  recorder ----> /api/stories (family code)
                                         \-> Live -------> /live WebSocket room <---- Live
```

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
npm test           # typecheck, server tests, recognition sweep
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
| `node scripts/sim/playtest.mjs` | Bot children (perfect, small hands, shaky, wrong shape first, slow, wanderer) play the whole story: no stalls, help arrives, render and CPU budgets |
| `node scripts/sim/smoke.mjs <url>` | A deployed site end to end |

Peak load measured through a whole story: 70 draw calls, 39k triangles, about
0.6 ms of app work per frame (desktop), far inside Quest budgets.

## Status

Complete and deployed; tested in the IWSDK Quest emulator and in simulation.
Not yet run on a physical Quest.
