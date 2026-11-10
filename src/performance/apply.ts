import { Entity, Vector3 } from '@iwsdk/core';
import {
  HiddenProp,
  Moth,
  PuppetStates,
  Scenery,
  ShadowPuppet,
  ShapeRecognizer,
  Stage,
  StageActor,
} from '../shadowplay-components.js';
import { PerformanceEvent, pointFromStage } from './format.js';

/** The entities an applier writes to (a system's query results). */
export interface ApplyTargets {
  recognizers: Iterable<Entity>;
  puppets: Iterable<Entity>;
  lamps: Iterable<Entity>;
  moths: Iterable<Entity>;
  scenery: Iterable<Entity>;
  actors: Iterable<Entity>;
  stages: Iterable<Entity>;
  props: Iterable<Entity>;
}

const lampPos = new Vector3();

/** Build targets from a system's queries (the Sets stay live as entities change). */
export function applyTargets(q: { [K in keyof ApplyTargets]: { entities: Iterable<Entity> } }): ApplyTargets {
  return {
    get recognizers() { return q.recognizers.entities; },
    get puppets() { return q.puppets.entities; },
    get lamps() { return q.lamps.entities; },
    get moths() { return q.moths.entities; },
    get scenery() { return q.scenery.entities; },
    get actors() { return q.actors.entities; },
    get stages() { return q.stages.entities; },
    get props() { return q.props.entities; },
  };
}

/**
 * Apply a performance event (from a recording or a live room) to this stage.
 * 'beat' events are left to the caller, which decides how beats are entered.
 */
export function applyEvent(e: Pick<PerformanceEvent, 'type' | 'data'>, t: ApplyTargets): void {
  switch (e.type) {
    case 'snapshot':
      applySnapshot(e.data, t);
      break;
    case 'stage':
      for (const s of t.stages) {
        s.setValue(Stage, 'lampLevel', Number(e.data.lampLevel));
        s.setValue(Stage, 'finale', Number(e.data.finale));
      }
      for (const m of t.moths) m.setValue(Moth, 'glow', Number(e.data.glow));
      break;
    case 'lamp':
      for (const l of t.lamps) {
        l.object3D?.position.copy(pointFromStage(Number(e.data.x), Number(e.data.y), Number(e.data.z), lampPos));
      }
      break;
    case 'wake': {
      // Make the creature wake on cue even if recognition would differ here.
      const puppet = puppetFor(t, String(e.data.shape));
      const rec = first(t.recognizers);
      if (rec && puppet && puppet.getValue(ShadowPuppet, 'state') !== PuppetStates.Alive) {
        if (puppet.getValue(ShadowPuppet, 'state') === PuppetStates.Hidden) {
          puppet.setValue(ShadowPuppet, 'state', PuppetStates.Outline);
        }
        rec.setValue(ShapeRecognizer, 'matchedHand', String(e.data.hand) as never);
        rec.setValue(ShapeRecognizer, 'matchedShape', String(e.data.shape) as never);
        rec.setValue(ShapeRecognizer, 'twoHanded', Boolean(e.data.twoHanded));
      }
      break;
    }
    case 'release': {
      const puppet = puppetFor(t, String(e.data.shape));
      if (puppet?.getValue(ShadowPuppet, 'state') === PuppetStates.Alive) {
        puppet.setValue(ShadowPuppet, 'state', PuppetStates.Releasing);
      }
      break;
    }
    default:
      break;
  }
}

function applySnapshot(d: PerformanceEvent['data'], t: ApplyTargets): void {
  // Clear the viewer's own creatures and requests: the show starts on a clean stage.
  for (const p of t.puppets) p.setValue(ShadowPuppet, 'state', PuppetStates.Hidden);
  for (const r of t.recognizers) {
    r.setValue(ShapeRecognizer, 'target', 'none');
    r.setValue(ShapeRecognizer, 'target2', 'none');
    r.setValue(ShapeRecognizer, 'matchedHand', 'none');
    r.setValue(ShapeRecognizer, 'matchedShape', 'none');
    r.setValue(ShapeRecognizer, 'heldFor', 0);
  }
  for (const s of t.scenery) s.setValue(Scenery, 'set', String(d.scenery) as never);
  for (const m of t.moths) {
    m.setValue(Moth, 'restU', Number(d.mothRestU));
    m.setValue(Moth, 'restV', Number(d.mothRestV));
    m.setValue(Moth, 'glow', Number(d.mothGlow));
    m.setValue(Moth, 'mode', String(d.mothMode) as never);
  }
  for (const a of t.actors) {
    a.setValue(StageActor, 'u', Number(d.actorU));
    a.setValue(StageActor, 'v', Number(d.actorV));
    a.setValue(StageActor, 'state', String(d.actorState) as never);
  }
  for (const s of t.stages) {
    s.setValue(Stage, 'lampLevel', Number(d.lampLevel));
    s.setValue(Stage, 'finale', Number(d.finale));
  }
  for (const p of t.props) {
    p.setValue(HiddenProp, 'u', Number(d.propU));
    p.setValue(HiddenProp, 'active', Boolean(d.propActive));
  }
}

function puppetFor(t: ApplyTargets, shape: string): Entity | undefined {
  for (const p of t.puppets) {
    if (p.getValue(ShadowPuppet, 'shape') === shape) return p;
  }
  return undefined;
}

function first<T>(set: Iterable<T>): T | undefined {
  for (const v of set) return v;
  return undefined;
}

