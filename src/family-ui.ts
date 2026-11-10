import { createSystem, VisibilityState } from '@iwsdk/core';
import { family } from './family.js';
import { viewerMode } from './viewer-mode.js';

const CSS = `
.sp-family-chip { position: fixed; left: 16px; top: calc(16px + env(safe-area-inset-top, 0px)); z-index: 880; min-height: 44px;
  padding: 0 18px; border-radius: 22px; border: 1px solid #6b4f2a; background: rgba(18, 13, 26, 0.88); color: #f2c47a;
  font: italic 16px Georgia, 'Times New Roman', serif; cursor: pointer; }
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
 * Family names, set on the page before entering the headset view (typing in
 * immersive mode is awkward): who the stories are for and who tells them.
 * Hidden on the family viewer and during an immersive session.
 */
export class FamilySetupSystem extends createSystem({}) {
  private chip: HTMLButtonElement | null = null;
  private style: HTMLStyleElement | null = null;
  private shownLabel = '';

  init(): void {
    this.cleanupFuncs.push(() => {
      this.chip?.remove();
      this.style?.remove();
      document.querySelector('.sp-family-sheet')?.remove();
    });
  }

  update(): void {
    const show = !viewerMode.on && this.world.visibilityState.peek() === VisibilityState.NonImmersive;
    if (show && !this.chip) this.build();
    if (!this.chip) return;
    if (this.chip.hidden === show) this.chip.hidden = !show;
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
