import { Room, RoomEvent, Track } from "livekit-client";
import { initRenderer, loadAvatar, updateViseme } from "./renderer.js";
import { updateStatus, updateSubtitles } from "./ui.js";
import { getFernUrl, getTokens, setTokens, clearTokens } from "./config.js";

let room = null;
let accessToken = null;
let selectedCharacter = null;

// --- Screens ---
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}

// --- Token refresh ---
async function refreshAccessToken() {
  const { refreshToken } = await getTokens();
  if (!refreshToken) throw new Error("No refresh token");

  const fernUrl = await getFernUrl();
  const res = await fetch(`${fernUrl}/api/v1/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!res.ok) throw new Error("Refresh failed");
  const data = await res.json();
  accessToken = data.access_token;
  await setTokens(data.access_token, data.refresh_token);
}

// --- Authenticated fetch (auto-refresh on 401) ---
async function authFetch(url, options = {}) {
  const fernUrl = await getFernUrl();
  const res = await fetch(`${fernUrl}${url}`, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (res.status === 401) {
    // Try to refresh the token
    await refreshAccessToken();
    // Retry the request with the new token
    return fetch(`${fernUrl}${url}`, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${accessToken}`,
      },
    });
  }

  return res;
}

// --- Boot: check for saved token ---
async function boot() {
  const { accessToken: savedToken } = await getTokens();
  if (savedToken) {
    accessToken = savedToken;
    try {
      await loadCharacters();
      showScreen("characters-screen");
    } catch {
      // Token expired, try refresh
      try {
        await refreshAccessToken();
        await loadCharacters();
        showScreen("characters-screen");
      } catch {
        await clearTokens();
        showScreen("login-screen");
      }
    }
  } else {
    showScreen("login-screen");
  }
}

boot();

// --- Login ---
document.getElementById("login-btn").addEventListener("click", async () => {
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const errorEl = document.getElementById("login-error");
  errorEl.textContent = "";

  try {
    const fernUrl = await getFernUrl();
    const res = await fetch(`${fernUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: email, password }),
    });

    if (!res.ok) throw new Error("Wrong email or password");
    const data = await res.json();
    accessToken = data.access_token;
    await setTokens(data.access_token, data.refresh_token);

    await loadCharacters();
    showScreen("characters-screen");

  } catch (err) {
    errorEl.textContent = err.message;
  }
});

// --- Characters ---
async function loadCharacters() {
  const res = await authFetch("/api/v1/hub/all");
  if (!res.ok) throw new Error("Failed to load characters");
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
  requestAnimationFrame(() => {
    initRenderer(document.getElementById("avatar-canvas"));
  });
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
    const res = await authFetch(`/api/v1/room/?character_id=${selectedCharacter.id}`, {
      method: "POST",
    });

    if (!res.ok) throw new Error("Failed to create room");
    const { token, livekit_url } = await res.json();

    room = new Room();

    // Play incoming audio from the avatar
    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Audio) {
        track.attach();
      }
    });

    // Handle transcript and viseme data from Fern
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

    // Load the character's VRM model from Fern
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