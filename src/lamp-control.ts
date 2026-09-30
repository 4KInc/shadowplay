import { createSystem, Entity, Object3D, Vector3 } from '@iwsdk/core';
import { playClick } from './sfx.js';
import { DeskLamp, ShadowJournal, Stage } from './shadowplay-components.js';
import { handRuntime, HandSample, stageRuntime } from './stage-runtime.js';

const THUMB_TIP = 4;
const INDEX_TIP = 9;
const PINCH_ON = 0.018;
const PINCH_OFF = 0.035;
/** Reach of a pinch around the switch / the lamp body. */
const SWITCH_REACH = 0.045;
const GRAB_REACH = 0.1;
/** Reach of a pinch around the centre of the journal's top cover. */
const BOOK_REACH = 0.1;
/** Horizontal distance of the lamp from the viewer while dragging. */
const MIN_REACH = 0.15;
const MAX_REACH = 0.65;

type Side = 'left' | 'right';

interface PinchState {
  pinching: boolean;
}

/**
 * Hands-only lamp control: pinch the switch on the base to turn the lamp off
 * and on (pausing the story), or pinch the lamp and drag it along the desk.
 * Every shadow and the light pool move with it. Pinching the Shadow Journal
 * on the desk opens or closes it.
 */
export class LampControlSystem extends createSystem({
  lamps: { required: [DeskLamp] },
  stages: { required: [Stage] },
  journals: { required: [ShadowJournal] },
}) {
  private pinch: Record<Side, PinchState> = { left: { pinching: false }, right: { pinching: false } };
  private point = new Vector3();
  private switchPos = new Vector3();
  private headPos = new Vector3();
  private lampHead = new Vector3();
  private grabOffset = new Vector3();
  private switchObj: Object3D | undefined;
  private headObj: Object3D | undefined;
  private bookPos = new Vector3();

  update(): void {
    const lamp = this.queries.lamps.entities.values().next().value as Entity | undefined;
    const stage = this.queries.stages.entities.values().next().value as Entity | undefined;
    const lampObj = lamp?.object3D;
    if (!lamp || !stage || !lampObj || !stageRuntime.ready) return;
    this.switchObj ??= lampObj.getObjectByName('lamp-switch');
    this.headObj ??= lampObj.getObjectByName('lamp-head');

    for (const side of ['right', 'left'] as const) {
      const hand = handRuntime[side];
      const state = this.pinch[side];
      const wasPinching = state.pinching;
      state.pinching = hand.tracked && this.isPinching(hand, wasPinching);
      if (!hand.tracked) continue;
      this.pinchPoint(hand);

      if (state.pinching && !wasPinching) this.onPinchStart(side, lamp, stage, lampObj);
      if (!state.pinching && wasPinching && lamp.getValue(DeskLamp, 'heldBy') === side) {
        lamp.setValue(DeskLamp, 'heldBy', 'none');
      }
    }
    // A hand that stops being tracked lets go.
    const holder = lamp.getValue(DeskLamp, 'heldBy');
    if (holder === 'left' || holder === 'right') {
      if (!handRuntime[holder].tracked) lamp.setValue(DeskLamp, 'heldBy', 'none');
      else this.drag(holder, lampObj);
    }
  }

  private isPinching(hand: HandSample, was: boolean): boolean {
    const j = hand.joints;
    const dx = j[THUMB_TIP * 3] - j[INDEX_TIP * 3];
    const dy = j[THUMB_TIP * 3 + 1] - j[INDEX_TIP * 3 + 1];
    const dz = j[THUMB_TIP * 3 + 2] - j[INDEX_TIP * 3 + 2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return d < (was ? PINCH_OFF : PINCH_ON);
  }

  private pinchPoint(hand: HandSample): Vector3 {
    const j = hand.joints;
    return this.point.set(
      (j[THUMB_TIP * 3] + j[INDEX_TIP * 3]) * 0.5,
      (j[THUMB_TIP * 3 + 1] + j[INDEX_TIP * 3 + 1]) * 0.5,
      (j[THUMB_TIP * 3 + 2] + j[INDEX_TIP * 3 + 2]) * 0.5,
    );
  }

  private onPinchStart(side: Side, lamp: Entity, stage: Entity, lampObj: Object3D): void {
    if (this.switchObj) {
      this.switchObj.getWorldPosition(this.switchPos);
      if (this.point.distanceTo(this.switchPos) < SWITCH_REACH) {
        stage.setValue(Stage, 'lampOn', !stage.getValue(Stage, 'lampOn'));
        playClick();
        return;
      }
    }
    for (const journal of this.queries.journals.entities) {
      const book = journal.object3D;
      if (!book) continue;
      this.bookPos.copy(book.position);
      this.bookPos.y += 0.03;
      if (this.point.distanceTo(this.bookPos) < BOOK_REACH) {
        journal.setValue(ShadowJournal, 'open', !journal.getValue(ShadowJournal, 'open'));
        playClick();
        return;
      }
    }
    (this.headObj ?? lampObj).getWorldPosition(this.lampHead);
    const nearHead = this.point.distanceTo(this.lampHead) < GRAB_REACH;
    const nearBase = this.point.distanceTo(lampObj.position) < GRAB_REACH;
    if ((nearHead || nearBase) && lamp.getValue(DeskLamp, 'heldBy') === 'none') {
      this.grabOffset.subVectors(lampObj.position, this.point);
      this.grabOffset.y = 0;
      lamp.setValue(DeskLamp, 'heldBy', side);
    }
  }

  /** Slide the lamp along the desk (height fixed), keeping it within reach. */
  private drag(side: Side, lampObj: Object3D): void {
    this.pinchPoint(handRuntime[side]);
    const y = lampObj.position.y;
    const p = lampObj.position;
    p.set(this.point.x + this.grabOffset.x, y, this.point.z + this.grabOffset.z);

    this.player.head.getWorldPosition(this.headPos);
    const dx = p.x - this.headPos.x;
    const dz = p.z - this.headPos.z;
    const reach = Math.hypot(dx, dz);
    const clamped = Math.min(MAX_REACH, Math.max(MIN_REACH, reach));
    if (reach > 1e-4 && clamped !== reach) {
      p.x = this.headPos.x + (dx / reach) * clamped;
      p.z = this.headPos.z + (dz / reach) * clamped;
    }
    // StageSetupSystem re-aims the shade: sliding the lamp sweeps its light.
  }
}
