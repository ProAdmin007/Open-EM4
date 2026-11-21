import type { Difficulty } from './sim/types';
import type { ModPack } from './sim/content';
import type { SaveGame } from './sim/world';

export interface Settings {
  edgeScroll: boolean;
  defaultSpeed: 1 | 2 | 4;
  hints: boolean;
  difficulty: Difficulty;
  seed: string;
}
export const DEFAULT_SETTINGS: Settings = { edgeScroll: false, defaultSpeed: 1, hints: true, difficulty: 'normal', seed: '2006' };

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

export const loadSettings = (): Settings => ({ ...DEFAULT_SETTINGS, ...(read<Partial<Settings>>(K_SETTINGS) ?? {}) });
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
