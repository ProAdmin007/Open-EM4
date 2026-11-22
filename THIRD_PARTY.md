# Third-party software and assets

## Runtime dependency (bundled in the game)

| Package | Version | License | Use |
| --- | --- | --- | --- |
| [Phaser](https://phaser.io) | 4.2.x | MIT | WebGL/Canvas rendering, input, camera (2D view) |
| [three.js](https://threejs.org) | 0.179.0 | MIT | WebGL rendering, camera, raycasting (optional 3D view, loaded lazily) |

## Development dependencies (not shipped)

| Package | License |
| --- | --- |
| Vite | MIT |
| Vitest | MIT |
| vite-node | MIT |
| TypeScript | Apache-2.0 |
| @playwright/test | Apache-2.0 |
| @types/node | MIT |
| Electron (only for the optional Windows exe; its binary is bundled in that build, with Chromium's own licenses in `LICENSES.chromium.html`) | MIT |
| @electron/packager | BSD-2-Clause |
| @types/three | MIT |

Docker images (`node:22-alpine`, `nginx:1.27-alpine`) are used only for building and hosting; they are not part of the repository.

## Assets

**There are no external assets.** All graphics (vehicles, people, trees, flames, buildings, UI) are generated at runtime from SVG strings in
`src/game/assets.ts` and Phaser drawing calls in `src/game/scene.ts`, and are covered by this project's MIT license. The map is produced by
`tools/genmap.mjs`. There are no sound files: all audio is synthesised at runtime in `src/game/audio.ts`. Emoji used in the interface are rendered by the visitor's own operating-system font; no emoji font is bundled.

No code, models, maps, sounds, texts or logos from Emergency 4 or any other commercial game are used.

If you add third-party assets, list them here with source URL, author and license, and only add assets whose redistribution rights are clear (e.g. CC0).
