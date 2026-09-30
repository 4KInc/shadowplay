import {
  AddEquation,
  BackSide,
  Color,
  CustomBlending,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  OneFactor,
  PlaneGeometry,
  ShaderMaterial,
  ShadowMaterial,
  SphereGeometry,
  Vector3,
  ZeroFactor,
} from '@iwsdk/core';

/**
 * Runtime-only stage visuals (room-dimming shell, light pool, shadow surface,
 * paper screen). These are driven entirely by detected room geometry, so they
 * are built in code rather than placed as scene assets.
 */

const unitPlane = new PlaneGeometry(1, 1);

/** Large inverted sphere, dark everywhere except a soft opening onto the stage. */
export function createDimShell(): Mesh<SphereGeometry, ShaderMaterial> {
  const material = new ShaderMaterial({
    side: BackSide,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      uDim: { value: 0 },
      uStageDir: { value: new Vector3(0, 0, -1) },
      uCosInner: { value: Math.cos((18 * Math.PI) / 180) },
      uCosOuter: { value: Math.cos((34 * Math.PI) / 180) },
      uTint: { value: new Color(0x05040a) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uDim;
      uniform vec3 uStageDir;
      uniform float uCosInner;
      uniform float uCosOuter;
      uniform vec3 uTint;
      varying vec3 vDir;
      void main() {
        float c = dot(normalize(vDir), uStageDir);
        float open = smoothstep(uCosOuter, uCosInner, c);
        gl_FragColor = vec4(uTint, uDim * (1.0 - open * 0.92));
      }`,
  });
  const shell = new Mesh(new SphereGeometry(1, 32, 16), material);
  shell.name = 'room-dim-shell';
  shell.scale.setScalar(3.5);
  shell.renderOrder = -10;
  shell.frustumCulled = false;
  return shell;
}

/** Warm additive pool of lamplight on the wall. */
export function createLightPool(): Mesh<PlaneGeometry, ShaderMaterial> {
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    // Add light to colour without touching alpha, so the dim regions of the
    // quad stay see-through over passthrough instead of turning opaque black.
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneFactor,
    blendSrcAlpha: ZeroFactor,
    blendDstAlpha: OneFactor,
    uniforms: {
      uIntensity: { value: 0 },
      uColor: { value: new Color(0xffa43a) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uIntensity;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        float d = length((vUv - 0.5) * 2.0);
        float a = 1.0 - smoothstep(0.25, 1.0, d);
        gl_FragColor = vec4(uColor * a * a * uIntensity, 0.0);
      }`,
  });
  const pool = new Mesh(unitPlane, material);
  pool.name = 'light-pool';
  pool.renderOrder = 0;
  return pool;
}

/** Transparent surface that only shows shadows (placed over the real wall). */
export function createShadowSurface(): Mesh<PlaneGeometry, ShadowMaterial> {
  const material = new ShadowMaterial({ color: 0x07050c, opacity: 0.85 });
  material.depthWrite = false;
  const surface = new Mesh(unitPlane, material);
  surface.name = 'shadow-surface';
  surface.receiveShadow = true;
  surface.renderOrder = 1;
  return surface;
}

/** Softly glowing paper screen used when no suitable wall is found. */
export function createPaperScreen(): Mesh<PlaneGeometry, MeshStandardMaterial> {
  const material = new MeshStandardMaterial({
    color: 0xf1dfbd,
    emissive: 0x3a2814,
    roughness: 1,
    metalness: 0,
    side: DoubleSide,
  });
  const paper = new Mesh(unitPlane, material);
  paper.name = 'paper-screen';
  paper.receiveShadow = true;
  paper.position.z = -0.003;
  return paper;
}
