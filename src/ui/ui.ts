import type { GameScene } from '../game/scene';
import { T } from '../game/scene';
import { DIFFICULTY, type WorldOptions } from '../sim/world';
import type { Ability, Category, Difficulty, GameEvent, Task } from '../sim/types';
import { hashSeed } from '../sim/rng';
import { loadMods, loadSave, loadSettings, saveMods, saveSettings, writeSave, type Settings } from '../storage';
import { mergeContent, type ModPack } from '../sim/content';

const CAT_LABEL: Record<Category, string> = { fire: '🚒 Brandweer', ambulance: '🚑 Ambulance', police: '🚓 Politie', tech: '🔧 Techniek' };
const ABILITY_LABEL: Partial<Record<Ability, string>> = {
  extinguish: '💧 Blussen', rescue: '🆘 Redden', treat: '🩺 Behandelen', carry: '🛏 Inladen', arrest: '🔗 Arresteren', secure: '🚧 Afzetten', clear: '🏗 Bergen',
};
const ABILITY_ORDER: Ability[] = ['extinguish', 'rescue', 'treat', 'carry', 'arrest', 'secure', 'clear'];
const TASK_LABEL = (t: Task | null): string => {
  if (!t) return 'Wacht op opdracht';
  switch (t.type) {
    case 'move': return 'Loopt';
    case 'board': return 'Stapt in';
    case 'extinguish': return t.deploy < 2.5 ? 'Rolt slang uit' : 'Blust brand';
    case 'rescue': return 'Redt slachtoffer';
    case 'treat': return 'Behandelt slachtoffer';
    case 'load': return 'Draagt slachtoffer naar voertuig';
    case 'arrest': return 'Arresteert verdachte';
    case 'secure': return 'Zet locatie af';
    case 'clear': return 'Ruimt obstakel';
  }
};
const TRANSPORT_LABEL: Record<string, string> = { trapped: 'Opgesloten in pand', scene: 'Ter plaatse', carried: 'Wordt gedragen', inAmbulance: 'In ambulance', atHospital: 'In ziekenhuis', dead: 'Overleden' };
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
  private lastTap = { id: -1, t: 0 };
  private toasts: HTMLElement[] = [];
  private mini = document.createElement('canvas');
  private miniFor: unknown = null;

  constructor(private scene: GameScene) {
    scene.edgeScroll = this.settings.edgeScroll;
    scene.onEvent(e => this.toast(e));
    this.bind();
    this.showScreen('main');
    setInterval(() => this.refresh(), 250);
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
      const target = (ev.target as HTMLElement).closest<HTMLElement>('[data-act],[data-vid],[data-iid],[data-tab],[data-ability]');
      if (!target || ev.button !== 0) return;
      const s = this.scene, w = s.world;
      if (!w) return;
      const d = target.dataset;
      if (d.vid) {
        const id = Number(d.vid);
        const now = performance.now();
        s.select([id], ev.shiftKey);
        if (this.lastTap.id === id && now - this.lastTap.t < 400) { const v = w.vehicles.get(id)!; s.centerOn(v.x, v.y); }
        this.lastTap = { id, t: now };
      } else if (d.iid) {
        const i = w.incidents.get(Number(d.iid));
        if (i) s.centerOn(i.x, i.y);
      } else if (d.tab) this.tab = d.tab as Category;
      else if (d.ability) s.cmdAbility(d.ability as Ability);
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
      case 'menu': this.openPause(); break;
      case 'zoomin': s.zoomBy(1.2); break;
      case 'zoomout': s.zoomBy(1 / 1.2); break;
      case 'home': { const id = [...s.selected][0]; const e = s.world!.vehicles.get(id) ?? s.world!.responders.get(id); if (e) s.centerOn(e.x, e.y); break; }
      case 'dismount': s.cmdDismount(); break;
      case 'board': s.cmdBoard(); break;
      case 'stop': s.cmdStop(); break;
      case 'crew': s.selectCrew(); break;
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
    if (e.type === 'game_over') this.showGameOver();
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
      if (i.victims.length) bits.push(`🩹 ${i.victims.filter(id => { const v = w.victims.get(id); return v && v.transport !== 'atHospital' && v.transport !== 'dead'; }).length}/${i.victims.length}`);
      if (i.suspects.length) bits.push(`🕵 ${i.suspects.filter(id => !w.suspects.get(id)?.arrested).length} verdacht`);
      if (def.objectives.includes('area_secured')) bits.push(i.secured ? '✔ afgezet' : '○ afzetten');
      if (def.objectives.includes('obstacle_cleared')) bits.push(i.cleared ? '✔ geruimd' : '○ ruimen');
      return `<div class="inc s${i.severity}" data-iid="${i.id}"><div class="t"><span>${esc(def.icon ?? '')} ${esc(i.name)}</span><span>ernst ${i.severity}</span></div>` +
        `<div class="d">${bits.join(' · ')} · nog ${Math.ceil(left)}s</div><div class="meter"><i class="${frac < 0.3 ? 'low' : ''}" style="width:${(frac * 100).toFixed(0)}%"></i></div></div>`;
    }).join('');
    this.setHtml('incident-list', html || '<div class="empty">Geen actieve meldingen. Even rust…</div>');
  }

  private renderDispatch(): void {
    const w = this.scene.world!, sel = this.scene.selected;
    const cats: Category[] = ['fire', 'ambulance', 'police', 'tech'];
    this.setHtml('tabs', cats.map(c => `<button data-tab="${c}" class="${c === this.tab ? 'on' : ''}">${CAT_LABEL[c]}</button>`).join(''));
    const html = w.vehiclesOf(this.tab).map(v => {
      const out = v.crew.filter(id => !w.responders.get(id)!.inVehicle).length;
      const status = v.state === 'moving' ? 'Onderweg' : out ? `${out} uitgestapt` : v.patients.length ? 'Patiënt aan boord' : 'Gereed';
      return `<button class="veh cat-${v.category} ${sel.has(v.id) ? 'sel' : ''}" data-vid="${v.id}"><span class="dot ${v.state === 'moving' ? 'moving' : out ? 'out' : ''}"></span>${esc(v.name)}<small>${status}</small></button>`;
    }).join('');
    this.setHtml('vehicle-list', html);
  }

  private renderUnitPanel(): void {
    const s = this.scene, w = s.world!;
    const ids = [...s.selected];
    let html = '';
    if (!ids.length && s.inspect) {
      const t = s.inspect;
      if (t.kind === 'victim') {
        const v = w.victims.get(t.id);
        if (v) html = `<div class="name">🩹 Slachtoffer</div><div class="row">Gezondheid: <span class="hp"><i class="${v.health < 35 ? 'low' : ''}" style="width:${v.health}%"></i></span> ${Math.round(v.health)}%</div><div class="row">Bewustzijn: ${v.conscious ? 'bij kennis' : 'bewusteloos'} · Behandeling: ${v.treated ? 'gestabiliseerd' : 'onbehandeld'}</div><div class="row">Status: ${TRANSPORT_LABEL[v.transport]}</div><div class="row">Rechtermuisknop met ambulancepersoneel = behandelen, daarna nogmaals = inladen.</div>`;
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
        html = `<div class="name">${esc(v.name)}</div><div class="row">${v.state === 'moving' ? 'Rijdt (' + Math.round(def.maxSpeed) + ' km/h max)' : 'Staat stil'} · Bemanning: ${v.crew.length - out}/${v.crew.length} aan boord${v.patients.length ? ' · patiënt aan boord' : ''}</div>` +
          `<div class="row">Uitrusting: ${def.equipment.map(e => esc(e.replace(/_/g, ' '))).join(', ') || '—'}</div>` +
          `<div class="actions"><button data-act="dismount">⬇ Uitstappen (E)</button><button data-act="board">⬆ Instappen (R)</button><button data-act="crew" ${out ? '' : 'disabled'}>👥 Bemanning</button><button data-act="stop">⏹ Stop (X)</button></div>` +
          `<div class="row">Rechtermuisknop op de kaart = rijden. Op een ziekenhuis = patiënt afleveren.</div>`;
      } else if (rs.length && !vs.length) {
        const first = rs[0];
        const abilities = new Set<Ability>();
        for (const r of rs) for (const a of w.roleDef(r).abilities) if (w.canDo(r, a) && ABILITY_LABEL[a]) abilities.add(a);
        const buttons = ABILITY_ORDER.filter(a => abilities.has(a)).map(a => {
          const hasTarget = rs.some(r => w.canDo(r, a) && w.findTarget(r, a));
          return `<button data-ability="${a}" ${hasTarget ? '' : 'disabled'} title="Nearest target">${ABILITY_LABEL[a]}</button>`;
        }).join('');
        html = `<div class="name">${rs.length === 1 ? esc(first.name) : `${rs.length} personeelsleden`}</div>` +
          `<div class="row">${rs.length === 1 ? esc(w.roleDef(first).name) + ' · ' + TASK_LABEL(first.task) : [...new Set(rs.map(r => w.roleDef(r).name))].join(', ')}${first.carrying !== null ? ' · draagt slachtoffer' : ''}</div>` +
          `<div class="actions">${buttons}<button data-act="board">⬆ Instappen (R)</button><button data-act="stop">⏹ Stop</button></div>` +
          `<div class="row">Rechtermuisknop op brand / slachtoffer / verdachte / obstakel = gerichte opdracht.</div>`;
      } else {
        html = `<div class="name">${ids.length} eenheden geselecteerd</div><div class="actions"><button data-act="dismount">⬇ Uitstappen</button><button data-act="board">⬆ Instappen</button><button data-act="stop">⏹ Stop</button></div>`;
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
          <button id="b-new" class="primary">▶ Nieuw spel</button><button id="b-free">♾ Freeplay</button>
          <button id="b-cont" ${save ? '' : 'disabled'}>⏵ Doorgaan met opgeslagen spel</button><button id="b-set">⚙ Instellingen</button></div>
          <p class="help">Nieuw spel start met een woningbrand, een ongeluk en een misdrijf en gaat daarna door in Freeplay.</p>`);
        on('b-new', () => this.start({ seed: hashSeed(this.settings.seed), difficulty: this.settings.difficulty, freeplay: true, scripted: true }));
        on('b-free', () => this.showScreen('freeplay'));
        on('b-cont', () => { const sv = loadSave(); if (sv) this.start(sv.opts, sv); });
        on('b-set', () => this.showScreen('settings', 'main'));
        break;
      case 'freeplay':
        card(`<h2>Freeplay</h2><div class="col"><label>Moeilijkheid<select id="f-diff">${(['easy', 'normal', 'hard'] as Difficulty[]).map(d => `<option value="${d}" ${d === this.settings.difficulty ? 'selected' : ''}>${{ easy: 'Easy – weinig incidenten', normal: 'Normal', hard: 'Hard – veel & snelle escalatie' }[d]}</option>`).join('')}</select></label>
          <label>Seed<input id="f-seed" type="text" value="${esc(this.settings.seed)}"></label>
          <p class="help">Dezelfde seed geeft hetzelfde scenario.</p>
          <button id="f-go" class="primary">▶ Start Freeplay</button><button id="f-back">← Terug</button></div>`);
        on('f-go', () => {
          this.settings.difficulty = (sc.querySelector('#f-diff') as HTMLSelectElement).value as Difficulty;
          this.settings.seed = (sc.querySelector('#f-seed') as HTMLInputElement).value || '1';
          saveSettings(this.settings);
          this.start({ seed: hashSeed(this.settings.seed), difficulty: this.settings.difficulty, freeplay: true });
        });
        on('f-back', () => this.showScreen('main'));
        break;
      case 'settings': {
        const mods = loadMods();
        const msg = typeof extra === 'object' && extra ? (extra as { msg?: string; errors?: string[] }) : {};
        card(`<h2>Instellingen</h2><div class="col">
          <label>Randscrollen met de muis<input id="s-edge" type="checkbox" ${this.settings.edgeScroll ? 'checked' : ''}></label>
          <label>Hints tonen<input id="s-hints" type="checkbox" ${this.settings.hints ? 'checked' : ''}></label>
          <label>Standaard spelsnelheid<select id="s-speed">${[1, 2, 4].map(n => `<option value="${n}" ${this.settings.defaultSpeed === n ? 'selected' : ''}>${n}×</option>`).join('')}</select></label>
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
          this.scene.edgeScroll = this.settings.edgeScroll;
          saveSettings(this.settings);
        };
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
        card(`<h2>Pauze</h2><div class="col"><button id="p-resume" class="primary">▶ Hervatten</button><button id="p-save">💾 Opslaan</button><button id="p-load" ${save ? '' : 'disabled'}>📂 Laden</button><button id="p-set">⚙ Instellingen</button><button id="p-menu">⌂ Hoofdmenu</button></div><p class="help" id="p-msg"></p>`);
        on('p-resume', () => this.closePause());
        on('p-save', () => { const ok = writeSave(this.scene.world!.serialize()); (sc.querySelector('#p-msg') as HTMLElement).textContent = ok ? 'Spel opgeslagen.' : 'Opslaan mislukt (browseropslag vol of geblokkeerd).'; this.showScreenKeepMsg(); });
        on('p-load', () => { const sv = loadSave(); if (sv) this.start(sv.opts, sv); });
        on('p-set', () => this.showScreen('settings', 'pause'));
        on('p-menu', () => { this.scene.toMenu(); this.showScreen('main'); });
        break;
      case 'gameover': {
        const w = this.scene.world!;
        card(`<h2>Game over</h2><div class="sub">${esc(String((extra as string) ?? 'De gemeente heeft het vertrouwen opgezegd.'))}</div>
          <div class="col"><div>Score: <b>${Math.round(w.score)}</b> · Opgelost: <b>${w.solved}</b> · Mislukt: <b>${w.failed}</b> · Speeltijd: <b>${fmtTime(w.time)}</b></div>
          <button id="g-again" class="primary">↻ Opnieuw</button><button id="g-menu">⌂ Hoofdmenu</button></div>`);
        on('g-again', () => this.start(this.lastOpts ?? { seed: 1, difficulty: 'normal', freeplay: true }));
        on('g-menu', () => { this.scene.toMenu(); this.showScreen('main'); });
        break;
      }
    }
  }
  private showScreenKeepMsg(): void { /* message element is updated in place */ }

  private start(opts: WorldOptions, save?: import('../sim/world').SaveGame): void {
    this.lastOpts = opts;
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
  private showGameOver(): void {
    if (this.overlayOpen) return;
    this.scene.setSpeed(0);
    this.showScreen('gameover');
  }
}
