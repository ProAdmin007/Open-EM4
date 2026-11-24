import type { GameScene } from '../game/scene';
import { T } from '../game/scene';
import { DIFFICULTY, World, type WorldOptions } from '../sim/world';
import type { Ability, Category, Difficulty, GameEvent, Task } from '../sim/types';
import { hashSeed } from '../sim/rng';
import { addScore, loadMods, loadSave, loadScores, loadSettings, saveMods, saveSettings, writeSave, type Settings } from '../storage';
import { mergeContent, type ModPack } from '../sim/content';

const CAT_LABEL: Record<Category, string> = { fire: '🚒 Brandweer', ambulance: '🚑 Ambulance', police: '🚓 Politie', tech: '🔧 Techniek' };
const ABILITY_LABEL: Partial<Record<Ability, string>> = {
  extinguish: '💧 Blussen', rescue: '🆘 Redden', treat: '🩺 Behandelen', carry: '🛏 Inladen', arrest: '🔗 Arresteren', secure: '🚧 Afzetten', clear: '🏗 Bergen', disperse: '📣 Wegsturen', defuse: '🤖 Ontmijnen', cool: '❄️ Koelen', assist: '🤝 Helpen', recon: '🔦 Verkennen', collect: '⚰️ Ophalen',
};
const ABILITY_ORDER: Ability[] = ['recon', 'extinguish', 'cool', 'rescue', 'treat', 'assist', 'carry', 'collect', 'arrest', 'secure', 'disperse', 'defuse', 'clear'];
const TASK_LABEL = (t: Task | null): string => {
  if (!t) return 'Wacht op opdracht';
  switch (t.type) {
    case 'move': return 'Loopt';
    case 'board': return 'Stapt in';
    case 'extinguish': return t.deploy < 2.5 ? 'Rolt slang uit' : 'Blust brand';
    case 'cool': return t.deploy < 2.5 ? 'Rolt slang uit' : 'Koelt pand';
    case 'assist': return 'Helpt bij het slachtoffer';
    case 'rescue': return 'Redt slachtoffer';
    case 'treat': return 'Behandelt slachtoffer';
    case 'load': return 'Draagt slachtoffer naar voertuig';
    case 'arrest': return 'Arresteert verdachte';
    case 'secure': return 'Zet locatie af';
    case 'clear': return 'Ruimt obstakel';
    case 'disperse': return 'Stuurt omstanders weg';
    case 'defuse': return 'Ontmijnt verdacht object';
    case 'recon': return 'Verkent het pand (zijn er nog mensen binnen?)';
    case 'collect': return 'Neemt een overledene mee';
  }
};
const TRANSPORT_LABEL: Record<string, string> = { trapped: 'Opgesloten in pand', scene: 'Ter plaatse', carried: 'Wordt gedragen', inAmbulance: 'In ambulance', atHospital: 'In ziekenhuis', dead: 'Overleden', collected: 'Opgehaald door de uitvaartdienst' };
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const fmtTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class UI {
  settings: Settings = loadSettings();
  private el = (id: string) => document.getElementById(id)!;
  private cache = new Map<string, string>();
  private tab: Category = 'fire';
  private lastOpts: WorldOptions | null = null;
  private resumeSpeed = 1;
  private overlayOpen = true;
  private recorded = false;
  private lastTap = { id: -1, t: 0 };
  private toasts: HTMLElement[] = [];
  private mini = document.createElement('canvas');
  private miniFor: unknown = null;

  constructor(private scene: GameScene) {
    scene.edgeScroll = this.settings.edgeScroll;
    // automated tests (`?e2e`) stay in the fast 2D view unless they ask for 3D; players get the 3D game by default
    const q = new URLSearchParams(location.search);
    if (q.has('e2e') && !q.has('fx')) this.settings.viewMode = '2d';
    void scene.setViewMode(this.settings.viewMode);
    scene.onEvent(e => { this.toast(e); scene.audio?.onGameEvent(e); });
    this.bind();
    this.applyAudio();
    document.addEventListener('keydown', ev => { if ((ev.target as HTMLElement).tagName === 'INPUT') return; if (ev.key === 'm' || ev.key === 'M') this.act('mute'); });
    this.showScreen('main');
    setInterval(() => this.refresh(), 250);
  }

  private applyAudio(): void {
    const a = this.scene.audio;
    if (!a) return;
    a.setVolume(this.settings.volume);
    a.setMuted(this.settings.muted);
    a.voiceOn = this.settings.voice !== false;
    a.setMix(this.settings.mix);
    a.voiceRate = this.settings.voiceRate;
    a.voiceName = this.settings.voiceName;
    this.el('btn-mute').textContent = this.settings.muted ? '🔇' : '🔊';
  }

  // ---------- generic ----------
  private setHtml(id: string, html: string): void {
    if (this.cache.get(id) === html) return;
    this.cache.set(id, html);
    this.el(id).innerHTML = html;
  }
  private setText(id: string, text: string): void {
    const e = this.el(id);
    if (e.textContent !== text) e.textContent = text;
  }

  private bind(): void {
    // pointerdown is used instead of click so periodic re-rendering cannot swallow a click
    document.addEventListener('pointerdown', ev => {
      const target = (ev.target as HTMLElement).closest<HTMLElement>('[data-act],[data-vid],[data-iid],[data-tab],[data-ability],[data-reinf],[data-backup],[data-grip],[data-dispatch],[data-advice],[data-question]');
      if (!target || ev.button !== 0) return;
      this.scene.audio?.play('click');
      const s = this.scene, w = s.world;
      if (!w) return;
      const d = target.dataset;
      if (d.vid) {
        const id = Number(d.vid);
        const now = performance.now();
        s.select([id], ev.shiftKey);
        if (this.lastTap.id === id && now - this.lastTap.t < 400) { const v = w.vehicles.get(id)!; s.centerOn(v.x, v.y); }
        this.lastTap = { id, t: now };
      } else if (d.reinf) {
        const v = w.callReinforcement(d.reinf);
        if (v) s.select([v.id]);
      } else if (d.iid) {
        const i = w.incidents.get(Number(d.iid));
        if (i) s.centerOn(i.x, i.y);
      } else if (d.tab) this.tab = d.tab as Category;
      else if (d.ability) s.cmdAbility(d.ability as Ability);
      else if (d.backup) s.cmdBackup(d.backup);
      else if (d.dispatch) s.cmdDispatch(Number(d.dispatch));
      else if (d.question) { if (w.questionCaller(Number(d.question))) s.audio?.play('order'); }
      else if (d.advice) { if (w.adviseCaller(Number(d.advice))) s.audio?.play('order'); }
      else if (d.grip) { w.setGrip(Number(d.grip)); s.audio?.play('order'); }
      else if (d.act) this.act(d.act);
      this.refresh();
    });
    const mm = this.el('minimap');
    const moveCam = (ev: PointerEvent) => {
      const w = this.scene.world;
      if (!w || (ev.buttons & 1) === 0) return;
      const r = mm.getBoundingClientRect();
      this.scene.centerOn(((ev.clientX - r.left) / r.width) * w.w, ((ev.clientY - r.top) / r.height) * w.h);
    };
    mm.addEventListener('pointerdown', moveCam);
    mm.addEventListener('pointermove', moveCam);
  }

  private act(a: string): void {
    const s = this.scene;
    switch (a) {
      case 'pause': s.togglePause(); break;
      case 'speed1': s.setSpeed(1); break;
      case 'speed2': s.setSpeed(2); break;
      case 'speed4': s.setSpeed(4); break;
      case 'mute': this.settings.muted = !this.settings.muted; this.applyAudio(); saveSettings(this.settings); break;
      case 'menu': this.openPause(); break;
      case 'zoomin': s.zoomBy(1.2); break;
      case 'zoomout': s.zoomBy(1 / 1.2); break;
      case 'home': { const id = [...s.selected][0]; const e = s.world!.vehicles.get(id) ?? s.world!.responders.get(id); if (e) s.centerOn(e.x, e.y); break; }
      case 'dismount': s.cmdDismount(); break;
      case 'board': s.cmdBoard(); break;
      case 'stop': s.cmdStop(); break;
      case 'return': s.cmdReturn(); break;
      case 'hospital': s.cmdHospital(); break;
      case 'deploy': s.cmdDeploy(); break;
      case 'cool': s.cmdCool(); break;
      case 'patrol': s.cmdPatrol(); break;
      case 'crew': s.selectCrew(); break;
      case 'prio': s.prio = s.prio === 1 ? 2 : 1; break;
    }
  }

  // ---------- toasts ----------
  private toast(e: GameEvent): void {
    const box = this.el('toasts');
    const d = document.createElement('div');
    d.className = `toast ${e.type}`;
    d.textContent = e.message;
    box.appendChild(d);
    this.toasts.push(d);
    while (this.toasts.length > 5) this.toasts.shift()!.remove();
    setTimeout(() => { d.remove(); this.toasts = this.toasts.filter(t => t !== d); }, 6500);
    if (e.type === 'game_over' || e.type === 'mission_complete') this.showGameOver(e.message);
  }

  // ---------- HUD refresh ----------
  refresh(): void {
    const s = this.scene, w = s.world;
    if (!w) return;
    if (s.state === 'gameover' && !this.overlayOpen) this.showGameOver();
    this.el('ui').classList.toggle('hidden', s.state === 'menu');
    if (s.state === 'menu') return;
    this.setText('st-time', fmtTime(w.time));
    this.setText('st-score', String(Math.round(w.score)));
    this.setText('st-budget', `€${Math.round(w.budget).toLocaleString('nl-NL')}`);
    this.setText('st-rep-n', String(Math.max(0, Math.round(w.reputation))));
    (this.el('st-rep') as HTMLElement).style.width = `${Math.max(0, w.reputation)}%`;
    this.setText('st-solved', String(w.solved));
    this.el('pause-banner').classList.toggle('hidden', s.speed !== 0 || this.overlayOpen);
    this.el('btn-pause').textContent = s.speed === 0 ? '▶' : '⏸';
    document.querySelectorAll<HTMLElement>('[data-act^="speed"]').forEach(b => b.classList.toggle('on', s.speed === Number(b.dataset.act!.slice(5))));
    this.renderIncidents();
    this.renderDispatch();
    this.renderUnitPanel();
    this.renderMinimap();
  }

  private renderIncidents(): void {
    const w = this.scene.world!;
    const scale = DIFFICULTY[w.opts.difficulty].timeScale;
    const html = [...w.incidents.values()].map(i => {
      const def = w.content.incidents[i.defId];
      const left = Math.max(0, def.failAfterSec * scale - i.elapsed);
      const frac = left / (def.failAfterSec * scale);
      const bits: string[] = [];
      const b = i.buildingId ? w.buildings.get(i.buildingId) : null;
      if (b && def.fire) bits.push(`🔥 ${Math.round(b.fire)}%`);
      const trappedKind = def.victims?.location === 'trapped';
      if (trappedKind && !i.scouted) bits.push('❓ mensen binnen onbekend – verkennen!');
      else if (trappedKind && !i.victims.some(id => w.victims.get(id)?.transport === 'trapped')) bits.push('✔ niemand binnen');
      else if (i.victims.length) bits.push(`🩹 ${i.victims.filter(id => { const v = w.victims.get(id); return v && v.transport !== 'atHospital' && v.transport !== 'dead' && v.transport !== 'collected'; }).length}/${i.victims.length}`);
      const bodies = i.victims.filter(id => w.victims.get(id)?.transport === 'dead').length;
      if (bodies) bits.push(`⚰ ${bodies} op te halen`);
      if (i.suspects.length) bits.push(`🕵 ${i.suspects.filter(id => !w.suspects.get(id)?.arrested).length} verdacht`);
      const crowd = i.bystanders.filter(id => w.bystanders.get(id)?.leaving === false).length;
      if (crowd) bits.push(`👥 ${crowd} omstanders`);
      if (def.objectives.includes('area_secured')) bits.push(i.secured ? '✔ afgezet' : '○ afzetten');
      if (def.objectives.includes('device_defused')) bits.push(i.defused ? '✔ onschadelijk' : '○ ontmijnen');
      if (def.objectives.includes('obstacle_cleared')) bits.push(i.cleared ? '✔ geruimd' : '○ ruimen');
      if (i.address) bits.unshift(`📍 ${esc(i.address)}`);
      return `<div class="inc s${i.severity}" data-iid="${i.id}"><div class="t"><span>${esc(def.icon ?? '')} ${esc(i.name)}</span><span>ernst ${i.severity}</span></div>` +
        `${i.description ? `<div class="d">${esc(i.description)}</div>` : ''}<div class="d">${bits.join(' · ')} · nog ${Math.ceil(left)}s</div><div class="meter"><i class="${frac < 0.3 ? 'low' : ''}" style="width:${(frac * 100).toFixed(0)}%"></i></div>${!i.advised && i.victims.some(id => { const pv = w.victims.get(id); return pv && !pv.treated && pv.transport !== 'dead'; }) ? `<div class="d"><button data-advice="${i.id}" title="Eerste-hulpinstructies aan de telefoon: de slachtoffers verliezen langzamer gezondheid tot de hulp er is">☎ Instructies geven</button></div>` : ''}${!i.questioned && i.victims.length ? `<div class="d"><button data-question="${i.id}" title="Vraag de melder wat er precies aan de hand is en hoeveel gewonden er zijn: de aanbevolen eenheden worden bijgewerkt">❓ Melder ondervragen</button></div>` : ''}${i.units?.length ? `<div class="d"><button data-dispatch="${i.id}" class="${i.dispatched ? '' : 'primary'}" title="Stuurt de dichtstbijzijnde vrije voertuigen: ${esc([...new Set(i.units)].map(u => (w.content.vehicles[u]?.name ?? u) + (i.units.filter(x => x === u).length > 1 ? ' ×' + i.units.filter(x => x === u).length : '')).join(', '))}">🚨 Uitrukken: ${esc([...new Set(i.units)].map(u => (w.content.vehicles[u]?.name ?? u) + (i.units.filter(x => x === u).length > 1 ? ' ×' + i.units.filter(x => x === u).length : '')).join(', '))}</button></div>` : ''}</div>`;
    }).join('');
    this.setHtml('incident-list', html || '<div class="empty">Geen actieve meldingen. Even rust…</div>');
  }

  private renderDispatch(): void {
    const w = this.scene.world!, sel = this.scene.selected;
    const cats: Category[] = ['fire', 'ambulance', 'police', 'tech'];
    this.setHtml('tabs', cats.map(c => `<button data-tab="${c}" class="${c === this.tab ? 'on' : ''}">${CAT_LABEL[c]}</button>`).join(''));
    const html = w.vehiclesOf(this.tab).map(v => {
      const out = v.crew.filter(id => !w.responders.get(id)!.inVehicle).length;
      const base = w.vehicleStatus(v);
      const status = v.state === 'moving' ? base : out ? `${base} · ${out} uitgestapt` : v.patients.length ? `${base} · patiënt aan boord` : base;
      return `<button class="veh cat-${v.category} ${sel.has(v.id) ? 'sel' : ''}" data-vid="${v.id}"><span class="dot ${v.state === 'moving' ? 'moving' : out ? 'out' : ''}"></span>${esc(v.name)}<small>${status}</small></button>`;
    }).join('');
    const reinf = Object.values(w.content.vehicles).filter(d => d.category === this.tab).map(d => {
      const cost = w.reinforcementCost(d.id);
      return `<button class="veh reinf" data-reinf="${esc(d.id)}" ${w.budget >= cost ? '' : 'disabled'} title="Versterking bestellen">➕ ${esc(d.name)}<small>€${cost.toLocaleString('nl-NL')}</small></button>`;
    }).join('');
    const gripBtns = [0, 1, 2, 3, 4].map(n => `<button data-grip="${n}" class="${w.grip === n ? 'primary' : ''}" title="${esc(World.GRIP_INFO[n])}">${n === 0 ? 'Geen' : 'GRIP ' + n}</button>`).join('') + (w.grip > 0 ? `<button data-grip="${w.grip - 1}" title="Een niveau afschalen: de eenheden van dit niveau die niets meer te doen hebben keren terug naar de kazerne">⬇ Afschalen</button>` : '');
    const gripBox = `<div class="grip" style="grid-column:1/-1"><div class="reinf-title">🏛 Opschalen (GRIP)</div><div class="actions">${gripBtns}</div><div class="help">${esc(World.GRIP_INFO[w.grip])}${w.grip ? '' : ' – opschalen stuurt automatisch bijbehorende voertuigen (OvD, CoPI, LGH, extra eenheden) naar het hoofdincident.'}</div></div>`;
    this.setHtml('vehicle-list', gripBox + html + (reinf ? `<div class="reinf-title">Versterking bestellen (middelen: €${Math.round(w.budget).toLocaleString('nl-NL')})</div>` + reinf : ''));
  }

  private renderUnitPanel(): void {
    const s = this.scene, w = s.world!;
    const ids = [...s.selected];
    let html = '';
    if (!ids.length && s.inspect) {
      const t = s.inspect;
      if (t.kind === 'victim') {
        const v = w.victims.get(t.id);
        if (v) html = `<div class="name">🩹 ${esc(v.name)} (${v.age} jr) – ${esc(v.condition)}</div>${v.pinned ? '<div class="row">⚠ <b>Bekneld in het voertuig</b> – bevrijden met de hulpverleningswagen (hydraulisch gereedschap) voordat de brancard erbij kan.</div>' : ''}<div class="row">Gezondheid: <span class="hp"><i class="${v.health < 35 ? 'low' : ''}" style="width:${v.health}%"></i></span> ${Math.round(v.health)}%</div><div class="row">Bewustzijn: ${v.conscious ? 'bij kennis' : 'bewusteloos'} · Behandeling: ${v.treated ? 'gestabiliseerd' : 'onbehandeld'}</div><div class="row">Status: ${TRANSPORT_LABEL[v.transport]}</div><div class="row">Rechtermuisknop met ambulancepersoneel = behandelen, daarna nogmaals = inladen.</div>`;
      } else if (t.kind === 'suspect') {
        const x = w.suspects.get(t.id);
        if (x) html = `<div class="name">🕵 Verdachte</div><div class="row">${x.arrested ? 'Gearresteerd' : 'Op vrije voeten — stuur een agent met rechtermuisknop'}</div>`;
      } else if (t.kind === 'building') {
        const b = w.buildings.get(t.id);
        if (b) html = `<div class="name">🏢 ${esc(b.name ?? b.type)}</div><div class="row">Brand: ${Math.round(b.fire)}% · Schade: ${Math.round(b.damage)}%${b.destroyed ? ' · verwoest' : ''}</div>`;
      } else if (t.kind === 'incident') {
        const i = w.incidents.get(t.id);
        if (i) html = `<div class="name">${esc(i.name)}</div><div class="row">Ernst ${i.severity}</div>`;
      }
    } else if (!ids.length) {
      html = `<h3>Geselecteerde eenheid</h3><div class="empty">Niets geselecteerd.</div>` +
        (this.settings.hints ? `<div class="row">Klik of sleep om te selecteren (Shift = toevoegen). Rechtermuisknop = opdracht. <b>E</b> uitstappen, <b>R</b> instappen, <b>X</b> stop, <b>Spatie</b> pauze, <b>WASD</b>/scroll = camera.</div>` : '');
    } else {
      const vs = ids.map(i => w.vehicles.get(i)).filter(Boolean) as NonNullable<ReturnType<typeof w.vehicles.get>>[];
      const rs = ids.map(i => w.responders.get(i)).filter(Boolean) as NonNullable<ReturnType<typeof w.responders.get>>[];
      if (vs.length === 1 && !rs.length) {
        const v = vs[0], def = w.vehicleDef(v);
        const out = v.crew.filter(id => !w.responders.get(id)!.inVehicle).length;
        html = `<div class="name">${esc(v.name)}</div><div class="row">${esc(w.vehicleStatus(v))}${v.state === 'moving' ? ' (max ' + Math.round(def.maxSpeed) + ' km/h)' : ''}${v.lights ? ' · 🚨 sirene aan' : ''} · Bemanning: ${v.crew.length - out}/${v.crew.length} aan boord${v.patients.length ? ' · patiënt aan boord' : ''}</div>` +
          `<div class="row">Uitrusting: ${def.equipment.map(e => esc(e.replace(/_/g, ' '))).join(', ') || '—'}</div>` +
          (def.tank ? `<div class="row">💧 Water: ${Math.round(v.water)} / ${def.tank} L${v.hydrant ? ' · aangesloten op brandkraan' : ''}</div><div class="meter"><i class="${v.water / def.tank < 0.25 && !v.hydrant ? 'low' : ''}" style="width:${Math.round((v.water / def.tank) * 100)}%"></i></div>` : '') +
          `<div class="actions"><button data-act="dismount">⬇ Uitstappen (E)</button><button data-act="board">⬆ Instappen (R)</button><button data-act="crew" ${out ? '' : 'disabled'}>👥 Bemanning</button><button data-act="stop">⏹ Stop (X)</button><button data-act="prio" class="${this.scene.prio === 1 ? 'primary' : ''}" title="Prio 1: met sirene en voorrang. Prio 2: gewoon verkeer, geen sirene, stopt voor rood">${this.scene.prio === 1 ? '🚨 Prio 1' : '🚗 Prio 2'}</button></div>` +
          (v.prisoners.length ? `<div class="row">⛓ Aangehouden aan boord: ${v.prisoners.length}</div>` : '') +
          (v.patients.length ? `<div class="row">🛏 Aan boord: ${v.patients.map(pid => { const pv = w.victims.get(pid); return pv ? esc(pv.name) + ' (' + pv.age + ' jr, ' + Math.round(pv.health) + '% · ' + esc(pv.condition) + ')' : ''; }).join('; ')}</div>` : '') +
          `<div class="actions">${def.equipment.includes('fire_hose') ? '<button data-act="deploy" class="primary" title="Bemanning stapt uit, rolt slangen uit en begint direct te blussen">🧯 Slangen aansluiten & blussen (B)</button><button data-act="cool" title="Bemanning koelt de panden naast de brand, zodat het vuur niet overslaat">❄️ Koelen (K)</button>' : ''}${def.canPatrol ? `<button data-act="patrol" class="${v.patrol ? 'primary' : ''}" title="Rijdt zonder sirene een ronde door de stad en rukt automatisch uit bij een melding">🚓 Patrouilleren (P)</button>` : ''}${def.patientCapacity > 0 ? `<button data-act="hospital" class="${v.patients.length ? 'primary' : ''}" ${v.patients.length ? '' : 'disabled'} title="Rijdt met de patiënt naar het dichtstbijzijnde ziekenhuis">🏥 Naar ziekenhuis (Z)</button>` : ''}${w.prisonerCapacity(v.defId) > 0 ? `<button data-act="hospital" class="${v.prisoners.length ? 'primary' : ''}" ${v.prisoners.length ? '' : 'disabled'} title="Rijdt met de aangehouden verdachten naar het politiebureau">🚔 Naar bureau (Z)</button>` : ''}<button data-act="return">🏠 Terug naar kazerne (H)</button></div>` +
          (def.callable?.length ? `<div class="actions"><span class="help">📞 Versterking inroepen:</span>${def.callable.map(c => `<button data-backup="${esc(c)}" title="Het dichtstbijzijnde vrije voertuig rijdt naar jou toe">${esc(w.content.vehicles[c]?.name ?? c)}</button>`).join('')}</div>` : '') +
          `<div class="row">Rechtermuisknop op de kaart = rijden, dubbel rechtsklikken op het voertuig = iedereen uitstappen. Op een ziekenhuis = patiënt afleveren. <b>Ctrl + slepen</b> draait de camera.</div>`;
      } else if (rs.length && !vs.length) {
        const first = rs[0];
        const hasPatient = rs.some(r => (w.vehicles.get(r.vehicleId)?.patients.length ?? 0) > 0);
        const hasPrisoner = rs.some(r => (w.vehicles.get(r.vehicleId)?.prisoners.length ?? 0) > 0);
        const abilities = new Set<Ability>();
        for (const r of rs) for (const a of w.roleDef(r).abilities) if (w.canDo(r, a) && ABILITY_LABEL[a]) abilities.add(a);
        const buttons = ABILITY_ORDER.filter(a => abilities.has(a)).map(a => {
          const hasTarget = rs.some(r => w.canDo(r, a) && w.findTarget(r, a));
          return `<button data-ability="${a}" ${hasTarget ? '' : 'disabled'} title="Nearest target">${ABILITY_LABEL[a]}</button>`;
        }).join('');
        html = `<div class="name">${rs.length === 1 ? esc(first.name) : `${rs.length} personeelsleden`}</div>` +
          `<div class="row">${rs.length === 1 ? esc(w.roleDef(first).name) + ' · ' + TASK_LABEL(first.task) : [...new Set(rs.map(r => w.roleDef(r).name))].join(', ')}${first.carrying !== null ? ' · draagt slachtoffer' : ''}</div>` +
          `<div class="actions">${buttons}<button data-act="board">⬆ Instappen (R)</button>${hasPatient ? '<button data-act="hospital" class="primary">🏥 Naar ziekenhuis (Z)</button>' : ''}${hasPrisoner ? '<button data-act="hospital" class="primary">🚔 Naar bureau (Z)</button>' : ''}<button data-act="return">🏠 Terug naar kazerne</button><button data-act="stop">⏹ Stop</button></div>` +
          `<div class="row">Rechtermuisknop op brand / slachtoffer / verdachte / obstakel = gerichte opdracht.</div>`;
      } else {
        html = `<div class="name">${ids.length} eenheden geselecteerd</div><div class="actions"><button data-act="dismount">⬇ Uitstappen</button><button data-act="board">⬆ Instappen</button><button data-act="return">🏠 Terug naar kazerne</button><button data-act="stop">⏹ Stop</button></div>`;
      }
    }
    this.setHtml('unit-panel', html);
  }

  private renderMinimap(): void {
    const s = this.scene, w = s.world!, cv = this.el('minimap') as HTMLCanvasElement;
    const ctx = cv.getContext('2d')!;
    const sx = cv.width / w.w, sy = cv.height / w.h;
    if (this.miniFor !== w) {
      this.miniFor = w;
      this.mini.width = cv.width; this.mini.height = cv.height;
      const m = this.mini.getContext('2d')!;
      m.fillStyle = '#2f4a2c'; m.fillRect(0, 0, cv.width, cv.height);
      for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) if (w.isRoad(x, y)) { m.fillStyle = '#555b66'; m.fillRect(x * sx, y * sy, sx + 0.5, sy + 0.5); }
      for (const b of w.buildings.values()) { m.fillStyle = b.type === 'hospital' ? '#fff' : b.type === 'station' ? '#ffb300' : '#8d8f96'; m.fillRect(b.x * sx, b.y * sy, b.w * sx, b.h * sy); }
    }
    ctx.drawImage(this.mini, 0, 0);
    for (const b of w.buildings.values()) if (b.destroyed || b.fire > 0) { ctx.fillStyle = b.destroyed ? '#222' : '#ff5722'; ctx.fillRect(b.x * sx, b.y * sy, b.w * sx, b.h * sy); }
    const col: Record<Category, string> = { fire: '#ff5252', ambulance: '#ffeb3b', police: '#448aff', tech: '#9ccc65' };
    for (const v of w.vehicles.values()) { ctx.fillStyle = col[v.category]; ctx.fillRect(v.x * sx - 2, v.y * sy - 2, 4, 4); }
    const pulse = 3 + (performance.now() / 150) % 3;
    for (const i of w.incidents.values()) { ctx.strokeStyle = '#ff1744'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(i.x * sx, i.y * sy, pulse, 0, 7); ctx.stroke(); }
    const v = s.cameras.main.worldView;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
    ctx.strokeRect((v.x / T) * sx, (v.y / T) * sy, (v.width / T) * sx, (v.height / T) * sy);
  }

  // ---------- screens ----------
  private showScreen(name: string, extra?: unknown): void {
    const sc = this.el('screen');
    this.overlayOpen = name !== 'none';
    sc.classList.toggle('hidden', name === 'none');
    if (name === 'none') { sc.innerHTML = ''; return; }
    const save = loadSave();
    const card = (inner: string) => (sc.innerHTML = `<div class="card">${inner}</div>`);
    const on = (id: string, fn: (ev: Event) => void, evt = 'click') => sc.querySelector(`#${id}`)?.addEventListener(evt, fn);
    switch (name) {
      case 'main':
        card(`<h1>🚒 OpenRescue RTS</h1><div class="sub">Open source hulpdienstensimulatie in je browser</div><div class="col">
          <button id="b-new" class="primary">▶ Nieuw spel</button><button id="b-free">♾ Freeplay</button><button id="b-miss">🎯 Missies</button>
          <button id="b-cont" ${save ? '' : 'disabled'}>⏵ Doorgaan met opgeslagen spel</button><button id="b-scores">🏆 Highscores</button><button id="b-set">⚙ Instellingen</button>
          <button id="b-view">${this.settings.viewMode === '3d' ? '🧊 Weergave: 3D' : '▦ Weergave: 2D'}</button></div>
          <p class="help">Nieuw spel start met een willekeurige brand, medische melding en politiemelding en gaat daarna door in Freeplay. De meldkamer spreekt elke melding in.</p>`);
        on('b-new', () => this.start({ seed: hashSeed(String(Date.now()) + Math.random()), difficulty: this.settings.difficulty, freeplay: true, scripted: true }));
        on('b-free', () => this.showScreen('freeplay'));
        on('b-cont', () => this.loadSaved());
        on('b-set', () => this.showScreen('settings', 'main'));
        on('b-scores', () => this.showScreen('scores'));
        on('b-miss', () => this.showScreen('missions'));
        on('b-view', () => {
          this.settings.viewMode = this.settings.viewMode === '3d' ? '2d' : '3d';
          saveSettings(this.settings);
          void this.scene.setViewMode(this.settings.viewMode);
          this.showScreen('main');
        });
        break;
      case 'missions': {
        const list = Object.values(this.scene.content.missions).map(m => `<button class="mission" data-mission="${esc(m.id)}"><b>${esc(m.name)}</b> ${'★'.repeat(m.level)}<small>${esc(m.description)}</small></button>`).join('');
        card(`<h2>🎯 Missies</h2><div class="sub">Los alle meldingen op. Meer dan een paar verloren meldingen betekent een mislukte missie.</div><div class="col">${list || '<div class="empty">Geen missies beschikbaar.</div>'}<button id="m-back">← Terug</button></div>`);
        sc.querySelectorAll<HTMLElement>('[data-mission]').forEach(b => b.addEventListener('click', () => this.start({ seed: hashSeed(b.dataset.mission!), difficulty: this.settings.difficulty, freeplay: false, missionId: b.dataset.mission })));
        on('m-back', () => this.showScreen('main'));
        break;
      }
      case 'scores': {
        const rows = loadScores().map((e, i) => `<tr><td>${i + 1}.</td><td><b>${e.score}</b></td><td>${e.solved} opgelost</td><td>${fmtTime(e.time)}</td><td>${esc(e.difficulty)}</td><td>${esc(e.date)}</td></tr>`).join('');
        card(`<h2>🏆 Highscores</h2>${rows ? `<table style="width:100%;border-spacing:8px 4px">${rows}</table>` : '<div class="empty">Nog geen scores. Speel een spel en beëindig het via het pauzemenu, of ga game over.</div>'}<div class="col" style="margin-top:14px"><button id="h-back">← Terug</button></div>`);
        on('h-back', () => this.showScreen('main'));
        break;
      }
      case 'freeplay':
        card(`<h2>Freeplay</h2><div class="col"><label>Moeilijkheid<select id="f-diff">${(['easy', 'normal', 'hard'] as Difficulty[]).map(d => `<option value="${d}" ${d === this.settings.difficulty ? 'selected' : ''}>${{ easy: 'Easy – weinig incidenten', normal: 'Normal', hard: 'Hard – veel & snelle escalatie' }[d]}</option>`).join('')}</select></label>
          <label>Kaart<select id="f-map">${Object.values(this.scene.content.maps).map(m => `<option value="${esc(m.id)}" ${m.id === this.settings.mapId ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>
          <label>Seed<input id="f-seed" type="text" value="${esc(String(Math.floor(Math.random() * 1e6)))}"></label>
          <p class="help">Elke keer een nieuwe willekeurige seed; vul dezelfde seed in voor hetzelfde scenario.</p>
          <button id="f-go" class="primary">▶ Start Freeplay</button><button id="f-back">← Terug</button></div>`);
        on('f-go', () => {
          this.settings.difficulty = (sc.querySelector('#f-diff') as HTMLSelectElement).value as Difficulty;
          this.settings.seed = (sc.querySelector('#f-seed') as HTMLInputElement).value || '1';
          this.settings.mapId = (sc.querySelector('#f-map') as HTMLSelectElement).value;
          saveSettings(this.settings);
          this.start({ seed: hashSeed(this.settings.seed), difficulty: this.settings.difficulty, freeplay: true, mapId: this.settings.mapId });
        });
        on('f-back', () => this.showScreen('main'));
        break;
      case 'settings': {
        const mods = loadMods();
        const msg = typeof extra === 'object' && extra ? (extra as { msg?: string; errors?: string[] }) : {};
        card(`<h2>Instellingen</h2><div class="col">
          <label>Randscrollen met de muis<input id="s-edge" type="checkbox" ${this.settings.edgeScroll ? 'checked' : ''}></label>
          <label>Hints tonen<input id="s-hints" type="checkbox" ${this.settings.hints ? 'checked' : ''}></label>
          <label>Geluid uit<input id="s-muted" type="checkbox" ${this.settings.muted ? 'checked' : ''}></label>
          <label>Volume (alles)<input id="s-vol" type="range" min="0" max="100" value="${Math.round(this.settings.volume * 100)}"></label>
          <details class="snd" open><summary><b>Geluidsopties</b></summary>
            ${([['sirens', '🚨 Sirenes'], ['fire', '🔥 Brand en water'], ['ambient', '🚗 Verkeer / omgeving'], ['effects', '🔔 Meldingen en effecten'], ['voice', '📻 Meldkamer-stem'], ['heartbeat', '💓 Hartslag bij stabiliseren']] as [string, string][]).map(([k, label]) => `<label>${label}<input class="s-mix" data-mix="${k}" type="range" min="0" max="150" value="${Math.round((this.settings.mix[k] ?? 1) * 100)}"></label>`).join('')}
            <label>Stem van de meldkamer<select id="s-voicename"><option value="">Automatisch (Nederlands)</option>${(typeof speechSynthesis !== 'undefined' ? speechSynthesis.getVoices() : []).map(v => `<option value="${esc(v.name)}" ${v.name === this.settings.voiceName ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('')}</select></label>
            <label>Spreeksnelheid<input id="s-voicerate" type="range" min="70" max="150" value="${Math.round(this.settings.voiceRate * 100)}"></label>
            <div class="row"><button id="s-test-siren">▶ Test sirene</button><button id="s-test-voice">▶ Test meldkamer</button><button id="s-test-beat">▶ Test hartslag</button></div>
          </details>
          <label>Standaard spelsnelheid<select id="s-speed">${[1, 2, 4].map(n => `<option value="${n}" ${this.settings.defaultSpeed === n ? 'selected' : ''}>${n}×</option>`).join('')}</select></label>
          <label>Weergave<select id="s-view"><option value="2d" ${this.settings.viewMode === '2d' ? 'selected' : ''}>2D</option><option value="3d" ${this.settings.viewMode === '3d' ? 'selected' : ''}>3D</option></select></label>
          <label>Meldkamer spreekt meldingen in<input id="s-voice" type="checkbox" ${this.settings.voice !== false ? 'checked' : ''}></label>
          <label>3D: schaduwen<input id="s-shadows" type="checkbox" ${localStorage.getItem('openrescue.shadows') !== '0' ? 'checked' : ''}></label>
          <label>3D: dag en nacht<input id="s-daynight" type="checkbox" ${localStorage.getItem('openrescue.daynight') !== '0' ? 'checked' : ''}></label>
          <hr style="border-color:#34405a;width:100%">
          <div><b>Mods</b> <span class="help">(JSON-bestand met voertuigen, incidenten, rollen of kaarten — zie docs/modding.md)</span></div>
          <input id="s-mod" type="file" accept=".json,application/json">
          ${msg.errors?.length ? `<div class="err">${esc(msg.errors.join('\n'))}</div>` : ''}${msg.msg ? `<div class="ok">${esc(msg.msg)}</div>` : ''}
          <div class="help">Geladen mods: ${mods.length ? mods.map(m => esc(m.name)).join(', ') : 'geen'}</div>
          ${mods.length ? '<button id="s-clear">Mods verwijderen</button>' : ''}
          <button id="s-back" class="primary">Opslaan en terug</button></div>`);
        const apply = () => {
          this.settings.edgeScroll = (sc.querySelector('#s-edge') as HTMLInputElement).checked;
          this.settings.hints = (sc.querySelector('#s-hints') as HTMLInputElement).checked;
          this.settings.defaultSpeed = Number((sc.querySelector('#s-speed') as HTMLSelectElement).value) as 1 | 2 | 4;
          this.settings.muted = (sc.querySelector('#s-muted') as HTMLInputElement).checked;
          this.settings.voice = (sc.querySelector('#s-voice') as HTMLInputElement).checked;
          sc.querySelectorAll<HTMLInputElement>('.s-mix').forEach(el => { this.settings.mix[el.dataset.mix!] = Number(el.value) / 100; });
          this.settings.voiceName = (sc.querySelector('#s-voicename') as HTMLSelectElement).value;
          this.settings.voiceRate = Number((sc.querySelector('#s-voicerate') as HTMLInputElement).value) / 100;
          this.settings.volume = Number((sc.querySelector('#s-vol') as HTMLInputElement).value) / 100;
          const view = (sc.querySelector('#s-view') as HTMLSelectElement).value as '2d' | '3d';
          if (view !== this.settings.viewMode) { this.settings.viewMode = view; void this.scene.setViewMode(this.settings.viewMode); }
          this.scene.edgeScroll = this.settings.edgeScroll;
          const shadows = (sc.querySelector('#s-shadows') as HTMLInputElement).checked, dayNight = (sc.querySelector('#s-daynight') as HTMLInputElement).checked;
          try { localStorage.setItem('openrescue.shadows', shadows ? '1' : '0'); localStorage.setItem('openrescue.daynight', dayNight ? '1' : '0'); } catch { /* storage unavailable */ }
          const r3 = this.scene.renderer3d as unknown as { setShadows?(on: boolean): void; setDayNight?(on: boolean): void } | null;
          r3?.setShadows?.(shadows); r3?.setDayNight?.(dayNight);
          this.applyAudio();
          saveSettings(this.settings);
        };
        sc.querySelector('#s-vol')?.addEventListener('input', () => { apply(); this.scene.audio?.play('click'); });
        sc.querySelectorAll('.s-mix,#s-voicename,#s-voicerate').forEach(el => el.addEventListener('input', apply));
        on('s-test-siren', () => { apply(); this.scene.audio?.unlock(); this.scene.audio?.play('alert'); });
        on('s-test-voice', () => { apply(); this.scene.audio?.unlock(); this.scene.audio?.speak('Meldkamer. Woningbrand. Buren melden veel rook uit een huis. Adres: Dorpsstraat 12. Prioriteit 1, spoed.'); });
        on('s-test-beat', () => { apply(); this.scene.audio?.unlock(); this.scene.audio?.testHeartbeat(); });
        sc.querySelector('#s-muted')?.addEventListener('change', apply);
        on('s-back', () => { apply(); this.showScreen(extra === 'pause' ? 'pause' : 'main'); });
        on('s-clear', () => { saveMods([]); this.showScreen('settings', { msg: 'Mods verwijderd. Herlaad de pagina om de standaardcontent terug te krijgen.' }); });
        on('s-mod', async ev => {
          apply();
          const f = (ev.target as HTMLInputElement).files?.[0];
          if (!f) return;
          try {
            const pack = JSON.parse(await f.text()) as ModPack;
            const { content, errors } = mergeContent(this.scene.content, pack, f.name);
            if (errors.length) { this.showScreen('settings', { errors }); return; }
            Object.assign(this.scene.content, content);
            const all = loadMods(); all.push({ name: f.name, pack }); saveMods(all);
            this.showScreen('settings', { msg: `Mod "${f.name}" geladen. Nieuwe voertuigsprites verschijnen na het herladen van de pagina.` });
          } catch (e) {
            this.showScreen('settings', { errors: [`${f.name}: ongeldige JSON (${(e as Error).message})`] });
          }
        }, 'change');
        break;
      }
      case 'pause':
        card(`<h2>Pauze</h2><div class="col"><button id="p-resume" class="primary">▶ Hervatten</button><button id="p-save">💾 Opslaan</button><button id="p-load" ${save ? '' : 'disabled'}>📂 Laden</button><button id="p-set">⚙ Instellingen</button><button id="p-end">🏁 Spel beëindigen en score bewaren</button><button id="p-menu">⌂ Hoofdmenu</button></div><p class="help" id="p-msg"></p>`);
        on('p-resume', () => this.closePause());
        on('p-save', () => { const ok = writeSave(this.scene.world!.serialize()); (sc.querySelector('#p-msg') as HTMLElement).textContent = ok ? 'Spel opgeslagen.' : 'Opslaan mislukt (browseropslag vol of geblokkeerd).'; this.showScreenKeepMsg(); });
        on('p-load', () => this.loadSaved());
        on('p-set', () => this.showScreen('settings', 'pause'));
        on('p-end', () => this.showScreen('gameover', 'Spel beëindigd door de speler.'));
        on('p-menu', () => { this.scene.toMenu(); this.showScreen('main'); });
        break;
      case 'gameover': {
        const w = this.scene.world!;
        if (!this.recorded) {
          this.recorded = true;
          addScore({ score: Math.round(w.score), solved: w.solved, time: Math.round(w.time), difficulty: w.mission ? w.mission.name : w.opts.difficulty, seed: String(w.opts.seed), date: new Date().toLocaleDateString('nl-NL') });
        }
        card(`<h2>${w.won ? '🏆 Missie geslaagd!' : 'Game over'}</h2><div class="sub">${esc(String((extra as string) ?? 'De gemeente heeft het vertrouwen opgezegd.'))}</div>
          <div class="col"><div>Score: <b>${Math.round(w.score)}</b> · Opgelost: <b>${w.solved}</b> · Mislukt: <b>${w.failed}</b> · Speeltijd: <b>${fmtTime(w.time)}</b></div>
          <div class="sub">Dienstrapport: gem. aanrijtijd <b>${w.responseTimes.length ? Math.round(w.averageResponse) + ' s' : '–'}</b> · overleden slachtoffers <b>${w.deaths}</b> · valse meldingen <b>${w.falseAlarms}</b> · GRIP-niveau <b>${w.grip}</b></div>
          <button id="g-again" class="primary">↻ Opnieuw</button><button id="g-menu">⌂ Hoofdmenu</button></div>`);
        on('g-again', () => this.start(this.lastOpts ?? { seed: 1, difficulty: 'normal', freeplay: true }));
        on('g-menu', () => { this.scene.toMenu(); this.showScreen('main'); });
        break;
      }
    }
  }
  private showScreenKeepMsg(): void { /* message element is updated in place */ }

  private loadSaved(): void {
    const sv = loadSave();
    if (!sv) return;
    try {
      this.start(sv.opts, sv);
    } catch (e) {
      this.scene.toMenu();
      this.showScreen('main');
      this.toast({ type: 'warn', message: `Opgeslagen spel kon niet worden geladen: ${(e as Error).message}` });
    }
  }

  private start(opts: WorldOptions, save?: import('../sim/world').SaveGame): void {
    this.lastOpts = opts;
    this.recorded = false;
    this.scene.begin(opts, save ?? undefined);
    this.scene.setSpeed(this.settings.defaultSpeed);
    this.cache.clear();
    this.showScreen('none');
  }
  private openPause(): void {
    if (this.scene.state !== 'playing') return;
    this.resumeSpeed = this.scene.speed || 1;
    this.scene.setSpeed(0);
    this.showScreen('pause');
  }
  private closePause(): void {
    this.scene.setSpeed(this.resumeSpeed);
    this.showScreen('none');
  }
  private showGameOver(message?: string): void {
    if (this.overlayOpen) return;
    this.scene.setSpeed(0);
    this.showScreen('gameover', message);
  }
}
