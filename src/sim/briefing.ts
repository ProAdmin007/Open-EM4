import type { Content, MissionDef } from './types';

export interface Briefing {
  title: string;
  stars: number;
  description: string;
  /** What is coming, in order of the script (time in seconds, name, severity, services needed). */
  incoming: { at: number; name: string; severity: number; services: string[] }[];
  /** The services that will be needed during the mission. */
  services: string[];
  objectives: string[];
  tips: string[];
}

const SERVICE_NL: Record<string, string> = { fire: 'brandweer', ambulance: 'ambulance', police: 'politie', tech: 'technische dienst' };

/** The mission briefing shown before a mission starts (Emergency 4 style): what happens, who is needed, when you fail. */
export function missionBriefing(content: Content, m: MissionDef): Briefing {
  const incoming = m.script.map(e => {
    const def = content.incidents[e.def];
    return { at: e.at, name: def?.name ?? e.def, severity: e.severity ?? 1, services: (def?.requires ?? []).map(c => SERVICE_NL[c] ?? c) };
  });
  const services = [...new Set(incoming.flatMap(i => i.services))];
  const objectives = [`Los alle ${incoming.length} melding${incoming.length === 1 ? '' : 'en'} op.`];
  objectives.push(m.allowedFailures === 0 ? 'Er mag geen enkele melding verloren gaan.' : `Maximaal ${m.allowedFailures} verloren melding${m.allowedFailures === 1 ? '' : 'en'}.`);
  const tips: string[] = [];
  if (incoming.some(i => i.severity >= 2)) tips.push('Een melding met hogere ernst escaleert sneller: stuur direct genoeg eenheden en gebruik GRIP bij een grote melding.');
  if (services.length > 1) tips.push(`Meerdere diensten werken samen (${services.join(', ')}): verdeel je eenheden en houd de wegen vrij.`);
  if (incoming.length > 1 && incoming[1].at - incoming[0].at < 40) tips.push('De meldingen volgen elkaar snel op. Stuur de eerste eenheden weg voordat de volgende melding binnenkomt.');
  if (incoming.some(i => /fire/.test(i.name.toLowerCase()) || i.services.includes('brandweer'))) tips.push('Bij brand: rol slangen uit, blus en let op overslag naar buurpanden.');
  if (incoming.some(i => i.services.includes('ambulance'))) tips.push('Gewonden eerst behandelen, dan laden en naar het ziekenhuis brengen. Ondervraag de melder voor het aantal slachtoffers.');
  tips.push('Spatie pauzeert het spel; de meldkamer spreekt elke melding in.');
  return { title: m.name, stars: m.level, description: m.description, incoming, services, objectives, tips };
}
