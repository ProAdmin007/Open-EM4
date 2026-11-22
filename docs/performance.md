# Performance measurements

Measured on the development machine (Windows Server 2022 VM, no physical GPU), 2026-11-21.

## Headless simulation (`npm run bench`)

30 simulated minutes on the 102×72 city, Hard difficulty, freeplay generator, 52 civilian cars, 47 pedestrians, 21 emergency vehicles, 49 responders, concurrent incidents:

- 32 s wall time (~55× real time)
- average tick 0.6 ms, worst tick 10 ms (budget at 30 Hz: 33 ms). Collision avoidance and larger traffic made ticks ~3× more expensive than on the old 64×48 map.

## Browser (Playwright test "performance", Chrome with SwiftShader *software* WebGL)

Hard freeplay at 4× speed on the 102×72 city: **≈ 11-12 fps** (frames actually rendered per second, counted with `game.loop.frame`). On the old 64×48 map the same test gave ≈ 20 fps.
An earlier note here claimed 60 fps; that came from `loop.actualFps`, which is stale when the render loop stalls (a lost WebGL context), so it was wrong and has been replaced.

Software rendering at 1366×768 is not representative of a normal desktop GPU. **The 60 FPS goal could not be verified in this environment**; run `npm run test:e2e` on a machine with a GPU
(the test prints `PERF avg fps=…`). The simulation itself is decoupled from rendering and runs at real-time pace even when rendering is slow (time-based fixed steps, backlog dropped when it cannot keep up).
Dynamic drawing is limited to the `fx` Graphics layer (selection, lights, glow), ≤560 pooled particle sprites and ~1,300 images (trees, vehicles, people, baked buildings and terrain chunks).

## Measures taken

- Fixed-step simulation decoupled from rendering, with interpolation.
- Static city drawn once; building graphics only redrawn when destroyed.
- Pooled particles (flames, smoke, water drops); no per-frame allocation of sprites.
- DOM HUD refreshed at 4 Hz with string diffing.
- A* uses typed arrays and a binary heap; pedestrians use a node cap.

## Notes

- The terrain (7,300 tiles) is drawn once onto 16×16-tile 2D canvases and uploaded as textures, so it costs one image per chunk per frame instead of tens of thousands of rectangles.
- In the software-rendered test browser the WebGL context of the *first* page after a browser start is sometimes lost; the game has a watchdog that reloads once if the loop stalls, and the Playwright config retries failed tests twice.
