import {
  CatmullRomCurve3,
  CylinderGeometry,
  DoubleSide,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from '@iwsdk/core';

/**
 * Desk lamp for Shadowplay. Origin: base-bottom center (desk contact), +Y up.
 * The shade opening faces -Z (toward the stage wall), tilted slightly upward.
 * Size envelope ~0.14 m wide x 0.32 m tall x 0.2 m deep.
 * Anchors: `lamp-bulb-anchor` (bulb center, local -Z = light axis) and
 * `lamp-switch` (pinch switch on the base).
 */

const ink = new MeshStandardMaterial({ color: 0x1b1822, roughness: 0.55, metalness: 0.35 });
const brass = new MeshStandardMaterial({ color: 0xb8863b, roughness: 0.35, metalness: 0.8 });
const shadeMat = new MeshStandardMaterial({
  color: 0x2a2233,
  roughness: 0.6,
  metalness: 0.2,
  side: DoubleSide,
});
const bulbMat = new MeshStandardMaterial({
  color: 0xffd9a0,
  emissive: 0xffb45a,
  emissiveIntensity: 2.2,
  roughness: 0.3,
});

const BASE_H = 0.028;
const JOINT = new Vector3(0, 0.26, 0.035);
const SHADE_TILT = (12 * Math.PI) / 180;

function buildBase(): Mesh {
  // Weighted round base: soft rounded rim lathed from a profile.
  const profile = [
    new Vector2(0, 0),
    new Vector2(0.066, 0),
    new Vector2(0.07, 0.006),
    new Vector2(0.068, 0.016),
    new Vector2(0.055, 0.024),
    new Vector2(0.018, BASE_H),
    new Vector2(0.012, BASE_H + 0.01),
    new Vector2(0, BASE_H + 0.01),
  ];
  const mesh = new Mesh(new LatheGeometry(profile, 32), ink);
  mesh.name = 'lamp-base';
  return mesh;
}

function buildStem(): Mesh {
  // One continuous gently curved arm from the base collar to the shade joint.
  const curve = new CatmullRomCurve3([
    new Vector3(0, BASE_H + 0.008, 0),
    new Vector3(0, 0.1, 0.03),
    new Vector3(0, 0.2, 0.05),
    JOINT.clone(),
  ]);
  const mesh = new Mesh(new TubeGeometry(curve, 24, 0.0055, 10, false), brass);
  mesh.name = 'lamp-stem';
  return mesh;
}

function buildHead(): Group {
  // Head pivot at the joint; local -Z is the light axis, tilted up a little.
  const head = new Group();
  head.name = 'lamp-head';
  head.position.copy(JOINT);
  head.rotation.x = SHADE_TILT;

  const knuckle = new Mesh(new SphereGeometry(0.011, 16, 12), brass);
  knuckle.name = 'lamp-knuckle';
  head.add(knuckle);

  // Cone shade lathed around +Y, then turned so its opening faces -Z.
  const shadeProfile = [
    new Vector2(0.0, 0.034),
    new Vector2(0.016, 0.03),
    new Vector2(0.02, 0.026),
    new Vector2(0.04, 0.0),
    new Vector2(0.062, -0.05),
    new Vector2(0.066, -0.056),
  ];
  const shade = new Mesh(new LatheGeometry(shadeProfile, 36), shadeMat);
  shade.name = 'lamp-shade';
  // Lathe axis +Y -> +Z, so the wide opening (at -Y) faces -Z.
  shade.rotation.x = Math.PI / 2;
  shade.position.z = -0.035;
  head.add(shade);

  const bulb = new Mesh(new SphereGeometry(0.018, 20, 14), bulbMat);
  bulb.name = 'lamp-bulb';
  bulb.position.z = -0.055;
  head.add(bulb);

  const anchor = new Object3D();
  anchor.name = 'lamp-bulb-anchor';
  anchor.position.z = -0.055;
  head.add(anchor);
  return head;
}

function buildSwitch(): Mesh {
  const mesh = new Mesh(new CylinderGeometry(0.009, 0.01, 0.01, 16), brass);
  mesh.name = 'lamp-switch';
  mesh.position.set(0.042, BASE_H - 0.001, -0.022);
  return mesh;
}

function buildDeskLamp(): Object3D {
  const root = new Group();
  root.name = 'DeskLamp';
  root.add(buildBase(), buildStem(), buildHead(), buildSwitch());
  root.traverse((o) => {
    o.castShadow = false;
    o.receiveShadow = false;
  });
  return root;
}

export default buildDeskLamp();
