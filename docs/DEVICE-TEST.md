# Device test checklist (Quest 3 and Quest 3S)

Every session uses the device-test build with diagnostics, so it leaves data behind:

- Quest 3: **https://devtest---shadowplay-1031148889398.us-central1.run.app/?diag&device=q3**
- Quest 3S: **https://devtest---shadowplay-1031148889398.us-central1.run.app/?diag&device=q3s**

Use the right one on each headset (bookmark it there): Quest 3S reports
"Quest 3" in its user agent, so the `device=` tag is the only way the data can
tell them apart. Without it the summary says `quest3-or-3s`.

(the public URL with `?diag` works too; see DEPLOY.md "Device-test deploys").
A panel appears under the stage with frame times, quality, hands and
recognition, room detection and startup timings. Its top line is the
**session id** in large type (also shown on the page before Enter XR): write it
in the table so the data can be found.

After a session (wait 15 s after taking the headset off), one command:

```sh
scripts/diag/pull.sh                          # every session today and yesterday (UTC)
scripts/diag/pull.sh 2026-11-12 "k3x9q m2p7a"   # one session (UTC date)
```

Send me the summary (or the session ids) and the boxes you ticked.

## Rooms

Run the core checks (A and B) in at least three rooms; the rest once per headset.

| Room | Description | Quest 3 session id | Quest 3S session id |
| --- | --- | --- | --- |
| R1 | Big blank wall ahead, normal light | | |
| R2 | Cluttered wall or bookshelf ahead | | |
| R3 | No Room Setup, or no usable wall (open space, window) | | |
| R4 | Dim light (bedtime lighting) | | |
| R5 | Bright light (daylight) | | |

## A. Start and placement (every room)

| # | Check | Pass | Notes / numbers |
| --- | --- | --- | --- |
| A0 | First screen (before Enter XR): **One-hand mode** and **Forgiving shapes** buttons visible at the top left and easy to tap; the choice is kept inside the headset | [ ] | |
| A1 | Cold start: link opened to the lamp glow, and to the stage (seconds; the glow should show at once) | [ ] | |
| A2 | Enter XR to stage placed (panel: `placed +Xs`) | [ ] | |
| A3 | Permission prompts: which appeared, all understandable | [ ] | |
| A4 | Stage on the wall straight ahead (panel: `wall`), or floating screen (`screen`) in R3 | [ ] | |
| A4b | Write down the plane labels from the summary's `placed:` line (for example `v wall 4, v door frame 1, h table 1`). Walls with an unexpected label still hold the stage (ranked after labelled walls), so note which plane it chose and whether it was the wall you faced | [ ] | labels |
| A4c | Facing a window or a door: the stage slides beside it (if it is off to one side), or a paper screen stands just in front of it (if it is straight ahead). Never shadows on the glass | [ ] | |
| A5 | Stage size feels right; not inside furniture | [ ] | |
| A5c | The summary's `placed:` line shows `view N°` (the headset's field of view across one eye); Quest 3 and 3S should keep the full 33-degree stage | [ ] | degrees |
| A5d | Stage anchor: the summary's `stage anchor:` line reads `pending > saved` on a wall (or `unsupported`). Take the headset off for a minute and put it back on: the stage is still on the same spot of the wall (corrections, if any, are listed) | [ ] | |
| A5e | Exit and launch again from the same seat: the stage is back on the same spot of the wall within a second, before any scan (`(back on last time's wall)`). Then *Move stage here* to another wall, relaunch: it comes back on the new one | [ ] | |
| A5b | The lamp and the book stand on your real desk or table, not floating above it or sunk into it (summary: `desk surface` when Room Setup found it, `desk estimate` otherwise) | [ ] | |
| A6 | Frame rate holds at 72 (panel line 1 stays cream, not red) | [ ] | fps / p95 |
| A7 | Quality level after 2 minutes (`q0`..`q3`; anything above `q0` means the headset could not hold 72) | [ ] | |
| A7b | If the level stepped down: no visible pop or flicker when it changed, and shadows still look whole (edges not clipped) | [ ] | |
| A9 | First launch only (it opens *Counting Stars*): time from Enter XR to the first creature (the two-hand bird) waking (summary: `first creature: N s`, target under 60 s). The ghost hand appears about 2 s after the bird is asked for | [ ] | seconds (emulator, first launch = Counting Stars: bird asked at 23 s; first creature 23.5 s quick child, 48.5 s slow bot; was 50.7 / 76 s with The Moth) |
| A10 | The first creature waking is unmistakable: chime, the lamp light swells, the bird flies Mo up ("Fly up, up, up.") | [ ] | |
| A8 | Controllers in hand: story pauses and asks to put them down; resumes with hands | [ ] | |

## B. Shapes (every room)

Make each shape when the story asks (or in Free Stage). Note how long it took
and whether anything woke that you did not ask for (panel: `match`).

| # | Shape | Story moment | Pass | Seconds / false triggers |
| --- | --- | --- | --- | --- |
| B1 | Open hand, Mo follows the fingertip | Prologue | [ ] | |
| B2 | Rabbit (and the easier "ears") | Moth ch. 1, Sea | [ ] | |
| B3 | Fish, then grow it near the lamp | Moth ch. 2, Sea | [ ] | |
| B4 | Dog, grow it against the wolf | Moth ch. 3 (dog), Brave Little Dog | [ ] | |
| B5 | Bird (two hands) | Moth ch. 3 (bird), Sea, Counting Stars | [ ] | |
| B6 | Cupped hands (two hands), then let go | Moth finale, Sea | [ ] | |
| B7 | Snail | Slow Letter | [ ] | |
| B8 | Swan | Slow Letter | [ ] | |
| B9 | Deer (two hands) | Slow Letter | [ ] | |
| B10 | Crocodile (two hands) | Brave Little Dog | [ ] | |
| B11 | Relaxed or half-closed hands never wake anything | anywhere | [ ] | |
| B12 | Make a shape almost right: "Almost! Hold it still..." appears after about a second | any request | [ ] | |
| B13 | Make the right shape outside the light: "Bring your hand into the lamplight." | any request | [ ] | |
| B15 | Dim room (R4): if your hands keep dropping out while a shape is asked for, "Hands lost — try turning a light on" appears with the ghost hand within a few seconds; with the light on it goes away. The summary's `hand-tracking flickers:` line shows how often it happened | [ ] | |
| B14 | Cupped hands with fingers overlapping (hard to track): still wakes within a few seconds | Moth finale, Sea | [ ] | |

## C. Whole stories (once per headset)

| # | Check | Pass | Notes |
| --- | --- | --- | --- |
| C1 | The Moth, Prologue to the lighthouse finale | [ ] | |
| C2 | Goodnight Across the Sea, start to end | [ ] | |
| C3 | Free Stage: every creature wakes | [ ] | |
| C4 | Story picker: browse, Tell this story starts it | [ ] | |
| C5 | Narration audible, in step with captions | [ ] | |

## D. Family features (once per headset, with a phone)

| # | Check | Pass | Notes |
| --- | --- | --- | --- |
| D1 | Record a story with voice, Send to family, code shown | [ ] | |
| D2 | Phone: open the code, watch it in your voice, goodnight card | [ ] | |
| D3 | Phone: Join in with the camera, shapes wake creatures | [ ] | |
| D4 | Phone: Send a goodnight back; headset shows Goodnights (1) and plays it | [ ] | |
| D5 | Go live; phone joins with the code; shadows appear on the phone | [ ] | |
| D6 | Talk both ways: delay acceptable, no echo | [ ] | |
| D7 | Take turns: the phone makes a creature on both screens | [ ] | |
| D8 | Phone switches Wi-Fi off and on mid-Live: reconnects | [ ] | |
| D9 | Sample family: Mia's goodnight waiting on first launch | [ ] | |

## E. Comfort and interruptions (once per headset)

| # | Check | Pass | Notes |
| --- | --- | --- | --- |
| E1 | Quest menu button mid-story: narration, sound and story pause (caption: `Paused.`); close the menu and it carries on from the same line | [ ] | |
| E2 | Headset off for 30 s and back on: silent while off; story resumes where it was, nothing skipped. In Live, the other person's voice stops while it is off | [ ] | |
| E3 | Recenter (hold the menu button): stage re-placed ahead | [ ] | |
| E4 | Stand up mid-story: stage stays put, hands still cast | [ ] | |
| E5 | Sit at 30-45 degrees to the wall: stage placement and shadows | [ ] | |
| E6 | Settings: **Move stage here** works by pinch: pinch, look at another wall within about 1.5 s, the stage appears there | [ ] | |
| E7 | One-hand mode: bird and cup with one hand | [ ] | |
| E8 | Tolerance Very forgiving: shapes wake sooner, no false wakes | [ ] | |
| E8b | Change Tolerance while a shape is being asked for: takes effect at once and stays after it wakes | [ ] | |
| E9 | Captions and the journal page readable without turning the head (measured in the emulator: within 16.5 degrees either side, 11 up, 13 down) | [ ] | |
| E9c | High contrast (Settings, *Easier to use* row, or the first screen): panels turn black and white with yellow for the selected option, captions white on solid black, the hand shadows on the wall solid black. Readable in passthrough, and the shadows still read as hand shadows | [ ] | |
| E9d | Look to press (first screen or Settings): a small ring follows the centre of the view; resting it on the book opens the journal, on a Settings button presses it once (no repeats), on the lamp switch pauses. With controllers in hand and hands away, tell *Counting Stars* to the end by looking at the ghost hand when a shape is asked for and at the stage otherwise. Note any button that is hard to hold the gaze on | [ ] | |
| E9e | Voice commands (first screen or Settings): the summary or panel shows how it listens (`browser` = Quest Browser's own recognition, `server` = clips to /api/voice, `unavailable`). Say "open the journal", "forgiving shapes", "close the journal", then the shape when asked ("bird"), "go on" when Mo wants to follow a finger, "pause" and "continue". Note what it mishears, and whether the narration ever triggers a command | [ ] | |
| E9f | Mo's tips: make the wrong shape on purpose when one is asked for (an open hand for the rabbit). After about 9 s Mo's bubble appears beside her with one tip about what to change; a second at about 21 s; none after the creature wakes. With voice commands, say "help". Summary: `Mo's tips: N (M by AI)`. Note whether the tip was right about your hand | [ ] | |
| E9g | Dream a new one (journal, Tonight's story): the chooser opens; pick a place and two or three shapes (a fourth is refused), Dream it: Mo is dreaming... then a new story starts within about 10 s, with its own title, two or three shapes and captions. Read every line: gentle, makes sense, asks for the right shape. Then **record it and send it**: open the code on the phone (`?viewer`), and the dreamed story plays there; **go live** with it and the phone tells the same story. Summary: `dream` events | [ ] | seconds |
| E9b | Settings readable and every row reachable by pinch without straining. In the emulator it spans 19 degrees up to 22 down and reaches 33 to the right at a 2 m wall (was 27 up, 25 down). Note whether the top or bottom rows are uncomfortable, and whether the desk lamp covers its lower corner | [ ] | |
| E11 | Every Settings button presses by hand ray and pinch, including "After 15 s" under Show-me hints (in the emulator it needed aiming slightly above its centre) | [ ] | |
| E12 | Credits (first screen, and the family viewer on a phone) opens and closes | [ ] | |
| E10 | Session ended mid-story: next launch continues from that chapter, with "Welcome back. Continuing from Chapter N..." | [ ] | |

## Optional: silhouette templates

Recognition currently runs on joint angles alone: the second method
(silhouette matching) has no templates until some are recorded on a headset
(`public/silhouettes/templates.json` is empty). With the dev server and a
paired Quest, record a few per shape with the recognition lab; this only adds
a second opinion, it is not required.

## Needs device: Quest Browser and phone behaviour (from a code audit)

Things that may behave differently on real hardware than in the emulator. Each
has a safe fallback or a fix in place; the device confirms it.

| # | Check | Pass | What to look for |
| --- | --- | --- | --- |
| N1 | Quest: decline room access when asked (or have no Room Setup): Enter XR still works and the story plays on the paper screen | [ ] | Features are optional (`iwsdk.config.json`), so the session should start |
| N2 | Quest: the story keeps playing in XR (the summary's `page:` line shows what the 2D page reports while immersive) | [ ] | In XR only the session's own visibility pauses the story (#32); confirm it never sits on "Paused." |
| N3 | Quest: the first narration line is heard right after Enter XR | [ ] | The Enter XR tap allows audio; if not, lines still finish on their captions |
| N4 | Quest: Quest menu, then back; headset off 1 min, then on: story, sound and Live voice pause and resume | [ ] | (E1/E2) |
| N5 | iPhone or iPad (Safari): Join live, the parent talks: is the parent's voice heard on the phone? | [ ] | Safari starts audio only from a tap; the Live voice player starts when the first sound arrives. If silent, tell me (fix ready: start it from the Join live tap) |
| N6 | iPhone or iPad (Safari): tap the sample story from Dad: is Dad's voice heard? | [ ] | Same audio rule |
| N7 | Live: put the headset to sleep for 1 minute mid-Live, then wake it: what does each side show? | [ ] | The room waits 45 s for the storyteller; after that the phone should show a clear message, never hang |
| N8 | A whole 20-minute Moth: heap in the summary's snapshots stays flat | [ ] | Emulator: 77.9 MB to 79.3 MB over two full playthroughs |

## Open questions only a device can answer

- Real frame rate and GPU cost on Quest 3 vs 3S (the panel and the summary).
- Whether Quest Browser grants 72 Hz (summary: `requested 72 Hz: granted`, `refused` or `unsupported`).
- Whether the stage holds `q0` through The Moth's storm and finale on Quest 3S;
  if not, which level it settles at (summary: `quality` events with the fps
  that triggered them).
- Recognition accuracy with real hand tracking noise, per shape, per room light
  (the synthetic sweep models +/-5 mm jitter, an occluded finger and 100 ms
  dropouts; summarize.mjs counts triggers by shape and what was asked).
- How the capsule hand shadows look on a real wall compared with a real hand.
- Plane detection timing in each room (`placed +Xs`) and the fallback in R3.
- The semantic labels Quest Browser gives walls, doors and windows (summary:
  `placed: ... labels: ...`). Labelled walls (`wall`, `wall face`) are preferred,
  then unlabelled planes, then any other vertical label; doors and windows
  (recognised by those words) are kept clear.
