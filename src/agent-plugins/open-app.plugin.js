import { launchApp } from '../electron-ipc.js';

export default {
  spec: {
    name: 'open_app',
    description: 'Launches an application already installed on the user\'s computer, matched by name (e.g. "Spotify", "Forza Horizon 4"). Never installs or downloads anything; if no locally installed app matches, returns launched:false with reason "not_found".',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the installed application to launch' },
      },
      required: ['name'],
    },
  },
  handler: async (args) => launchApp(args?.name),
};
