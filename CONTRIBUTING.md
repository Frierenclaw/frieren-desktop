# Contributing to Frieren Desktop

Thanks for taking a look. This is a young project with a lot of moving parts, so this doc is meant to get you oriented quickly rather than gatekeep.

## Setup

```bash
git clone https://github.com/Frierenclaw/frieren-desktop.git
cd frieren-desktop
npm install
npm run dev
```

You'll also need a running [Fern](https://github.com/Frierenclaw/fern) instance to actually connect and talk to a character; the client alone will render an idle avatar but won't do anything useful without a backend to talk to. Ask in the community channels if you need access to a test instance.

## Project layout

```
electron/main.js     Main process: windows, tray, IPC handlers, custom protocol
electron/preload.cjs Preload script, exposes window.electronIPC to the renderer
src/main.js           Avatar window entry point (drag/resize/hit-test logic)
src/ui.js              Settings window entry point
src/avatar.js          Three.js/VRM rendering, idle animation, lip-sync
src/visemes.js          Viseme name validation (mirrors Fern's viseme set)
src/livekit-client.js   LiveKit room connection, audio, viseme data channel
src/auth.js             JWT login/refresh against Fern
src/config.js           Persisted app config (instances, wake words, character)
src/electron-ipc.js     Thin wrapper around the preload bridge
```

The avatar window and the settings window are separate `BrowserWindow`s that talk to each other through a small event relay (`frieren:*` events) over Electron IPC, not by sharing JS state directly.

## Conventions

- Provider- and backend-specific logic belongs in Fern, not in the client. This repo should stay a fairly "dumb" renderer/transport layer; if you find yourself adding business logic here, it's worth asking first whether it belongs on the backend instead.
- Config and secrets are never hardcoded. Server URLs, character IDs, and tokens all go through `config.js` / `auth.js`, backed by `electron-store`.

## Where help is most useful right now

- **Multi-monitor and window-focus bugs.** This has been the source of the trickiest issues so far (window bounds getting clamped to the primary monitor, click-through toggling stealing OS focus from apps behind the avatar). If you have an unusual monitor setup, testing here is valuable.
- **Animation clips (`.vrma`).** Idle motion is hand-coded procedurally right now; discrete gesture clips authored via Mixamo + conversion tooling are on the roadmap but not started.
- **Packaging/signing** for `electron-builder` across platforms hasn't been fully reviewed.
- **VRM edge cases.** Different VRM models expose different expression sets; if you hit a model that renders oddly, an issue with the model (or a link to a permissively-licensed one) is genuinely useful for testing.

If none of that fits what you're interested in, open an issue describing what you'd like to work on before sending a large PR, just so effort isn't wasted on something that's already being reworked elsewhere.

## Reporting bugs

Please include:
- OS and monitor setup (single/multi-monitor, resolutions, scaling)
- Whether it happens in `npm run dev` or a packaged build
- Console output from the Electron main process and the DevTools console if relevant
