import { sendTextMessage, CHAT_BACKEND_AVAILABLE } from './text-chat.js';
import { $ } from './ui-shared.js';

const messagesEl = $('chat-messages');
const inputEl    = $('chat-input');
const sendBtn    = $('chat-send-btn');
const errorEl    = $('chat-error');

function appendMessage(role, text) {
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble chat-bubble-${role}`;
  bubble.textContent = text;
  messagesEl.appendChild(bubble);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return bubble;
}

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.remove('hidden');
}

async function handleSend() {
  const text = inputEl.value.trim();
  if (!text) return;

  errorEl.classList.add('hidden');
  inputEl.value = '';
  sendBtn.disabled = true;

  appendMessage('user', text);
  const pending = appendMessage('assistant', '…');
  pending.classList.add('chat-bubble-pending');

  try {
    const reply = await sendTextMessage(text);
    pending.textContent = reply || '(no response)';
    pending.classList.remove('chat-bubble-pending');
  } catch (err) {
    pending.remove();
    showError(err.message);
  } finally {
    sendBtn.disabled = false;
    inputEl.focus();
  }
}

export function initTextChatSection() {
  if (!CHAT_BACKEND_AVAILABLE) {
    inputEl.disabled = true;
    sendBtn.disabled = true;
    inputEl.placeholder = 'Coming soon';
    appendMessage('assistant', 'Text chat is on the way; this will light up once the backend for it ships.');
    return;
  }

  sendBtn.addEventListener('click', handleSend);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  });
}