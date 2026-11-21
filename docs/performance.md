# Performance measurements

Measured on the development machine (Windows Server 2022 VM, no physical GPU), 2026-11-21.

## Headless simulation (`npm run bench`)

30 simulated minutes, Hard difficulty, freeplay generator, 26 civilian cars, 24 pedestrians, 15 emergency vehicles, 35 responders, up to 9 concurrent incidents:

- 2.7 s wall time (~660× real time)
- average tick 0.051 ms, worst tick 5.7 ms (budget at 30 Hz: 33 ms)

## Browser (Playwright test "performance", Chrome with SwiftShader *software* WebGL)

Hard freeplay at 4× speed for ~11 s: **avg ≈ 20 fps (min ≈ 19)**, Phaser object count stable (962 → 963, pooled particles, sprites created/destroyed by diffing).

Software rendering at 1366×768 is not representative of a normal desktop GPU. **The 60 FPS goal could not be verified in this environment**; re-run `npm run test:e2e` on a machine with a GPU
(the test prints `PERF avg fps=…`). Known per-frame costs: ~3,000 static tile draws are baked into one Graphics object once; dynamic drawing is limited to the `fx` Graphics layer
(selection, lights, glow) and ≤560 pooled particle sprites.

## Measures taken

- Fixed-step simulation decoupled from rendering, with interpolation.
- Static city drawn once; building graphics only redrawn when destroyed.
- Pooled particles (flames, smoke, water drops); no per-frame allocation of sprites.
- DOM HUD refreshed at 4 Hz with string diffing.
- A* uses typed arrays and a binary heap; pedestrians use a node cap.
