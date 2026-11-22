import type { Category, GameEvent } from '../sim/types';
import type { World } from '../sim/world';

/**
 * Fully procedural audio (Web Audio API): no sound files, so there is nothing to license.
 * Continuous layers (sirens, fire, water, traffic) follow the camera; one-shot effects react to game events.
 */
export type Sfx = 'alert' | 'escalate' | 'resolved' | 'failed' | 'click' | 'order' | 'dismount' | 'death' | 'pickup' | 'warn' | 'explosion';

interface Siren { osc: OscillatorNode; osc2: OscillatorNode; amp: GainNode; pan: StereoPannerNode }

/**
 * Dutch emergency vehicles use the classic two-tone "tatütata" (a rising/falling fourth). Exact pitches are approximations
 * chosen by ear/musical interval (A4-D5; fire engines a tone lower), not measured from real vehicles.
 */
const NL_TWO_TONE: Record<'ambulance' | 'police' | 'fire', { lo: number; hi: number; period: number }> = {
  ambulance: { lo: 440, hi: 587, period: 0.62 },
  police: { lo: 440, hi: 587, period: 0.52 },
  fire: { lo: 392, hi: 523, period: 0.72 },
};
interface Layer { gain: GainNode; level: number }

const CATS: Category[] = ['fire', 'ambulance', 'police', 'tech'];
const atten = (d: number) => Math.pow(Math.max(0, 1 - d / 38), 2);

export class AudioEngine {
  ctx: AudioContext | null = null;
  volume = 0.6;
  muted = false;
  private master!: GainNode;
  /** channel groups (each with its own volume in the settings): sirens, fire and water, traffic ambience, alerts and effects, heartbeat */
  private g = {} as Record<'sirens' | 'fire' | 'ambient' | 'effects' | 'heart', GainNode>;
  /** user mix 0..1 per channel; `voice` scales the control-room speech, `voiceRate` its speed */
  mix: Record<string, number> = { sirens: 1, fire: 1, ambient: 1, effects: 1, voice: 1, heartbeat: 1 };
  voiceRate = 1.08;
  voiceName = '';
  private nextBeat = 0;
  private sirens = {} as Record<Category, Siren>;
  private fire!: Layer;
  private spray!: Layer;
  private traffic!: Layer;
  private roar!: Layer;
  private hiss!: Layer;
  private sizzle!: Layer;
  private lastT = 0;
  private popAcc = 0;
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
    for (const k of ['sirens', 'fire', 'ambient', 'effects', 'heart'] as const) { this.g[k] = ctx.createGain(); this.g[k].connect(this.master); }
    this.applyMix();
    // 2 s of white noise, looped by the noise-based layers
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    for (const c of CATS) {
      // horn-like timbre: a sawtooth plus a slightly detuned square, low-passed
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const osc2 = ctx.createOscillator();
      osc2.type = 'square';
      osc2.detune.value = 7;
      const g2 = ctx.createGain();
      g2.gain.value = 0.35;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1900;
      lp.Q.value = 0.9;
      const amp = ctx.createGain();
      amp.gain.value = 0;
      const pan = ctx.createStereoPanner();
      osc.connect(lp);
      osc2.connect(g2).connect(lp);
      lp.connect(amp).connect(pan).connect(this.g.sirens);
      osc.frequency.value = osc2.frequency.value = 440;
      osc.start();
      osc2.start();
      this.sirens[c] = { osc, osc2, amp, pan };
    }
    const loop = (filter: BiquadFilterType, freq: number, q = 0.7, dest: GainNode = this.g.fire): Layer => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = filter;
      f.frequency.value = freq;
      f.Q.value = q;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(f).connect(gain).connect(dest);
      src.start();
      return { gain, level: 0 };
    };
    this.fire = loop('highpass', 1400);
    this.spray = loop('bandpass', 3500, 0.5);
    this.traffic = loop('lowpass', 260, 0.7, this.g.ambient);
    this.roar = loop('lowpass', 170, 0.9, this.g.fire); // the deep roar of a big fire
    this.hiss = loop('bandpass', 6200, 0.6, this.g.fire); // the airy hiss of flames
    this.sizzle = loop('highpass', 7800, 0.5, this.g.fire); // water hitting hot surfaces
  }

  /** Per-channel volumes (0..1) from the settings. */
  setMix(m: Partial<Record<string, number>>): void {
    for (const [k, v] of Object.entries(m)) if (typeof v === 'number') this.mix[k] = Math.max(0, Math.min(1.5, v));
    this.applyMix();
  }
  private applyMix(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.g.sirens.gain.setTargetAtTime(this.mix.sirens, now, 0.05);
    this.g.fire.gain.setTargetAtTime(this.mix.fire, now, 0.05);
    this.g.ambient.gain.setTargetAtTime(this.mix.ambient, now, 0.05);
    this.g.effects.gain.setTargetAtTime(this.mix.effects, now, 0.05);
    this.g.heart.gain.setTargetAtTime(this.mix.heartbeat, now, 0.05);
  }

  /** The patient monitor while a paramedic is stabilising somebody: a heartbeat thump and a monitor beep at the patient's pulse. */
  private heartbeat(active: boolean, health: number): void {
    const ctx = this.ctx;
    if (!ctx || !active) return;
    const bpm = health < 15 ? 38 : 58 + (100 - health) * 0.75; // weak and slow when nearly gone, racing when hurt
    const now = ctx.currentTime;
    if (now < this.nextBeat) return;
    this.nextBeat = now + 60 / bpm;
    const vol = 0.5 + 0.5 * (health / 100);
    const thump = (delay: number, f: number, v: number) => { // "lub" and "dub"
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(f, now + delay); o.frequency.exponentialRampToValueAtTime(f * 0.55, now + delay + 0.14);
      g.gain.setValueAtTime(0.0001, now + delay); g.gain.exponentialRampToValueAtTime(v * vol, now + delay + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.16);
      o.connect(g).connect(this.g.heart); o.start(now + delay); o.stop(now + delay + 0.2);
    };
    thump(0, 70, 0.7); thump(0.17, 56, 0.45);
    const beep = ctx.createOscillator(), bg = ctx.createGain(); // ECG monitor beep
    beep.type = 'sine'; beep.frequency.value = 1050;
    bg.gain.setValueAtTime(0.0001, now + 0.02); bg.gain.exponentialRampToValueAtTime(0.09 * vol, now + 0.03); bg.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    beep.connect(bg).connect(this.g.heart); beep.start(now + 0.02); beep.stop(now + 0.2);
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
    let fireLevel = 0, sprayLevel = 0, hb = false, hbHealth = 101;
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
        if (task?.type === 'treat' && !r.inVehicle) { // the patient monitor of whoever is being stabilised
          const v = world.victims.get(task.victimId);
          if (v && v.transport === 'scene' && Math.hypot(r.x - v.x, r.y - v.y) < 2 && Math.hypot(v.x - listener.x, v.y - listener.y) < 30 && v.health < hbHealth) { hbHealth = v.health; hb = true; }
        }
      }
    }
    for (const c of CATS) {
      const s = this.sirens[c];
      const lvl = sirenLevel[c] ?? 0;
      let f = 700, pulse = 1;
      if (c === 'tech') { f = 1100; pulse = Math.floor(t / 0.35) % 2; } // amber warning: slow beeps
      else {
        const nl = NL_TWO_TONE[c];
        f = Math.floor(t / nl.period) % 2 ? nl.hi : nl.lo;
        // police occasionally add a fast "yelp" when approaching junctions
        if (c === 'police' && t % 11 > 9) f = 620 + 680 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 4.5 * t));
      }
      s.osc.frequency.setTargetAtTime(f, now, 0.01);
      s.osc2.frequency.setTargetAtTime(f, now, 0.01);
      s.amp.gain.setTargetAtTime(lvl * 0.1 * pulse, now, 0.04);
      s.pan.pan.setTargetAtTime(sirenPan[c] ?? 0, now, 0.1);
      this.lastLevels.sirens[c] = lvl;
    }
    const lvl = Math.min(1.6, fireLevel);
    const crackle = Math.min(1, fireLevel) * 0.2 * (0.65 + 0.35 * Math.random());
    this.fire.gain.gain.setTargetAtTime(crackle, now, 0.05);
    // a fire is a roar that swells and fades, a hiss, and a constant stream of pops and cracks (random, louder with the fire)
    const swell = 0.75 + 0.25 * Math.sin(now * 1.7) * Math.sin(now * 0.63 + 1.3);
    this.roar.gain.gain.setTargetAtTime(Math.min(1, lvl) * 0.3 * swell, now, 0.15);
    this.hiss.gain.gain.setTargetAtTime(Math.min(1, lvl) * 0.05 * (0.7 + 0.3 * Math.random()), now, 0.08);
    this.sizzle.gain.gain.setTargetAtTime(Math.min(sprayLevel, Math.min(1, lvl)) * 0.07, now, 0.1);
    const dtA = Math.min(0.1, Math.max(0, now - this.lastT));
    this.lastT = now;
    if (lvl > 0.02) {
      this.popAcc += dtA * (5 + 38 * Math.min(1, lvl));
      while (this.popAcc >= 1) {
        this.popAcc -= 1;
        const big = Math.random() < 0.12; // an occasional loud crack or a collapsing beam
        this.burst(big ? 0.09 : 0.025 + Math.random() * 0.03, (big ? 0.34 : 0.05 + Math.random() * 0.14) * Math.min(1, lvl + 0.2), big ? 380 + Math.random() * 400 : 900 + Math.random() * 3200, big ? 'lowpass' : 'bandpass', Math.random() * 0.05, this.g.fire);
      }
      if (lvl > 0.5 && Math.random() < dtA * 0.35) { // a whoosh when the flames flare up
        this.burst(0.7, 0.2 * Math.min(1, lvl), 520 + Math.random() * 300, 'bandpass', 0, this.g.fire);
      }
    }
    this.spray.gain.gain.setTargetAtTime(sprayLevel * 0.12, now, 0.1);
    this.traffic.gain.gain.setTargetAtTime(world && !paused ? 0.045 : 0.0, now, 0.4);
    this.heartbeat(hb, hbHealth);
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
    o.connect(g).connect(this.g.effects);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
  private burst(dur: number, vol: number, freq: number, type: BiquadFilterType = 'lowpass', delay = 0, dest?: GainNode): void {
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
    s.connect(f).connect(g).connect(dest ?? this.g.effects);
    s.start(t0, Math.random());
    s.stop(t0 + dur + 0.05);
  }

  /** The control room reads the call out over the radio (Dutch speech synthesis), after a short squelch. */
  voiceOn = true;
  private speaking = 0;
  speak(text: string): void {
    if (!this.voiceOn || this.muted || typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') return;
    if (this.speaking >= 3) speechSynthesis.cancel(); // never build up a long queue
    try {
      this.burst(0.12, 0.18, 2500, 'bandpass'); this.tone(1900, 0.05, 'square', 0.05, 0.1);
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'nl-NL'; u.rate = this.voiceRate; u.pitch = 0.85; u.volume = Math.min(1, this.volume * 1.4 * (this.mix.voice ?? 1));
      const voices = speechSynthesis.getVoices();
      const nl = (this.voiceName ? voices.find(v => v.name === this.voiceName) : null) ?? voices.find(v => v.lang.toLowerCase().startsWith('nl'));
      if (nl) u.voice = nl;
      this.speaking++;
      u.onend = u.onerror = () => { this.speaking = Math.max(0, this.speaking - 1); };
      setTimeout(() => speechSynthesis.speak(u), 350);
    } catch { /* speech not available */ }
  }

  /** For the settings screen: a few beats of the patient monitor. */
  testHeartbeat(): void {
    for (let i = 0; i < 5; i++) setTimeout(() => { this.nextBeat = 0; this.heartbeat(true, 55); }, i * 800);
  }

  /** The monitor goes flat when somebody dies. */
  private flatline(): void { this.tone(1000, 1.6, 'sine', 0.16); }

  play(name: Sfx): void {
    switch (name) {
      case 'alert': this.tone(880, 0.16, 'sine', 0.22); this.tone(660, 0.16, 'sine', 0.22, 0.18); this.tone(880, 0.16, 'sine', 0.22, 0.38); this.tone(660, 0.22, 'sine', 0.22, 0.56); break;
      case 'escalate': [0, 0.15, 0.3].forEach(d => this.tone(330, 0.12, 'square', 0.14, d)); break;
      case 'resolved': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.22, i * 0.1)); break;
      case 'failed': this.tone(320, 0.7, 'sawtooth', 0.18, 0, 90); break;
      case 'explosion': this.burst(0.9, 0.9, 260); this.burst(0.5, 0.6, 1400, 'lowpass', 0.02); this.tone(70, 1.2, 'sine', 0.6, 0, 28); break;
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
      case 'incident_started': this.play('alert'); if (e.speech) this.speak(e.speech); break;
      case 'incident_escalated': this.play('escalate'); break;
      case 'incident_resolved': case 'mission_complete': this.play('resolved'); break;
      case 'incident_failed': case 'game_over': this.play('failed'); break;
      case 'explosion': this.play('explosion'); break;
      case 'warn': this.play(/overleden/.test(e.message) ? 'death' : 'warn'); if (/overleden/.test(e.message)) this.flatline(); break;
      case 'info': this.play('pickup'); if (e.speech) this.speak(e.speech); break;
    }
  }
}
