# Research notes

Date: 2026-11-21. **Verification status is stated per item.** Package facts were read from the npm registry (`npm view`) while building this project;
items marked *unverified* come from general knowledge, were not checked online in this session, and should be re-checked before relying on them.

## Engine and tooling (verified via npm)

| Package | Version used | License | Notes |
| --- | --- | --- | --- |
| phaser | 4.2.1 (`latest` dist-tag; 4.0.0-rc.x was `beta`) | MIT | Last published 2026-07-09. Phaser 4 works with the familiar `Phaser.Game`, `Scene`, `Graphics`, `Image`, camera and input APIs used here. |
| vite | 8.3.8 | MIT | Dev server + production build. |
| vitest | 5.1.1 | MIT | Unit and simulation tests, shares Vite config. |
| typescript | 7.0.2 | Apache-2.0 | `strict: true`. |
| @playwright/test | 1.65.1 | Apache-2.0 | Browser tests, run against the locally installed Chrome. |

**Decision:** Phaser 4 + TypeScript + Vite as requested.

## Pathfinding and entity management

| Option | Facts (verified via npm) | Decision |
| --- | --- | --- |
| `grid-engine` (Phaser plugin) | 2.55.1, Apache-2.0, peer `phaser ~4.0.0`, modified 2026-11-21 | Not used: it couples movement to Phaser scenes/tilemaps, but the simulation must run headless and deterministic (tests, future server). |
| `easystarjs` | 0.4.4, MIT, last modified 2022 | Not used: unmaintained; our needs (4/8-direction grid A*, goal predicates, per-vehicle passability) are ~100 lines. |
| `pathfinding` | 0.4.18, last modified 2022 | Not used: unmaintained. |
| `bitecs` | 0.4.0, **MPL-2.0** | Not used: licensing is weaker-copyleft and the entity count (~100) does not need an ECS. |
| `miniplex` | 2.0.0, MIT, last modified 2023 | Not used: plain typed `Map`s are sufficient. |

**Decision:** own binary-heap A* (`src/sim/pathfinding.ts`, covered by tests) and plain typed entity maps in `World`. No extra runtime dependencies except Phaser.

## Maps

*Unverified:* Tiled can export JSON maps (including isometric orientation) and Phaser can load them. The first version uses a procedurally generated
ASCII map (`tools/genmap.mjs` → `src/data/map_default.json`) because it is easy to validate and mod, and keeps collision/road data in one grid. Importing
Tiled maps is a possible follow-up. The view is top-down with extruded ("2.5D") buildings rather than true isometric; true isometry would need an
iso-aware picking and depth model and was left out of the vertical slice.

## Existing open-source projects and assets (unverified, not browsed)

- No actively maintained open-source, browser-based clone of Emergency-style games was identified from memory. Candidates worth checking: OpenRA (GPL-3.0, C#, command & conquer engines – a general RTS reference), and generic Phaser RTS demos.
  Because most are GPL, **no code was copied**; only general RTS interaction conventions (box select, right-click orders) are used.
- Kenney.nl asset packs are widely distributed under CC0 (unverified for specific packs). They were *not* used; all art is generated SVG so there is no redistribution uncertainty.
- Traffic-simulation libraries (e.g. Intelligent Driver Model implementations) exist; a small lane-offset follower with traffic lights and emergency priority was implemented instead.

## Take-aways

1. The simulation is deliberately independent of Phaser (`src/sim`), so it can later run on an authoritative server.
2. Zero external assets keeps licensing trivial (see `THIRD_PARTY.md`).
3. Re-verify the *unverified* items above before adding assets or dependencies.
