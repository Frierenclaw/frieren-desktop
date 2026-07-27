import { openExternal } from '../electron-ipc.js';

export default {
  spec: {
    name: 'open_spotify',
    description: 'Opens the Spotify desktop app if installed, falling back to the Spotify web player in the browser otherwise.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  handler: async () => {
    try {
      const result = await openExternal('spotify:');
      return { opened: result?.opened ?? 'spotify:', app: 'desktop' };
    } catch (err) {
      console.warn('[agent] Spotify app not available, falling back to web player:', err);
      const result = await openExternal('https://open.spotify.com');
      return { opened: result?.opened ?? 'https://open.spotify.com', app: 'web' };
    }
  },
};
