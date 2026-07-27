/**
 * ui-wake-words.js, "Wake Words" card
 */

import { $ } from './ui-shared.js';
import { getWakeWords, addWakeWord, removeWakeWord } from './config.js';

const wakeWordsList    = $('wake-words-list');
const newWakeWordInput = $('new-wake-word');
const addWakeWordBtn   = $('add-wake-word-btn');
const wakeWordsError   = $('wake-words-error');

export async function renderWakeWords() {
  const words = await getWakeWords();
  wakeWordsList.innerHTML = '';

  if (words.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'info-text';
    empty.textContent = 'No wake words set, the assistant will not start listening.';
    wakeWordsList.appendChild(empty);
    return;
  }

  words.forEach((word) => {
    const chip = document.createElement('span');
    chip.className = 'chip';

    const label = document.createElement('span');
    label.className = 'chip-label';
    label.textContent = word;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'chip-remove';
    removeBtn.type = 'button';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove';
    removeBtn.addEventListener('click', async () => {
      await removeWakeWord(word);
      await renderWakeWords();
    });

    chip.append(label, removeBtn);
    wakeWordsList.appendChild(chip);
  });
}

function showWakeWordError(msg) {
  wakeWordsError.textContent = msg;
  wakeWordsError.classList.remove('hidden');
}

async function handleAddWakeWord() {
  const word = newWakeWordInput.value.trim();
  wakeWordsError.classList.add('hidden');

  if (!word) return;

  if (word.length > 60) {
    showWakeWordError('Wake word is too long (max 60 characters).');
    return;
  }

  await addWakeWord(word);
  newWakeWordInput.value = '';
  await renderWakeWords();
}

export function initWakeWordsSection() {
  addWakeWordBtn.addEventListener('click', handleAddWakeWord);

  newWakeWordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddWakeWord();
    }
  });

  return renderWakeWords();
}
