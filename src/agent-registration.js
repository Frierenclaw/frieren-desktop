import { authedFetch } from './auth.js';
import { getClientId } from './client-id.js';
import { buildManifest } from './agent-tools.js';
import { getAppVersion } from './electron-ipc.js';

export async function registerClientFunctions(baseUrl) {
  const client_id = await getClientId();
  const app_version = await getAppVersion();
  const functions = buildManifest();

  const payload = {
    client: { id: client_id, app_version },
    functions,
  };

  console.debug('[agent] registering client', payload);

  const res = await authedFetch(`${baseUrl}/api/v1/client/`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to register client functions (${res.status}): ${body}`);
  }

  return res.json().catch(() => ({}));
}