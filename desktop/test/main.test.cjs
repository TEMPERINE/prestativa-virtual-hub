const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Electron APIs need a Windows UI; execute the real main process with host adapters.
async function boot(url) {
  const handlers = {};
  const external = [];
  let loaded;
  let picks = 0;
  const webContents = {
    getURL: () => loaded,
    on: (event, fn) => { handlers[event] = fn; },
    setWindowOpenHandler: fn => { handlers.open = fn; },
  };
  class BrowserWindow {
    constructor() { this.webContents = webContents; }
    loadURL(value) { loaded = value; }
  }
  const session = {
    setPermissionRequestHandler: fn => { handlers.permission = fn; },
    setPermissionCheckHandler: fn => { handlers.check = fn; },
    setDisplayMediaRequestHandler: fn => { handlers.display = fn; },
  };
  const electron = {
    app: { requestSingleInstanceLock: () => true, on() {}, whenReady: () => Promise.resolve(), getVersion: () => '1.0.7' },
    BrowserWindow, session: { defaultSession: session },
    ipcMain: { handle() {} }, desktopCapturer: {},
    shell: { openExternal: value => external.push(value) },
  };
  const log = { transports: { file: {} }, info() {}, error() {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8'), {
    require: name => ({ electron, 'electron-log': log, 'electron-updater': { autoUpdater: { on() {} } },
      './picker.cjs': { pickSource: async () => { picks++; return { id: 'screen:1' }; } }, path })[name],
    __dirname: path.join(__dirname, '../electron'), URL,
    process: { env: url ? { PRESTATIVA_URL: url } : {}, platform: 'win32' },
    setTimeout() {}, setInterval() {},
  });
  await Promise.resolve();
  return { handlers, external, webContents, loaded, picks: () => picks };
}

test('loads canonical production and keeps post-login navigation inside desktop', async () => {
  const app = await boot();
  assert.equal(app.loaded, 'https://prestativaoffice.com.br');
  let prevented = false;
  app.handlers['will-navigate']({ preventDefault: () => { prevented = true; } }, 'https://prestativaoffice.com.br/workspaces');
  assert.equal(prevented, false);
  assert.deepEqual(app.external, []);
});

test('denies foreign-frame media and allows explicit Office notification requests', async () => {
  const app = await boot();
  const request = (permission, requestingUrl) => {
    let result;
    app.handlers.permission(app.webContents, permission, value => { result = value; }, { requestingUrl, mediaTypes: ['audio'] });
    return result;
  };
  assert.equal(request('media', 'https://foreign.example/frame'), false);
  assert.equal(request('notifications', 'https://prestativaoffice.com.br/workspaces'), true);
  assert.equal(request('geolocation', 'https://prestativaoffice.com.br'), false);
  assert.equal(app.handlers.check(null, 'notifications', 'https://foreign.example', {}), false);
});

test('foreign display capture is denied before showing the picker', async () => {
  const app = await boot();
  let result;
  await app.handlers.display({ securityOrigin: 'https://foreign.example' }, value => { result = value; });
  assert.deepEqual(Object.keys(result), []);
  assert.equal(app.picks(), 0);
});

test('trusted sharing still requires picker and preview remains isolated', async () => {
  const app = await boot('https://preview.example');
  assert.equal(app.loaded, 'https://preview.example');
  let result;
  await app.handlers.display({ securityOrigin: 'https://preview.example' }, value => { result = value; });
  assert.equal(app.picks(), 1);
  assert.equal(result.video.id, 'screen:1');
  assert.equal(app.handlers.check(null, 'media', 'https://prestativaoffice.com.br', { mediaType: 'audio' }), false);
});
