# Architecture

```
src/
  sim/            pure TypeScript, no Phaser/DOM -> deterministic, headless-testable, server-ready
    rng.ts          seeded mulberry32 (state is serialisable)
    pathfinding.ts  binary-heap A* (4/8 directions, goal tile or predicate)
    types.ts        data definitions (JSON shapes) + runtime entities
    content.ts      validators + mod merging (Dutch error messages)
    world.ts        World: terrain, entities, fixed-step tick, orders, fire, victims,
                    incidents, civilian traffic, save/load
  data/           JSON content: roles, vehicles, incidents, default map
  game/           Phaser layer (rendering only)
    assets.ts       SVG art generation + rasterisation
    scene.ts        GameScene: camera, input/selection, sprite sync + interpolation,
                    effects (pooled particles), static city rendering
  ui/ui.ts        DOM HUD (Dutch): top bar, incidents, unit panel, dispatch bar, minimap, menus
  storage.ts      localStorage: settings, savegame, mods
  main.ts         bootstrap
tests/unit        Vitest (pathfinding, incidents, fire, units, save/validation)
tests/e2e         Playwright (real browser gameplay)
tools/            genmap.mjs (map generator), bench.ts (headless benchmark), screens.mjs
```

## Layers

1. **Rendering and animation** – `game/scene.ts`. Never mutates simulation state. Sprites are created/destroyed by diffing against `World` maps; positions are interpolated between the previous and current fixed tick (`px/py` → `x/y`).
2. **World and entities** – `sim/world.ts`: `Vehicle`, `Responder`, `Victim`, `Suspect`, `Building`, `Incident`, civilian cars and pedestrians.
3. **Simulation systems** – inside `World.tick`: vehicle movement and rerouting, responder tasks, fire, victim health, incident lifecycle, hospital hand-over, traffic.
4. **Incidents and missions** – generic, data-driven (`IncidentDef`): objectives, escalation, failure, rewards. Freeplay generator with difficulty tables and a seeded RNG; "Nieuw spel" adds a short scripted opening.
5. **AI and pathfinding** – A* for vehicles (roads only, obstacles block, routes recomputed when `roadVersion` changes), A* with diagonals for people (never through buildings). Civilians stop for red lights and yield to emergency vehicles with lights on.
6. **UI** – plain DOM, throttled to 4 Hz with string-diffing (`setHtml`) so unchanged panels cause no DOM work. Buttons use `pointerdown` so a re-render can't swallow a click.
7. **Data, assets, modding** – JSON validated at load; mods merge over built-ins (`docs/modding.md`).
8. **Storage and state** – `World.serialize()` / `World.fromSave()` produce JSON; settings, save and mods live in `localStorage` with try/catch (private mode safe). Civilians/pedestrians are cosmetic and regenerated on load.

## Fixed time step

`SIM_DT = 1/30 s`. `GameScene.update` accumulates `frameTime × speed` and runs `World.tick(SIM_DT)` while the accumulator allows (max 12 steps per frame to avoid a spiral of death). Pause simply sets speed 0, so no simulation state is touched while paused; rendering continues (camera, selection, UI).

## Player orders (the only way the UI changes the world)

`orderMove`, `orderDismount`, `orderBoard`, `orderStop`, `orderAbility(ids, ability, target?)`, `contextOrder(ids, x, y)` (right-click). Each order is validated (crew outside vehicle, role abilities, vehicle equipment, patient capacity) and emits warnings as game events.

## Towards multiplayer

Because `World` has no rendering dependencies and all mutations are orders + `tick`, an authoritative server can own a `World`, receive orders as messages, run the same fixed ticks and broadcast snapshots (`serialize()` is a starting point; a delta format would be needed). Entities use numeric ids and the RNG is seeded/serialisable, so clients can run predictive replicas. This is not implemented yet.

## Rules in a nutshell

- Fire: each building has intensity 0–100, grows per incident definition and severity, accumulates damage (destroyed at 100) and can ignite buildings within 2.5 tiles (creating a linked incident). Firefighters need to dismount, roll out the hose (2.5 s, hose length 16 tiles from their vehicle) and then reduce intensity at `power × bonus × 0.12 /s`.
- Victims: health decays at the incident's rate (faster in burning buildings), nearly stops once treated, stops in the ambulance. Death costs score and counts for the incident.
- Ambulance chain: rescue (fire, if trapped) → treat → carry to ambulance → drive to hospital (hand-over happens within 3.5 tiles of a hospital).
- Police: arrest (4 s next to the suspect), secure an accident area (5 s).
- Tech: clear wrecks/blockades (8 s, faster with a crane); traffic is rerouted while a road is blocked.
