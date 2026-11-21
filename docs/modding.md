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

`abilities`: `extinguish, rescue, treat, carry, arrest, secure, clear, coordinate` (`coordinate`: while dismounted and within 10 tiles, other responders extinguish 25% faster). `speed` is tiles/second on foot. `power` scales extinguishing; for `treat` a value ≥ 2 doubles treatment speed.

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

Every `escalation.everySec` seconds (scaled by difficulty) the severity rises (max 3): fire intensity jumps, victims decay faster, extra suspects appear.
At `failAfterSec` (or when a burning building is destroyed) the incident fails and costs reputation.

## Map

```json
{
  "id": "my_city", "name": "My city", "width": 64, "height": 48,
  "rows": ["RRRR...", "..."],          // height strings of width chars: R road, . grass, T tree, B building footprint
  "buildings": [{ "id": "b1", "type": "residential", "x": 3, "y": 3, "w": 3, "h": 3, "height": 14 }],
  "stations": [{ "id": "fire_station", "category": "fire", "buildingId": "b2", "fleet": ["fire_engine", "fire_engine"] }]
}
```

Building `type`: `residential, apartment, commercial, industrial, station, hospital`. At least one `hospital` is required. Every `B` tile should belong to a
building rectangle. `tools/genmap.mjs` shows how the default city is generated. Roads should be 2 tiles wide so cars can pass obstacles; intersections
are detected automatically.

Maps added by a mod are validated and appear in the *Freeplay* map selector ("Nieuw spel" always uses `default_city`).
