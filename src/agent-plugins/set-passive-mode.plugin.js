import { togglePassive, isPassiveMode } from '../passive-mode.js';

export default {
  spec: {
    name: 'set_passive_mode',
    description: 'Enables or disables passive mode, which makes the avatar click-through and semi-transparent.',
    input_schema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', description: 'true to enable passive mode, false to disable it' },
      },
      required: ['enabled'],
    },
  },
  handler: async (args) => {
    await togglePassive(!!args.enabled);
    return { passive: isPassiveMode() };
  },
};
