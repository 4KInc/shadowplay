import { createSystem } from '@iwsdk/core';
import { LiveSession } from '../shadowplay-components.js';
import { viewerMode } from '../viewer-mode.js';

/**
 * Loads code by role, so neither page downloads the other's: the headset's
 * systems when not in the family viewer, the viewer's UI and camera hands in
 * it, and Live only when someone goes live or joins. Each is its own chunk.
 */
export class RoleLoaderSystem extends createSystem({ sessions: { required: [LiveSession] } }) {
  private headset = false;
  private viewer = false;
  private live = false;

  init(): void {
    // Development: V switches the page between headset and viewer.
    if (import.meta.env.DEV) {
      const onKey = (e: KeyboardEvent) => {
        if (e.repeat || e.metaKey || e.ctrlKey || e.key.toLowerCase() !== 'v') return;
        if ((e.target as HTMLElement | null)?.closest?.('input, textarea')) return;
        viewerMode.on = !viewerMode.on;
      };
      window.addEventListener('keydown', onKey);
      this.cleanupFuncs.push(() => window.removeEventListener('keydown', onKey));
    }
  }

  update(): void {
    if (!viewerMode.on && !this.headset) {
      this.headset = true;
      void import('./headset.js').then(({ registerHeadset }) => registerHeadset(this.world));
    }
    if (viewerMode.on && !this.viewer) {
      this.viewer = true;
      void import('./viewer.js').then(({ registerViewer }) => registerViewer(this.world));
    }
    if (!this.live) {
      const role = this.queries.sessions.entities.values().next().value?.getValue(LiveSession, 'role') ?? 'off';
      if (role !== 'off') {
        this.live = true;
        void import('../live/live-system.js').then(({ LiveSystem }) => this.world.registerSystem(LiveSystem));
      }
    }
  }
}
