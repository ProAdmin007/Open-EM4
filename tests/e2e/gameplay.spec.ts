import { expect, test, type Page } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */
const game = (page: Page) => ({
  eval: <T>(fn: (or: any) => T) => page.evaluate(fn as any, undefined) as Promise<T>,
});
void game;


/**
 * Open the game and make sure the render loop is really running. In the software-rendered test browser the WebGL context
 * is sometimes lost while the page starts (the game loop then stalls); reload until a healthy start.
 */
async function gotoHealthy(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt++) {
    await page.goto('/?e2e');
    await page.waitForFunction(() => !!(window as any).__openrescue?.scene, undefined, { timeout: 15_000 }).catch(() => undefined);
    const a = await page.evaluate(() => (window as any).__openrescue?.game?.loop?.frame ?? -1);
    await page.waitForTimeout(1200);
    const b = await page.evaluate(() => (window as any).__openrescue?.game?.loop?.frame ?? -1);
    if (a >= 0 && b > a + 3) return;
  }
  throw new Error('The game loop did not start (WebGL context lost?)');
}

async function openFreeplay(page: Page): Promise<void> {
  await gotoHealthy(page);
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

  await page.waitForTimeout(300); // let the camera apply centerOn/zoom before computing screen coordinates
  // The incident shows up in the incident list.
  await expect(page.locator('#incident-list')).toContainText('Woningbrand', { timeout: 25_000 }); // the caller first only gives confused words and tells what it is after a few seconds

  // Select the fire engine from the dispatch bar and speed the game up.
  await page.locator(`[data-vid="${info.vid}"]`).click();
  await expect(page.locator('#unit-panel')).toContainText('Tankautospuit');
  await page.locator('[data-act="speed4"]').click();

  // Right-click the burning building: the engine drives to it.
  const target = await screenOf(page, info.bx, info.by);
  for (let attempt = 0; attempt < 4; attempt++) { // software GL is slow: the first click can land before the camera has settled
    await page.mouse.click(target.x, target.y, { button: 'right' });
    const started = await page.waitForFunction(id => (window as any).__openrescue.world.vehicles.get(id).path.length > 0, info.vid, { timeout: 10_000 }).then(() => true, () => false);
    if (started) break;
  }
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
  await expect(page.locator(`[data-iid="${info.incId}"]`)).toHaveCount(0); // the resolved incident left the list (a spread-fire incident may remain)
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
  await page.waitForTimeout(300);
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

test('new game starts with a random call and the menu can save', async ({ page }) => {
  await gotoHealthy(page);
  await page.getByRole('button', { name: /Nieuw spel/ }).click();
  await page.locator('[data-act="speed4"]').click();
  await expect(page.locator('#incident-list .inc').first()).toBeVisible({ timeout: 20_000 }); // the first call is random now
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
  await gotoHealthy(page);
  await page.getByRole('button', { name: /Freeplay/ }).click();
  await page.locator('#f-diff').selectOption('hard');
  await page.getByRole('button', { name: /Start Freeplay/ }).click();
  await page.locator('[data-act="speed4"]').click();
  await page.waitForTimeout(3000);
  const objs0 = await page.evaluate(() => (window as any).__openrescue.scene.children.list.length);
  const samples: number[] = [];
  for (let i = 0; i < 8; i++) {
    // frames actually rendered per second (loop.actualFps can be stale when the loop stalls)
    const a = await page.evaluate(() => ({ f: (window as any).__openrescue.game.loop.frame, t: performance.now() }));
    await page.waitForTimeout(1000);
    const b = await page.evaluate(() => ({ f: (window as any).__openrescue.game.loop.frame, t: performance.now() }));
    samples.push(((b.f - a.f) * 1000) / (b.t - a.t));
  }
  const objs1 = await page.evaluate(() => (window as any).__openrescue.scene.children.list.length);
  const avg = samples.reduce((s, x) => s + x, 0) / samples.length;
  console.log(`PERF avg fps=${avg.toFixed(1)} min=${Math.min(...samples).toFixed(1)} objects ${objs0} -> ${objs1}`);
  expect(avg).toBeGreaterThan(6); // software-rendered (SwiftShader) browser runs ~10-20 fps; this only guards against regressions
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

test('reinforcements are bought with budget from the dispatch bar', async ({ page }) => {
  await openFreeplay(page);
  const before = await page.evaluate(() => ({ v: (window as any).__openrescue.world.vehicles.size, b: (window as any).__openrescue.world.budget }));
  await page.locator('[data-reinf="fire_engine"]').click();
  await page.waitForFunction(n => (window as any).__openrescue.world.vehicles.size === n + 1, before.v);
  const after = await page.evaluate(() => (window as any).__openrescue.world.budget);
  expect(after).toBeLessThan(before.b);
  await expect(page.locator('#unit-panel')).toContainText('Tankautospuit');
  // too expensive -> button disabled
  await page.evaluate(() => { (window as any).__openrescue.world.budget = 10; });
  await expect(page.locator('[data-reinf="aerial_ladder"]')).toBeDisabled();
});

test('highscores: ending a game stores the score and shows it in the menu', async ({ page }) => {
  await openFreeplay(page);
  await page.evaluate(() => { (window as any).__openrescue.world.score = 777; });
  await page.locator('[data-act="menu"]').click();
  await page.getByRole('button', { name: /Spel beëindigen/ }).click();
  await expect(page.locator('#screen')).toContainText('Game over');
  await expect(page.locator('#screen')).toContainText('777');
  await page.getByRole('button', { name: /Hoofdmenu/ }).click();
  await page.getByRole('button', { name: /Highscores/ }).click();
  await expect(page.locator('#screen')).toContainText('777');
});

test('double right-click on a vehicle lets everybody out; return button sends it home', async ({ page }) => {
  await openFreeplay(page);
  const v = await page.evaluate(() => {
    const or = (window as any).__openrescue;
    const veh = [...or.world.vehicles.values()].find((x: any) => x.defId === 'ambulance');
    or.scene.centerOn(veh.x, veh.y);
    return { id: veh.id, x: veh.x, y: veh.y, hx: veh.home.x, hy: veh.home.y };
  });
  await page.waitForTimeout(300); // let the camera apply centerOn before computing screen coordinates
  const p = await screenOf(page, v.x, v.y);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await page.waitForFunction(id => (window as any).__openrescue.world.vehicles.get(id).crew.every((r: number) => !(window as any).__openrescue.world.responders.get(r).inVehicle), v.id);
  expect(await page.evaluate(() => (window as any).__openrescue.scene.selectedResponderIds().length)).toBe(2);

  // drive away, then use the "terug naar kazerne" button (crew boards first)
  await page.locator('[data-tab="ambulance"]').click();
  await page.locator(`[data-vid="${v.id}"]`).click();
  await page.getByRole('button', { name: /Instappen/ }).first().click();
  await page.waitForFunction(id => (window as any).__openrescue.world.vehicles.get(id).crew.every((r: number) => (window as any).__openrescue.world.responders.get(r).inVehicle), v.id);
  await page.evaluate(id => { const w = (window as any).__openrescue.world; w.orderMove([id], 45, 35); }, v.id);
  await page.locator('[data-act="speed4"]').click();
  await page.waitForFunction(id => (window as any).__openrescue.world.vehicles.get(id).path.length === 0, v.id, { timeout: 60_000 });
  await page.locator(`[data-vid="${v.id}"]`).click();
  await page.getByRole('button', { name: /Terug naar kazerne/ }).click();
  await page.waitForFunction(([id, hx, hy]) => {
    const veh = (window as any).__openrescue.world.vehicles.get(id);
    return Math.hypot(veh.x - (hx + 0.5), veh.y - (hy + 0.5)) < 0.6 && !veh.path.length;
  }, [v.id, v.hx, v.hy] as const, { timeout: 90_000 });
});

test('fire engine: one button connects hoses and starts extinguishing', async ({ page }) => {
  await openFreeplay(page);
  const info = await page.evaluate(() => {
    const or = (window as any).__openrescue, w = or.world;
    const inc = w.spawnIncident('house_fire', { severity: 1 });
    for (const id of inc.victims) w.victims.delete(id);
    inc.victims = [];
    const b = w.buildings.get(inc.buildingId);
    const v = [...w.vehicles.values()].find((x: any) => x.defId === 'fire_engine');
    w.orderMove([v.id], b.door.x + 0.5, b.door.y + 0.5);
    or.scene.select([v.id]);
    or.scene.centerOn(b.x, b.y);
    return { incId: inc.id, vid: v.id };
  });
  await page.locator('[data-act="speed4"]').click();
  await page.waitForFunction(id => (window as any).__openrescue.world.vehicles.get(id).path.length === 0, info.vid, { timeout: 60_000 }).catch(async e => {
    console.log('DIAG', JSON.stringify(await page.evaluate(id => { const or = (window as any).__openrescue, w = or.world, v = w.vehicles.get(id); return { speed: or.scene.speed, t: w.time, pos: [v.x, v.y], path: v.path.length, dest: v.dest, state: or.scene.state, obstacles: w.obstacles.size, inc: [...w.incidents.values()].map((i: any) => i.defId) }; }, info.vid)));
    throw e;
  });
  await page.getByRole('button', { name: /Slangen aansluiten/ }).click();
  await page.waitForFunction(() => [...(window as any).__openrescue.world.responders.values()].filter((r: any) => r.task?.type === 'extinguish').length >= 4);
  await page.waitForFunction(id => !(window as any).__openrescue.world.incidents.has(id), info.incId, { timeout: 90_000 });
});

test('ambulance with a patient: the hospital button drives to the hospital and hands the patient over', async ({ page }) => {
  await openFreeplay(page);
  const info = await page.evaluate(() => {
    const or = (window as any).__openrescue, w = or.world;
    const inc = w.spawnIncident('medical_emergency', { severity: 1 });
    const victim = w.victims.get(inc.victims[0]);
    victim.treated = true;
    const amb = [...w.vehicles.values()].find((v: any) => v.defId === 'ambulance');
    // put the patient into the ambulance (as if it had been loaded)
    victim.transport = 'inAmbulance';
    amb.patients.push(victim.id);
    or.scene.select([amb.id]);
    return { vid: amb.id, victim: victim.id, inc: inc.id };
  });
  await page.locator('[data-tab="ambulance"]').click();
  const btn = page.getByRole('button', { name: /Naar ziekenhuis/ });
  await expect(btn).toBeEnabled();
  await page.locator('[data-act="speed4"]').click();
  await btn.click();
  await page.waitForFunction(id => (window as any).__openrescue.world.victims.get(id)?.transport === 'atHospital' || !(window as any).__openrescue.world.victims.has(id), info.victim, { timeout: 90_000 });
  await page.waitForFunction(id => !(window as any).__openrescue.world.incidents.has(id), info.inc, { timeout: 30_000 });
});

test('the hospital button is disabled without a patient', async ({ page }) => {
  await openFreeplay(page);
  await page.evaluate(() => { const or = (window as any).__openrescue; or.scene.select([[...or.world.vehicles.values()].find((v: any) => v.defId === 'ambulance').id]); });
  await expect(page.getByRole('button', { name: /Naar ziekenhuis/ })).toBeDisabled();
});

test('vehicles start parked in the station lot, not on the road', async ({ page }) => {
  await openFreeplay(page);
  const res = await page.evaluate(() => {
    const w = (window as any).__openrescue.world;
    return [...w.vehicles.values()].map((v: any) => ({ lot: w.isParking(Math.floor(v.x), Math.floor(v.y)), road: w.isRoad(Math.floor(v.x), Math.floor(v.y)) }));
  });
  expect(res.length).toBe(await page.evaluate(() => (window as any).__openrescue.world.map.stations.reduce((n: number, st: any) => n + st.fleet.length, 0)));
  expect(res.length).toBeGreaterThanOrEqual(15);
  expect(res.every((r: any) => r.lot && !r.road)).toBe(true);
});

test('3D view: select engine, send to a house fire, dismount, extinguish, incident disappears', async ({ page }) => {
  test.setTimeout(180_000);
  await openFreeplay(page);
  await page.evaluate(() => (window as any).__openrescue.scene.setViewMode('3d'));
  await page.waitForFunction(() => !!(window as any).__openrescue.scene.renderer3d);
  await expect(page.locator('canvas').nth(1)).toBeVisible(); // the three.js canvas, on top of the hidden Phaser one

  const info = await page.evaluate(() => {
    const or = (window as any).__openrescue;
    const w = or.world;
    const inc = w.spawnIncident('house_fire', { severity: 1 });
    w.questionCaller(inc.id); // software GL runs the game slowly: do not wait for the caller to tell it all by themselves
    for (const id of inc.victims) w.victims.delete(id);
    inc.victims = [];
    const b = w.buildings.get(inc.buildingId);
    or.scene.centerOn(b.x + b.w / 2, b.y + b.h / 2);
    or.scene.zoomBy(0.6);
    const engine = [...w.vehicles.values()].find((v: any) => v.defId === 'fire_engine');
    return { incId: inc.id, bx: b.x + b.w / 2, by: b.y + b.h / 2, bid: b.id, vid: engine.id };
  });
  await page.waitForTimeout(400); // let the 3D camera render a few frames (matrixWorld) before reading screen coordinates

  await expect(page.locator('#incident-list')).toContainText('Woningbrand', { timeout: 25_000 }); // the caller first only gives confused words and tells what it is after a few seconds
  await page.locator(`[data-vid="${info.vid}"]`).click();
  await expect(page.locator('#unit-panel')).toContainText('Tankautospuit');
  await page.locator('[data-act="speed4"]').click();

  // Right-click the burning building in the 3D view: ray-picked through the three.js camera to the ground plane.
  const target = await screenOf(page, info.bx, info.by);
  await page.mouse.click(target.x, target.y, { button: 'right' });
  await page.waitForFunction(id => (window as any).__openrescue.world.vehicles.get(id).path.length > 0, info.vid);
  await page.waitForFunction(id => (window as any).__openrescue.world.vehicles.get(id).path.length === 0, info.vid, { timeout: 150_000 });

  await page.getByRole('button', { name: /Uitstappen/ }).click();
  await page.waitForFunction(id => (window as any).__openrescue.world.vehicles.get(id).crew.every((r: number) => !(window as any).__openrescue.world.responders.get(r).inVehicle), info.vid);
  await page.locator('[data-ability="extinguish"]').click();
  await page.waitForFunction(() => [...(window as any).__openrescue.world.responders.values()].some((r: any) => r.task?.type === 'extinguish'));

  await page.waitForFunction(id => !(window as any).__openrescue.world.incidents.has(id), info.incId, { timeout: 90_000 });
  const res = await page.evaluate(id => (window as any).__openrescue.world.buildings.get(id).fire, info.bid);
  expect(res).toBe(0);
  await page.screenshot({ path: 'test-results/scenario-3d-resolved.png' });

  // switching back to 2D hides the three.js canvas and shows the Phaser one again
  await page.evaluate(() => (window as any).__openrescue.scene.setViewMode('2d'));
  await expect(page.locator('canvas').first()).toBeVisible();
});

test('missions menu: start a mission and see its first incident', async ({ page }) => {
  await gotoHealthy(page);
  await page.getByRole('button', { name: /Missies/ }).click();
  await expect(page.locator('#screen')).toContainText('Eerste dienst');
  await page.locator('[data-mission="first_shift"]').click();
  await expect(page.locator('#screen')).toContainText('Briefing');
  await expect(page.locator('#screen')).toContainText('Woningbrand');
  await page.getByRole('button', { name: /Start missie/ }).click();
  await page.locator('[data-act="speed4"]').click();
  await expect(page.locator('#incident-list .inc').first()).toContainText('Woningbrand', { timeout: 20_000 });
  expect(await page.evaluate(() => (window as any).__openrescue.world.mission?.id)).toBe('first_shift');
});
