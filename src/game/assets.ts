import type { Content, VehicleDef } from '../sim/types';

/** All art is generated here as SVG (our own work, MIT licensed). SVGs are rasterised at 2x for crisp zooming. */
export const ART_SCALE = 2;

const svg = (w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w * ART_SCALE}" height="${h * ART_SCALE}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + amt)));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => f(c).toString(16).padStart(2, '0')).join('')}`;
}

function vehicleSvg(def: VehicleDef): string {
  const L = Math.round(def.length * 32), W = def.length < 1.2 ? 14 : 22;
  const y0 = (24 - W) / 2;
  const c = def.color, dark = shade(c, -50);
  let deco = '';
  const cx = L / 2;
  if (def.category === 'fire') {
    deco += `<rect x="6" y="${y0 + W / 2 - 1.5}" width="${L - 26}" height="3" fill="#fff"/>`;
    if (def.equipment.includes('aerial_ladder')) deco += `<rect x="4" y="${y0 + 5}" width="${L - 22}" height="2" fill="#ddd"/><rect x="4" y="${y0 + W - 7}" width="${L - 22}" height="2" fill="#ddd"/>`;
    else deco += `<rect x="8" y="${y0 + 3}" width="${L - 30}" height="${W - 6}" rx="2" fill="${shade(c, 25)}"/>`;
  } else if (def.category === 'ambulance') {
    deco += `<rect x="3" y="${y0 + W - 6}" width="${L - 20}" height="3" fill="#d32f2f"/><rect x="${cx - 6}" y="${y0 + W / 2 - 1.3}" width="12" height="2.6" fill="#d32f2f"/><rect x="${cx - 1.3}" y="${y0 + W / 2 - 6}" width="2.6" height="12" fill="#d32f2f"/>`;
  } else if (def.category === 'police') {
    deco += `<rect x="5" y="${y0 + 3}" width="${L - 22}" height="${W - 6}" rx="3" fill="#f4f6fb"/><rect x="${cx - 4}" y="${y0 + 3}" width="8" height="${W - 6}" fill="${c}"/>`;
  } else {
    deco += `<rect x="4" y="${y0 + 2}" width="${L - 20}" height="3" fill="#ffeb3b"/><rect x="4" y="${y0 + W - 5}" width="${L - 20}" height="3" fill="#ffeb3b"/>`;
    if (def.equipment.includes('crane')) deco += `<rect x="6" y="${y0 + W / 2 - 1.5}" width="${L - 14}" height="3" fill="#455a64"/>`;
  }
  const bar = def.category === 'tech'
    ? `<rect x="${L - 28}" y="${y0 + W / 2 - 2}" width="4" height="4" rx="2" fill="#ffa000"/>`
    : `<rect x="${L - 30}" y="${y0 + 3}" width="4" height="${W - 6}" rx="1.5" fill="#fff"/><rect x="${L - 30}" y="${y0 + 3}" width="4" height="${(W - 6) / 2}" fill="#e53935"/><rect x="${L - 30}" y="${y0 + W / 2}" width="4" height="${(W - 6) / 2}" fill="#1e88e5"/>`;
  return svg(L, 24, `<ellipse cx="${L / 2}" cy="13" rx="${L / 2}" ry="${W / 2 + 1}" fill="#000" opacity=".25"/>
<rect x="1.5" y="${y0}" width="${L - 3}" height="${W}" rx="${def.length < 1.2 ? 6 : 5}" fill="${c}" stroke="${dark}" stroke-width="1.2"/>${deco}
<rect x="${L - 19}" y="${y0 + 2}" width="12" height="${W - 4}" rx="3" fill="#1d2b3a"/><rect x="${L - 17}" y="${y0 + 3}" width="3" height="${W - 6}" fill="#6f8aa3" opacity=".6"/>${bar}
<rect x="${L - 3}" y="${y0 + 3}" width="2" height="3" fill="#fff59d"/><rect x="${L - 3}" y="${y0 + W - 6}" width="2" height="3" fill="#fff59d"/>`);
}

const CIV_COLORS = ['#b0bec5', '#8d6e63', '#7e57c2', '#26a69a', '#ef9a9a', '#cfd8dc'];
const civSvg = (c: string) => svg(46, 24, `<ellipse cx="23" cy="13" rx="23" ry="11" fill="#000" opacity=".22"/><rect x="2" y="4" width="42" height="17" rx="6" fill="${c}" stroke="${shade(c, -60)}" stroke-width="1"/><rect x="26" y="6" width="11" height="13" rx="3" fill="#1d2b3a"/><rect x="10" y="7" width="12" height="11" rx="3" fill="${shade(c, 20)}"/><rect x="43" y="6" width="2" height="3" fill="#fff59d"/><rect x="43" y="16" width="2" height="3" fill="#fff59d"/>`);

const PED_COLORS = ['#e57373', '#64b5f6', '#81c784', '#ffd54f', '#ba68c8', '#a1887f'];

export function buildSvgs(content: Content): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of Object.values(content.vehicles)) out[`veh_${d.id}`] = vehicleSvg(d);
  CIV_COLORS.forEach((c, i) => (out[`civ_${i}`] = civSvg(c)));
  for (const r of Object.values(content.roles)) {
    out[`res_${r.id}`] = svg(16, 16, `<ellipse cx="8" cy="9" rx="6" ry="6" fill="#000" opacity=".25"/><rect x="2" y="4" width="12" height="9" rx="4" fill="${r.color}" stroke="${shade(r.color, -70)}"/><circle cx="8" cy="8" r="3.6" fill="${shade(r.color, 40)}" stroke="${shade(r.color, -70)}" stroke-width=".8"/>`);
  }
  PED_COLORS.forEach((c, i) => (out[`ped_${i}`] = svg(12, 12, `<ellipse cx="6" cy="7" rx="4.5" ry="4" fill="#000" opacity=".2"/><rect x="2" y="3" width="8" height="6" rx="3" fill="${c}"/><circle cx="6" cy="6" r="2.4" fill="#f1c9a5"/>`)));
  out.victim = svg(22, 16, `<ellipse cx="11" cy="9" rx="10" ry="6" fill="#000" opacity=".25"/><rect x="2" y="4" width="16" height="8" rx="4" fill="#fafafa" stroke="#9e9e9e"/><circle cx="19" cy="8" r="3.2" fill="#f1c9a5"/><rect x="8" y="5" width="2" height="6" fill="#d32f2f"/><rect x="6" y="7" width="6" height="2" fill="#d32f2f"/>`);
  out.victim_dead = svg(22, 16, `<rect x="2" y="4" width="16" height="8" rx="4" fill="#9e9e9e"/><circle cx="19" cy="8" r="3.2" fill="#bdbdbd"/>`);
  out.suspect = svg(16, 16, `<ellipse cx="8" cy="9" rx="6" ry="6" fill="#000" opacity=".25"/><rect x="2" y="4" width="12" height="9" rx="4" fill="#37474f" stroke="#111"/><circle cx="8" cy="8" r="3.4" fill="#263238"/><rect x="5" y="5" width="6" height="2" fill="#ff7043"/>`);
  out.tree = svg(32, 32, `<ellipse cx="17" cy="20" rx="11" ry="8" fill="#000" opacity=".22"/><circle cx="16" cy="14" r="11" fill="#2e7d32"/><circle cx="12" cy="11" r="7" fill="#388e3c"/><circle cx="20" cy="16" r="6" fill="#1b5e20"/><circle cx="13" cy="10" r="3" fill="#66bb6a" opacity=".7"/>`);
  out.tree2 = svg(32, 32, `<ellipse cx="17" cy="20" rx="9" ry="7" fill="#000" opacity=".22"/><circle cx="16" cy="15" r="9" fill="#558b2f"/><circle cx="19" cy="11" r="6" fill="#689f38"/><circle cx="12" cy="17" r="5" fill="#33691e"/>`);
  out.flame = svg(24, 32, `<defs><radialGradient id="g" cx="50%" cy="65%" r="60%"><stop offset="0" stop-color="#fff59d"/><stop offset=".45" stop-color="#ff9800"/><stop offset="1" stop-color="#e53935" stop-opacity="0"/></radialGradient></defs><path d="M12 1C14 9 22 12 21 21c0 6-4 10-9 10S3 27 3 21C3 14 9 12 12 1z" fill="url(#g)"/>`);
  out.smoke = svg(32, 32, `<defs><radialGradient id="s"><stop offset="0" stop-color="#555" stop-opacity=".7"/><stop offset="1" stop-color="#555" stop-opacity="0"/></radialGradient></defs><circle cx="16" cy="16" r="16" fill="url(#s)"/>`);
  out.drop = svg(8, 8, `<circle cx="4" cy="4" r="3" fill="#90caf9"/><circle cx="3" cy="3" r="1" fill="#fff" opacity=".8"/>`);
  out.wreck = svg(46, 24, `<ellipse cx="23" cy="13" rx="23" ry="11" fill="#000" opacity=".3"/><rect x="3" y="5" width="40" height="16" rx="5" fill="#6d4c41" stroke="#3e2723" transform="rotate(-14 23 13)"/><rect x="14" y="8" width="14" height="10" rx="3" fill="#263238" transform="rotate(-14 23 13)"/><path d="M6 8l5 4-3 3" stroke="#212121" stroke-width="1.5" fill="none"/>`);
  out.barrier = svg(32, 14, `<rect x="1" y="3" width="30" height="8" rx="2" fill="#fff" stroke="#b71c1c" stroke-width="1"/><path d="M4 3l6 8M12 3l6 8M20 3l6 8" stroke="#d32f2f" stroke-width="3"/>`);
  out.cone = svg(14, 14, `<ellipse cx="7" cy="12" rx="6" ry="2" fill="#000" opacity=".3"/><path d="M7 1l5 11H2z" fill="#ff6d00"/><path d="M4.5 7h5l.8 2h-6.6z" fill="#fff"/>`);
  out.burnt = svg(32, 32, `<rect width="32" height="32" fill="#1c1917" opacity=".5"/>`);
  return out;
}

export async function rasterise(svgs: Record<string, string>): Promise<Map<string, HTMLImageElement>> {
  const out = new Map<string, HTMLImageElement>();
  await Promise.all(Object.entries(svgs).map(async ([k, s]) => {
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
    await img.decode();
    out.set(k, img);
  }));
  return out;
}
