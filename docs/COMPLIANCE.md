# Compliance audit: Official Rules, section 4 (Entry Requirements)

Audit of Shadowplay against section 4 of the Meta VR Start Developer
Competition 2026 Official Rules (start-developer-competition-26.devpost.com/rules),
as of 11 Nov 2026. Fixed in this pass: two in-app strings that named the
headset brand, and the missing in-app credits. Everything else below was
already compliant; items only a headset can confirm are in
[DEVICE-TEST.md](DEVICE-TEST.md).

## Entry basics

| Requirement | Shadowplay | Status |
| --- | --- | --- |
| VR/MR application for Meta VR devices | WebXR (IWSDK) mixed-reality app for Quest 3 / 3S in Quest Browser | OK |
| Track | Entertainment (immersive storytelling) | OK |
| Division: New Experience, conceived and built in the window (from 24 Sep 2026) | First commit 29 Sep 2026 (`git log --reverse`); no earlier codebase | OK |
| IWSDK submission: a link judges can open | https://shadowplay-1031148889398.us-central1.run.app (Cloud Run, one instance kept warm for judging, see [DEPLOY.md](DEPLOY.md)) | OK |
| Free, available until the winner announcement | No payment, no account, no sign-in | OK |
| Video under 3:00, public on YouTube or Vimeo, footage on a Quest or an emulator | Workstream 8 ([VIDEO.md](VIDEO.md)) | To do (WS8) |
| Text: inspiration, how it was built, future plans, target launch date | Workstream 8 ([DEVPOST.md](DEVPOST.md)) | To do (WS8) |
| Permitted tools (public SDKs only) | IWSDK 1.0.0-rc.2 (public npm), three.js, uikit, MediaPipe, Kokoro; no unreleased Meta APIs | OK |
| Not a wrapper around a third-party service | Everything runs in the app or on our own small server; no external AI or media service at runtime | OK |
| No Meta funding | None | OK (entrant to confirm) |

## Content Experience Requirements

### Hands-first: "Can someone complete the entire experience without ever pairing a controller?"

Yes. Holding controllers is the one thing the app pushes back on: after a
second the story pauses with "Shadowplay is played with your hands. Put your
controllers down and let the headset see your hands." Every interaction:

| Interaction | How with hands | Evidence |
| --- | --- | --- |
| Open the link, Enter XR, family names, One-hand mode, Forgiving shapes, Credits | Quest Browser page: tap with the hand pointer (system pinch); the system keyboard for names | Standard browser UI |
| Stage placement | Automatic (wall ahead or paper screen); "Move stage here" in Settings | `scripts/sim/rooms.mjs` (pinch) |
| Lamp on / off | Pinch the switch on the lamp base (direct pinch from the hand joints) | `scripts/sim/hands-only.mjs` |
| Move the light | Pinch the lamp and drag it along the desk | `hands-only.mjs` |
| Open / close the Shadow Journal (and with it Settings) | Pinch the book on the desk | `hands-only.mjs` |
| All Settings and family buttons (story picker, chapters, recognition tolerance, hints, one-hand mode, Move stage here, Replay, Goodnights, Take turns, Record, Send, Go live, Talk) | Hand ray and pinch on the panel | `hands-only.mjs`: 22 of 26 pressed in the emulator; Record, Send, Go live and Talk are the same buttons, not pressed in automation because they open the microphone or a Live room |
| Story: follow (Mo follows a fingertip), shape requests (rabbit, fish, dog, bird, cup, snail, swan, deer, crocodile), choices, grow (move toward the lamp), carry, reveal, release, let go | Hand tracking: joint-angle recognition, both hands or one (one-hand mode) | `npm run test:recognition`, `scripts/sim/playtest.mjs` |
| Live: talk, take turns | Panel buttons (above); turns pass by making shapes | `scripts/sim/live-family.mjs` |
| Free Stage | Any shape wakes its creature | `playtest.mjs` (finishes in Free Stage) |

The family viewer (`?viewer`) is a phone or tablet page (touch), not the headset
experience; its optional "Join in" uses the phone camera to see the child's hands.

### Seated, easy in and out

- Seated by design: the lamp and journal sit on the desk within reach, the stage
  on the wall ahead (about 33 degrees wide); nothing needs standing or walking
  (the "airplane seat test").
- Cold start: about 555 KB to first render (WS3). A complete moment, the first
  creature waking, comes about 50 s after Enter XR; a chapter takes a few
  minutes (the "one bus stop test").
- Pause and resume: the Quest menu or taking the headset off pauses story,
  narration, sound and Live voice and resumes on the same line; a session that
  ends mid-story continues from that chapter next time (WS6,
  `scripts/sim/session-life.mjs`).

## Policies and content

### Identifiable people

- No real people are named or shown. The story characters (Mo the moth, the
  little dog, the wolf, the lighthouse keeper, the crocodile and others) are
  original.
- The samples are "Dad" and "Mia": generic names, as the brief allows. The
  family-name placeholders ("e.g. Mia", "e.g. Dad, Grandma Rosa") are generic
  examples.
- Every narration clip is a synthetic voice (Kokoro, voice `af_heart`), not a
  recording of a person. The sample stories' hands are the app's own synthetic
  hands.
- The user's own content (their recorded stories, family names, Live sessions)
  is private to their family: reachable only by a private code, deleted after
  30 days, never listed publicly.

### Brands, logos, commercial artwork, advertising

Searched every story file, the narration manifest, the panel markup, the page
and all UI strings in `src/` for brand and product names.

| Finding | Action |
| --- | --- |
| Browser title card: "Put on your Meta Quest and press Enter XR to begin." | **Fixed**: "Put on your headset and press Enter XR to begin." |
| Start-up error: "...or open it in the Meta Quest browser." | **Fixed**: "...or open it in the browser on your headset." |
| Library names (MediaPipe, Kokoro, Inter, Lucide, three.js, IWSDK, uikit) | Attribution only, in Credits and the README, as their licences require |
| "Quest" in code comments and the `?diag` developer overlay (device detection) | Not user-facing content; left as is |

No logos, no branded products, no commercial artwork, no advertising. All
visuals are built in code (`src/scene-assets/`, procedural shadow puppets and
scenery); the sound effects are synthesised in the browser; there are no image
or 3D model files from anywhere else.

### Third-party licences

| Work | Licence | Where attributed |
| --- | --- | --- |
| Kokoro-82M (narration, generated offline) | Apache-2.0 | App Credits, README |
| MediaPipe Hand Landmarker model and Tasks Vision runtime | Apache-2.0 | App Credits, README, `public/models/NOTICE.md` |
| Inter typeface (via `@pmndrs/msdfonts`) | SIL OFL 1.1 | App Credits, README |
| Lucide icons (two) | ISC | App Credits, README |
| three.js | MIT | App Credits, README |
| Immersive Web SDK | MIT | App Credits, README |
| uikit, uikit-horizon | MIT | App Credits, README |

**Fixed**: the app had no in-app credits. There is now a **Credits** button on
the first screen and in the family viewer (`src/credits.ts`), listing the same
works as the README's new "Credits and licences" section. No Creative Commons or
other third-party media is used. Georgia, the page typeface, is a system font
and is not shipped.

### Language

English only: every story, caption, narration clip, panel and page string.
Captions are on for all narration.

### Content rating (10+ or lower)

Bedtime stories for families. The only peril is gentle and resolved kindly: a
wolf on the path that runs away from a big shadow dog or falls asleep under a
shadow bird, a storm that passes, a little dog that is scared and brave anyway.
No violence, injury, frightening imagery, profanity, romance or commercial
content. The user content is private family recordings and live calls between
family members who share a code. Suitable for 10+ (and younger with a parent,
which is the intended use).

### Privacy (README guarantees, unchanged)

The README's privacy guarantees stand exactly as written: no accounts, camera
video never leaves the device, the microphone opens only on Record with voice
or Talk, Live rooms store nothing. Diagnostics run only with `?diag` and send
numbers and short identifiers only (`server/diag.ts`).

## Device checks added

- E11 (DEVICE-TEST.md): "After 15 s" (Show-me hints) presses reliably by hand ray. In the
  emulator it needed aiming 1.5 cm off its centre; every other button pressed
  dead centre.
