import * as THREE from 'three';

/**
 * Weather and life in the sky: drifting clouds (greyer and lower in the rain), rain streaks around the camera and a few flocks of birds.
 * Purely visual; the simulation only knows whether it rains (`World.raining`, which slows the traffic down).
 */
export class Weather {
  private clouds: THREE.Group[] = [];
  private cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, fog: false, depthWrite: false });
  private rain: THREE.LineSegments;
  private rainPos: Float32Array;
  private birds: { g: THREE.Group; wings: THREE.Mesh[]; cx: number; cz: number; r: number; h: number; s: number; ph: number }[] = [];
  rainK = 0;
  private static readonly DROPS = 1400;

  constructor(scene: THREE.Scene) {
    // clouds: clusters of flattened spheres
    const geo = new THREE.SphereGeometry(1, 10, 8);
    for (let i = 0; i < 16; i++) {
      const g = new THREE.Group();
      const n = 4 + (i % 4);
      for (let k = 0; k < n; k++) {
        const m = new THREE.Mesh(geo, this.cloudMat);
        const s = 40 + ((i * 7 + k * 13) % 30);
        m.scale.set(s, s * 0.34, s * 0.8);
        m.position.set((k - n / 2) * 38 + ((i * 5 + k) % 5), ((k * 3) % 8), ((k * 7) % 19) - 9);
        m.renderOrder = -5;
        g.add(m);
      }
      g.position.set(((i * 97) % 1000) - 500, 260 + ((i * 31) % 60), ((i * 53) % 1000) - 500);
      g.userData.speed = 1.2 + (i % 5) * 0.4;
      this.clouds.push(g);
      scene.add(g);
    }
    // rain
    this.rainPos = new Float32Array(Weather.DROPS * 6);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xb8c8d8, transparent: true, opacity: 0.0, depthWrite: false, fog: true }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    scene.add(this.rain);
    for (let i = 0; i < Weather.DROPS; i++) this.dropReset(i, 0, 0);
    // birds: two small flocks circling high above the city
    const wingGeo = new THREE.PlaneGeometry(1.1, 0.35);
    const bm = new THREE.MeshBasicMaterial({ color: 0x1c1f24, side: THREE.DoubleSide, fog: true });
    for (let i = 0; i < 9; i++) {
      const g = new THREE.Group();
      const wl = new THREE.Mesh(wingGeo, bm), wr = new THREE.Mesh(wingGeo, bm);
      wl.position.z = -0.55; wr.position.z = 0.55;
      wl.rotation.x = -Math.PI / 2; wr.rotation.x = -Math.PI / 2;
      g.add(wl, wr);
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.14), bm);
      g.add(body);
      g.scale.setScalar(1.6);
      this.birds.push({ g, wings: [wl, wr], cx: (i < 5 ? -40 : 70) + (i % 3) * 6, cz: (i < 5 ? 20 : -50) + (i % 2) * 7, r: 55 + (i % 4) * 9, h: 30 + (i % 5) * 4, s: 0.22 + (i % 3) * 0.03, ph: i * 1.3 });
      scene.add(g);
    }
  }

  private dropReset(i: number, cx: number, cz: number): void {
    const x = cx + (Math.random() - 0.5) * 120, z = cz + (Math.random() - 0.5) * 120, y = Math.random() * 60;
    const o = i * 6;
    this.rainPos[o] = x; this.rainPos[o + 1] = y; this.rainPos[o + 2] = z;
    this.rainPos[o + 3] = x - 0.15; this.rainPos[o + 4] = y + 1.6; this.rainPos[o + 5] = z - 0.05;
  }

  /** `raining` = target state, `daylight` 0..1, `target` = camera focus. */
  update(time: number, dt: number, raining: boolean, daylight: number, target: THREE.Vector3, fog: THREE.Fog, sun: THREE.DirectionalLight): void {
    this.rainK += ((raining ? 1 : 0) - this.rainK) * Math.min(1, dt * 0.4);
    const k = this.rainK;
    // clouds drift with the wind and wrap around the camera focus
    const tint = new THREE.Color(0xffffff).lerp(new THREE.Color(0x6f7782), k).multiplyScalar(0.35 + 0.65 * daylight);
    this.cloudMat.color.copy(tint);
    this.cloudMat.opacity = 0.75 + 0.2 * k;
    for (const c of this.clouds) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x - target.x > 500) c.position.x -= 1000;
      if (c.position.x - target.x < -500) c.position.x += 1000;
      c.position.y = 260 + (c.userData.speed * 13) % 60 - k * 40;
    }
    // rain
    this.rain.visible = k > 0.03;
    (this.rain.material as THREE.LineBasicMaterial).opacity = 0.45 * k;
    if (this.rain.visible) {
      const fall = 48 * dt;
      for (let i = 0; i < Weather.DROPS; i++) {
        const o = i * 6;
        this.rainPos[o + 1] -= fall; this.rainPos[o + 4] -= fall;
        if (this.rainPos[o + 1] < 0) this.dropReset(i, target.x, target.z);
        else if (Math.abs(this.rainPos[o] - target.x) > 70 || Math.abs(this.rainPos[o + 2] - target.z) > 70) this.dropReset(i, target.x, target.z);
      }
      (this.rain.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }
    // grey, darker, foggier air in the rain
    fog.color.lerp(new THREE.Color(0x7d8794).multiplyScalar(0.4 + 0.6 * daylight), k * 0.6);
    fog.near = 260 * (1 - 0.35 * k); fog.far = 900 * (1 - 0.4 * k);
    sun.intensity *= 1 - 0.55 * k;
    // birds circle (and flap); they stay away in the rain
    for (const b of this.birds) {
      const a = time * b.s + b.ph;
      b.g.visible = k < 0.5 && daylight > 0.3;
      b.g.position.set(target.x + b.cx + Math.cos(a) * b.r, b.h + Math.sin(a * 2.3) * 2, target.z + b.cz + Math.sin(a) * b.r);
      b.g.rotation.y = -a - Math.PI / 2;
      const flap = Math.sin(time * 9 + b.ph) * 0.6;
      b.wings[0].rotation.x = -Math.PI / 2 + flap; b.wings[1].rotation.x = -Math.PI / 2 - flap;
    }
  }
}
