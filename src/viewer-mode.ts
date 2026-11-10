/**
 * Family viewer mode: on for ?viewer (and share links); in dev builds the V
 * key toggles it too, so the viewer can be exercised in the managed browser.
 */
export const viewerMode = {
  on: typeof location !== 'undefined' && new URLSearchParams(location.search).has('viewer'),
};
