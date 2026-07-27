import { registerFunction } from '../agent-tools.js';

// Every file matching ./*.plugin.js in this folder is picked up automatically.
// Drop a new file in, it gets registered, no edits needed anywhere else.
const modules = import.meta.glob('./*.plugin.js', { eager: true });

export function loadAgentPlugins() {
  const loaded = [];

  for (const [filePath, mod] of Object.entries(modules)) {
    const plugin = mod.default;
    if (!plugin?.spec?.name || typeof plugin.handler !== 'function') {
      console.warn(`[agent-plugins] Skipping invalid plugin at ${filePath}`);
      continue;
    }
    registerFunction(plugin.spec, plugin.handler);
    loaded.push(plugin.spec.name);
  }

  console.debug('[agent-plugins] Loaded:', loaded);
  return loaded;
}
