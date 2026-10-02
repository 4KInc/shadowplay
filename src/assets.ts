import { AssetType, defineAssets } from '@iwsdk/core';
import deskLamp from './scene-assets/desk-lamp.scene-asset.js';
import journalBook from './scene-assets/journal-book.scene-asset.js';

const publicAssetUrl = (filePath: string): string =>
  `${import.meta.env.BASE_URL}${filePath.replace(/^\/+/u, '')}`;

export default defineAssets({
  'desk-lamp': deskLamp,
  'journal-book': journalBook,
  'settings-panel': {
    url: publicAssetUrl('ui/settings.uikitml'),
    type: AssetType.UIKitML,
    name: 'Settings Panel',
  },
});
