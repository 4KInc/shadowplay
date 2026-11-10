/**
 * The only Lucide icons Shadowplay uses (the Horizon UI kit's checkbox and
 * select). @drawcall/uikitml's kit loader does `import * as Lucide` and walks
 * every export, which pulled all ~1,500 icons (4.1 MB, 60% of the main chunk)
 * into the bundle. vite.config.ts points '@pmndrs/uikit-lucide' here instead.
 * Add an icon by re-exporting its file if a panel ever uses one.
 */
export * from '@pmndrs/uikit-lucide/dist/Check.js';
export * from '@pmndrs/uikit-lucide/dist/ChevronDown.js';
