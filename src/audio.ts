import { createSystem, Vector3 } from '@iwsdk/core';
import { audioRunning, Hum, setListener, startLampHum } from './sfx.js';
import { Stage } from './shadowplay-components.js';
import { stageRuntime } from './stage-runtime.js';

/**
 * Spatial audio upkeep: keeps the Web Audio listener on the viewer's head so
 * placed sounds come from the wall or the desk, and runs the lamp's faint hum
 * at the bulb, following its brightness (silent when switched off).
 */
export class AudioSystem extends createSystem({
  stages: { required: [Stage] },
}) {
  private head = new Vector3();
  private forward = new Vector3();
  private up = new Vector3();
  private hum: Hum | null = null;

  update(): void {
    if (!audioRunning()) return;
    const headObj = this.player.head;
    headObj.updateWorldMatrix(true, false);
    this.head.setFromMatrixPosition(headObj.matrixWorld);
    // Object3D world direction is +Z; the viewer looks down -Z.
    headObj.getWorldDirection(this.forward).negate();
    this.up.set(0, 1, 0).transformDirection(headObj.matrixWorld);
    setListener(this.head, this.forward, this.up);

    this.hum ??= startLampHum();
    if (!this.hum) return;
    const stage = this.queries.stages.entities.values().next().value;
    const on = stage?.getValue(Stage, 'lampOn') ?? false;
    const level = stage?.getValue(Stage, 'lampLevel') ?? 0;
    this.hum.setPosition(stageRuntime.bulb);
    this.hum.setLevel(stageRuntime.ready && on ? level : 0);
  }
}
