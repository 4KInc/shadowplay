import { accessRuntime } from './stage-runtime.js';

/** Button and panel colours for the headset panels: the usual ink and amber, or high contrast. */
const NORMAL = {
  root: { backgroundColor: '#17121f', borderColor: '#b8863b', borderWidth: 0.25 },
  selected: { backgroundColor: '#e0a24a', borderColor: '#f2c47a', color: '#1a1320' },
  unselected: { backgroundColor: '#2b2338', borderColor: '#4a3d5c', color: '#f6e3bd' },
  locked: { backgroundColor: '#1d1826', borderColor: '#2e2639', color: '#6b5f7a' },
  replay: { backgroundColor: '#3a2716', borderColor: '#e0a24a', color: '#f2c47a' },
  /** Text on a selected, unselected and dimmed button. */
  ink: '#1a1320',
  cream: '#f6e3bd',
  muted: '#6b5f7a',
};

/** Black and white with one strong yellow for "selected"; thicker borders. */
const HIGH_CONTRAST: typeof NORMAL = {
  root: { backgroundColor: '#000000', borderColor: '#ffffff', borderWidth: 0.4 },
  selected: { backgroundColor: '#ffd400', borderColor: '#ffffff', color: '#000000' },
  unselected: { backgroundColor: '#000000', borderColor: '#ffffff', color: '#ffffff' },
  locked: { backgroundColor: '#000000', borderColor: '#7a7a7a', color: '#a8a8a8' },
  replay: { backgroundColor: '#000000', borderColor: '#ffd400', color: '#ffd400' },
  ink: '#000000',
  cream: '#ffffff',
  muted: '#a8a8a8',
};

export function palette(): typeof NORMAL {
  return accessRuntime.highContrast ? HIGH_CONTRAST : NORMAL;
}
