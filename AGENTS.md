# Repository Guidelines

## Project Structure & Modules
- `desktop/electron/` — Electron main/preload, IPC handlers, tray/window mode, chat/voice adapters.
  - `main.js` — app bootstrap, BrowserWindow security config, backend/runtime wiring, IPC registration.
  - `preload.js` — expose minimal renderer bridge (`conversation`, `settings`, `voice`, `voiceModels`, `live2dModels`, `nanobotRuntime`, `capture`, `windowMode`).
  - `ipc/chatStream.js` — low-level stream IPC (`chat:stream:start`, `chat:stream:abort`) and segment emission.
  - `ipc/conversation.js` — conversation control IPC (`conversation:submit-user-text`, `conversation:abort-active`).
  - `ipc/settings.js` — settings read/save/test + Nanobot workspace picker (`settings:*`).
  - `ipc/nanobotRuntime.js` — Nanobot runtime install/status IPC (`nanobot-runtime:*`).
  - `ipc/screenshotCapture.js` — screenshot capture/overlay lifecycle IPC (`capture:*`, `capture-overlay:*`).
  - `ipc/voiceSession.js` — voice session lifecycle/audio commit/TTS flow-control IPC (`voice:*`).
  - `ipc/voiceModels.js` — voice model library IPC (`voice-models:*`).
  - `ipc/live2dModels.js` — Live2D model library IPC (`live2d-models:list`, `live2d-models:import-zip`).
  - `window/modeIpc.js`, `window/windowModeManager.js`, `window/trayManager.js` — pet/window mode handshake and tray-driven mode control.
  - `services/chat/conversationRuntime.js` — per-session turn orchestration (`latest-wins`/`queue`) and chat/voice event envelope routing.
  - `services/chat/backendManager.js` — backend selection (`openclaw` / `nanobot`) and shared error mapping.
  - `services/chat/backends/openclawBackend.js`, `services/chat/backends/nanobotBackend.js` — backend adapters.
  - `services/chat/nanobot/nanobotRuntimeManager.js` — Nanobot repo install/launch config, resolved against shared Python runtime/env.
  - `services/live2dModelLibrary.js` — Live2D ZIP import, model discovery, and custom protocol path resolution.
  - `services/screenshotCaptureService.js`, `services/screenshotSelectionService.js` — capture lifecycle + overlay selection session management.
  - `services/python/pythonRuntimeManager.js` — shared app-level Python runtime download/install/verification.
  - `services/python/pythonEnvManager.js` — isolated Python env creation and dependency installation by profile/lock.
  - `services/python/pythonRuntimeCatalog.js` — built-in shared Python runtime package catalog (default Python `3.12`).
  - `services/voice/voiceModelCatalog.js` — built-in voice model catalog (Sherpa bundles + Python-backed ASR/TTS entries with env profiles).
  - `services/voice/voiceModelLibrary.js` — model artifact download, bundle selection, shared runtime/env resolution, legacy state compatibility.
  - `services/voice/asrService.js`, `ttsService.js` — provider resolution with worker-first execution.
  - `services/voice/asrWorkerClient.js`, `asrWorkerProcess.js` — ASR worker process isolation (Python path).
  - `services/voice/ttsWorkerClient.js`, `ttsWorkerProcess.js` — TTS worker process and chunk ACK backpressure.
  - `services/voice/providers/python/` — Python bridge/bootstrap/resident worker scripts (`tts_resident_worker.py` provides Qwen3 MLX streaming TTS).
- `front_end/` — React + Vite renderer (`src/`, `tests/`, `package.json`).
  - `src/App.jsx` — app composition root (chat, subtitles, voice, settings, download center).
  - `src/shells/MainShell.jsx`, `src/shells/PetShell.jsx` — window/pet mode shells.
  - `src/components/config/ConfigDrawer.jsx` — chat backend, Nanobot runtime, voice, and preferences panels.
  - `src/components/config/VoiceSettingsPanel.jsx` — voice session controls + model catalog install/select UI.
  - `src/services/desktopBridge.js` — normalized desktop/web bridge and `conversation:event` routing helpers.
  - `src/hooks/chat/useStreamingSubtitleBridge.js` — subtitle sync from chat envelope and playback lifecycle.
  - `src/hooks/voice/` — VAD, capture, session bridge, and TTS playback handling.
- `docs/` — current plans and architecture notes (historical docs are in `docs/archive/`).
- Root `package.json` — desktop scripts and packaging (`electron-builder`).

## Build, Test, and Run
- Install deps:
  - Root workspace: `pnpm install`
- Desktop dev:
  - `pnpm run desktop:dev`
- Split desktop dev (when debugging startup race conditions):
  - `pnpm run desktop:dev:renderer`
  - `pnpm run desktop:dev:electron`
- Build desktop package:
  - `pnpm run desktop:build`
- Tests:
  - Desktop main-process tests: `pnpm run test:desktop`
  - Frontend tests: `pnpm run test:frontend`
  - Frontend lint: `cd front_end && pnpm run lint`

## Chat & Conversation Runtime Notes (Current State)
- Supported chat backends:
  - `openclaw` (default)
  - `nanobot`
- Settings shape is next-gen:
  - `chatBackend`
  - `openclaw` (`baseUrl`, `agentId`, token in secure storage)
  - `nanobot` (`enabled`, `workspace`, provider/model/API fields, API key in secure storage)
- Conversation runtime (`conversationRuntime`) owns per-session concurrency:
  - default policy: `latest-wins`
  - optional policy: `queue`
- Renderer integration should prefer:
  - request APIs: `conversation:submit-user-text`, `conversation:abort-active`
  - event channel: `conversation:event` envelope with `channel: chat|voice`
- Legacy mirrors (`chat:stream:event`, `voice:event`) are compatibility-only and gated by `OPENCLAW_ENABLE_LEGACY_STREAM_EVENTS`.

## Voice Runtime Notes (Current State)
- Providers currently supported in main process:
  - ASR: `mock`, `sherpa-onnx`, `python`
  - TTS: `mock`, `sherpa-onnx`, `python`
- Python runtime architecture:
  - Python is no longer bundled inside voice model bundles.
  - Shared runtime lives under app data `python-runtime/`.
  - Isolated dependency envs live under app data `python-envs/<env-id>/`.
  - Voice/Nanobot resources store env references (`pythonEnvId`), not bundled interpreter paths.
- Worker strategy:
  - ASR Python path prefers `asrWorkerClient` + child process; on worker-level failures, `asrService` falls back to direct provider.
  - TTS non-mock providers run through `ttsWorkerClient` + chunk ACK protocol to avoid uncontrolled buffering.
  - `qwen3-mlx` TTS uses a resident Python worker for true streaming chunk output; keep that path intact unless explicitly changing streaming behavior.
- Built-in catalog includes:
  - `builtin-asr-zh-int8-zipformer-v1`
  - `builtin-asr-qwen3-0.6b-4bit-v1`
  - `builtin-tts-qwen3-0.6b-8bit-v1`
  - `builtin-tts-edge-v1`
- Current Python-backed built-in profiles:
  - `asr-qwen3-mlx`
  - `tts-qwen3-mlx`
  - `tts-edge`
- Default shared Python version:
  - `3.12.12`
- Runtime env is resolved by `VoiceModelLibrary#getRuntimeEnv(...)` and injected into voice session via `registerVoiceSessionIpc({ resolveVoiceEnv })`.
- Nanobot runtime is resolved independently by `NanobotRuntimeManager#resolveLaunchConfig()` and should not depend on selected voice bundles.
- Keep renderer contracts stable:
  - conversation envelope: `conversation:event` with `channel: voice` and event types including `state`, `asr-partial`, `asr-final`, `tts-chunk`, `done`, `error`, segment lifecycle payloads.
  - flow control: `voice:flow-control` with payload `{ type: 'tts-flow-control', action: 'pause'|'resume', ... }`.

## Coding Style & Naming
- JavaScript/React: prefer clear module boundaries and descriptive names.
- Keep security-sensitive logic in Electron main process, not renderer.
- Keep preload API minimal and explicit.

## UI Framework Policy
- Current UI is still MUI-heavy (for example `ConfigDrawer`, settings forms, tabs, drawers).
- Prefer incremental migration over one-shot rewrites: preserve behavior parity while replacing high-friction components.
- For newly introduced UI surfaces, prefer project-owned reusable primitives/styles when practical.
- Preserve UX/security constraints during migration: pet-mode interaction affordance, streaming composer behavior, and Electron security boundaries.

## Testing Guidelines
- Frameworks:
  - Desktop: Node built-in `node:test`
  - Frontend: `vitest`
- Focus regression tests on:
  - conversation runtime policy behavior (`latest-wins`/`queue`) and envelope routing
  - IPC stream event mapping (`text-delta` / `segment-ready` / `done` / `error`)
  - stream abort behavior
  - voice session state transitions and commit serialization
  - TTS chunk ACK backpressure pause/resume and timeout handling
  - segment subtitle/playback lifecycle synchronization (ready/start/finish/fail/reset)
  - shared Python runtime/env resolution and legacy path migration
  - ASR worker warmup/fallback behavior
  - voice-to-chat bridge on `asr-final`
  - settings persistence and secure secret handling (OpenClaw token / Nanobot API key)
  - backend switching and Nanobot connection validation behavior
  - SSE parsing robustness
  - voice model catalog install + runtime/env mapping (sherpa/python)
  - nanobot runtime install + shared Python env resolution
  - screenshot capture + overlay selection lifecycle (`capture:*`, `capture-overlay:*`)
  - pet/window mode handshake and mouse passthrough updates
  - Live2D custom protocol URL resolution compatibility:
    - `openclaw-model:///folder/file`
    - `openclaw-model://folder/file`
  - path traversal rejection for custom protocol resolution
- When changing voice model, provider, worker, or protocol logic, run `pnpm run test:desktop`.
- When changing `VoiceSettingsPanel` or voice renderer hooks, run:
  - `pnpm run test:frontend`
  - `cd front_end && pnpm run lint`

## GUI Real-Device Download Regression (Installed App)
- Scope:
  - Validate first-run onboarding flow in installed app (`/Applications/OtakuClaw.app`).
  - Cover full path: `Nanobot runtime` download + `Qwen ASR` model download + `Qwen TTS` model download.
  - Focus on download area UX: status text, progress %, speed, ETA, stage transitions, completion/failure messaging.
- Reset before run (macOS):
  - Quit app process first.
  - Remove app data: `~/Library/Application Support/otakuclaw-desktop`.
  - Remove prefs: `~/Library/Preferences/com.otakuclaw.desktop.plist`.
  - Remove keychain secrets (if present): service `otakuclaw-desktop`, accounts:
    - `openclaw-token`
    - `nanobot-api-key`
    - `dashscope-api-key`
- Launch mode:
  - Prefer installed app with remote debugging enabled:
    - `open -a "/Applications/OtakuClaw.app" --args --remote-debugging-port=9222`
  - Do not rely only on macOS AX tree for React controls; AX often exposes only container groups.
  - Use CDP (port `9222`) to drive real GUI DOM interactions.
- Stable CDP interaction rules for MUI controls:
  - For MUI `TextField select`, interact with `[role="combobox"]`.
  - Open dropdown via `mousedown` + `click` on combobox, then select `li[role="option"]`.
  - Do not assume static ids; match by nearby label/outer text (`推理后端`, `ASR 来源`, `ASR 本地模型`, `TTS 来源`, `TTS 本地模型`).
- Download-monitor checklist:
  - `Nanobot`: verify stages like Python runtime download/extract/install and final completion text.
  - `ASR/TTS`: verify Python env setup stages (`创建 env`, `安装依赖 n/5`), then model bytes/speed/ETA.
  - Confirm final state switches to installed and button text changes (`下载模型` -> `重新下载`).
  - For ASR/TTS automation completion checks, do not rely on generic `任务完成` text alone:
    - ASR completion should include model-installed UI text (`当前模型已下载` or `ASR 本地模型下载完成`) and `重新下载` visibility.
    - TTS completion should include model-installed UI text (`当前模型已下载` or `TTS 本地模型下载完成`) and `重新下载` visibility.
- Severity rule during run:
  - If a blocking failure appears (`无法下载`, persistent failed phase, unrecoverable navigation dead-end), stop further steps immediately.
  - Output root-cause analysis + concrete patch plan instead of continuing the remaining download flow.
- Suggested evidence artifacts (for reproducible reports):
  - Save automation logs/report under `/tmp/openclaw-gui-test/`, e.g.:
    - `cdp_full_flow.log`
    - `full-flow-report.json`
  - Optional strict completion checker:
    - `node docs/scripts/cdp_wait_model_download_done.js --kind asr --port 9222`
    - `node docs/scripts/cdp_wait_model_download_done.js --kind tts --port 9222`
  - Report should include:
    - exact step where issue occurred,
    - visible UI text at that moment,
    - expected vs actual behavior,
    - user-impact severity (`P1/P2/P3`),
    - patch target files/functions.

## Commit & PR Guidelines
- Conventional commit style: `feat:`, `fix:`, `test:`, `chore:`.
- After completing a user-requested code change in this repo, stage only the files relevant to that task and create a git commit before ending the turn unless the user explicitly says not to commit or the task is still incomplete/blocking.
- Do not leave task-related code edits uncommitted at the end of an implementation turn; if a commit cannot be made, explain the blocker explicitly in the final response.
- PR should include:
  - Scope and rationale
  - User-visible behavior changes
  - Tests run and results

## Security & Config
- OpenClaw token and Nanobot API key should be managed in Electron main process and stored via system keychain when available.
- Do not expose raw secrets to renderer over preload APIs.
- Keep `contextIsolation: true` and `sandbox: true` for BrowserWindow.
- For `openclaw-model://` asset serving, keep strict root-directory confinement and reject traversal attempts.
- Do not let renderer directly execute Python, shell, or model bootstrap commands; keep these operations in trusted main-process services.
- Keep voice worker IPC payloads schema-safe and minimal (audio/text/status only).
