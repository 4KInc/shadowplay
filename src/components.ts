import { defineComponents } from '@iwsdk/core';
import {
  DailyShape,
  DeskLamp,
  HiddenProp,
  Moth,
  Scenery,
  ShadowJournal,
  ShadowPuppet,
  ShapeRecognizer,
  Stage,
  StageActor,
  StoryState,
} from './shadowplay-components.js';

export default defineComponents([
  Stage,
  DeskLamp,
  ShapeRecognizer,
  ShadowPuppet,
  StoryState,
  Moth,
  Scenery,
  StageActor,
  ShadowJournal,
  HiddenProp,
  DailyShape,
]);
