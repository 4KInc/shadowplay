# Submission video

**Rules:** under 3:00 (judges stop at 3:00), public on YouTube or Vimeo,
footage of the project on a Quest or in an emulator. **Our target: 2:50.** No
AI-generated footage: everything is real capture of the running app;
`scripts/video/*` is used only for title cards and assembly.

**People on screen:** only the entrant. The rules forbid identifiable people
other than entrants, so use your own hands on both the headset and the "child"
side (a phone in your hand). No faces, no children, no recognisable rooms with
photos or brand logos in view.

## Sources

| Code | What | How |
| --- | --- | --- |
| **MR** | Quest 3 mixed-reality capture: passthrough plus the app | On the headset: Meta button, Camera, **Record video** (records what you see, passthrough included on Quest 3; check one 5 s test clip first). Or cast to a computer and screen-record. Pull files with `adb pull /sdcard/Oculus/VideoShots/` |
| **PH** | Phone screen recording of the family viewer | iOS: Control Centre, Screen Recording (long-press for microphone off). Android: Quick Settings, Screen record |
| **EM** | Emulator capture of the running app | `node scripts/video/capture.mjs` (dev server running), frames in `node_modules/.cache/shadowplay-video/` |
| **TC** | Title card | `scripts/video/assemble.py` (`card([...])`) |

Every shot has an emulator fallback (column **If no headset**), so the video can
be made today and upgraded shot by shot when device footage exists.

## Shot list and voice-over

The voice-over (VO) is spoken by you (record it with the phone's voice memo app
in a quiet room), or, as a fallback, generated with the same open-source voice
as the narration (`scripts/narration/generate.py` style; synthetic voice, no
real person). Captions in **bold** are on-screen text.

<!-- shots -->
| # | Time | Picture | VO / on-screen | Source | If no headset |
| --- | --- | --- | --- | --- | --- |
| 1 | 0:00-0:04 | Dark room, a real hand rises into a warm pool of light on a real wall. The hand forms a rabbit; its real shadow falls on the wall | (no VO, the lamp hum) | MR | EM: stage in the emulated room, the rabbit shadow forming |
| 2 | 0:04-0:10 | The shadow rabbit **comes alive**, hops where the hand goes; the light swells, chime | VO: "Everyone knows how to make a shadow rabbit." | MR | EM |
| 3 | 0:10-0:16 | Title card: **Shadowplay**, *Bedtime Across the World* | VO: "What if it could tell a bedtime story, to a child far away?" | TC | TC |
| 4 | 0:16-0:30 | Seated at a desk: the lamp appears on the real desk, the room dims, Mo the moth follows a fingertip | VO: "Put on a Quest. A lamp appears on your desk, and your hands become the storyteller." | MR | EM (`1-headset-rabbit` moment) |
| 5 | 0:30-0:42 | A fish grows as the hand moves toward the lamp; then two hands make a bird and Mo rides it | VO: "Make a shape, and the story's creature wakes up. Move closer to the lamp, and it grows." | MR | EM (`2-headset-bird`) |
| 6 | 0:42-0:52 | Pinch the journal, Settings: **Record a story**, then **Send to family**: a three-word code appears | VO: "Record it, in your own voice, and send it with a private family code." | MR | EM |
| 7 | 0:52-1:10 | The phone: type the code, the story plays in Dad's voice with the child's name; at a shape, **Join in**, a hand makes the rabbit through the phone camera and it wakes | VO: "At home, it plays on a phone or tablet, in your voice. And at every shape, they can join in with their own hands." | PH | EM (`phone` view in capture.mjs; `4-family-viewer`) |
| 8 | 1:10-1:22 | Goodnight card **Goodnight, Mia**; tap **Send a goodnight back**, a short shadow creature and a "goodnight" | VO: "When it ends, they can send a goodnight back." | PH | EM (`5-goodnight-card`) |
| 9 | 1:22-1:34 | Back in the headset: **Goodnights (1)**; Mia's goodnight plays on the wall | VO: "It's waiting on your wall the next time you put the headset on." | MR | EM (the `wall` view: Mia's goodnight) |
| 10 | 1:34-2:02 | Live: headset **Go live**, the phone joins with the code; split screen, the same shadows on both; talking; with **Take turns**, the phone's hand makes the next creature and it appears on the parent's wall | VO: "Or go live. They see your shadows as you make them, you talk, and you take turns making the creatures." | MR + PH side by side | EM: two browsers (`scripts/sim/live-family.mjs` screenshots) or skip and lengthen 7 |
| 11 | 2:02-2:16 | Quick cuts: first screen with **One-hand mode** and **Forgiving shapes**; the ghost hand teaching a shape; **Move stage here** onto another wall | VO: "One-hand mode, forgiving shapes, and a story that never gets stuck: it shows you how, and waits." | MR + page capture | EM (`6-headset-journal-settings`) |
| 12 | 2:16-2:28 | Finale: cupped hands hold the lighthouse light, then open to let it go | VO: "Hands only. No controllers, nothing to learn." | MR | EM (`3-headset-cupped-hands`) |
| 13 | 2:28-2:38 | Card: **Private by design**. *No accounts. Camera video never leaves the device. The microphone opens only when you press Record or Talk.* | VO: "No accounts. Camera video never leaves the device. The microphone only opens when you press Record or Talk." | TC | TC |
| 14 | 2:38-2:50 | End card: **Shadowplay**, *A bedtime story, wherever you are.*, the URL; small line: *Footage: Quest 3 capture and phone screen recordings of the running app. No AI-generated video.* | VO: "Shadowplay. A bedtime story, wherever you are." | TC | TC (change the small line to "emulator and app capture") |
<!-- /shots -->

The first 30 seconds carry it: real hands, a real shadow, a creature waking, the
title, and a parent at a desk. Shot 1-2 is worth several takes: steady hand,
rabbit held still for the half-second it takes to wake, the light pool on a
plain wall.

## Recording session checklist (headset)

1. Plain, lit-from-the-side wall straight ahead; desk clear; nothing branded in
   view; Room Setup done so the stage lands on the wall.
2. Open the deployed URL in the Quest Browser, Enter XR, put the controllers
   away.
3. Record shots 4, 5, 12 in one take of *The Moth Who Borrowed Light* (pick the
   Prologue and Chapters 1 and 5 from the journal to jump).
4. Record 6 and 9 (record a short story, send it; play the goodnight).
5. Live (10): phone in the other hand or on a stand, both screens recording.
6. Hook (1-2) last, when you're used to holding the rabbit still.

## Assembly

- Today (no headset): `node scripts/video/capture.mjs` then
  `python3 scripts/video/assemble.py` makes the emulator version (2:33, already
  under the limit), `shadowplay-video.mp4` in the project folder.
- With device clips: put them in `video-clips/` (gitignored), trim to the times
  above (`ffmpeg -ss START -to END -i in.mp4 -c:v libx264 -crf 18 shotN.mp4`),
  and replace the matching emulator segments in `assemble.py`'s shot list; keep
  its title cards (3, 13, 14) and music.
- Check the total with `node scripts/submission/check.mjs` (shot table) and
  `ffprobe -show_entries format=duration shadowplay-video.mp4` (file). Keep
  it at or under 2:55.
- Upload as **public** to YouTube or Vimeo; paste the link in DEVPOST.md and the
  Devpost form.
