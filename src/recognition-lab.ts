import { createSystem, Entity, Vector3 } from '@iwsdk/core';
import { FIXTURES, localJoints, PoseFixture, TESTERS, toWorld } from './hand-poses.js';
import { loadLabTrials, saveLabTrials } from './journal-store.js';
import { buildReport, LabSample, LabTrial } from './recognition-report.js';
import { RecognitionLab, ShapeRecognizer } from './shadowplay-components.js';
import { handOverride, handRuntime, JOINT_COUNT, stageRuntime } from './stage-runtime.js';

/**
 * Recognition lab for the week-1 device gate (development tool; inert unless
 * driven through its component, e.g. from the IWSDK CLI on a paired headset).
 * Records labelled trials of both recognition methods per frame, persists
 * them so several testers can be pooled, and exports a confusion matrix with
 * per-shape accuracy and the negative-set false-match rate.
 */
export class RecognitionLabSystem extends createSystem({
  labs: { required: [RecognitionLab] },
  recognizers: { required: [ShapeRecognizer] },
}) {
  private trials: LabTrial[] = [];
  private loaded = false;
  private loading = false;
  private current: LabTrial | null = null;
  private elapsed = 0;
  /** Synthetic run: queue of (fixture, tester), settle timer, results kept apart from real trials. */
  private auto: { fixture: PoseFixture; tester: (typeof TESTERS)[number] }[] | null = null;
  private autoTrials: LabTrial[] = [];
  private autoSettle = 0;
  private autoWasFree = false;
  private anchor = new Vector3();
  private wrist = new Vector3();
  private leftJoints = new Float32Array(JOINT_COUNT * 3);
  private rightJoints = new Float32Array(JOINT_COUNT * 3);

  update(delta: number): void {
    const lab = first(this.queries.labs.entities);
    const rec = first(this.queries.recognizers.entities);
    if (!lab || !rec) return;
    if (!this.loaded && !this.loading) this.load(lab);
    if (!this.loaded) return;

    if (lab.getValue(RecognitionLab, 'clearRequested')) {
      lab.setValue(RecognitionLab, 'clearRequested', false);
      this.trials = [];
      void saveLabTrials(this.trials);
      lab.setValue(RecognitionLab, 'trials', 0);
      lab.setValue(RecognitionLab, 'report', '');
      lab.setValue(RecognitionLab, 'status', 'Cleared all trials.');
    }
    if (lab.getValue(RecognitionLab, 'exportRequested')) {
      lab.setValue(RecognitionLab, 'exportRequested', false);
      this.export(lab, rec);
    }

    if (lab.getValue(RecognitionLab, 'autoRun') && !this.auto) this.startAuto(lab, rec);
    if (this.auto) {
      this.stepAuto(lab, rec, delta);
      return;
    }

    const recording = Boolean(lab.getValue(RecognitionLab, 'recording'));
    if (recording && !this.current) this.start(lab);
    if (!this.current) return;
    this.elapsed += delta;
    this.sample(rec);
    const length = lab.getValue(RecognitionLab, 'trialSeconds') ?? 5;
    if (this.elapsed >= length || !recording) this.finish(lab);
  }

  private load(lab: Entity): void {
    this.loading = true;
    loadLabTrials<LabTrial>().then((trials) => {
      this.trials = trials;
      lab.setValue(RecognitionLab, 'trials', trials.length);
      this.loaded = true;
    });
  }

  private start(lab: Entity): void {
    const label = (lab.getValue(RecognitionLab, 'label') ?? '').trim();
    if (!label) {
      lab.setValue(RecognitionLab, 'recording', false);
      lab.setValue(RecognitionLab, 'status', 'Set a label (a shape id or "negative") before recording.');
      return;
    }
    this.elapsed = 0;
    this.current = {
      tester: lab.getValue(RecognitionLab, 'tester') ?? 'tester',
      label,
      startedAt: Date.now(),
      samples: [],
    };
    lab.setValue(RecognitionLab, 'status', `Recording "${label}"...`);
  }

  private startAuto(lab: Entity, rec: Entity): void {
    if (!stageRuntime.ready) {
      lab.setValue(RecognitionLab, 'autoRun', false);
      lab.setValue(RecognitionLab, 'status', 'Synthetic run needs the stage to be placed first.');
      return;
    }
    this.auto = [];
    for (const tester of TESTERS) for (const fixture of FIXTURES) this.auto.push({ fixture, tester });
    this.autoTrials = [];
    this.autoWasFree = Boolean(rec.getValue(ShapeRecognizer, 'freeMode'));
    rec.setValue(ShapeRecognizer, 'freeMode', true); // so the hidden two-hand creatures are testable
    handOverride.active = true;
    handOverride.source = 'fixtures';
    this.loadNext();
  }

  /** Pose the next fixture's hands in the lamp light in front of the stage. */
  private loadNext(): void {
    const item = this.auto![0];
    if (!item) return;
    // A little way from the lamp towards the stage, so the shadow lands on the stage.
    this.anchor.copy(stageRuntime.bulb).lerp(stageRuntime.poolCenter, 0.22).addScaledVector(stageRuntime.up, -0.06);
    const place = (side: 'left' | 'right', out: Float32Array): Float32Array | null => {
      const pose = side === 'right' ? item.fixture.right : item.fixture.left;
      if (!pose) return null;
      const at = (side === 'right' ? item.fixture.rightAt : item.fixture.leftAt) ?? [0, 0];
      this.wrist.copy(this.anchor).addScaledVector(stageRuntime.right, at[0]).addScaledVector(stageRuntime.up, at[1]);
      const seed = item.tester.seed + (side === 'left' ? 1000 : 0) + FIXTURES.indexOf(item.fixture) * 7;
      const local = localJoints(pose, item.tester.scale, seed);
      return toWorld(local, side, this.wrist, stageRuntime.right, stageRuntime.up, stageRuntime.normal, out);
    };
    handOverride.right = place('right', this.rightJoints);
    handOverride.left = place('left', this.leftJoints);
    this.autoSettle = 0;
  }

  private stepAuto(lab: Entity, rec: Entity, delta: number): void {
    const item = this.auto![0];
    if (!item) {
      this.finishAuto(lab, rec);
      return;
    }
    if (!this.current) {
      // Let the matcher and the silhouette readback settle before recording.
      this.autoSettle += delta;
      if (this.autoSettle < 0.4) return;
      this.elapsed = 0;
      this.current = { tester: item.tester.name, label: item.fixture.label, startedAt: Date.now(), samples: [] };
      lab.setValue(RecognitionLab, 'status', `Synthetic: ${item.tester.name} / ${item.fixture.label} (${this.auto!.length} left)`);
      return;
    }
    this.elapsed += delta;
    this.sample(rec);
    if (this.elapsed >= 1) {
      this.autoTrials.push(this.current);
      this.current = null;
      this.auto!.shift();
      this.loadNext();
    }
  }

  private finishAuto(lab: Entity, rec: Entity): void {
    this.auto = null;
    handOverride.active = false;
    handOverride.left = handOverride.right = null;
    rec.setValue(ShapeRecognizer, 'freeMode', this.autoWasFree);
    lab.setValue(RecognitionLab, 'autoRun', false);
    const report = buildReport(this.autoTrials, rec.getValue(ShapeRecognizer, 'holdSeconds') ?? 0.5);
    const json = JSON.stringify({ source: 'synthetic', ...report });
    lab.setValue(RecognitionLab, 'syntheticReport', json);
    lab.setValue(RecognitionLab, 'status', `Synthetic run done: ${this.autoTrials.length} trials.`);
    console.info('[shadowplay] synthetic recognition report:', json);
  }

  private sample(rec: Entity): void {
    const trial = this.current!;
    for (const side of ['left', 'right'] as const) {
      const hand = handRuntime[side];
      if (!hand.tracked) continue;
      const fused = rec.getValue(ShapeRecognizer, side === 'left' ? 'leftShape' : 'rightShape') ?? '';
      const s: LabSample = {
        t: +this.elapsed.toFixed(3),
        hand: side,
        inLight: Boolean(rec.getValue(ShapeRecognizer, side === 'left' ? 'leftInLight' : 'rightInLight')),
        jointBest: hand.jointBest,
        jointScore: +hand.jointScore.toFixed(3),
        joint: hand.jointShape,
        silhouetteBest: hand.silhouetteBest,
        silhouetteOverlap: +hand.silhouetteBestOverlap.toFixed(3),
        silhouette: hand.silhouetteShape,
        fused,
        features: Array.from(hand.features, (v) => +v.toFixed(3)),
      };
      trial.samples.push(s);
    }
  }

  private finish(lab: Entity): void {
    const trial = this.current!;
    this.current = null;
    lab.setValue(RecognitionLab, 'recording', false);
    this.trials.push(trial);
    void saveLabTrials(this.trials);
    lab.setValue(RecognitionLab, 'trials', this.trials.length);
    const lit = trial.samples.filter((s) => s.inLight).length;
    lab.setValue(
      RecognitionLab,
      'status',
      `Saved "${trial.label}" (${trial.samples.length} samples, ${lit} in the light). ${this.trials.length} trials total.`,
    );
  }

  private export(lab: Entity, rec: Entity): void {
    const hold = rec.getValue(ShapeRecognizer, 'holdSeconds') ?? 0.5;
    const report = buildReport(this.trials, hold);
    const json = JSON.stringify(report);
    lab.setValue(RecognitionLab, 'report', json);
    lab.setValue(RecognitionLab, 'status', `Report built from ${report.trials} trials.`);
    console.info('[shadowplay] recognition lab report:', json);
    console.info('[shadowplay] recognition lab raw trials:', JSON.stringify(this.trials));
  }
}

function first<T>(set: Iterable<T>): T | undefined {
  for (const v of set) return v;
  return undefined;
}
