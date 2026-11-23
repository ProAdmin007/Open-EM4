# Feasibility check

`tools/feasibility.ts` lets a simple automatic player (`tools/bot.ts`) handle every incident type on its own: it sends the recommended units, gets the crews out, orders abilities, sends full ambulances to the hospital and police cars to the station. The table shows how long it took against the incident's time limit (normal difficulty, seed 3, civilian traffic on, highest severity of each type).

Run it yourself: `npx vite-node tools/feasibility.ts [seed] [incidentId...]` (the full run takes a good while).

## Result

**55 of 56 incident types are solvable well within their limit.**

* `prank_call` is *meant* to be ignored: it ends by itself at 70 s (the table shows it as "too slow" because nobody has to solve it).
* `building_collapse` is **not solved by the bot** (five casualties under rubble). In the last runs an ambulance stayed stuck in the scene traffic for several minutes, so this is a known open issue (scene congestion); raising the limit to 640 s did not help.

What this check found and fixed:

* Big incidents recommended too few ambulances (an ambulance takes one patient). Recommendations now scale with the number of casualties.
* The undertaker's hearse could not take a second body and could stand still for ever; bodies now stay until collected, the hearse takes up to four, and the deceased count as safe once the hearse is on the way.
* Ambulances stopped too far from the hospital to hand over; the hand-over distance was widened and parking spots are chosen more carefully.
* A U-turn into a spot that another vehicle occupies is no longer planned.

| incident | severity | limit (s) | solved (s) | units sent | verdict |
|---|---|---|---|---|---|
| house_fire | 3 | 300 | 79 | 4 | ok |
| kitchen_fire | 2 | 240 | 29 | 2 | ok |
| apartment_fire | 3 | 330 | 61 | 5 | ok |
| office_fire | 3 | 310 | 69 | 5 | ok |
| industrial_fire | 3 | 330 | 45 | 3 | ok |
| warehouse_fire | 3 | 340 | 22 | 2 | ok |
| medical_emergency | 2 | 260 | 45 | 1 | ok |
| cardiac_arrest | 3 | 200 | 16 | 1 | ok |
| fall_injury | 2 | 320 | 43 | 1 | ok |
| choking | 3 | 180 | 21 | 1 | ok |
| childbirth | 2 | 360 | 72 | 1 | ok |
| allergic_reaction | 3 | 220 | 45 | 1 | ok |
| stroke | 3 | 260 | 27 | 1 | ok |
| car_accident | 3 | 330 | 43 | 3 | ok |
| motorcycle_accident | 3 | 250 | 24 | 2 | ok |
| pedestrian_hit | 3 | 260 | 28 | 2 | ok |
| truck_collision | 3 | 360 | 59 | 9 | ok |
| crime | 2 | 240 | 29 | 1 | ok |
| burglary | 2 | 230 | 32 | 1 | ok |
| fight | 3 | 230 | 56 | 3 | ok |
| armed_robbery | 3 | 260 | 43 | 1 | ok |
| vandalism | 1 | 200 | 48 | 1 | ok |
| road_blockage | 2 | 260 | 40 | 1 | ok |
| fallen_tree | 2 | 240 | 37 | 1 | ok |
| broken_down_truck | 2 | 280 | 44 | 2 | ok |
| suspicious_package | 3 | 260 | 44 | 2 | ok |
| chimney_fire | 2 | 260 | 28 | 1 | ok |
| container_fire | 2 | 240 | 14 | 1 | ok |
| automatic_alarm | 1 | 240 | 28 | 1 | ok |
| smoke_detector | 2 | 260 | 35 | 3 | ok |
| gas_leak | 3 | 260 | 29 | 2 | ok |
| elevator_rescue | 2 | 300 | 59 | 2 | ok |
| hazmat_leak | 3 | 340 | 53 | 5 | ok |
| high_rise_fire | 3 | 420 | 91 | 12 | ok |
| industrial_explosion | 3 | 560 | 66 | 12 | ok |
| building_collapse | 3 | 480 | - | 13 | NOT SOLVED |
| breathing_problem | 3 | 220 | 57 | 1 | ok |
| seizure | 2 | 240 | 50 | 1 | ok |
| diabetic_shock | 2 | 260 | 68 | 1 | ok |
| overdose | 3 | 220 | 41 | 2 | ok |
| burn_injury | 3 | 230 | 33 | 1 | ok |
| stroke_a1 | 3 | 230 | 57 | 1 | ok |
| bus_crash | 3 | 520 | 107 | 15 | ok (re-run after a bot fix) |
| domestic_violence | 3 | 230 | 47 | 2 | ok |
| knife_threat | 3 | 210 | 31 | 2 | ok |
| shoplifting | 1 | 200 | 20 | 1 | ok |
| noise_nuisance | 2 | 240 | 8 | 1 | ok |
| car_break_in | 2 | 210 | 30 | 1 | ok |
| riot | 3 | 380 | 58 | 3 | ok |
| flooding | 2 | 260 | 43 | 1 | ok |
| animal_on_road | 1 | 240 | 83 | 2 | ok |
| oil_spill | 2 | 260 | 46 | 2 | ok |
| demonstration | 2 | 320 | 21 | 2 | ok |
| prank_call | 1 | 70 | 70 | 0 | TOO SLOW |
| ice_pileup_collision | 3 | 380 | 84 | 6 | ok |
| storm_debris | 2 | 250 | 44 | 2 | ok |
