# Contributing to OpenRescue RTS

Thanks for helping! The project is MIT licensed; by contributing you agree your work is released under the same license.

## Setup

```
npm install
npm run dev          # http://localhost:5173
npm test             # unit + simulation tests (Vitest)
npm run build        # typecheck + production build
npm run test:e2e     # Playwright (uses installed Chrome; set PW_CHANNEL=msedge or run `npx playwright install chromium`)
npm run bench        # headless simulation benchmark
```

## Guidelines

- Keep `src/sim` free of Phaser/DOM code. It must stay deterministic: use the world's seeded `Rng`, never `Math.random()`.
- Rendering and UI only *read* simulation state and send orders through `World` methods (`orderMove`, `orderAbility`, `contextOrder`, ...).
- New gameplay content should be data (JSON) first. See `docs/modding.md`.
- Add a unit test for every simulation change, and a Playwright test for new player-facing flows.
- No actions without mechanics: a button must trigger real simulation behaviour.
- Only add assets whose redistribution rights are clear, and record them in `THIRD_PARTY.md`.
- The UI language is Dutch; code and comments are English.
