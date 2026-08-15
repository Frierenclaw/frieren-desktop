import { isLoggedIn } from './auth.js';
import {
  createCharacter,
  uploadCharacterModel,
  uploadCharacterCover,
  uploadCharacterAnimations,
  NAME_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  PROMPT_MAX_LENGTH,
} from './hub.js';
import { $ } from './ui-shared.js';

const uploadLoggedOut = $('upload-logged-out');
const uploadForm      = $('upload-form');

const nameInput         = $('upload-name');
const descriptionInput  = $('upload-description');
const promptInput       = $('upload-prompt');
const vrmInput          = $('upload-vrm-input');
const coverInput        = $('upload-cover-input');
const animationsInput   = $('upload-animations-input');
const vrmFilenameText         = $('upload-vrm-filename');
const coverFilenameText       = $('upload-cover-filename');
const animationsFilenameText  = $('upload-animations-filename');
const submitBtn         = $('upload-submit-btn');
const statusText        = $('upload-status');
const errorText         = $('upload-error');

nameInput.maxLength = NAME_MAX_LENGTH;
descriptionInput.maxLength = DESCRIPTION_MAX_LENGTH;
promptInput.maxLength = PROMPT_MAX_LENGTH;

function showError(msg) {
  errorText.textContent = msg;
  errorText.classList.remove('hidden');
}

function updateSubmitAvailability() {
  const ready = nameInput.value.trim().length > 0
    && descriptionInput.value.trim().length > 0
    && promptInput.value.trim().length > 0
    && vrmInput.files.length > 0;
  submitBtn.disabled = !ready;
}

function resetForm() {
  nameInput.value = '';
  descriptionInput.value = '';
  promptInput.value = '';
  vrmInput.value = '';
  coverInput.value = '';
  animationsInput.value = '';
  vrmFilenameText.textContent = '';
  coverFilenameText.textContent = '';
  animationsFilenameText.textContent = '';
}

async function handleSubmit() {
  errorText.classList.add('hidden');
  submitBtn.disabled = true;

  const name = nameInput.value.trim();
  const description = descriptionInput.value.trim();
  const prompt = promptInput.value.trim();
  const vrmFile = vrmInput.files[0];
  const coverFile = coverInput.files[0];
  const animationsFile = animationsInput.files[0];

  let characterId = null;
  const warnings = [];

  try {
    statusText.textContent = 'Creating character…';
    characterId = await createCharacter(name, description, prompt);

    statusText.textContent = 'Uploading model…';
    await uploadCharacterModel(characterId, vrmFile);

    if (coverFile) {
      statusText.textContent = 'Uploading cover…';
      try {
        await uploadCharacterCover(characterId, coverFile);
      } catch (err) {
        warnings.push(`Cover: ${err.message}`);
      }
    }

    if (animationsFile) {
      statusText.textContent = 'Uploading animations…';
      try {
        await uploadCharacterAnimations(characterId, animationsFile);
      } catch (err) {
        warnings.push(`Animations: ${err.message}`);
      }
    }

    statusText.textContent = warnings.length
      ? `Character created, but: ${warnings.join('; ')}`
      : 'Uploaded! It should now appear in the Character list above.';
    resetForm();
  } catch (err) {
    statusText.textContent = '';
    showError(
      characterId
        ? `${err.message} (character ${characterId} was created, but the model upload failed, it won't be usable until that succeeds; try again)`
        : err.message,
    );
  } finally {
    updateSubmitAvailability();
  }
}

export async function renderUploadAvailability() {
  const loggedIn = await isLoggedIn();
  uploadLoggedOut.classList.toggle('hidden', loggedIn);
  uploadForm.classList.toggle('hidden', !loggedIn);
}

export function initUploadSection() {
  vrmInput.addEventListener('change', () => {
    vrmFilenameText.textContent = vrmInput.files[0]?.name ?? '';
    updateSubmitAvailability();
  });

  coverInput.addEventListener('change', () => {
    coverFilenameText.textContent = coverInput.files[0]?.name ?? '';
  });

  animationsInput.addEventListener('change', () => {
    animationsFilenameText.textContent = animationsInput.files[0]?.name ?? '';
  });

  nameInput.addEventListener('input', updateSubmitAvailability);
  descriptionInput.addEventListener('input', updateSubmitAvailability);
  promptInput.addEventListener('input', updateSubmitAvailability);

  submitBtn.addEventListener('click', handleSubmit);

  return renderUploadAvailability();
}