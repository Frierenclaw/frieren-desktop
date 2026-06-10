import { Room, RoomEvent, Track } from "livekit-client";
import { initRenderer, loadAvatar, updateViseme } from "./renderer.js";
import { updateStatus, updateSubtitles } from "./ui.js";

const FERN_URL = "http://localhost:8000";

let room = null;
let accessToken = null;
let selectedCharacter = null;

// --- Screens ---
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}

// --- Login ---
document.getElementById("login-btn").addEventListener("click", async () => {
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const errorEl = document.getElementById("login-error");
  errorEl.textContent = "";

  try {
    const res = await fetch(`${FERN_URL}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: email, password }),
    });

    if (!res.ok) throw new Error("Wrong email or password");
    const data = await res.json();
    accessToken = data.access_token;

    await loadCharacters();
    showScreen("characters-screen");

  } catch (err) {
    errorEl.textContent = err.message;
  }
});

// --- Characters ---
async function loadCharacters() {
  const res = await fetch(`${FERN_URL}/api/v1/hub/all`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();

  const list = document.getElementById("characters-list");
  list.innerHTML = "";

  for (const char of data.items) {
    const card = document.createElement("div");
    card.className = "character-card";
    card.innerHTML = `
      <img src="${char.cover_url || ""}" alt="${char.name}" onerror="this.style.display='none'"/>
      <div class="char-info">
        <div class="char-name">${char.name}</div>
        <div class="char-desc">${char.description}</div>
      </div>
    `;
    card.addEventListener("click", () => selectCharacter(char));
    list.appendChild(card);
  }
}

function selectCharacter(char) {
  selectedCharacter = char;
  showScreen("main-screen");
  initRenderer(document.getElementById("avatar-canvas"));
}

// --- Connect / Disconnect ---
document.getElementById("connect-btn").addEventListener("click", async () => {
  if (room) {
    await disconnect();
  } else {
    await connect();
  }
});

async function connect() {
  updateStatus("Connecting...");

  try {
    const res = await fetch(`${FERN_URL}/api/v1/room/?character_id=${selectedCharacter.id}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) throw new Error("Failed to create room");
    const { token, livekit_url } = await res.json();

    room = new Room();

    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Audio) {
        track.attach();
      }
    });

    room.on(RoomEvent.DataReceived, (data) => {
      const msg = JSON.parse(new TextDecoder().decode(data));
      if (msg.type === "transcript") updateSubtitles(msg.text);
      if (msg.type === "viseme") updateViseme(msg.id, msg.weight);
    });

    room.on(RoomEvent.Disconnected, () => {
      updateStatus("Disconnected");
      document.getElementById("connect-btn").textContent = "Connect";
      room = null;
    });

    await room.connect(livekit_url, token);
    await room.localParticipant.setMicrophoneEnabled(true);

    updateStatus("Connected");
    document.getElementById("connect-btn").textContent = "Disconnect";

    if (selectedCharacter.model_url) {
      await loadAvatar(selectedCharacter.model_url);
    }

  } catch (err) {
    console.error(err);
    updateStatus("Error connecting");
    room = null;
  }
}

async function disconnect() {
  if (room) await room.disconnect();
}