import { Matrix4, Quaternion, Vector3 } from '@iwsdk/core';

/** localStorage: the last wall stage's persistent anchor and its width. */
const SAVED_KEY = 'shadowplay.stage-anchor';

/**
 * '' before XR; 'unsupported' (no anchors in this browser or session), 'pending'
 * (being created), 'live' (stage locked to it), 'saved' (live, and remembered for
 * the next launch), 'restored' (the stage came back to last time's wall), 'failed'.
 */
export type AnchorState = '' | 'unsupported' | 'pending' | 'live' | 'saved' | 'restored' | 'failed';

interface Saved {
  uuid: string;
  width: number;
}

type PersistentSession = XRSession & {
  restorePersistentAnchor?: (uuid: string) => Promise<XRAnchor>;
  deletePersistentAnchor?: (uuid: string) => Promise<void>;
};
type PersistentAnchor = XRAnchor & { requestPersistentHandle?: () => Promise<string> };

function readSaved(): Saved | null {
  try {
    const s = JSON.parse(localStorage.getItem(SAVED_KEY) ?? 'null');
    return s && typeof s.uuid === 'string' && typeof s.width === 'number' ? s : null;
  } catch {
    return null;
  }
}

function writeSaved(s: Saved | null): void {
  try {
    if (s) localStorage.setItem(SAVED_KEY, JSON.stringify(s));
    else localStorage.removeItem(SAVED_KEY);
  } catch {
    // Storage blocked: the stage is still anchored for this session.
  }
}

/**
 * The stage's WebXR anchor: a point the headset keeps fixed to the real room.
 * While the stage stands on a wall it follows the anchor, so a tracking
 * correction (the headset re-finding the room) moves it back onto the wall
 * instead of leaving it floating. A wall stage is also made persistent where the
 * browser allows it, and the next session restores it: the stage comes back to
 * the same wall. Every step is optional; without anchors the stage is placed as
 * before.
 */
export class StageAnchor {
  state: AnchorState = '';
  /** Corrections applied since the session began (diagnostics). */
  fixes = 0;
  /** The largest correction so far, centimetres. */
  maxFixCm = 0;
  /** This session's stage went back to the wall remembered from last time. */
  fromLastTime = false;

  private session: PersistentSession | null = null;
  /** The XR session begin() was last called for. */
  began: XRSession | null = null;
  private anchor: XRAnchor | null = null;
  private uuid = '';
  /** Last session's anchor, until the first placement uses or discards it. */
  private restored: XRAnchor | null = null;
  private restoredWidth = 0;
  private restoring = false;
  /** Bumped by every placement and session change: stale async results are dropped. */
  private generation = 0;
  private pose = new Matrix4();
  private tmp = new Matrix4();
  private q = new Quaternion();
  private p = new Vector3();
  private s = new Vector3();

  /** A new XR session: start restoring last time's wall, if there was one. */
  begin(session: XRSession | null | undefined, disabled: boolean): void {
    this.end();
    this.session = (session ?? null) as PersistentSession | null;
    this.began = session ?? null;
    this.fixes = 0;
    this.maxFixCm = 0;
    this.fromLastTime = false;
    const frameProto = (globalThis as { XRFrame?: { prototype: { createAnchor?: unknown } } }).XRFrame?.prototype;
    if (!session || disabled || typeof frameProto?.createAnchor !== 'function') {
      this.state = 'unsupported';
      return;
    }
    const saved = readSaved();
    if (!saved || !this.session!.restorePersistentAnchor) return;
    const generation = this.generation;
    this.restoring = true;
    this.session!.restorePersistentAnchor(saved.uuid).then(
      (anchor) => {
        this.restoring = false;
        if (generation !== this.generation) return void anchor.delete();
        this.restored = anchor;
        this.restoredWidth = saved.width;
        this.uuid = saved.uuid;
      },
      () => {
        // Not in this room (or forgotten by the headset): scan as usual.
        this.restoring = false;
        if (generation === this.generation) writeSaved(null);
      },
    );
  }

  /** The session ended: let go of live anchors (the saved one stays for next time). */
  end(): void {
    this.generation++;
    this.anchor?.delete();
    this.restored?.delete();
    this.anchor = null;
    this.restored = null;
    this.restoring = false;
    this.session = null;
    this.began = null;
    this.uuid = '';
    this.state = '';
  }

  /** Still waiting to hear whether last session's anchor can be restored. */
  get waiting(): boolean {
    return this.restoring;
  }

  /**
   * Last session's stage pose (stage centre, and its basis: +Z toward the player),
   * if restored and tracked this frame. Null otherwise.
   */
  restoredPose(frame: XRFrame | undefined, ref: XRReferenceSpace | null, out: Matrix4): number {
    if (!this.restored || !frame || !ref) return 0;
    const pose = frame.getPose(this.restored.anchorSpace, ref);
    if (!pose) return 0;
    out.fromArray(pose.transform.matrix);
    return this.restoredWidth;
  }

  /** Drop last session's anchor without using it (the stage went somewhere else). */
  discardRestored(): void {
    this.restored?.delete();
    this.restored = null;
  }

  /**
   * The stage was just placed (`stage` is its world matrix): replace the anchor
   * with one here. Only a wall stage is remembered for the next launch; a paper
   * screen floats where the player happens to sit.
   */
  place(frame: XRFrame | undefined, ref: XRReferenceSpace | null, stage: Matrix4, width: number, remember: boolean): void {
    if (this.state === 'unsupported' || !this.session) return;
    this.discardRestored();
    const generation = ++this.generation;
    this.anchor?.delete();
    this.anchor = null;
    const oldUuid = this.uuid;
    this.uuid = '';
    if (oldUuid) {
      // A new spot replaces the remembered one, here and in the headset's store.
      writeSaved(null);
      this.session.deletePersistentAnchor?.(oldUuid).catch(() => {});
    }
    if (!frame?.createAnchor || !ref) {
      this.state = 'unsupported';
      return;
    }
    const p = this.p;
    stage.decompose(p, this.q, this.s);
    this.state = 'pending';
    let created: Promise<XRAnchor | undefined> | undefined;
    try {
      created = frame.createAnchor(new XRRigidTransform({ x: p.x, y: p.y, z: p.z }, { x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w }), ref);
    } catch {
      created = undefined;
    }
    if (!created) {
      this.state = 'failed';
      return;
    }
    created.then(
      async (anchor) => {
        if (!anchor) return void (generation === this.generation && (this.state = 'failed'));
        if (generation !== this.generation) return void anchor.delete();
        this.anchor = anchor;
        this.state = 'live';
        const persistent = anchor as PersistentAnchor;
        if (!remember || !persistent.requestPersistentHandle) return;
        try {
          const uuid = await persistent.requestPersistentHandle();
          if (generation !== this.generation) return;
          this.uuid = uuid;
          writeSaved({ uuid, width });
          this.state = 'saved';
        } catch {
          // Live for this session only.
        }
      },
      () => {
        if (generation === this.generation) this.state = 'failed';
      },
    );
  }

  /**
   * Where the anchor says the stage should be now, as a correction to apply to
   * the stage's world matrix (`stage`): writes the delta transform into `out` and
   * returns its size in metres, or 0 when there is nothing to correct.
   */
  correction(frame: XRFrame | undefined, ref: XRReferenceSpace | null, stage: Matrix4, out: Matrix4): number {
    if (!this.anchor || !frame || !ref) return 0;
    const pose = frame.getPose(this.anchor.anchorSpace, ref);
    if (!pose) return 0;
    this.pose.fromArray(pose.transform.matrix);
    // delta = anchorPose * stage^-1: maps where the stage is to where it belongs.
    out.multiplyMatrices(this.pose, this.tmp.copy(stage).invert());
    const a = this.pose.elements;
    const b = stage.elements;
    const moved = Math.hypot(a[12] - b[12], a[13] - b[13], a[14] - b[14]);
    // Rotation angle of the delta from its trace (a + b + c = 1 + 2 cos θ).
    const e = out.elements;
    const turned = Math.acos(Math.min(1, Math.max(-1, (e[0] + e[5] + e[10] - 1) / 2)));
    // A metre or more is not drift but a bad pose: leave the stage alone.
    if (moved > 1) return 0;
    return moved > 0.015 || turned > 0.017 ? Math.max(moved, 0.001) : 0;
  }

  /** Count an applied correction (diagnostics). */
  corrected(cm: number): void {
    this.fixes++;
    this.maxFixCm = Math.max(this.maxFixCm, Math.round(cm));
  }
}
