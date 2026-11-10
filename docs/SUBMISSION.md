# Shadowplay: submission pack

Meta VR Start Developer Competition 2026. Deadline **18 Nov 2026, 12:00 PT**.
Plan: submit on **17 Nov** and freeze the hosted build. Judging uses the build as
it stands at the deadline.

## Devpost form

**Name**
Shadowplay: Bedtime Across the World

**Tagline** (131 of 140 characters)
Bedtime stories told with your hands, for a child far away: shadow puppets on your wall, watched, joined in and answered from home.

**Track / division**
Entertainment / New Experience

**Target launch date**
Live now as a public web beta (link below). Horizon Store release as a PWA in Q1 2027, with more stories.
*(Your call: change if you plan differently.)*

**Links**
- Experience (open in the Meta Quest browser): https://shadowplay-1031148889398.us-central1.run.app
- Family viewer (phone, tablet or desktop): https://shadowplay-1031148889398.us-central1.run.app/?viewer
- Video: *(YouTube/Vimeo link after upload, public or unlisted as the rules allow)*

### Description (about 500 words)

Every night, millions of parents say goodnight from far away: on deployment,
working abroad, across an ocean. A video call at bedtime is something, but it is
not a story. Shadowplay lets a parent tell one with their hands.

The parent puts on a Meta Quest. A small lamp appears on their real desk, the room
dims like a theatre, and the shadows of their real, tracked hands fall on their
real wall. When the story needs a character, they make its shape, and the shadow
comes alive: a rabbit that hops where their hand goes, a fish that grows as they
move closer to the lamp, a bird made of two hands, a deer, a crocodile. A small moth
called Mo rides on each creature through the story. There are five narrated
stories, from a twenty-minute adventure to a three-minute count to five for the
littlest ones, chosen from a library in the headset.

Then the story travels. The parent can **record** it (their hands, the story and
their own voice) and **send** it with a private three-word family code. At home,
the child opens it on a phone or tablet and watches the story play on their
screen, in their parent's voice, with their name in it. At every shape the story
can wait for them: they **join in** with their own hands through the camera, and
their shadow wakes the creature. When it ends, a goodnight card says "Goodnight,
Mia. Love, Dad", and the child can **send a goodnight back**: twenty seconds of
their own shadow creature and their voice, which plays on the parent's wall the
next time they put on the headset.

Families can also **go live**. The child joins with the code and sees the
parent's shadows in real time, they talk, and with **take turns** on, the child
makes every other creature, appearing on both screens. Live survives bad
connections: the room waits for a parent whose network drops, and the voice
catches back up.

Shadowplay is built with the Immersive Web SDK. Plane detection finds the wall
ahead (with a floating screen fallback), a real-time shadow map casts capsule
models of the tracked hands, and two recognition methods, joint-angle templates
and silhouette matching, decide when a shadow matches a character. The story never
fails: if a shape is hard, it waits, shows a hint and gradually becomes more
forgiving. On the family side, hand tracking runs on the device in the browser.

It is safe by design. There are no accounts and nothing is public: a story is
reachable only by its family code and is deleted after thirty days. The camera
starts only after a grown-up allows it, and video never leaves the device; only
hand positions are used. The microphone opens only when someone presses record
or talk.

No controllers, no menus to learn, no text walls. Everyone already knows how to
make a shadow rabbit. Shadowplay turns that into a bedtime story that reaches a
child wherever they are.

### Hand-interaction notes

- Hands only, from start to finish: no controller is ever needed. If controllers
  are detected without hands, the story pauses and asks the player to put them
  down.
- Shapes: open hand, rabbit (with an easier "ears" variant), fish, dog, bird (two
  hands), cupped hands (two hands), snail, swan, deer (two hands), crocodile (two
  hands). Recognition fuses joint angles with silhouette matching.
- Moving the hand moves the creature (carry), and moving it closer to the lamp
  grows its shadow (grow). An open hand continues; opening cupped hands lets the
  light go.
- The desk lamp is moved with a pinch-drag along the desk; pinching its switch
  pauses and resumes.
- Panels (settings, story picker, record, send, go live, talk, take turns,
  goodnights) are pressed with hand rays (pinch).
- Accessibility: recognition tolerance, show-me hints, a one-hand mode for two-hand
  shapes, and an assist ladder that loosens recognition after 20, 40 and 60
  seconds so no one gets stuck.
- Works seated within arm's reach: the stage is straight ahead, the hands work just
  above the desk.

## How judges can try it

1. **In a Quest:** open the experience link in the Meta Quest browser and press
   Enter XR. Put controllers down. Raise a hand into the lamplight; the story
   begins.
2. **Alone? There is a sample family.** Pinch the Shadow Journal (the book on the
   desk), then **Goodnights**: a goodnight from Mia is waiting. **Tonight's story**
   lists all five stories.
3. **On a phone or tablet:** open the family viewer link and tap the sample story
   from Dad. Tap **Join in** and allow the camera to make the shapes yourself.
4. **Live, with two devices:** in the headset, press **Go live** and read the
   code; on the phone, type it and tap **Join live**.

## Video

- File: `shadowplay-video.mp4` in the project folder (2:33, 1920x1080, 30 fps).
  Remake with `node scripts/video/capture.mjs` then
  `python3 scripts/video/assemble.py`.
- Footage: the running app and the IWSDK Meta Quest emulator (the rules allow the
  XR simulator), no AI-generated video. The closing card says so.
- Audio: sample voices generated with Kokoro (Apache-2.0); the music is an
  original music-box lullaby synthesised for this video.
- Upload to YouTube or Vimeo as public and paste the link above.

## Screenshots

`docs/submission/` (1920x1080, from the video):
1. `1-two-screens.png`: Dad's wall and Mia's tablet, the same story in sync
2. `2-headset.png`: the story on the wall in the emulated headset
3. `3-cupped-hands.png`: catching the goodnight in cupped hands
4. `4-goodnight-card.png`: the goodnight card and "Send a goodnight back"
5. `5-goodnight-from-mia.png`: Mia's goodnight on Dad's wall

## Rules checklist

| Rule | Status |
| --- | --- |
| Public HTTPS link live until the winners are announced (~11 Dec) | Cloud Run, scales to zero; keep the project and billing active until then |
| Video under 3 minutes, real footage or XR simulator | 2:33, emulator and app footage |
| English | Yes |
| No identifiable real people | Yes (Dad and Mia are fictional; no faces) |
| No third-party brand names or logos | Only the platform (Meta Quest, IWSDK) is named |
| Music, art, fonts licensed or original | Original art and music; Inter (OFL) via uikit; Georgia from the device's system fonts (not bundled; video text rendered with the macOS system font) |
| Voice licences | Kokoro voices, Apache-2.0 (licence: github.com/hexgrad/kokoro) |
| Libraries | IWSDK, three.js, ws, uikit (MIT); MediaPipe hand tracking (Apache-2.0) |
| Hands-first | Entire experience without a controller |
| 60 fps floor on Quest | Measured only in simulation (70 draw calls, 39k triangles, ~0.6 ms of app work per frame on desktop); not measured on a Quest |

## Before submitting (16-17 Nov)

- [ ] Watch the video once more; upload; paste the link.
- [ ] Freeze: tag the deployed commit (for example `git tag v1.0.0 && git push --tags`)
      and do not deploy after the deadline.
- [ ] Run `node scripts/sim/smoke.mjs https://shadowplay-1031148889398.us-central1.run.app`.
- [ ] Open the link once in a phone browser and once in Chrome on a desktop.
- [ ] Confirm the Google Cloud project and billing stay active until judging ends.
- [ ] Fill in the Devpost form from this page.

## Known risks (for you, not for the form)

- It has never run on a physical Quest. Everything was verified in the IWSDK
  emulator and in simulation (two-browser families, network impairment, bot
  playtesters, a deployed smoke test).
- Real two-person voice and a real child's hands through a camera have only been
  tested with Chrome's fake devices.
