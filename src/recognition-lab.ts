import { createSystem, Entity } from '@iwsdk/core';
import { loadLabTrials, saveLabTrials } from './journal-store.js';
import { buildReport, LabSample, LabTrial } from './recognition-report.js';
import { RecognitionLab, ShapeRecognizer } from './shadowplay-components.js';
import { handRuntime } from './stage-runtime.js';

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
