import Phaser from 'phaser';
import './style.css';
import { loadBuiltinContent } from './data';
import { buildSvgs, rasterise } from './game/assets';
import { GameScene, boot } from './game/scene';
import { UI } from './ui/ui';
import { loadMods } from './storage';
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
  game.events.once('ready', () => {
    const scene = game.scene.getScene('game') as unknown as GameScene;
    const start = () => {
      const ui = new UI(scene);
      (window as unknown as Record<string, unknown>).__openrescue = { game, scene, ui, get world() { return scene.world; } };
    };
    if (scene.world) start();
    else scene.events.once('create', start);
  });
}

main().catch(err => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f88;padding:20px">Fout bij starten: ${String(err)}</pre>`);
});
