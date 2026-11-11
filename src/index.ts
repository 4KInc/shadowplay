import { World } from '@iwsdk/core';
import { AutomationSystem, automationEnabled } from './automation.js';
import { family } from './family.js';
import { seedSamples } from './performance/samples.js';
import { RoleLoaderSystem } from './roles/loader.js';
import { viewerMode } from './viewer-mode.js';
import projectOptions from 'virtual:iwsdk-project';
import { AudioSystem } from './audio.js';
import { CaptionSystem } from './captions.js';
import { FreeStageSystem } from './free-stage.js';
import { HandCasterSystem } from './hand-caster.js';
import { MothSystem } from './moth.js';
import { NarrationSystem } from './narration.js';
import { PerformancePlayerSystem } from './performance/player.js';
import { PerformanceRecorderSystem } from './performance/recorder.js';
import { StoryTapSystem } from './performance/story-tap.js';
import { HiddenPropSystem } from './props.js';
import { QualitySystem } from './quality.js';
import { PuppetSystem } from './puppet.js';
import { ScenerySystem } from './scenery.js';
import { SilhouetteSystem } from './silhouette.js';
import { ShapeMatchSystem } from './shape-match.js';
import { StageSetupSystem } from './stage-setup.js';
import { StorySystem } from './story.js';
import { StageActorSystem } from './wolf.js';

/** The HTML loading glow (index.html) fades out once the first frame is drawn. */
function hideLoading(): void {
  const el = document.getElementById('sp-loading');
  if (!el) return;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.classList.add('done');
    setTimeout(() => el.remove(), 700);
  }));
}

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world
    .registerSystem(StageSetupSystem)
    .registerSystem(HandCasterSystem)
    .registerSystem(SilhouetteSystem)
    .registerSystem(ShapeMatchSystem)
    .registerSystem(PerformancePlayerSystem)
    .registerSystem(StorySystem)
    .registerSystem(NarrationSystem)
    .registerSystem(FreeStageSystem)
    .registerSystem(PuppetSystem)
    .registerSystem(MothSystem)
    .registerSystem(StageActorSystem)
    .registerSystem(ScenerySystem)
    .registerSystem(HiddenPropSystem)
    .registerSystem(CaptionSystem)
    .registerSystem(AudioSystem)
    .registerSystem(QualitySystem)
    .registerSystem(StoryTapSystem)
    .registerSystem(PerformanceRecorderSystem)
    .registerSystem(RoleLoaderSystem);
  void family.load();
  void seedSamples(viewerMode.on ? 'viewer' : 'headset');
  if (automationEnabled) {
    world.registerSystem(AutomationSystem);
    // The recognition lab (synthetic hands, trial reports) is a test tool.
    void import('./recognition-lab.js').then(({ RecognitionLabSystem }) => world.registerSystem(RecognitionLabSystem));
  }
  // Device diagnostics only with ?diag (a separate chunk, never loaded otherwise).
  if (new URLSearchParams(location.search).has('diag')) {
    void import('./diag/diag-system.js').then(({ DiagSystem }) => world.registerSystem(DiagSystem));
  }

  hideLoading();

  // Development only: webcam-driven hands for testing recognition without a headset.
  if (import.meta.env.DEV) {
    void import('./webcam-hands.js').then(({ WebcamHandsSystem }) => world.registerSystem(WebcamHandsSystem));
    void import('./demo-director.js').then(({ DemoDirectorSystem }) => world.registerSystem(DemoDirectorSystem));
  }
}).catch((error: unknown) => {
  console.error('[shadowplay] start failed', error);
  const el = document.getElementById('sp-loading');
  const line = el?.lastElementChild;
  if (line) line.textContent = 'Shadowplay could not start here. Try reloading, or open it in the browser on your headset.';
});
