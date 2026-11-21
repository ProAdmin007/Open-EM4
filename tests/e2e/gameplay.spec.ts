import { expect, test, type Page } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */
const game = (page: Page) => ({
  eval: <T>(fn: (or: any) => T) => page.evaluate(fn as any, undefined) as Promise<T>,
});
void game;

async function openFreeplay(page: Page): Promise<void> {
  await page.goto('/?e2e');
  await expect(page.locator('#screen .card h1')).toContainText('OpenRescue');
  await page.getByRole('button', { name: /Freeplay/ }).click();
  await page.locator('#f-seed').fill('e2e');
  await page.getByRole('button', { name: /Start Freeplay/ }).click();
  await expect(page.locator('#ui')).toBeVisible();
  await page.waitForFunction(() => (window as any).__openrescue?.scene?.state === 'playing');
}

/** Screen position (page coordinates) of a world tile. */
const screenOf = (page: Page, tx: number, ty: number) =>
  page.evaluate(([x, y]) => (window as any).__openrescue.scene.tileToScreen(x, y), [tx, ty]) as Promise<{ x: number; y: number }>;

test('scenario: send engine to a house fire, dismount, extinguish, incident disappears', async ({ page }) => {
  await openFreeplay(page);

  // Scenario setup: a house fire without trapped victims (everything else is driven through the real UI).
  const info = await page.evaluate(() => {
    const or = (window as any).__openrescue;
    const w = or.world;
    const inc = w.spawnIncident('house_fire', { severity: 1 });
    for (const id of inc.victims) w.victims.delete(id);
    inc.victims = [];
    const b = w.buildings.get(inc.buildingId);
    or.scene.centerOn(b.x + b.w / 2, b.y + b.h / 2);
    or.scene.zoomBy(0.7);
    const engine = [...w.vehicles.values()].find((v: any) => v.defId === 'fire_engine');
    return { incId: inc.id, bx: b.x + b.w / 2, by: b.y + b.h / 2, bid: b.id, vid: engine.id };
  });

  // The incident shows up in the incident list.
  await expect(page.locator('#incident-list .inc')).toContainText('Woningbrand');

  // Select the fire engine from the dispatch bar and speed the game up.
  await page.locator(`[data-vid="${info.vid}"]`).click();
  await expect(page.locator('#unit-panel')).toContainText('Tankautospuit');
  await page.locator('[data-act="speed4"]').click();

  // Right-click the burning building: the engine drives to it.
  const target = await screenOf(page, info.bx, info.by);
  await page.mouse.click(target.x, target.y, { button: 'right' });
  await page.waitForFunction(id => (window as any).__openrescue.world.vehicles.get(id).path.length > 0, info.vid);
  await page.waitForFunction(id => {
    const w = (window as any).__openrescue.world;
    return w.vehicles.get(id).path.length === 0;
  }, info.vid, { timeout: 60_000 });

  // Crew gets out through the real button.
  await page.getByRole('button', { name: /Uitstappen/ }).click();
  await page.waitForFunction(id => (window as any).__openrescue.world.vehicles.get(id).crew.every((r: number) => !(window as any).__openrescue.world.responders.get(r).inVehicle), info.vid);
  await expect(page.locator('#unit-panel')).toContainText('personeelsleden');

  // Order the extinguish action via the ability button.
  await page.locator('[data-ability="extinguish"]').click();
  await page.waitForFunction(() => [...(window as any).__openrescue.world.responders.values()].some((r: any) => r.task?.type === 'extinguish'));

  // The fire is fought and the incident is resolved.
  await page.waitForFunction(id => !(window as any).__openrescue.world.incidents.has(id), info.incId, { timeout: 90_000 });
  const res = await page.evaluate(id => {
    const w = (window as any).__openrescue.world;
    return { solved: w.solved, score: w.score, fire: w.buildings.get(id).fire, destroyed: w.buildings.get(id).destroyed };
  }, info.bid);
  expect(res.solved).toBeGreaterThanOrEqual(1);
  expect(res.score).toBeGreaterThan(0);
  expect(res.fire).toBe(0);
  expect(res.destroyed).toBe(false);
  await expect(page.locator('#incident-list')).not.toContainText('Woningbrand');
  await page.screenshot({ path: 'test-results/scenario-resolved.png' });
});

test('selecting a vehicle by clicking and box-selecting on the map', async ({ page }) => {
  await openFreeplay(page);
  const v = await page.evaluate(() => {
    const or = (window as any).__openrescue;
    const veh = [...or.world.vehicles.values()].find((x: any) => x.defId === 'ambulance');
    or.scene.centerOn(veh.x, veh.y);
    return { id: veh.id, x: veh.x, y: veh.y };
  });
  const p = await screenOf(page, v.x, v.y);
  await page.mouse.click(p.x, p.y);
  expect(await page.evaluate(() => [...(window as any).__openrescue.scene.selected])).toContain(v.id);
  await expect(page.locator('#unit-panel')).toContainText('Ambulance');
  // deselect, then box-select around it
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => (window as any).__openrescue.scene.selected.size)).toBe(0);
  await page.mouse.move(p.x - 80, p.y - 60);
  await page.mouse.down();
  await page.mouse.move(p.x + 80, p.y + 60, { steps: 5 });
  await page.mouse.up();
  expect(await page.evaluate(() => (window as any).__openrescue.scene.selected.size)).toBeGreaterThan(0);
});

test('pause and resume stop and restart the simulation', async ({ page }) => {
  await openFreeplay(page);
  await page.waitForTimeout(600);
  await page.locator('#btn-pause').click();
  await expect(page.locator('#pause-banner')).toBeVisible();
  const t0 = await page.evaluate(() => (window as any).__openrescue.world.time);
  await page.waitForTimeout(800);
  const t1 = await page.evaluate(() => (window as any).__openrescue.world.time);
  expect(t1).toBe(t0);
  await page.keyboard.press('Space');
  await page.waitForTimeout(800);
  const t2 = await page.evaluate(() => (window as any).__openrescue.world.time);
  expect(t2).toBeGreaterThan(t1);
  await expect(page.locator('#pause-banner')).toBeHidden();
});

test('new game starts the scripted fire and the menu can save', async ({ page }) => {
  await page.goto('/?e2e');
  await page.getByRole('button', { name: /Nieuw spel/ }).click();
  await page.locator('[data-act="speed4"]').click();
  await expect(page.locator('#incident-list .inc').first()).toContainText('Woningbrand', { timeout: 20_000 });
  await page.locator('[data-act="menu"]').click();
  await page.getByRole('button', { name: /Opslaan/ }).click();
  await expect(page.locator('#p-msg')).toContainText('opgeslagen');
  await page.getByRole('button', { name: /Hervatten/ }).click();
  await expect(page.locator('#screen')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('openrescue.save'))).toBeTruthy();
});

test('camera: wasd moves, wheel zooms, minimap click recentres', async ({ page }) => {
  await openFreeplay(page);
  const cam = () => page.evaluate(() => { const c = (window as any).__openrescue.scene.cameras.main; return { x: c.scrollX, y: c.scrollY, z: c.zoom }; });
  const a = await cam();
  await page.keyboard.down('d');
  await page.waitForTimeout(400);
  await page.keyboard.up('d');
  expect((await cam()).x).toBeGreaterThan(a.x + 50);
  await page.mouse.move(600, 300);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(100);
  expect((await cam()).z).toBeGreaterThan(a.z);
  const box = (await page.locator('#minimap').boundingBox())!;
  await page.mouse.click(box.x + 10, box.y + 10);
  const b = await cam();
  expect(b.x).toBeLessThan(500);
});

test('performance: freeplay on hard keeps a good frame rate and a stable object count', async ({ page }) => {
  await page.goto('/?e2e');
  await page.getByRole('button', { name: /Freeplay/ }).click();
  await page.locator('#f-diff').selectOption('hard');
  await page.getByRole('button', { name: /Start Freeplay/ }).click();
  await page.locator('[data-act="speed4"]').click();
  await page.waitForTimeout(3000);
  const objs0 = await page.evaluate(() => (window as any).__openrescue.scene.children.list.length);
  const samples: number[] = [];
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(1000);
    samples.push(await page.evaluate(() => (window as any).__openrescue.game.loop.actualFps));
  }
  const objs1 = await page.evaluate(() => (window as any).__openrescue.scene.children.list.length);
  const avg = samples.reduce((s, x) => s + x, 0) / samples.length;
  console.log(`PERF avg fps=${avg.toFixed(1)} min=${Math.min(...samples).toFixed(1)} objects ${objs0} -> ${objs1}`);
  expect(avg).toBeGreaterThan(12); // software-rendered (SwiftShader) browser runs ~20 fps; this only guards against regressions
  expect(objs1).toBeLessThan(objs0 + 200);
});

test('audio: engine starts after a gesture, reacts to fire and sirens, and honours mute', async ({ page }) => {
  await openFreeplay(page);
  const dbg = () => page.evaluate(() => (window as any).__openrescue.audio.debug());
  await expect.poll(async () => (await dbg()).state, { timeout: 5000 }).toBe('running');
  expect((await dbg()).masterGain).toBeGreaterThan(0);

  // a fire right next to the camera produces crackle
  await page.evaluate(() => {
    const or = (window as any).__openrescue;
    const inc = or.world.spawnIncident('house_fire', { severity: 2 });
    const b = or.world.buildings.get(inc.buildingId);
    or.scene.centerOn(b.x + b.w / 2, b.y + b.h / 2);
  });
  await expect.poll(async () => (await dbg()).fire, { timeout: 5000 }).toBeGreaterThan(0.05);

  // a driving emergency vehicle near the camera produces a siren
  await page.evaluate(() => {
    const or = (window as any).__openrescue;
    const v = [...or.world.vehicles.values()].find((x: any) => x.defId === 'fire_engine');
    or.scene.centerOn(v.x, v.y);
    or.world.orderMove([v.id], v.x + 12, v.y + 12);
  });
  await expect.poll(async () => (await dbg()).sirens.fire ?? 0, { timeout: 5000 }).toBeGreaterThan(0.2);

  // mute button and M key
  await page.locator('#btn-mute').click();
  await expect.poll(async () => (await dbg()).muted).toBe(true);
  await expect.poll(async () => (await dbg()).masterGain, { timeout: 3000 }).toBeLessThan(0.01);
  await page.keyboard.press('m');
  await expect.poll(async () => (await dbg()).muted).toBe(false);
});
