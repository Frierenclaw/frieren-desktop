import { openOrFocusSettingsWindow } from '../electron-ipc.js';

export default {
  spec: {
    name: 'open_settings',
    description: 'Opens the settings window so the user can change instance, account, character, or wake word configuration.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  handler: async () => {
    await openOrFocusSettingsWindow();
    return { opened: true };
  },
};
