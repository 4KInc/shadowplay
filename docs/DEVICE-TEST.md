# Device test checklist (Quest 3 and Quest 3S)

Every session uses the diagnostics build so it leaves data behind:

**https://shadowplay-1031148889398.us-central1.run.app/?diag**

(or the local dev server, `https://<your-mac-ip>:8082/?diag`). A small panel
appears under the stage with frame times, quality, hands and recognition, room
detection and startup timings. The last item on its bottom line is the
**session id**: write it in the table so the data can be found.

After a session, summarize it:

```sh
# deployed: diagnostics land in the stories bucket under diag/<date>/
gcloud storage cat 'gs://quick-catcher-470218-b0-shadowplay-stories/diag/2026-11-12/*.jsonl' | node scripts/diag/summarize.mjs -
# local dev server
node scripts/diag/summarize.mjs .data/diag
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
| A1 | Cold start: link opened to page shown (seconds) | [ ] | |
| A2 | Enter XR to stage placed (panel: `placed +Xs`) | [ ] | |
| A3 | Permission prompts: which appeared, all understandable | [ ] | |
| A4 | Stage on the wall straight ahead (panel: `wall`), or floating screen (`screen`) in R3 | [ ] | |
| A5 | Stage size feels right; not inside furniture | [ ] | |
| A6 | Frame rate holds at 72 (panel line 1 stays cream, not red) | [ ] | fps / p95 |
| A7 | Quality level after 2 minutes (`q0`..`q2`) | [ ] | |
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
| E1 | Quest menu button mid-story: narration and story pause; resume cleanly | [ ] | |
| E2 | Headset off for 30 s and back on: story resumes | [ ] | |
| E3 | Recenter (hold the menu button): stage re-placed ahead | [ ] | |
| E4 | Stand up mid-story: stage stays put, hands still cast | [ ] | |
| E5 | Sit at 30-45 degrees to the wall: stage placement and shadows | [ ] | |
| E6 | Settings: Re-place stage on the wall ahead works by pinch | [ ] | |
| E7 | One-hand mode: bird and cup with one hand | [ ] | |
| E8 | Tolerance Very forgiving: shapes wake sooner, no false wakes | [ ] | |
| E9 | Captions, journal and settings readable without turning the head | [ ] | |
| E10 | Session ended mid-story: next launch continues from that chapter | [ ] | |

## Open questions only a device can answer

- Real frame rate and GPU cost on Quest 3 vs 3S (the panel and the summary).
- Whether Quest Browser grants 72 Hz (summary: `requested 72 Hz`).
- Recognition accuracy with real hand tracking noise, per shape, per room light.
- How the capsule hand shadows look on a real wall compared with a real hand.
- Plane detection timing in each room (`placed +Xs`) and the fallback in R3.
