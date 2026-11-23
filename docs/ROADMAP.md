# Roadmap

Derived from the [knowledge base](knowledge/README.md). Status: ✅ done · 🟡 partly · ⬜ open. "Next" items are the best candidates for the following iteration.

## Done in earlier iterations (for context)

✅ 3D view as the primary view · ✅ 50+ P2000-style incident types · ✅ GRIP 1-4 with associated units and scale-down · ✅ prio 1/2 dispatch · ✅ recommended units + dispatch button · ✅ realistic traffic (priority rules, few lights, car following) · ✅ fire spread incl. across streets and by wind · ✅ medical flow (treat, load, hospital, return) · ✅ undertaker · ✅ tow truck · ✅ arrests with fleeing suspects, pistol, transport · ✅ responders with role-specific outfits · ✅ weather (clouds, rain) · ✅ sound mix, heartbeat, dispatch voice

## Iteration "dispatcher ideas" (this one)

| # | Item | Source | Status |
|---|---|---|---|
| R1 | Prank / false-alarm calls that end by themselves; checking one costs money | 911/112 Operator | ✅ |
| R1b | Phone first-aid instructions that slow casualty decay | 911/112 Operator | ✅ |
| R3 | Duty report on the end screen (average response time, deaths, false alarms) | 112 Operator | ✅ |
| R12 | Feasibility bot: every incident type solvable within its time limit (`tools/feasibility.ts`) | own | ✅ (see results in `docs/feasibility.md`) |
| R13 | Close-up review of every incident type in 3D (`tools/screens3d-incidents.mjs`): fixed oversized smokestacks, added scene props (flood water, oil slick, gas cloud, rubble, waving callers at the door, tape at crime scenes, alarm beacons) | own | ✅ |
| R5a | Weather-driven incidents: chain collisions on slippery roads and storm debris, 4x as likely in the rain | 112 Operator | ✅ (storms and flooding still open) |
| R6 | Hospital capacity: 4 beds per hospital for 150 s per patient; ambulances prefer a hospital with a free bed and wait when all are full | 911 Operator | ✅ (specialisation still open) |
| V1 | Visual realism: filmic tone mapping, soft shadows, headlight pools and flashing emergency glow on the road at night, wet darker roads in rain, brighter night ambience (`tools/screens3d-night.mjs`) | own | ✅ |

## Next

| # | Item | Source | Notes |
|---|---|---|---|
| R2 | Call queue: calls ring, ask 2-3 questions (what / where / how many hurt), recommended units depend on the answers | 911/112 Operator | extends `recommendedUnits`; needs a small call UI |
| R4 | Districts with different incident mixes (industrial, residential, centre) | 112 Operator | weights per area in the map; map generator already knows building types |
| R5 | Storms with wind damage across the map, flooding that grows, day/night mixes | 112 Operator | builds on R5a |
| R8 | Ballistic shields / entry team for armed incidents | LA mod | extra police roles and abilities |
| R9 | Scene lighting vehicle (flood lights) for night operations | LA mod | night visibility effect + vehicle model |

## Later

| # | Item | Source |
|---|---|---|
| R7 | Helicopters: air ambulance, winch rescue | Emergency 4 |
| R10 | Mission briefing screen and interludes before large operations | Emergency 4 |
| R14 | Career mode with ranks and unlocks | 112 Operator |
| R15 | Voice commands | Emergency 4 Deluxe |
| R11 | Co-op multiplayer | Emergency 4 |
| R16 | Modding: share content packs by URL | own |

## How the roadmap is maintained

* New ideas go into the knowledge base first (with source), then into this file with an id.
* An item moves to "Done" together with a test or a tool run that proves it.
* `docs/feasibility.md` is regenerated with `npx vite-node tools/feasibility.ts`.
