import {
  CanvasTexture,
  createSystem,
  Entity,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';
import { CREATURES, drawJournalPage, PAGE_H, PAGE_W, slotCenter } from './creatures.js';
import { loadCreatures, saveCreature } from './journal-store.js';
import { buildPuppetRig, PuppetRig } from './puppet-rigs.js';
import { ShadowJournal, StoryState } from './shadowplay-components.js';
import { stageRuntime } from './stage-runtime.js';
import { playSoftRise } from './sfx.js';

/**
 * The Shadow Journal: loads discovered creatures from IndexedDB, records new
 * ones the story reports, pulses the book's emblem when a page is added, and
 * shows the open journal as a page on the stage.
 */
export class JournalSystem extends createSystem({
  journals: { required: [ShadowJournal] },
  stories: { required: [StoryState] },
}) {
  private discovered = new Set<string>();
  private loaded = false;
  private loading = false;
  private pulse = 0;
  private emblem: MeshStandardMaterial | null = null;
  private page!: { canvas: HTMLCanvasElement; texture: CanvasTexture; material: MeshBasicMaterial; mesh: Mesh };
  private overlay = new Group();
  private rigs = new Map<string, PuppetRig>();
  private ink = new MeshBasicMaterial({ color: 0x1b1624, transparent: true, opacity: 0 });
  private eye = new MeshBasicMaterial({ color: 0xd88a2c, transparent: true, opacity: 0 });
  private level = 0;
  private dirty = true;
  private endingsShown = '';
  private quat = new Quaternion();
  private yAxis = new Vector3(0, 1, 0);

  init(): void {
    const canvas = document.createElement('canvas');
    canvas.width = PAGE_W;
    canvas.height = PAGE_H;
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    const material = new MeshBasicMaterial({ map: texture, transparent: true, opacity: 0, depthWrite: false });
    const mesh = new Mesh(new PlaneGeometry(1, PAGE_H / PAGE_W), material);
    mesh.name = 'journal-page';
    mesh.renderOrder = 30;
    this.page = { canvas, texture, material, mesh };
    this.overlay.name = 'journal-overlay';
    this.overlay.add(mesh);
    CREATURES.forEach((c, i) => {
      if (!c.rig) return;
      const rig = buildPuppetRig(c.rig, this.ink, this.eye);
      const { x, y } = slotCenter(i);
      rig.root.position.set(x / PAGE_W - 0.5, (0.5 - y / PAGE_H) * (PAGE_H / PAGE_W), 0.002);
      rig.root.scale.setScalar(0.16);
      rig.root.traverse((o) => (o.renderOrder = 31));
      rig.root.visible = false;
      this.overlay.add(rig.root);
      this.rigs.set(c.id, rig);
    });
    this.world.createTransformEntity(this.overlay);
    this.cleanupFuncs.push(() => {
      texture.dispose();
      material.dispose();
      mesh.geometry.dispose();
      this.ink.dispose();
      this.eye.dispose();
    });
  }

  update(delta: number): void {
    const journal = this.queries.journals.entities.values().next().value as Entity | undefined;
    if (!journal) return;
    if (!this.loaded && !this.loading) this.load(journal);

    const pending = journal.getValue(ShadowJournal, 'pendingAdd') ?? '';
    if (pending && this.loaded) {
      journal.setValue(ShadowJournal, 'pendingAdd', '');
      this.add(journal, pending);
    }

    this.bindEmblem(journal);
    this.pulse = Math.max(0, this.pulse - delta * 0.4);
    if (this.emblem) {
      const glow = 0.5 + 0.5 * Math.sin(performance.now() * 0.008);
      this.emblem.emissiveIntensity = 1.2 + this.pulse * 3 * glow;
    }
    this.updateOverlay(Boolean(journal.getValue(ShadowJournal, 'open')), delta);
  }

  private load(journal: Entity): void {
    this.loading = true;
    loadCreatures().then((entries) => {
      for (const e of entries) this.discovered.add(e.id);
      this.loaded = true;
      this.sync(journal);
    });
  }

  private add(journal: Entity, id: string): void {
    const chapter = this.queries.stories.entities.values().next().value?.getValue(StoryState, 'chapter') ?? '';
    journal.setValue(ShadowJournal, 'lastAdded', id);
    this.pulse = 1;
    playSoftRise(journal.object3D?.position);
    if (this.discovered.has(id)) return;
    this.discovered.add(id);
    void saveCreature({ id, discoveredAt: Date.now(), chapter });
    this.sync(journal);
  }

  private sync(journal: Entity): void {
    journal.setValue(ShadowJournal, 'count', this.discovered.size);
    journal.setValue(ShadowJournal, 'discovered', [...this.discovered].join(','));
    this.dirty = true;
  }

  private bindEmblem(journal: Entity): void {
    if (this.emblem || !journal.object3D) return;
    const mesh = journal.object3D.getObjectByName('journal-emblem');
    if (mesh instanceof Mesh && mesh.material instanceof MeshStandardMaterial) {
      this.emblem = mesh.material.clone();
      mesh.material = this.emblem;
    }
  }

  private updateOverlay(open: boolean, delta: number): void {
    const endings = this.queries.stories.entities.values().next().value?.getValue(StoryState, 'endings') ?? '';
    if (endings !== this.endingsShown) {
      this.endingsShown = endings;
      this.dirty = true;
    }
    const target = open && stageRuntime.ready ? 1 : 0;
    this.level += Math.sign(target - this.level) * Math.min(Math.abs(target - this.level), delta * 3);
    this.overlay.visible = this.level > 0.001;
    if (!this.overlay.visible) return;
    if (this.dirty) {
      const endingsFound = this.endingsShown ? this.endingsShown.split(',').length : 0;
      drawJournalPage(this.page.canvas.getContext('2d')!, this.discovered, endingsFound);
      this.page.texture.needsUpdate = true;
      for (const [id, rig] of this.rigs) rig.root.visible = this.discovered.has(id);
      this.dirty = false;
    }
    this.page.material.opacity = this.level;
    this.ink.opacity = 0.92 * this.level;
    this.eye.opacity = this.level;

    const n = stageRuntime.normal;
    this.overlay.quaternion.copy(this.quat.setFromAxisAngle(this.yAxis, Math.atan2(n.x, n.z)));
    this.overlay.position.copy(stageRuntime.center).addScaledVector(n, 0.03);
    this.overlay.scale.setScalar(stageRuntime.width * 0.92);
  }
}
