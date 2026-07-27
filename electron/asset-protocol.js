import { protocol, net } from 'electron';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'frieren-asset',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

export function registerAssetProtocol() {
  protocol.handle('frieren-asset', (request) => {
    const url = new URL(request.url);
    let filePath = decodeURIComponent(url.pathname);

    if (process.platform === 'win32' && /^\/[A-Za-z]:/.test(filePath)) {
      filePath = filePath.slice(1);
    }

    return net.fetch(`file://${filePath}`);
  });
}
