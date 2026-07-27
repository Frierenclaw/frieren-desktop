import { openExternal } from '../electron-ipc.js';

export default {
  spec: {
    name: 'open_browser',
    description: 'Opens a URL in the user\'s default web browser. If no URL is given, opens a blank default page.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full URL to open, e.g. https://example.com' },
      },
      required: [],
    },
  },
  handler: async (args) => {
    const url = args?.url || 'https://www.google.com';
    const result = await openExternal(url);
    return { opened: result?.opened ?? url };
  },
};
