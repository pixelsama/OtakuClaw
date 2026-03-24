# Phase 3 Real-Device Regression

This folder contains reusable end-to-end regression assets for the Phase 3 checklist (backend switch, ask permission loop, transport fault handling).

## Structure

- `fixtures/mock_acp_stdio_runner.js`
  - ACP stdio mock runner for deterministic scenarios: `echo`, `long`, `permission-once`, `permission-queue`, `error`.
- `fixtures/mock_acp_http_server.js`
  - ACP HTTP mock server (`/acp`, `/permission`, `/status`).
- `fixtures/mock_acp_ws_server.js`
  - ACP WebSocket mock server for `echo`, `disconnect`, `long`, `permission-once`.
- `run_real_device_regression.js`
  - Electron + Playwright regression runner. It executes checklist-aligned cases and prints per-case PASS/FAIL.

## Run

```bash
pnpm run test:regression:phase3-real-device
```

Strict mode (non-zero exit on failures):

```bash
pnpm run test:regression:phase3-real-device:strict
```

## Notes

- The runner uses the local Electron app with `ELECTRON_DEV_SERVER_URL` (default `http://127.0.0.1:3000`).
- For real-device smoke, keep the renderer dev server running before starting this script.
- Cases are mapped to checklist groups: backend connectivity, ask flow, switch/abort recovery, transport errors + recovery, persistence.
