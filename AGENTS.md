# Repository Guidelines

## Project Structure & Modules
- `desktop/electron/` — Electron main/preload, IPC handlers, OpenClaw stream adapter.
  - `services/live2dModelLibrary.js` — Live2D ZIP import, model discovery, and custom protocol path resolution.
  - `ipc/live2dModels.js` — model library IPC (`live2d-models:list`, `live2d-models:import-zip`).
- `front_end/` — React + Vite renderer (`src/`, `tests/`, `package.json`).
- `docs/` — current plans and architecture notes (historical docs are in `docs/archive/`).
- Root `package.json` — desktop scripts and packaging (`electron-builder`).

## Build, Test, and Run
- Install deps:
  - Root: `npm install`
  - Frontend: `cd front_end && npm install`
- Desktop dev:
  - `npm run desktop:dev`
- Build desktop package:
  - `npm run desktop:build`
- Tests:
  - Desktop main-process tests: `npm run test:desktop`
  - Frontend tests: `npm run test:frontend`
  - Frontend lint: `cd front_end && npm run lint`

## Coding Style & Naming
- JavaScript/React: prefer clear module boundaries and descriptive names.
- Keep security-sensitive logic in Electron main process, not renderer.
- Keep preload API minimal and explicit.

## UI Framework Policy
- Current direction: **progressive de-MUI migration**. Treat MUI as legacy dependency in this project.
- Do **not** introduce new MUI components for new UI work unless explicitly required by the user.
- For new UI, prefer local reusable primitives/components with project-owned styles (CSS/CSS variables), optimized for desktop widget/pet-mode visuals.
- When touching existing MUI-heavy areas, migrate incrementally by replacing highest-friction components first (for example: `TextField`, `Button`, `Tabs`, `Drawer`).
- Do not do one-shot full rewrites. Keep behavior parity and reduce regression risk through staged replacement.
- Preserve UX/security constraints during migration: pet-mode interaction affordance, streaming composer behavior, and Electron security boundaries.

## Testing Guidelines
- Frameworks:
  - Desktop: Node built-in `node:test`
  - Frontend: `vitest`
- Focus regression tests on:
  - IPC stream event mapping (`text-delta/done/error`)
  - stream abort behavior
  - settings persistence and token handling
  - SSE parsing robustness
  - Live2D custom protocol URL resolution compatibility:
    - `openclaw-model:///folder/file`
    - `openclaw-model://folder/file`
  - path traversal rejection for custom protocol resolution
- When changing model import/protocol logic, run `npm run test:desktop`.

## Commit & PR Guidelines
- Conventional commit style: `feat:`, `fix:`, `test:`, `chore:`.
- PR should include:
  - Scope and rationale
  - User-visible behavior changes
  - Tests run and results

## Security & Config
- OpenClaw token should be managed in Electron main process and stored via system keychain when available.
- Do not expose token to renderer over preload APIs.
- Keep `contextIsolation: true` and `sandbox: true` for BrowserWindow.
- For `openclaw-model://` asset serving, keep strict root-directory confinement and reject traversal attempts.
