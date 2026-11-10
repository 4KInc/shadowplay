import {
  BoxGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Path,
  Shape,
  ShapeGeometry,
} from '@iwsdk/core';

/**
 * The Shadow Journal: a small closed hardcover lying flat on the desk.
 * Origin: bottom-centre (desk contact), +Y up. Spine along the -X edge,
 * ribbon bookmark drapes out of the +Z (front) edge onto the desk.
 * Size envelope ~0.15 m (X) x 0.03 m (Y) x 0.21 m (Z) plus the ribbon tail.
 * `journal-emblem` has its own emissive material for the runtime to pulse.
 */

const W = 0.15;
const D = 0.21;
const T = 0.03;
const COVER = 0.003;
const BEVEL = 0.0006;

const cloth = new MeshStandardMaterial({ color: 0x2a2036, roughness: 0.85, metalness: 0.05 });
const spineMat = new MeshStandardMaterial({ color: 0x1b1822, roughness: 0.7, metalness: 0.1 });
const paper = new MeshStandardMaterial({ color: 0xeadbb8, roughness: 0.95 });
const ribbonMat = new MeshStandardMaterial({ color: 0xb8863b, roughness: 0.5, metalness: 0.4 });
const emblemMat = new MeshStandardMaterial({
  color: 0xffd9a0,
  emissive: 0xffb45a,
  emissiveIntensity: 1.2,
  roughness: 0.4,
});

function roundedRect(w: number, d: number, r: number): Shape {
  const s = new Shape();
  const x = -w / 2;
  const y = -d / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r);
  s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d);
  s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** Board lying flat: shape in XZ, thickness up +Y from y = 0. */
function coverGeometry(): ExtrudeGeometry {
  const geo = new ExtrudeGeometry(roundedRect(W, D, 0.01), {
    depth: COVER,
    bevelEnabled: true,
    bevelThickness: BEVEL,
    bevelSize: BEVEL,
    bevelSegments: 1,
    curveSegments: 6,
  });
  geo.rotateX(-Math.PI / 2); // extrusion +Z -> +Y
  return geo;
}

function emblemGeometry(): ShapeGeometry {
  const ring = new Shape();
  ring.absarc(0, 0, 0.022, 0, Math.PI * 2, false);
  const hole = new Path();
  hole.absarc(0, 0, 0.017, 0, Math.PI * 2, true);
  ring.holes.push(hole);
  const dot = new Shape();
  dot.absarc(0, 0, 0.008, 0, Math.PI * 2, false);
  const geo = new ShapeGeometry([ring, dot], 24);
  geo.rotateX(-Math.PI / 2); // face +Y
  return geo;
}

function buildJournalBook(): Object3D {
  const root = new Group();
  root.name = 'JournalBook';
  const cover = coverGeometry();

  const bottom = new Mesh(cover, cloth);
  bottom.name = 'journal-cover-bottom';
  bottom.position.y = BEVEL; // bevel grows both ways; keep the book on the desk

  const top = new Mesh(cover, cloth);
  top.name = 'journal-cover-top';
  top.position.y = T - COVER - BEVEL;

  // Page block inset from the fore-edge and ends; tucked into the spine.
  const pageW = W - 0.01;
  const pages = new Mesh(new BoxGeometry(pageW, T - 2 * COVER, D - 0.01), paper);
  pages.name = 'journal-pages';
  pages.position.set(-0.002, T / 2, 0);

  // Rounded spine: a cylinder whose inner half hides inside the boards.
  const spine = new Mesh(new CylinderGeometry(T / 2, T / 2, D + 0.001, 18), spineMat);
  spine.name = 'journal-spine';
  spine.rotation.x = Math.PI / 2;
  spine.position.set(-W / 2 + T / 2 - 0.002, T / 2, 0);

  // Ribbon: leaves the page block mid-height and drapes down to the desk.
  const run = 0.045;
  const drop = T / 2 - 0.001;
  const ribbon = new Mesh(new BoxGeometry(0.011, 0.0008, Math.hypot(run, drop)), ribbonMat);
  ribbon.name = 'journal-ribbon';
  ribbon.rotation.x = Math.atan2(drop, run);
  ribbon.position.set(0.025, drop / 2 + 0.0005, D / 2 - 0.004 + run / 2);

  const emblem = new Mesh(emblemGeometry(), emblemMat);
  emblem.name = 'journal-emblem';
  emblem.position.set(0.008, T + 0.0008, -0.02);

  root.add(bottom, top, pages, spine, ribbon, emblem);
  root.traverse((o) => {
    o.castShadow = false;
    o.receiveShadow = false;
  });
  return root;
}

export default buildJournalBook();
