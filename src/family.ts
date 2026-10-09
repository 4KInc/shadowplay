import { loadFamily, saveFamily } from './journal-store.js';

/**
 * Who the story is for and who is telling it. Story lines can say
 * `{child|puppeteer}`: the child's name, or the fallback when no name is
 * set. A replay or live story uses the names that came with it, so a
 * grandmother's recording says her grandchild's name on any device.
 */
export interface FamilyNames {
  child: string;
  performer: string;
}

const own: FamilyNames = { child: '', performer: '' };
let borrowed: FamilyNames | null = null;
let loaded: Promise<void> | null = null;

export const family = {
  /** This device's own family profile (loaded from IndexedDB). */
  get own(): FamilyNames {
    return own;
  },
  /** The names in use now: a replay's or live host's, else this device's. */
  get current(): FamilyNames {
    return borrowed ?? own;
  },
  load(): Promise<void> {
    loaded ??= loadFamily().then((stored) => {
      if (stored) Object.assign(own, clean(stored));
    });
    return loaded;
  },
  async save(names: FamilyNames): Promise<void> {
    Object.assign(own, clean(names));
    await saveFamily({ ...own });
  },
  /** Use someone else's names while their story plays (null to stop). */
  borrow(names: FamilyNames | null): void {
    borrowed = names ? clean(names) : null;
  },
};

function clean(names: Partial<FamilyNames>): FamilyNames {
  const tidy = (s: unknown) => (typeof s === 'string' ? s.replace(/[{}<>]/g, '').trim().slice(0, 24) : '');
  return { child: tidy(names.child), performer: tidy(names.performer) };
}

/** Fill `{child|fallback}` and `{performer|fallback}` placeholders. */
export function personalise(text: string, names: FamilyNames = family.current): string {
  return text.replace(/\{(child|performer)(?:\|([^}]*))?\}/g, (_, key: keyof FamilyNames, fallback = '') => names[key] || fallback);
}
