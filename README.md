# 🦋 Frieren Desktop (The Face)
> *"A window into another world."*

Frieren Desktop is the real-time 3D client of the [Frieren AI Ecosystem](https://github.com/Frierenclaw). It renders an interactive VRM avatar, streams microphone audio to Fern via WebRTC, and animates the avatar in sync with the AI's voice using live viseme data.

## 🔮 Responsibilities

* **The Face (VRM Renderer):** Loads and renders a fully rigged 3D VRM avatar in real-time using Three.js, with live lip-sync driven by viseme frames pushed from Fern.
* **The Ear (Audio Transport):** Captures microphone input and streams raw PCM audio to Fern via LiveKit WebRTC transport.
* **The Voice Receiver (TTS Playback):** Receives synthesized audio chunks from Fern and plays them back in real-time as they arrive.
* **The Hub (Character Selection):** Authenticates with Fern and displays available AI characters fetched from the ecosystem's character registry.

## 📐 Architecture Integration

| From | Direction / Protocol | To | Data Transferred |
|---|---|---|---|
| Microphone | to Fern (VAD / STT) | Raw Audio PCM | Captures raw microphone input from the user. |
| Fern (TTS Engine) | to Audio output | Audio chunks | Synthesized voice streamed back and played in real-time. |
| Fern (Pipeline) | to VRM Renderer | Viseme JSON | Lip-sync animation frames applied to the 3D avatar. |
| Fern (API) | to Character Hub | Characters | Available AI characters loaded on login. |

## 🛠 Tech Stack & Spells

* **Framework:** Tauri 2.0 (Rust + WebView)
* **3D Rendering:** Three.js + `@pixiv/three-vrm`
* **Audio Transport:** LiveKit Client SDK
* **Frontend:** Vanilla JavaScript + Vite
* **Avatar Format:** VRM

## 🚀 Quick Start

1. Clone the repository:
```bash
   git clone https://github.com/Frierenclaw/frieren-desktop.git
   cd frieren-desktop
```

2. Install dependencies:
```bash
   npm install
```

3. Configure Fern's URL, open `src/main.js` and set:
```javascript
   const FERN_URL = "http://your-fern-server:8000";
```

4. Run in development mode:
```bash
   npm run tauri dev
```

## ⚠️ Requirements

* [Node.js](https://nodejs.org) v18+
* [Rust](https://rustup.rs)
* A running instance of [Fern](https://github.com/Frierenclaw/fern)

---

Part of the [Frieren AI Ecosystem](https://github.com/Frierenclaw).