import { defineComponents } from '@iwsdk/core';
import {
  DailyShape,
  DeskLamp,
  HiddenProp,
  Moth,
  Scenery,
  Settings,
  ShadowJournal,
  ShadowPuppet,
  ShapeRecognizer,
  SilhouetteMatcher,
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
  Settings,
  SilhouetteMatcher,
]);
