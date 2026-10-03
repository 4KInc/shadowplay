import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { AudioSystem } from './audio.js';
import { CaptionSystem } from './captions.js';
import { FreeStageSystem } from './free-stage.js';
import { HandCasterSystem } from './hand-caster.js';
import { JournalSystem } from './journal.js';
import { LampControlSystem } from './lamp-control.js';
import { MothSystem } from './moth.js';
import { NarrationSystem } from './narration.js';
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
import { StageActorSystem } from './wolf.js';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world
    .registerSystem(StageSetupSystem)
    .registerSystem(HandCasterSystem)
    .registerSystem(LampControlSystem)
    .registerSystem(SilhouetteSystem)
    .registerSystem(ShapeMatchSystem)
    .registerSystem(RecognitionLabSystem)
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
    .registerSystem(QualitySystem);

  // Development only: webcam-driven hands for testing recognition without a headset.
  if (import.meta.env.DEV) {
    void import('./webcam-hands.js').then(({ WebcamHandsSystem }) => world.registerSystem(WebcamHandsSystem));
  }
});
