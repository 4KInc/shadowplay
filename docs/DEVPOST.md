# Devpost submission text

Copy each block into the Devpost form. Word and character counts are checked
by `node scripts/submission/check.mjs` (run it after any edit).

## Project name

Shadowplay: Bedtime Across the World

## Tagline

<!-- tagline -->
Tell a bedtime story with your hands, for a child far away: shadow puppets on your wall, watched, joined and answered from home.
<!-- /tagline -->

## Track and division

- Track: **Entertainment**
- Division: **New Experience**

## Links

- Experience (open in the Quest Browser): https://shadowplay-1031148889398.us-central1.run.app
- Family viewer (phone, tablet or computer): https://shadowplay-1031148889398.us-central1.run.app/?viewer
- Video: _YouTube or Vimeo link, public (see [VIDEO.md](VIDEO.md))_
- Code: https://github.com/4KInc/shadowplay

## Target launch date

<!-- Heartlin: fill in -->
_TBD by Heartlin (for example: "Public web beta now; Horizon Store web app in Q1 2027 with more stories")._

## About the project

<!-- about -->
### Inspiration

Every night, parents say goodnight from far away: on deployment, on a night shift,
across an ocean. A video call at bedtime is something, but it is not a story.
Everyone already knows how to make a shadow rabbit on a wall. We wanted that
oldest of bedtime games to reach a child wherever they are.

### What it does

The storyteller puts on a Quest. A little lamp appears on their real desk, the
room dims like a theatre, and the shadows of their real hands fall on their real
wall. When the story needs a character, they make its shape and the shadow comes
alive: a rabbit that hops where the hand goes, a fish that grows as it nears the
lamp, a bird made of two hands. Mo, a small moth, rides each creature through
five narrated stories, from a twenty-minute adventure to a three-minute count
for the littlest ones.

Then the story travels. The parent records it, hands and voice, and sends it
with a private family code. At home the child watches it on a phone or tablet,
joins in with their own hands through the camera, and sends a goodnight back
that plays on the parent's wall. Families can also go live: the child sees the
shadows as they happen, they talk, and they take turns making the creatures.

### How we built it

Shadowplay is a WebXR app built with the Immersive Web SDK. Plane detection
finds the wall straight ahead, with a floating paper screen when there isn't
one. The tracked hand joints become capsules that cast real-time shadows from
the lamp, and a recognizer compares smoothed joint angles with each shape's
template, so a shape counts only when it is held. The story never gets stuck:
it waits, shows a ghost hand, and slowly becomes more forgiving. Recordings
replay on any stage; Live rooms carry hands at 20 Hz and voice over a small
Node server. Narration was generated offline with an open-source voice model.

It is private by design: no accounts, nothing public, stories deleted after 30
days, camera video never leaving the device, the microphone opening only when
someone presses Record or Talk.

### What's next

More stories, recorded narration, more languages, and more creatures, including
ones families invent and teach the stage. Then a Horizon Store release.
<!-- /about -->

## How hand interactions work

<!-- hands -->
- **Hands only, start to finish.** No controller is needed at any point. If
  controllers are picked up, the story pauses and asks for hands.
- **Shapes are the input.** Open hand, rabbit, fish, dog, snail, swan, and
  two-hand bird, cupped hands, deer and crocodile. Joint angles are smoothed
  and matched to templates; a shape must be held about half a second, so
  resting hands never trigger anything.
- **Move to act.** Move your hand to carry Mo; bring it toward the lamp to grow
  the shadow; open cupped hands to let the light go.
- **Direct pinch** on real-feeling objects: the lamp switch (pause), the lamp
  itself (drag it along the desk to move the light), the Shadow Journal (open
  the creatures you've found and the settings).
- **Ray and pinch** for the panel: story picker, chapters, Record, Send, Go live,
  Talk, Take turns, Goodnights, Move stage here.
- **Accessibility:** one-hand mode (the bird with one open hand; one cupped
  hand is always enough for the cup), four recognition tolerances, show-me
  hints, and an assist ladder that loosens recognition after 20 and 40 seconds
  and, after 60, lets any steady hand in the light wake the creature (so the
  two-hand deer and crocodile never block anyone). One-hand mode and forgiving shapes
  are also on the first screen, before entering the headset view.
- **Seated within arm's reach.** The stage is straight ahead and about 33
  degrees wide; hands work just above the desk.
<!-- /hands -->

## Testing instructions for judges

<!-- testing -->
**In a Quest 3 or 3S (about 5 minutes)**

1. Open https://shadowplay-1031148889398.us-central1.run.app in the Quest
   Browser and press **Enter XR**. Allow room access (it finds your wall; without
   it the story plays on a floating paper screen).
2. Put the controllers down. The lamp lights up and the story begins: raise a
   hand into the light and Mo the moth follows your fingertip.
3. When asked, make a shadow rabbit (index and middle finger up, the others
   touching the thumb) and hold it still. A ghost hand shows you how.
4. Pinch the book on the desk (the Shadow Journal) to open your creatures and
   Settings. Try **Tonight's story** to pick one of five stories, and
   **Goodnights**: a goodnight from Mia (the sample family) is waiting.
5. If a shape is hard, press **Forgiving** in Settings, or **One-hand mode**.
   If the stage lands somewhere odd, look at a wall and press **Move stage
   here**.

**On a phone or tablet (the child's side)**

1. Open https://shadowplay-1031148889398.us-central1.run.app/?viewer and tap
   **A story from far away, from Dad** (a sample recording).
2. Watch it in Dad's voice; at a shape, tap **Join in** and allow the camera to
   make the shape with your own hands (video stays on the phone). At the end,
   **Send a goodnight back** records a goodnight for the parent.

**Live, with both devices:** in the headset, open the Journal and press **Go
live**; read the code. On the phone, type it and tap **Join live**. With **Take
turns** on, the phone makes every other creature.

No accounts or sign-in are needed anywhere.
<!-- /testing -->

## Screenshots

Six 1920x1080 stills in [`docs/submission/`](submission/), captured from the
running app (`node scripts/video/capture.mjs --stills`, dev server running):
the emulated Quest view with the emulator's own panels hidden, and the family
viewer. Upload them in this order:

1. `1-headset-rabbit.png`: the rabbit carries Mo across the field (the hand
   shapes at the edge are the player's hands in front of the stage)
2. `2-headset-bird.png`: two hands make a bird
3. `3-headset-cupped-hands.png`: the finale, holding the lighthouse light
4. `4-family-viewer.png`: the child's tablet, the story in Dad's voice
5. `5-goodnight-card.png`: the goodnight card and "Send a goodnight back"
6. `6-headset-journal-settings.png`: the Shadow Journal and Settings (story
   picker, one-hand mode, tolerances, Live)

When device footage exists, a mixed-reality still of shot 1 (real hand, real
shadow) should replace screenshot 1.
