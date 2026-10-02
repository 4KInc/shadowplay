/**
 * Analysis for the recognition lab (week-1 device gate). Pure functions over
 * recorded trials: confusion matrices for each method, per-shape accuracy,
 * whether a trial would have triggered a match (a held run of the label), and
 * false-match / false-trigger rates on the negative set.
 */
export const NEGATIVE = 'negative';
/** Predictions that never count as a match. */
const NEUTRAL = new Set(['', 'none', 'open']);

export type Method = 'joint' | 'silhouette' | 'fused';
export const METHODS: readonly Method[] = ['joint', 'silhouette', 'fused'];

export interface LabSample {
  /** Seconds since the trial started. */
  t: number;
  hand: 'left' | 'right';
  inLight: boolean;
  /** Joint method: best template and score, and the shape after the tolerance threshold. */
  jointBest: string;
  jointScore: number;
  joint: string;
  /** Silhouette method: best template and overlap, and the shape after its threshold. */
  silhouetteBest: string;
  silhouetteOverlap: number;
  silhouette: string;
  /** What the matcher used: the joint shape, else the silhouette shape. */
  fused: string;
}

export interface LabTrial {
  tester: string;
  label: string;
  startedAt: number;
  samples: LabSample[];
}

type Counts = Record<string, Record<string, number>>;

export interface LabReport {
  generatedAt: string;
  testers: string[];
  trials: number;
  holdSeconds: number;
  perShape: Record<
    string,
    { trials: number; frames: number; accuracy: Record<Method, number>; triggered: Record<Method, number> }
  >;
  confusion: Record<Method, Counts>;
  negative: {
    trials: number;
    frames: number;
    falseMatchRate: Record<Method, number>;
    falseTriggers: Record<Method, { trial: number; shape: string; seconds: number }[]>;
  };
}

function pred(s: LabSample, m: Method): string {
  const v = m === 'joint' ? s.joint : m === 'silhouette' ? s.silhouette : s.fused;
  return v || 'none';
}

/** Longest run (seconds) per hand in which `test` holds, using sample timestamps. */
function longestRun(samples: LabSample[], test: (s: LabSample) => boolean): number {
  let best = 0;
  for (const hand of ['left', 'right'] as const) {
    let start = -1;
    let last = 0;
    for (const s of samples) {
      if (s.hand !== hand) continue;
      if (s.inLight && test(s)) {
        if (start < 0) start = s.t;
        last = s.t;
        best = Math.max(best, last - start);
      } else {
        start = -1;
      }
    }
  }
  return best;
}

export function buildReport(trials: LabTrial[], holdSeconds = 0.5): LabReport {
  const confusion = { joint: {}, silhouette: {}, fused: {} } as Record<Method, Counts>;
  const perShape: LabReport['perShape'] = {};
  const negative: LabReport['negative'] = {
    trials: 0,
    frames: 0,
    falseMatchRate: { joint: 0, silhouette: 0, fused: 0 },
    falseTriggers: { joint: [], silhouette: [], fused: [] },
  };
  const negHits: Record<Method, number> = { joint: 0, silhouette: 0, fused: 0 };

  trials.forEach((trial, index) => {
    const lit = trial.samples.filter((s) => s.inLight);
    const isNeg = trial.label === NEGATIVE;
    for (const m of METHODS) {
      const row = (confusion[m][trial.label] ??= {});
      for (const s of lit) row[pred(s, m)] = (row[pred(s, m)] ?? 0) + 1;
    }
    if (isNeg) {
      negative.trials++;
      negative.frames += lit.length;
      for (const m of METHODS) {
        negHits[m] += lit.filter((s) => !NEUTRAL.has(pred(s, m))).length;
        // A false trigger: any non-neutral shape held long enough to summon.
        const shapes = new Set(lit.map((s) => pred(s, m)).filter((p) => !NEUTRAL.has(p)));
        for (const shape of shapes) {
          const seconds = longestRun(trial.samples, (s) => pred(s, m) === shape);
          if (seconds >= holdSeconds) negative.falseTriggers[m].push({ trial: index, shape, seconds: +seconds.toFixed(2) });
        }
      }
      return;
    }
    const entry = (perShape[trial.label] ??= {
      trials: 0,
      frames: 0,
      accuracy: { joint: 0, silhouette: 0, fused: 0 },
      triggered: { joint: 0, silhouette: 0, fused: 0 },
    });
    entry.trials++;
    entry.frames += lit.length;
    for (const m of METHODS) {
      entry.accuracy[m] += lit.filter((s) => pred(s, m) === trial.label).length;
      if (longestRun(trial.samples, (s) => pred(s, m) === trial.label) >= holdSeconds) entry.triggered[m]++;
    }
  });

  // Convert counts to rates.
  for (const entry of Object.values(perShape)) {
    for (const m of METHODS) {
      entry.accuracy[m] = entry.frames ? +(entry.accuracy[m] / entry.frames).toFixed(3) : 0;
      entry.triggered[m] = entry.trials ? +(entry.triggered[m] / entry.trials).toFixed(3) : 0;
    }
  }
  for (const m of METHODS) {
    negative.falseMatchRate[m] = negative.frames ? +(negHits[m] / negative.frames).toFixed(3) : 0;
  }
  return {
    generatedAt: new Date().toISOString(),
    testers: [...new Set(trials.map((t) => t.tester))],
    trials: trials.length,
    holdSeconds,
    perShape,
    confusion,
    negative,
  };
}
