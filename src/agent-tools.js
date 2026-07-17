const _registry = new Map();
let _playAnimationHandler = null;

export function registerFunction(spec, handler) {
  if (!spec?.name) throw new Error('registerFunction: spec.name is required');
  _registry.set(spec.name, { spec, handler });
}

export function unregisterFunction(name) {
  _registry.delete(name);
}

export function buildManifest() {
  return [..._registry.values()].map(({ spec }) => ({
    name: spec.name,
    description: spec.description,
    input_schema: spec.input_schema,
  }));
}

export function setPlayAnimationHandler(handler) {
  _playAnimationHandler = handler;
}

export async function dispatchToolCall({ call_id, name, arguments: args }) {
  try {
    let result;

    if (name === 'play_animation') {
      if (!_playAnimationHandler) throw new Error('No animation handler registered on this client');
      result = await _playAnimationHandler(args ?? {});
    } else {
      const entry = _registry.get(name);
      if (!entry) throw new Error(`Unknown function: ${name}`);
      result = await entry.handler(args ?? {});
    }

    return { type: 'tool_result', call_id, ok: true, result: result ?? {} };
  } catch (err) {
    return { type: 'tool_result', call_id, ok: false, error: err?.message ?? String(err) };
  }
}