import { createSystem, VisibilityState } from '@iwsdk/core';
import { ShadowJournal, Stage } from './shadowplay-components.js';
import { stageRuntime } from './stage-runtime.js';

/**
 * Filming: entering XR goes straight to the story picker. Once the stage is
 * placed, the lamp is lit and the Shadow Journal opens (Settings with
 * "Tonight's story" beside it), so the opening story waits until a story is
 * picked or the book is closed. The sample family is already there, as on any
 * launch. Registered only with ?film (src/index.ts).
 */
export class FilmSystem extends createSystem({
  stages: { required: [Stage] },
  journals: { required: [ShadowJournal] },
}) {
  private done = false;
  private inXR = false;

  init(): void {
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((state) => {
        this.inXR = state !== VisibilityState.NonImmersive;
      }),
    );
  }

  update(): void {
    if (this.done || !this.inXR || !stageRuntime.ready) return;
    this.done = true;
    for (const s of this.queries.stages.entities) s.setValue(Stage, 'lampLevel', 1);
    for (const j of this.queries.journals.entities) j.setValue(ShadowJournal, 'open', true);
  }
}
