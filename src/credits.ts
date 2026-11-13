/**
 * Third-party work Shadowplay ships, with its licence: shown from a Credits
 * button on the first screen and in the family viewer (also in the README).
 * Everything else, the stories, characters, models and sounds, is original.
 */
export const CREDITS: ReadonlyArray<{ name: string; what: string; licence: string; by: string }> = [
  { name: 'Kokoro-82M', what: 'the storyteller voice (narration generated offline)', licence: 'Apache License 2.0', by: 'hexgrad' },
  { name: 'MediaPipe Hand Landmarker', what: 'camera hands in the family viewer (runs on the device)', licence: 'Apache License 2.0', by: 'Google' },
  { name: 'Inter', what: 'the typeface in the headset panels', licence: 'SIL Open Font License 1.1', by: 'The Inter Project Authors' },
  { name: 'Lucide', what: 'two interface icons', licence: 'ISC License', by: 'Lucide Contributors' },
  { name: 'three.js', what: '3D rendering', licence: 'MIT License', by: 'three.js authors' },
  { name: 'Immersive Web SDK', what: 'WebXR framework', licence: 'MIT License', by: 'Meta Platforms, Inc.' },
  { name: 'uikit', what: 'headset user interface', licence: 'MIT License', by: 'Bela Bohlender' },
];

const CSS = `
.sp-credits { position: fixed; inset: 0; z-index: 970; display: flex; align-items: center; justify-content: center;
  background: rgba(8, 6, 12, 0.7); padding: 16px; font: 15px/1.45 Georgia, 'Times New Roman', serif; color: #f6e3bd; }
.sp-credits > div { width: min(480px, 100%); max-height: calc(100vh - 32px); overflow: auto; box-sizing: border-box;
  background: #17121f; border: 1px solid #b8863b; border-radius: 18px; padding: 18px; }
.sp-credits h2 { margin: 0 0 6px; font-size: 20px; font-style: italic; color: #f2c47a; font-weight: 600; }
.sp-credits p { margin: 0 0 12px; color: #bfae8e; font-size: 14px; }
.sp-credits ul { margin: 0 0 14px; padding: 0; list-style: none; }
.sp-credits li { margin: 0 0 10px; }
.sp-credits b { color: #f2c47a; font-weight: 600; }
.sp-credits span { display: block; color: #d9c7a3; font-size: 13px; }
.sp-credits button { min-height: 48px; padding: 0 22px; border-radius: 24px; border: 2px solid #e0a24a; background: #e0a24a;
  color: #1a1320; font: inherit; font-size: 16px; cursor: pointer; }
`;

/** Open the Credits sheet (one at a time). */
export function openCredits(): void {
  if (document.querySelector('.sp-credits')) return;
  if (!document.getElementById('sp-credits-style')) {
    const style = document.createElement('style');
    style.id = 'sp-credits-style';
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  const sheet = document.createElement('div');
  sheet.className = 'sp-credits';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Credits');
  const box = document.createElement('div');
  const title = document.createElement('h2');
  title.textContent = 'Credits';
  const intro = document.createElement('p');
  intro.textContent = 'Rated 10+: gentle bedtime stories, made for a grown-up and a child together. The stories, characters, shadows, lamp and sounds are original to Shadowplay. It is built with:';
  const list = document.createElement('ul');
  for (const c of CREDITS) {
    const li = document.createElement('li');
    const name = document.createElement('b');
    name.textContent = c.name;
    const detail = document.createElement('span');
    detail.textContent = `${c.what}. ${c.by}, ${c.licence}.`;
    li.append(name, detail);
    list.appendChild(li);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Close';
  close.addEventListener('click', () => sheet.remove());
  sheet.addEventListener('click', (e) => e.target === sheet && sheet.remove());
  box.append(title, intro, list, close);
  sheet.appendChild(box);
  document.body.appendChild(sheet);
  close.focus();
}
