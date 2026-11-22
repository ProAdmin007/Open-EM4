# Modding

Vehicles, personnel roles, incidents and maps are plain JSON. The built-in content lives in `src/data/*.json` and is validated at start-up with the
same validators used for mods (`src/sim/content.ts`). Errors are reported in Dutch with the exact path, e.g.
`mymod.json.vehicles[2].crew: bemanning (7) is groter dan capacity (6)`.

## Loading a mod

*Settings → Mods → choose a `.json` file.* Valid items are merged into the game (items with the same `id` override built-in ones) and remembered in the
browser. Invalid items are skipped and listed on screen. Reload the page after loading so new vehicle sprites are generated.

A mod file is one object; every key is optional:

```json
{
  "roles":     [ ... ],
  "vehicles":  [ ... ],
  "incidents": [ ... ],
  "maps":      [ ... ]
}
```

## Vehicle

```json
{
  "id": "fire_engine",
  "name": "Tankautospuit",
  "category": "fire",            // fire | ambulance | police | tech
  "maxSpeed": 65,                // km/h, 12 km/h = 1 tile/s
  "capacity": 6,
  "length": 1.9,                 // in tiles; also controls the generated sprite
  "color": "#d32f2f",
  "equipment": ["fire_hose", "breathing_apparatus"],
  "crew": [{ "role": "fire_officer", "count": 1 }, { "role": "firefighter", "count": 4 }],
  "patientCapacity": 0,          // >0 lets crew with "carry" load patients
  "cost": 900,                   // optional: price in budget to call as reinforcement (default 500)
  "firePowerBonus": 1.4,         // optional multiplier for extinguishing
  "clearPowerBonus": 2           // optional multiplier for clearing obstacles
}
```

Abilities require equipment on the responder's vehicle (any one of the listed items):

| Ability | Needs |
| --- | --- |
| `extinguish` | `fire_hose` |
| `rescue` | `breathing_apparatus` or `rescue_tools` |
| `treat` | `medical_kit` |
| `carry` | `stretcher` (and `patientCapacity > 0`) |
| `arrest` | `handcuffs` |
| `secure` | `barrier_tape` |
| `clear` | `tow_gear` or `rescue_tools` |

To make a vehicle appear in the game it must be listed in a station's `fleet` (see Map).

## Role (personnel)

```json
{ "id": "firefighter", "name": "Brandweerman", "category": "fire", "abilities": ["extinguish", "rescue"], "speed": 2.6, "color": "#ffb300", "power": 9 }
```

`abilities`: `extinguish, rescue, treat, carry, arrest, secure, disperse, clear, coordinate` (`coordinate`: while dismounted and within 10 tiles, other responders extinguish 25% faster). `speed` is tiles/second on foot. `power` scales extinguishing; for `treat` a value ≥ 2 doubles treatment speed.

## Incident

```json
{
  "id": "house_fire", "name": "Woningbrand", "category": "fire", "weight": 4, "icon": "🔥",
  "spawn": { "on": "building", "buildingTypes": ["residential", "apartment"] },   // or { "on": "road" }
  "severity": { "min": 1, "max": 3 },
  "requires": ["fire", "ambulance"],                       // informative: which services are expected
  "fire":     { "start": 22, "growth": 0.7, "spread": 1.0 },
  "victims":  { "min": 0, "max": 1, "location": "trapped", "health": [45, 85], "decay": 0.25 },
  "suspects": { "min": 1, "max": 2 },
  "bystanders": { "min": 2, "max": 4 },
  "obstacle": { "tiles": 1 },                              // 1 = wreck in one lane, 2 = full road block
  "objectives": ["fire_out", "victims_safe"],
  "escalation": { "everySec": 70 },
  "failAfterSec": 300,
  "reward": { "score": 250, "budget": 600 }
}
```

An incident only closes when **all** `objectives` hold:

| Objective | Requires block | True when |
| --- | --- | --- |
| `fire_out` | `fire` | the building's fire is at 0 and the building is not destroyed |
| `victims_safe` | `victims` | every victim is delivered to a hospital (or dead) |
| `suspects_arrested` | `suspects` | every suspect is arrested |
| `area_secured` | – | a police officer has finished *secure* |
| `obstacle_cleared` | `obstacle` | a technician has cleared the obstacle |
| `bystanders_dispersed` | `bystanders` | police have sent every bystander away (ability `disperse`) |

Every `escalation.everySec` seconds (scaled by difficulty) the severity rises (max 3): fire intensity jumps, victims decay faster, extra suspects appear.
At `failAfterSec` (or when a burning building is destroyed) the incident fails and costs reputation.

## Map

```json
{
  "id": "my_city", "name": "My city", "width": 64, "height": 48,
  "rows": ["RRRR...", "..."],          // height strings of width chars: R road, . grass, T tree, B building footprint
  "buildings": [{ "id": "b1", "type": "residential", "x": 3, "y": 3, "w": 3, "h": 3, "height": 14 }],
  "stations": [{ "id": "fire_station", "category": "fire", "buildingId": "b2", "fleet": ["fire_engine", "fire_engine"], "bays": [{ "x": 12, "y": 14 }, { "x": 13, "y": 14 }] }]
}
```

Map characters: `R` road, `.` grass, `T` tree, `B` building, `P` station parking lot. Roads must be 2 tiles wide: lanes are derived automatically (right-hand traffic) and intersections are detected where roads cross.
A station may define `bays` (tile coordinates on `P` tiles) where its vehicles park; vehicles drive straight in and out of a bay. The default map has one lot per station (8 bays) generated by `tools/genmap.mjs`.

Building `type`: `residential, apartment, commercial, industrial, station, hospital`. At least one `hospital` is required. Every `B` tile should belong to a
building rectangle. `tools/genmap.mjs` shows how the default city is generated. Roads should be 2 tiles wide so cars can pass obstacles; intersections
are detected automatically.

Maps added by a mod are validated and appear in the *Freeplay* map selector ("Nieuw spel" always uses `default_city`).

## Mission

```json
{
  "id": "rush_hour", "name": "Spitsuur", "description": "…", "level": 1, "allowedFailures": 1,
  "script": [{ "at": 3, "def": "car_accident", "severity": 1 }, { "at": 25, "def": "road_blockage" }]
}
```

`at` is in game seconds. The mission is won when every scripted incident has been resolved and no incident is active; it fails when more than `allowedFailures` incidents are lost.

## Example pack

`mods/la-style-pack.json` (own content, inspired by the multi-role crews and big incidents of the Emergency 4 Los Angeles mod): a firefighter-paramedic role, a *squad* and *heavy rescue* vehicle, a patrol SUV, a multi-victim *Kettingbotsing* (pile-up) incident and a mission. Load it via *Instellingen → Mods*; its vehicles appear in the reinforcement list.

## More incident fields (variety and severity)

```json
{
  "descriptions": ["Man (62) is ineengezakt en reageert niet meer.", "…"],   // one is picked per incident
  "fire":     { "start": 28, "growth": 0.9, "spread": 1.2, "resistance": 1.2 },     // resistance divides extinguishing power
  "victims":  { "min": 1, "max": 1, "location": "scene", "health": [12, 32], "decay": 0.55, "treatTime": 9, "condition": "Hartstilstand" },
  "suspects": { "min": 1, "max": 2, "arrestTime": 8 },
  "obstacle": { "tiles": 2, "mass": 1.8 }                                          // heavier wrecks take longer to clear
}
```

All durations scale with the incident's current severity (1-3): treatment ×(1 + 0.3·(severity − 1)), arrests ×(1 + 0.4·…), securing ×(1 + 0.25·…), clearing ×(1 + 0.3·…)/`mass`,
dispersing ×(1 + 0.2·…) and fire resistance ×(1 + 0.12·…). When an incident escalates, untreated victims and free suspects take 15% longer.

Building types: `residential, apartment, office, commercial, shopping, school, church, warehouse, industrial, station, hospital`. Buildings may carry `floors` and `roof` (`gable`/`hip`/`flat`) for a future 3D view; vehicles and roles may carry a `model` id.
Map character `W` is water (not walkable or drivable).


## Fire-fighting and bomb-disposal fields (added later)

- Vehicle `tank` (litres): fire vehicles use `6 L/s` per working nozzle, refill at hydrants (`HYDRANT_REFILL`) and stop spraying when empty. A vehicle parked within 4.5 tiles of a hydrant hooks up and has unlimited water.
- Buildings with `floors >= 4` need an `aerial_ladder` crew on the fire for full effect (otherwise 40%).
- Ability `defuse` needs the vehicle equipment `bomb_robot`; incident objective `device_defused` with an optional `defuseTime` (seconds, scaled by severity). See the `suspicious_package` incident and the `bomb_squad` vehicle / `bomb_tech` role in `src/data`.

- An incident with the objective `device_defused` that runs out of time explodes: the building takes damage, a fire incident starts and the bystanders still standing around become casualties. A secured incident closes the road tiles within `CORDON_RADIUS` (3.2) to civilian cars.

- Ability `cool` (needs `fire_hose`): the crew wets a building that is not burning. `wet` (0..100) slows fire growth and, above all, spread to that building; it dries at `WET_DECAY` per second. Vehicle flag `canPatrol: true` lets a vehicle drive the three built-in patrol routes (outer ring, inner ring, snake through the middle rows) without sirens; the nearest patrolling vehicle of a service that an incident `requires` rushes out by itself.
