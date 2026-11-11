/**
 * Whether the player has stepped away from the story: the Quest menu is open
 * (XR visibility "visible-blurred"), the headset is off or the app is in the
 * background ("hidden"), or the page itself is hidden.
 *
 * Set from the visibility events themselves, not from a frame loop: while an XR
 * session is hidden no frames run, so audio has to be paused here.
 */
export const away = { now: false };

const listeners = new Set<(isAway: boolean) => void>();

/** Call `listener` whenever the player steps away or comes back; returns an unsubscribe. */
export function onAway(listener: (isAway: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setAway(isAway: boolean): void {
  if (isAway === away.now) return;
  away.now = isAway;
  for (const listener of listeners) listener(isAway);
}
