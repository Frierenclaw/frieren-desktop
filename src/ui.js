const statusEl = document.getElementById("status");
const subtitlesEl = document.getElementById("subtitles");

export function updateStatus(text) {
  statusEl.textContent = text;
}

export function updateSubtitles(text) {
  subtitlesEl.textContent = text;

  // Clear subtitles after 4 seconds
  clearTimeout(subtitlesEl._timeout);
  subtitlesEl._timeout = setTimeout(() => {
    subtitlesEl.textContent = "";
  }, 4000);
}