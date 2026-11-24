import { describe, expect, it } from 'vitest';
import { loadBuiltinContent } from '../../src/data';
import { missionBriefing } from '../../src/sim/briefing';

describe('mission briefing (R10)', () => {
  const content = loadBuiltinContent();
  it('every built-in mission gets goals, an incident forecast and tips', () => {
    for (const m of Object.values(content.missions)) {
      const b = missionBriefing(content, m);
      expect(b.incoming.length).toBe(m.script.length);
      expect(b.incoming.every(i => i.name && i.services.length > 0)).toBe(true);
      expect(b.objectives.length).toBeGreaterThanOrEqual(2);
      expect(b.tips.length).toBeGreaterThanOrEqual(1);
    }
  });
  it('names the failure limit', () => {
    const first = missionBriefing(content, content.missions.first_shift);
    expect(first.objectives.join(' ')).toMatch(/geen enkele melding/);
    const rush = missionBriefing(content, content.missions.rush_hour);
    expect(rush.objectives.join(' ')).toMatch(/Maximaal 1 verloren melding/);
    expect(rush.services.length).toBeGreaterThan(1);
  });
});
