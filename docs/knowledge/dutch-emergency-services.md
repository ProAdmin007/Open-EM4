# Dutch emergency services: what we model **(general knowledge)**

| Term | Meaning | In the game |
|---|---|---|
| **112** | National emergency number | calls in the HUD |
| **P2000** | Pager network that alerts crews | pager line per call, e.g. `A1 Rendam Havenstraat 31 Hartstilstand AMB` |
| **A1 / A2 / B** | Ambulance priority: A1 = life threatening, lights and siren; A2 = urgent, lights and siren with care; B = planned, no lights | incident severity maps to A1/A2; Prio 1/Prio 2 for fire, police, tech |
| **Prio 1 / Prio 2** | Police/fire urgency: 1 = immediate with lights and siren, 2 = without hurry | vehicle prio toggle: prio 1 siren + beacons + fast, prio 2 beacons only + normal traffic rules |
| **TS / HW / HV / OvD-B** | Fire: tankautospuit (engine), hulpverleningsvoertuig (rescue), hoogwerker (aerial ladder), Officer van Dienst Brandweer | vehicle names and pager codes |
| **AMB / MMT / LGH / OvD-G** | Ambulance, Mobile Medical Team (trauma doctor + nurse), Leider Geneeskundige Hulpverlening, Officer van Dienst Geneeskundig | rapid responder, LGH car |
| **ME** | Mobiele Eenheid, riot police | riot van, demonstration/riot content |
| **EOD** | Explosive Ordnance Disposal | bomb squad with robot |
| **OGS / HAZMAT** | Gevaarlijke stoffen unit | hazmat unit |
| **GRIP 1-4** | Gecoördineerde Regionale Incidentbestrijdings Procedure | `GRIP 1` CoPI, `GRIP 2` + ROT, `GRIP 3` municipal policy team, `GRIP 4` regional; scale up sends associated units, scale down releases idle ones |
| **CoPI** | Commando Plaats Incident, the on-scene command team | command vehicle, extends command range |
| **Bevelvoerder** | Crew commander | fire officer bonus |
| **Berging** | Recovery (tow) | tow truck carries the wreck |
| **Uitvaartonderneming** | Undertaker, collects the deceased after the police release the scene | hearse flow |

## Traffic law for emergency vehicles

* Vehicles with blue lights and siren may deviate from rules (red light, speed) when urgent, with due care; other traffic must give way.
* Without siren (prio 2) they obey normal rules; return trips are silent.
* In the game: prio 2 stops for red, siren vehicles pull out around slow cars, an idle vehicle in the way makes room.

## Real-world scene practice

* Park so the road stays passable, block the scene with a vehicle ("afzetten") and divert traffic.
* Treat first, then transport; hospital chosen by severity.
* Police secure and investigate; the undertaker waits for release.
