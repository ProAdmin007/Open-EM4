# Design principles and gap analysis

## Principles distilled from the games

1. **One cursor, one verb.** Right-click on the thing does the obvious job. Extra buttons are shortcuts, never the only way.
2. **The player commands, the crew acts.** Sending a vehicle is not solving the incident; hands-on steps (dismount, hose, stabilise, load) are the game.
3. **Scarcity creates decisions.** Few units, many calls, slow transport. Never let the player win by spamming.
4. **Time pressure is visible.** Every call has a meter; casualties and fires get worse in front of the player.
5. **Information is a resource** (dispatcher games). Reconnaissance, caller questions and the control room's recommendations decide how well the player prepares.
6. **Realism is flavour plus consequence:** sirens mean urgency, prio 2 obeys traffic, units that return are quiet, fire spreads, bodies are collected by the undertaker.
7. **Everything must be solvable.** Each incident type has a path to success within its time limit with sensible play (checked by `tools/feasibility.ts`).
8. **Readable at a glance.** Colour by service, labels on selection, a status line per vehicle.

## Gap analysis (what other games have that we do not, yet)

| Gap | Source | Roadmap item |
|---|---|---|
| Call queue with questions before dispatch | 911/112 Operator | R2 |
| Prank calls and ignoring low-risk calls | 911/112 Operator | R1 (done) |
| Phone first-aid instructions that slow casualty decay | 911/112 Operator | R1 (done) |
| After-duty report | 112 Operator | R3 |
| Districts with different incident mixes | 112 Operator | R4 |
| Weather-driven incidents (storm, ice) | 112 Operator | R5 |
| Hospital capacity | 911 Operator | R6 |
| Helicopters (air ambulance, winch) | Emergency 4 | R7 |
| Ballistic shields, SWAT entry | LA mod | R8 |
| Flood lights / scene lighting vehicle | LA mod | R9 |
| Mission briefing and interludes | Emergency 4 | R10 |
| Co-op multiplayer | Emergency 4 | R11 |
