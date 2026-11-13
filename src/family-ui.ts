import { createSystem, Entity, VisibilityState } from '@iwsdk/core';
import { openCredits } from './credits.js';
import { family } from './family.js';
import { Settings, ToleranceLevels } from './shadowplay-components.js';
import { viewerMode } from './viewer-mode.js';

const CSS = `
.sp-family-chip { position: fixed; left: 16px; top: calc(16px + env(safe-area-inset-top, 0px)); z-index: 880; min-height: 44px;
  padding: 0 18px; border-radius: 22px; border: 1px solid #6b4f2a; background: rgba(18, 13, 26, 0.88); color: #f2c47a;
  font: italic 16px Georgia, 'Times New Roman', serif; cursor: pointer; }
.sp-access { position: fixed; left: 16px; top: calc(70px + env(safe-area-inset-top, 0px)); z-index: 880; display: flex; gap: 8px; flex-wrap: wrap;
  max-width: calc(100vw - 32px); }
.sp-access button { min-height: 44px; padding: 0 16px; border-radius: 22px; border: 1px solid #6b4f2a; background: rgba(18, 13, 26, 0.88);
  color: #d9c7a3; font: 15px Georgia, 'Times New Roman', serif; cursor: pointer; }
.sp-access button[aria-pressed="true"] { background: #e0a24a; border-color: #e0a24a; color: #1a1320; }
/* Narrow screens: below the Enter XR button, which sits top centre. */
@media (max-width: 560px) {
  .sp-family-chip { top: calc(64px + env(safe-area-inset-top, 0px)); }
  .sp-access { top: calc(118px + env(safe-area-inset-top, 0px)); }
}
.sp-credits-link { position: fixed; left: 16px; bottom: calc(16px + env(safe-area-inset-bottom, 0px)); z-index: 880; min-height: 44px;
  padding: 0 16px; border-radius: 22px; border: 1px solid #4a3d5c; background: rgba(18, 13, 26, 0.7); color: #bfae8e;
  font: 14px Georgia, 'Times New Roman', serif; cursor: pointer; }
.sp-family-sheet { position: fixed; inset: 0; z-index: 960; display: flex; align-items: center; justify-content: center;
  background: rgba(8, 6, 12, 0.6); padding: 16px; font: 16px/1.4 Georgia, 'Times New Roman', serif; color: #f6e3bd; }
.sp-family-sheet form { width: min(440px, 100%); background: #17121f; border: 1px solid #b8863b; border-radius: 18px; padding: 18px; }
.sp-family-sheet h2 { margin: 0 0 6px; font-size: 20px; font-style: italic; color: #f2c47a; font-weight: 600; }
.sp-family-sheet p { margin: 0 0 14px; color: #bfae8e; font-size: 14px; }
.sp-family-sheet label { display: block; margin: 10px 0 4px; color: #d9c7a3; font-size: 15px; }
.sp-family-sheet input { width: 100%; box-sizing: border-box; min-height: 48px; border-radius: 24px; border: 1px solid #6b4f2a;
  background: #1d1826; color: #f6e3bd; font: inherit; padding: 0 16px; }
.sp-family-sheet .row { display: flex; gap: 10px; margin-top: 16px; flex-wrap: wrap; }
.sp-family-sheet button { min-height: 52px; padding: 0 22px; border-radius: 26px; border: 2px solid #e0a24a; background: #3a2716;
  color: #f2c47a; font: inherit; font-size: 17px; cursor: pointer; }
.sp-family-sheet button.on { background: #e0a24a; color: #1a1320; }
`;

/**
 * The first screen, before entering the headset view: family names (typing in
 * immersive mode is awkward), plus the accessibility options (one-hand
 * mode, forgiving shapes and high contrast), so nobody has to find them inside the journal.
 * Hidden on the family viewer and during an immersive session.
 */
export class FamilySetupSystem extends createSystem({
  settings: { required: [Settings] },
}) {
  private chip: HTMLButtonElement | null = null;
  private access: HTMLDivElement | null = null;
  private oneHand: HTMLButtonElement | null = null;
  private forgiving: HTMLButtonElement | null = null;
  private contrast: HTMLButtonElement | null = null;
  private credits: HTMLButtonElement | null = null;
  private style: HTMLStyleElement | null = null;
  private shownLabel = '';

  init(): void {
    this.cleanupFuncs.push(() => {
      this.chip?.remove();
      this.access?.remove();
      this.credits?.remove();
      this.style?.remove();
      document.querySelector('.sp-family-sheet')?.remove();
    });
  }

  update(): void {
    const show = !viewerMode.on && this.world.visibilityState.peek() === VisibilityState.NonImmersive;
    if (show && !this.chip) this.build();
    if (!this.chip) return;
    if (this.chip.hidden === show) this.chip.hidden = this.access!.hidden = this.credits!.hidden = !show;
    const settings = this.settingsEntity();
    if (settings && show) {
      setPressed(this.oneHand!, Boolean(settings.getValue(Settings, 'oneHand')));
      setPressed(this.forgiving!, isForgiving(settings.getValue(Settings, 'tolerance')));
      setPressed(this.contrast!, Boolean(settings.getValue(Settings, 'highContrast')));
    }
    const child = family.own.child;
    const label = child ? `Stories for ${child}` : 'Who are the stories for?';
    if (label !== this.shownLabel) {
      this.shownLabel = label;
      this.chip.textContent = label;
    }
  }

  private build(): void {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    this.chip = document.createElement('button');
    this.chip.className = 'sp-family-chip';
    this.chip.addEventListener('click', () => this.open());
    document.body.appendChild(this.chip);

    this.access = document.createElement('div');
    this.access.className = 'sp-access';
    this.access.setAttribute('role', 'group');
    this.access.setAttribute('aria-label', 'Accessibility');
    this.oneHand = toggle('One-hand mode', 'The two-hand bird works with one open hand');
    this.forgiving = toggle('Forgiving shapes', 'Shapes count even when they are not quite right');
    this.oneHand.addEventListener('click', () => {
      const s = this.settingsEntity();
      if (s) s.setValue(Settings, 'oneHand', !s.getValue(Settings, 'oneHand'));
    });
    this.forgiving.addEventListener('click', () => {
      const s = this.settingsEntity();
      if (!s) return;
      const on = isForgiving(s.getValue(Settings, 'tolerance'));
      s.setValue(Settings, 'tolerance', on ? ToleranceLevels.Normal : ToleranceLevels.Forgiving);
    });
    this.contrast = toggle('High contrast', 'Black-and-white panels and captions, solid shadows on the wall');
    this.contrast.addEventListener('click', () => {
      const s = this.settingsEntity();
      if (s) s.setValue(Settings, 'highContrast', !s.getValue(Settings, 'highContrast'));
    });
    this.access.append(this.oneHand, this.forgiving, this.contrast);
    document.body.appendChild(this.access);

    this.credits = document.createElement('button');
    this.credits.type = 'button';
    this.credits.className = 'sp-credits-link';
    this.credits.textContent = 'Credits';
    this.credits.addEventListener('click', openCredits);
    document.body.appendChild(this.credits);
  }

  private settingsEntity(): Entity | undefined {
    return this.queries.settings.entities.values().next().value;
  }

  private open(): void {
    if (document.querySelector('.sp-family-sheet')) return;
    const sheet = document.createElement('div');
    sheet.className = 'sp-family-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', 'Your family');
    sheet.innerHTML = `
      <form autocomplete="off">
        <h2>Your family</h2>
        <p>The story will say your child's name, and your stories will be signed with yours. Names stay on this device
        and travel only inside the stories you send.</p>
        <label for="sp-child">Who are the stories for?</label>
        <input id="sp-child" name="child" maxlength="24" placeholder="e.g. Mia" />
        <label for="sp-performer">Your name, as they call you</label>
        <input id="sp-performer" name="performer" maxlength="24" placeholder="e.g. Dad, Grandma Rosa" />
        <div class="row">
          <button class="on" type="submit">Save</button>
          <button type="button" data-act="cancel">Cancel</button>
        </div>
      </form>`;
    const form = sheet.querySelector('form')!;
    const child = form.querySelector<HTMLInputElement>('[name="child"]')!;
    const performer = form.querySelector<HTMLInputElement>('[name="performer"]')!;
    child.value = family.own.child;
    performer.value = family.own.performer;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void family.save({ child: child.value, performer: performer.value });
      sheet.remove();
    });
    sheet.querySelector('[data-act="cancel"]')?.addEventListener('click', () => sheet.remove());
    document.body.appendChild(sheet);
    child.focus();
  }
}

function toggle(label: string, title: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.title = title;
  b.setAttribute('aria-pressed', 'false');
  return b;
}

function setPressed(b: HTMLButtonElement, on: boolean): void {
  const value = on ? 'true' : 'false';
  if (b.getAttribute('aria-pressed') !== value) b.setAttribute('aria-pressed', value);
}

/** Forgiving or very forgiving (the in-headset panel offers both). */
function isForgiving(tolerance: unknown): boolean {
  return tolerance === ToleranceLevels.Forgiving || tolerance === ToleranceLevels.VeryForgiving;
}
