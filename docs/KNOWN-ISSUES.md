# Known issues

Shadowplay as submitted to the Meta VR Start Developer Competition 2026. These
are the limits we know of, stated plainly. Items found on a headset are added
with the session that showed them.

## Not yet verified on a headset

- The app has been built and tested in the IWSDK Quest emulator and in
  simulation (bot players, room cases, network faults). On-device frame rate,
  real-hand recognition rates, room-plane labels and audio start-up are being
  checked on Quest 3 and Quest 3S; see `docs/DEVICE-TEST.md`.

## Design limits

- **Hand tracking needs light.** Shadowplay dims the room in the headset, but
  the room itself should stay lit. If hands keep dropping out during a shape,
  the story shows the ghost hand and suggests turning a light on.
- **Recognition is joint-angle based.** Each shape is matched from the tracked
  joint angles. A second, silhouette-based method exists in the code but is
  off: it has no recorded templates yet, and it would cost GPU time on Quest.
- **One-hand mode** covers the bird (an open hand) and the cup (one cupped
  hand). The deer and the crocodile still need two hands; after a minute, any
  steady hand in the light wakes them so nobody gets stuck.
- **The Settings panel sits beside the stage, to the right.** It spans about
  19 degrees up to 22 down (tightened from 27 up and 25 down) and reaches 33
  degrees to the right; the text and buttons were kept large rather than
  shrunk. From the seat, the desk lamp's head can cover the panel's lower
  corner; drag the lamp aside if it does.
- **Live is one storyteller and one family member**, and Live rooms run on a
  single server instance (in memory). That is plenty for judging; a larger
  launch would need a shared room service.
- **Live voice on iPhone and iPad** may need a tap before the parent's voice is
  heard (Safari starts audio only from a tap). Under test.

## Cosmetic

- In the emulator, the "After 15 s" hint button needed aiming slightly above
  its centre to press; every other button pressed at its centre. Under test on
  a headset.
