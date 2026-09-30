# Shadowplay

An interactive shadow-puppet story performed on your real wall. A virtual lamp
on your desk throws the shadows of your tracked hands across the room; form the
right shape and your shadow comes alive as a character and carries the story
forward.

Hands-first mixed reality for Meta Quest (WebXR / IWSDK), built for the Meta VR
Start Developer Competition 2026 (Entertainment track, New Experience).

The full concept, first-five-minutes flow, shape-recognition approach, risks and
build plan are in [docs/shadowplay-idea-brief.pdf](docs/shadowplay-idea-brief.pdf).

---

## IWSDK App

This project uses `iwsdk.config.json` for declarative scene, asset, component,
XR, and emulator configuration. Application systems remain explicit in
`src/index.ts`.

```sh
npm install
npm run dev
```

Use the Runtime and Editor controls in the managed browser to switch between
the running experience and its authored scene.

## Starter content

The robot and welcome panel are small examples of authored scene content plus
runtime systems. The robot turns toward the player's head and plays a sound
when pressed. To remove the robot, delete its scene node, its `RobotSystem`
registration from `src/index.ts` or `src/index.js`, and its `Robot` registration
from `src/components.ts` or `src/components.js`; you can then delete the unused
robot component and system files. To remove the welcome panel, delete its scene
node and its `PanelSystem` registration from the application entry point.

- Minimal scene walkthrough: https://iwsdk.dev/guides/01b-minimal-scene.html
- XR-enabled projects — IWER emulator controls: https://iwsdk.dev/guides/02-testing-experience.html#iwer-controls
