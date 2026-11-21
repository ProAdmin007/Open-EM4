import type { Category, GameEvent } from '../sim/types';
import type { World } from '../sim/world';

/**
 * Fully procedural audio (Web Audio API): no sound files, so there is nothing to license.
 * Continuous layers (sirens, fire, water, traffic) follow the camera; one-shot effects react to game events.
 */
export type Sfx = 'alert' | 'escalate' | 'resolved' | 'failed' | 'click' | 'order' | 'dismount' | 'death' | 'pickup' | 'warn';

interface Siren { osc: OscillatorNode; amp: GainNode; pan: StereoPannerNode }
interface Layer { gain: GainNode; level: number }

const CATS: Category[] = ['fire', 'ambulance', 'police', 'tech'];
const atten = (d: number) => Math.pow(Math.max(0, 1 - d / 38), 2);

export class AudioEngine {
  ctx: AudioContext | null = null;
  volume = 0.6;
  muted = false;
  private master!: GainNode;
  private sirens = {} as Record<Category, Siren>;
  private fire!: Layer;
  private spray!: Layer;
  private traffic!: Layer;
  private noise!: AudioBuffer;
  private lastLevels = { fire: 0, spray: 0, sirens: {} as Record<string, number> };

  constructor(volume = 0.6, muted = false) {
    this.volume = volume;
    this.muted = muted;
  }

  /** Must be called from a user gesture (browser autoplay policy). Safe to call repeatedly. */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.build(this.ctx);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private build(ctx: AudioContext): void {
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);
    // 2 s of white noise, looped by the noise-based layers
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    for (const c of CATS) {
      const osc = ctx.createOscillator();
      osc.type = c === 'police' ? 'sawtooth' : 'square';
      osc.frequency.value = 700;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2400;
      const amp = ctx.createGain();
      amp.gain.value = 0;
      const pan = ctx.createStereoPanner();
      osc.connect(lp).connect(amp).connect(pan).connect(this.master);
      osc.start();
      this.sirens[c] = { osc, amp, pan };
    }
    const loop = (filter: BiquadFilterType, freq: number, q = 0.7): Layer => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = filter;
      f.frequency.value = freq;
      f.Q.value = q;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(f).connect(gain).connect(this.master);
      src.start();
      return { gain, level: 0 };
    };
    this.fire = loop('highpass', 1400);
    this.spray = loop('bandpass', 3500, 0.5);
    this.traffic = loop('lowpass', 260);
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.applyMaster();
  }
  setMuted(m: boolean): void {
    this.muted = m;
    this.applyMaster();
  }
  private applyMaster(): void {
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.03);
  }

  // ---------- continuous layers ----------
  /** Called every frame by the scene. `listener` is the camera centre in tile units. */
  update(world: World | null, listener: { x: number; y: number }, playing: boolean, paused: boolean): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const t = world?.time ?? now;
    const sirenLevel: Record<string, number> = {};
    const sirenPan: Record<string, number> = {};
    let fireLevel = 0, sprayLevel = 0;
    if (world && playing && !paused) {
      for (const v of world.vehicles.values()) {
        if (!v.lights) continue;
        const d = Math.hypot(v.x - listener.x, v.y - listener.y), g = atten(d);
        if (g > (sirenLevel[v.category] ?? 0)) { sirenLevel[v.category] = g; sirenPan[v.category] = Math.max(-1, Math.min(1, (v.x - listener.x) / 18)); }
      }
      for (const b of world.buildings.values()) {
        if (b.fire <= 0) continue;
        fireLevel += (b.fire / 100) * atten(Math.hypot(b.x + b.w / 2 - listener.x, b.y + b.h / 2 - listener.y) * 0.8) ;
      }
      for (const r of world.responders.values()) {
        const task = r.task;
        if (task?.type === 'extinguish' && task.deploy >= 2.5) sprayLevel = Math.max(sprayLevel, atten(Math.hypot(r.x - listener.x, r.y - listener.y)));
      }
    }
    for (const c of CATS) {
      const s = this.sirens[c];
      const lvl = sirenLevel[c] ?? 0;
      let f = 700, pulse = 1;
      switch (c) {
        case 'fire': f = Math.floor(t / 0.55) % 2 ? 880 : 660; break;
        case 'ambulance': f = Math.floor(t / 0.42) % 2 ? 960 : 770; break;
        case 'police': f = 650 + 520 * (0.5 + 0.5 * Math.sin((2 * Math.PI * t) / 1.7)); break;
        case 'tech': f = 1100; pulse = Math.floor(t / 0.35) % 2; break;
      }
      s.osc.frequency.setTargetAtTime(f, now, 0.012);
      s.amp.gain.setTargetAtTime(lvl * 0.11 * pulse, now, 0.04);
      s.pan.pan.setTargetAtTime(sirenPan[c] ?? 0, now, 0.1);
      this.lastLevels.sirens[c] = lvl;
    }
    const crackle = Math.min(1, fireLevel) * 0.32 * (0.65 + 0.35 * Math.random());
    this.fire.gain.gain.setTargetAtTime(crackle, now, 0.05);
    this.spray.gain.gain.setTargetAtTime(sprayLevel * 0.12, now, 0.1);
    this.traffic.gain.gain.setTargetAtTime(world && !paused ? 0.045 : 0.0, now, 0.4);
    this.lastLevels.fire = Math.min(1, fireLevel);
    this.lastLevels.spray = sprayLevel;
  }

  /** For tests and diagnostics. */
  debug(): { state: string; muted: boolean; volume: number; masterGain: number; fire: number; spray: number; sirens: Record<string, number> } {
    return { state: this.ctx?.state ?? 'none', muted: this.muted, volume: this.volume, masterGain: this.ctx ? this.master.gain.value : -1, fire: this.lastLevels.fire, spray: this.lastLevels.spray, sirens: { ...this.lastLevels.sirens } };
  }

  // ---------- one-shot effects ----------
  private tone(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0, slideTo?: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
  private burst(dur: number, vol: number, freq: number, type: BiquadFilterType = 'lowpass', delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t0 = ctx.currentTime + delay;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t0, Math.random());
    s.stop(t0 + dur + 0.05);
  }

  play(name: Sfx): void {
    switch (name) {
      case 'alert': this.tone(880, 0.16, 'sine', 0.22); this.tone(660, 0.16, 'sine', 0.22, 0.18); this.tone(880, 0.16, 'sine', 0.22, 0.38); this.tone(660, 0.22, 'sine', 0.22, 0.56); break;
      case 'escalate': [0, 0.15, 0.3].forEach(d => this.tone(330, 0.12, 'square', 0.14, d)); break;
      case 'resolved': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.22, i * 0.1)); break;
      case 'failed': this.tone(320, 0.7, 'sawtooth', 0.18, 0, 90); break;
      case 'click': this.tone(1400, 0.035, 'square', 0.05); break;
      case 'order': this.burst(0.08, 0.1, 3000, 'bandpass'); this.tone(1500, 0.05, 'sine', 0.08, 0.07); break;
      case 'dismount': this.burst(0.12, 0.3, 500); this.burst(0.1, 0.25, 420, 'lowpass', 0.14); break;
      case 'death': this.tone(110, 0.9, 'sine', 0.3, 0, 55); break;
      case 'pickup': this.tone(740, 0.08, 'triangle', 0.14); this.tone(988, 0.1, 'triangle', 0.14, 0.08); break;
      case 'warn': this.tone(220, 0.14, 'square', 0.1); break;
    }
  }

  onGameEvent(e: GameEvent): void {
    switch (e.type) {
      case 'incident_started': this.play('alert'); break;
      case 'incident_escalated': this.play('escalate'); break;
      case 'incident_resolved': this.play('resolved'); break;
      case 'incident_failed': case 'game_over': this.play('failed'); break;
      case 'warn': this.play(/overleden/.test(e.message) ? 'death' : 'warn'); break;
      case 'info': this.play('pickup'); break;
    }
  }
}
