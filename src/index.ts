import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { AudioSystem } from './audio.js';
import { CameraHandsSystem } from './camera-hands.js';
import { CaptionSystem } from './captions.js';
import { FreeStageSystem } from './free-stage.js';
import { HandCasterSystem } from './hand-caster.js';
import { JournalSystem } from './journal.js';
import { LampControlSystem } from './lamp-control.js';
import { MothSystem } from './moth.js';
import { NarrationSystem } from './narration.js';
import { PerformancePlayerSystem } from './performance/player.js';
import { PerformanceRecorderSystem } from './performance/recorder.js';
import { StoryTapSystem } from './performance/story-tap.js';
import { LiveSystem } from './live/live-system.js';
import { FamilyControlsSystem } from './live/family-controls.js';
import { HiddenPropSystem } from './props.js';
import { QualitySystem } from './quality.js';
import { RecognitionLabSystem } from './recognition-lab.js';
import { PuppetSystem } from './puppet.js';
import { ScenerySystem } from './scenery.js';
import { SettingsSystem } from './settings.js';
import { SilhouetteSystem } from './silhouette.js';
import { ShapeMatchSystem } from './shape-match.js';
import { StageSetupSystem } from './stage-setup.js';
import { StorySystem } from './story.js';
import { ViewerUISystem } from './viewer-ui.js';
import { StageActorSystem } from './wolf.js';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world
    .registerSystem(StageSetupSystem)
    .registerSystem(CameraHandsSystem)
    .registerSystem(HandCasterSystem)
    .registerSystem(LampControlSystem)
    .registerSystem(SilhouetteSystem)
    .registerSystem(ShapeMatchSystem)
    .registerSystem(RecognitionLabSystem)
    .registerSystem(PerformancePlayerSystem)
    .registerSystem(StorySystem)
    .registerSystem(NarrationSystem)
    .registerSystem(FreeStageSystem)
    .registerSystem(PuppetSystem)
    .registerSystem(MothSystem)
    .registerSystem(StageActorSystem)
    .registerSystem(ScenerySystem)
    .registerSystem(HiddenPropSystem)
    .registerSystem(JournalSystem)
    .registerSystem(SettingsSystem)
    .registerSystem(CaptionSystem)
    .registerSystem(AudioSystem)
    .registerSystem(QualitySystem)
    .registerSystem(StoryTapSystem)
    .registerSystem(PerformanceRecorderSystem)
    .registerSystem(LiveSystem)
    .registerSystem(FamilyControlsSystem)
    .registerSystem(ViewerUISystem);

  // Development only: webcam-driven hands for testing recognition without a headset.
  if (import.meta.env.DEV) {
    void import('./webcam-hands.js').then(({ WebcamHandsSystem }) => world.registerSystem(WebcamHandsSystem));
    void import('./demo-director.js').then(({ DemoDirectorSystem }) => world.registerSystem(DemoDirectorSystem));
  }
});
