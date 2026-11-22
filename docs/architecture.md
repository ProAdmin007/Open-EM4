# Architecture

```
src/
  sim/            pure TypeScript, no Phaser/DOM -> deterministic, headless-testable, server-ready
    rng.ts          seeded mulberry32 (state is serialisable)
    pathfinding.ts  binary-heap A* (4/8 directions, goal tile or predicate)
    space.ts        units and coordinate conventions (tile <-> metres), real-world sizes, model ids
    snapshot.ts     renderer-agnostic, interpolated per-frame view of the world (for 3D / replays)
    types.ts        data definitions (JSON shapes) + runtime entities
    content.ts      validators + mod merging (Dutch error messages)
    world.ts        World: terrain, entities, fixed-step tick, orders, fire, victims,
                    incidents, civilian traffic, save/load
  data/           JSON content: roles, vehicles, incidents, default map
  game/           rendering (2D Phaser + experimental 3D three.js)
    assets.ts       SVG art generation + rasterisation
    audio.ts        AudioEngine: procedural Web Audio (sirens, fire, water, traffic, SFX)
    scene.ts        GameScene: camera, input/selection, sprite sync + interpolation,
                    effects (pooled particles), static city rendering; also drives the
                    world tick regardless of which renderer is on screen
    selection.ts    Commands/pickVehicle/pickUnit: selection and order logic shared by
                    the 2D and 3D input handlers (docs/3d.md)
    three-renderer.ts Three3DRenderer: the experimental 3D view (lazy-loaded), implements
                    the GameRenderer contract (docs/3d.md)
    renderer.ts     GameRenderer: the interface a renderer must implement
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

## Audio

`src/game/audio.ts` synthesises everything with the Web Audio API (oscillators and filtered noise), so no sound files exist. The `AudioContext` is created on the first pointer/key event (autoplay policy).
Each frame the scene calls `audio.update(world, cameraCentre, playing, paused)`: it computes the loudest moving emergency vehicle per service (distance attenuation + stereo pan), total fire intensity near the camera and active water spray, and sets the gain of persistent voices (4 sirens with service-specific patterns, fire crackle, spray, traffic hum). Nothing is allocated per frame. One-shot effects are triggered from game events (`incident_*`, `info`, `warn`) and from UI actions (orders, dismount, clicks). Volume and mute live in `Settings` (localStorage) and `audio.debug()` exposes levels for tests.

## Reinforcements, bystanders, highscores

- `World.callReinforcement(defId)` spends budget (`cost` in the vehicle definition) to create a crewed vehicle on a free road tile near the matching station (max 8 per service). The UI shows it under the dispatch tabs.
- `Bystander` entities are spawned by incidents with a `bystanders` block. A police `disperse` task (3 s on scene) makes them walk away and be removed; the `bystanders_dispersed` objective is only true when none are left.
- Highscores (`storage.ts`, localStorage) keep the best 8 results and are written when a game ends (game over or "Spel beëindigen").

## Traffic, parking and collisions

- **Parking:** station maps contain `P` tiles with parking bays. Vehicles are created in their bay facing the exit (`angle = -π/2`); `home` is the bay tile. Inside a lot only straight (north-south) moves are allowed, so a lot is a set of single-file columns.
- **Lanes:** every non-intersection road tile has a lane direction (`World.lane`, derived from the map): the road is two tiles wide, one lane per direction. `laneEdgeOk` is passed to A* as an edge filter, so routes obey the lane direction; entering/leaving lots is allowed perpendicular. Civilians use `isCivDrivable` (no lots).
- **No overlap:** moving vehicles and cars call `findBlocker` before each step. It uses oriented rectangles (separating-axis test): the vehicle's own footprint may never overlap anything (near box), and a short look-ahead box keeps following distance and makes lower-priority crossing traffic wait (emergency > civilian > lower id). Halted things are obstacles. Persons (crew on foot, victims, suspects, bystanders) are blocking too.
- **Gate:** at the lot exit a vehicle only pulls out when the merge window on the road is free; vehicles leaving next to each other go in id order, so nobody stops with a nose in the lane.
- **Deadlocks:** a halted civilian car that blocks an emergency vehicle is moved to a quiet road tile (`respawnCivilian`); a vehicle blocked by a parked vehicle re-routes around it; after 12 s a stuck vehicle stops and warns instead of driving through anything. The `tests/unit/traffic.test.ts` stress test (hard freeplay, 15 vehicles + 26 cars, 150 s) asserts zero overlaps.
- **People:** `vehicleBlockedTiles` marks tiles under/next to vehicle footprints; walking responders route around them. `exitPositions` places crew beside the vehicle when they dismount.
- **Hospital / station orders:** `orderToHospital`, `orderReturn` (crew boards first, then the vehicle drives).
- **Missions:** `MissionDef` scripts incidents at given times; `World.won` / `mission_complete` end the game in success.

## City, incidents and severity

- `tools/genmap.mjs` generates the 102×72 city from 10×7 blocks: downtown, mid ring, outskirts, an industrial east, stations with parking lots, two hospitals, a mall, a school campus and parks with ponds. It refuses to place buildings on roads or lots.
- Incident definitions are pure data (26 built in). Per-incident flavour (`descriptions`), per-kind treatment/arrest/clear parameters (`treatTime`, `arrestTime`, `mass`, `resistance`) and the shared `sevFactor` make the time needed depend on both kind and severity.
- With several stations per service, reinforcements go to the first station that still has a free bay; routes and hospital deliveries use the nearest hospital.
- 3D preparation is described in [3d.md](3d.md).
