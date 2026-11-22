import type { Difficulty } from './sim/types';
import type { ModPack } from './sim/content';
import type { SaveGame } from './sim/world';

export interface Settings {
  edgeScroll: boolean;
  defaultSpeed: 1 | 2 | 4;
  hints: boolean;
  difficulty: Difficulty;
  seed: string;
  volume: number;
  muted: boolean;
  mapId: string;
  /** Weergave: 2D (Phaser) of 3D (three.js, experimenteel, lazy geladen). */
  viewMode: '2d' | '3d';
  /** The control room reads each call out loud (speech synthesis). */
  voice: boolean;
  /** volume per sound channel (0..1.5): sirens, fire (fire and water), ambient (traffic), effects (alerts and clicks), voice (control room), heartbeat */
  mix: Record<string, number>;
  voiceRate: number;
  voiceName: string;
}
export const DEFAULT_SETTINGS: Settings = { edgeScroll: false, defaultSpeed: 1, hints: true, difficulty: 'normal', seed: '2006', volume: 0.6, muted: false, mapId: 'default_city', viewMode: '3d', voice: true, mix: { sirens: 1, fire: 1, ambient: 1, effects: 1, voice: 1, heartbeat: 1 }, voiceRate: 1.08, voiceName: '' };

const K_SETTINGS = 'openrescue.settings', K_SAVE = 'openrescue.save', K_MODS = 'openrescue.mods';

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const loadSettings = (): Settings => {
  const stored = read<Partial<Settings>>(K_SETTINGS) ?? {};
  return { ...DEFAULT_SETTINGS, ...stored, mix: { ...DEFAULT_SETTINGS.mix, ...(stored.mix ?? {}) } };
};
export const saveSettings = (s: Settings): boolean => write(K_SETTINGS, s);
export const loadSave = (): SaveGame | null => read<SaveGame>(K_SAVE);
export const writeSave = (s: SaveGame): boolean => write(K_SAVE, s);
export const hasSave = (): boolean => loadSave() !== null;

export interface StoredMod {
  name: string;
  pack: ModPack;
}
export const loadMods = (): StoredMod[] => read<StoredMod[]>(K_MODS) ?? [];
export const saveMods = (m: StoredMod[]): boolean => write(K_MODS, m);

export interface ScoreEntry {
  score: number;
  solved: number;
  time: number;
  difficulty: string;
  seed: string;
  date: string;
}
const K_SCORES = 'openrescue.scores';
export const loadScores = (): ScoreEntry[] => read<ScoreEntry[]>(K_SCORES) ?? [];
/** Adds a score, keeps the best 8 and returns the new list. */
export function addScore(e: ScoreEntry): ScoreEntry[] {
  const all = [...loadScores(), e].sort((a, b) => b.score - a.score).slice(0, 8);
  write(K_SCORES, all);
  return all;
}
