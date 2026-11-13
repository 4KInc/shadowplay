import type { World } from '@iwsdk/core';
import { FamilySetupSystem } from '../family-ui.js';
import { GazeDwellSystem } from '../gaze-dwell.js';
import { JournalSystem } from '../journal.js';
import { LampControlSystem } from '../lamp-control.js';
import { FamilyControlsSystem } from '../live/family-controls.js';
import { FamilyInboxSystem } from '../performance/replies.js';
import { SettingsSystem } from '../settings.js';

/** Systems only the storyteller's page needs (never loaded by the family viewer). */
export function registerHeadset(world: World): void {
  world
    .registerSystem(LampControlSystem)
    .registerSystem(JournalSystem)
    .registerSystem(SettingsSystem)
    .registerSystem(FamilyInboxSystem)
    .registerSystem(FamilyControlsSystem)
    .registerSystem(FamilySetupSystem)
    .registerSystem(GazeDwellSystem);
}
