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
| R2 | Call questions: a new call only has a preliminary unit list (one unit per service); "❓ Melder ondervragen" reveals the real number of casualties and updates the recommended units (a full call queue UI is still open) | 911/112 Operator | ✅ (light) |
| R9 | Light unit (Lichtmastwagen) at fire station 2: at night treating casualties is 30% slower unless a parked light unit is within 10 tiles; floodlight pool in 3D; recommended automatically at night for severity 2+ | LA mod | ✅ |
| R4 | Busy district rotates every 6 minutes (60% of building calls come from it); night brings crime, noise and alarms, day brings traffic and shops | 112 Operator | ✅ (light: quadrants, not named districts) |
| R5 | Heavy storms (the peak of a shower): Code oranje warning, calls 40% faster, storm damage 2.5x | 112 Operator | ✅ (growing floods: see R5b) |
| R5b | Floods grow by a tile on every escalation (max 5) | 112 Operator | ✅ |
| R8 | Armed suspects: arrests are 40% slower without a riot (ME) van within 14 tiles; the van is recommended for armed robbery / knife threat (full ballistic shield animation still open) | LA mod | ✅ (light) |
| R7 | Trauma helicopter (air ambulance) at the Centrum hospital: flies in a straight line at 220 km/h over traffic, lands on open ground next to the scene, takes one patient to the nearest hospital with a free bed; recommended for 3+ casualties from severity 2; 3D model with spinning rotors, climbs and descends (winch rescue still open) | Emergency 4 | ✅ (light) |
| T1 | Soak/fuzz test (`tools/soak.ts`: 24 runs x 12 min with random orders, invariants every 5 s, save/load round trip) and browser smoke test (`tools/smoke-browser.mjs`) | own | ✅ |

## Next

| # | Item | Source | Notes |
|---|---|---|---|

## Later

| # | Item | Source |
|---|---|---|
| R7b | Helicopter winch rescue, police helicopter | Emergency 4 |
| R10 | Mission briefing screen and interludes before large operations | Emergency 4 |
| R14 | Career mode with ranks and unlocks | 112 Operator |
| R15 | Voice commands | Emergency 4 Deluxe |
| R11 | Co-op multiplayer | Emergency 4 |
| R16 | Modding: share content packs by URL | own |

## How the roadmap is maintained

* New ideas go into the knowledge base first (with source), then into this file with an id.
* An item moves to "Done" together with a test or a tool run that proves it.
* `docs/feasibility.md` is regenerated with `npx vite-node tools/feasibility.ts`.
