import type { World } from '@iwsdk/core';
import { CameraHandsSystem } from '../camera-hands.js';
import { ViewerUISystem } from '../viewer-ui.js';

/** Systems only the family viewer needs (phone, tablet): its page UI and camera hands. */
export function registerViewer(world: World): void {
  world.registerSystem(CameraHandsSystem).registerSystem(ViewerUISystem);
}
