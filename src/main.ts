import Phaser from 'phaser';
import './style.css';
import { loadBuiltinContent } from './data';
import { buildSvgs, rasterise } from './game/assets';
import { GameScene, boot } from './game/scene';
import { UI } from './ui/ui';
import { loadMods, loadSettings } from './storage';
import { AudioEngine } from './game/audio';
import { mergeContent } from './sim/content';

async function main(): Promise<void> {
  let content = loadBuiltinContent();
  const modErrors: string[] = [];
  for (const m of loadMods()) {
    const r = mergeContent(content, m.pack, m.name);
    content = r.content;
    modErrors.push(...r.errors);
  }
  if (modErrors.length) console.warn('Mod-fouten:\n' + modErrors.join('\n'));
  const images = await rasterise(buildSvgs(content));
  boot.data = { content, images };

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game-root',
    backgroundColor: '#1d2a1d',
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    render: { antialias: true, powerPreference: 'high-performance' },
    banner: false,
    scene: [GameScene],
  });
  // Safety net: if the WebGL context is lost during start-up (seen with some GPU drivers and software renderers) the game loop can
  // stall for good. When no frame has been produced for a few seconds, reload the page once.
  let lastFrame = -1, stalled = 0;
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    const frame = game.loop.frame;
    stalled = frame === lastFrame ? stalled + 1 : 0;
    lastFrame = frame;
    if (stalled >= 3) {
      try {
        if (sessionStorage.getItem('openrescue.reloaded')) return;
        sessionStorage.setItem('openrescue.reloaded', '1');
      } catch { /* storage unavailable: still reload once per page load below */ }
      location.reload();
    }
  }, 2000);
  game.events.once('ready', () => {
    const scene = game.scene.getScene('game') as unknown as GameScene;
    const start = () => {
      const st = loadSettings();
      const audio = new AudioEngine(st.volume, st.muted);
      scene.audio = audio;
      const unlock = () => audio.unlock();
      for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, unlock, { capture: true });
      const ui = new UI(scene);
      (window as unknown as Record<string, unknown>).__openrescue = { game, scene, ui, audio, get world() { return scene.world; } };
    };
    if (scene.world) start();
    else scene.events.once('create', start);
  });
}

main().catch(err => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f88;padding:20px">Fout bij starten: ${String(err)}</pre>`);
});
