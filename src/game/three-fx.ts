import * as THREE from 'three';

/**
 * Soft billboard particle pools for the 3D view: flames (additive), smoke and water spray. One THREE.Points object and
 * one draw call per pool; per-particle size, colour and alpha are animated on the CPU over each particle's life.
 */

export interface EmitOptions {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number;
  size0: number; size1: number;
  /** start / end colour (0xRRGGBB) */
  c0: number; c1: number;
  alpha: number;
}

const VERT = /* glsl */ `
  attribute float aSize; attribute vec3 aColor; attribute float aAlpha;
  uniform float uScale; varying vec3 vC; varying float vA;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = max(1.0, aSize * uScale / -mv.z);
    gl_Position = projectionMatrix * mv;
    vC = aColor; vA = aAlpha;
  }`;
const FRAG = /* glsl */ `
  varying vec3 vC; varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.15, d) * vA;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vC, a);
  }`;

const FLAME_FRAG = /* glsl */ `
  varying vec3 vC; varying float vA; uniform float uTime;
  void main() {
    vec2 p = gl_PointCoord;
    float x = (p.x - 0.5) * 2.0;
    float y = 1.0 - p.y;                               // 0 = bottom of the flame, 1 = tip
    float w = pow(max(0.0, 1.0 - y), 0.85) * 0.8 + 0.04;
    float wob = sin(y * 9.0 + uTime * 13.0 + vC.r * 23.0) * 0.14 * y;
    float a = smoothstep(w, w * 0.2, abs(x + wob));
    a *= smoothstep(1.0, 0.5, y) * smoothstep(0.0, 0.06, y);
    float core = smoothstep(0.6, 0.0, abs(x) / (w + 0.001)) * (1.0 - y * 0.8);
    vec3 col = mix(vC, vec3(1.0, 0.96, 0.72), core * 0.75);
    float al = a * vA;
    if (al < 0.01) discard;
    gl_FragColor = vec4(col, al);
  }`;

const tmpA = new THREE.Color(), tmpB = new THREE.Color();

export class ParticlePool {
  readonly points: THREE.Points;
  private pos: Float32Array; private vel: Float32Array; private life: Float32Array; private max: Float32Array;
  private s0: Float32Array; private s1: Float32Array; private c0: Float32Array; private c1: Float32Array; private a0: Float32Array;
  private size: Float32Array; private col: Float32Array; private alpha: Float32Array;
  private cursor = 0;
  private uniforms = { uScale: { value: 800 }, uTime: { value: 0 } };
  /** how many slots are in use (for tests) */
  alive = 0;

  constructor(readonly capacity: number, blending: THREE.Blending, private gravity: number, private drag: number, shape: 'soft' | 'flame' = 'soft') {
    const n = capacity;
    this.pos = new Float32Array(n * 3).fill(0); this.vel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) this.pos[i * 3 + 1] = -1000;
    this.life = new Float32Array(n).fill(1); this.max = new Float32Array(n).fill(1);
    this.s0 = new Float32Array(n); this.s1 = new Float32Array(n); this.a0 = new Float32Array(n);
    this.c0 = new Float32Array(n * 3); this.c1 = new Float32Array(n * 3);
    this.size = new Float32Array(n); this.col = new Float32Array(n * 3); this.alpha = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: shape === 'flame' ? FLAME_FRAG : FRAG, uniforms: this.uniforms, transparent: true, depthWrite: false, blending });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  setScale(viewportHeightPx: number, fovDeg: number): void {
    this.uniforms.uScale.value = viewportHeightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  emit(o: EmitOptions): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.pos[i * 3] = o.x; this.pos[i * 3 + 1] = o.y; this.pos[i * 3 + 2] = o.z;
    this.vel[i * 3] = o.vx; this.vel[i * 3 + 1] = o.vy; this.vel[i * 3 + 2] = o.vz;
    this.life[i] = 0; this.max[i] = o.life;
    this.s0[i] = o.size0; this.s1[i] = o.size1; this.a0[i] = o.alpha;
    tmpA.setHex(o.c0); tmpB.setHex(o.c1);
    this.c0.set([tmpA.r, tmpA.g, tmpA.b], i * 3); this.c1.set([tmpB.r, tmpB.g, tmpB.b], i * 3);
  }

  update(dt: number): void {
    let alive = 0;
    this.uniforms.uTime.value += dt;
    const damp = Math.max(0, 1 - this.drag * dt);
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] >= this.max[i]) { this.alpha[i] = 0; this.pos[i * 3 + 1] = -1000; continue; }
      alive++;
      this.life[i] += dt;
      const t = Math.min(1, this.life[i] / this.max[i]);
      this.vel[i * 3 + 1] += this.gravity * dt;
      for (let k = 0; k < 3; k++) { this.vel[i * 3 + k] *= damp; this.pos[i * 3 + k] += this.vel[i * 3 + k] * dt; }
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      for (let k = 0; k < 3; k++) this.col[i * 3 + k] = this.c0[i * 3 + k] + (this.c1[i * 3 + k] - this.c0[i * 3 + k]) * t;
      // quick fade-in, long fade-out
      this.alpha[i] = this.a0[i] * Math.min(1, t * 8) * (1 - t) * (1 - t * 0.2);
      if (this.pos[i * 3 + 1] < 0 && this.gravity < 0) { this.life[i] = this.max[i]; } // water that hits the ground
    }
    this.alive = alive;
    for (const n of ['position', 'aSize', 'aColor', 'aAlpha']) (this.points.geometry.getAttribute(n) as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void { this.points.geometry.dispose(); (this.points.material as THREE.Material).dispose(); }
}

/** A thin box stretched between two points (hose segments, police tape). */
export function setSegment(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, thickness: number): void {
  const len = a.distanceTo(b);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.scale.set(Math.max(0.001, len), thickness, thickness);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), b.clone().sub(a).normalize());
}
