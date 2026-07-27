import { isConnected } from '../livekit-client.js';

export default {
  spec: {
    name: 'get_connection_status',
    description: 'Returns whether the client is currently connected to Fern.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  handler: async () => ({ connected: isConnected() }),
};
