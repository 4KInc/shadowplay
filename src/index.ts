import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { CaptionSystem } from './captions.js';
import { HandCasterSystem } from './hand-caster.js';
import { JournalSystem } from './journal.js';
import { LampControlSystem } from './lamp-control.js';
import { MothSystem } from './moth.js';
import { PuppetSystem } from './puppet.js';
import { ScenerySystem } from './scenery.js';
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
    .registerSystem(ShapeMatchSystem)
    .registerSystem(StorySystem)
    .registerSystem(PuppetSystem)
    .registerSystem(MothSystem)
    .registerSystem(StageActorSystem)
    .registerSystem(ScenerySystem)
    .registerSystem(JournalSystem)
    .registerSystem(CaptionSystem);
});
