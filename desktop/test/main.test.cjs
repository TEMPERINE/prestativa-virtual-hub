const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { EventEmitter } = require('node:events');

// Electron APIs need a Windows UI; execute the real main process with host adapters.
async function boot(url, state = {}) {
  const handlers = {};
  const external = [];
  const notifications = [];
  const sent = [];
  let windowCount = 0;
  let quits = 0;
  let appId;
  const windowState = { minimized: false, visible: true, focused: true, ...state };
  handlers.app = {};
  handlers.window = {};
  const mainFrame = { get url() { return loaded; } };
  let loaded;
  let picks = 0;
  const webContents = {
    getURL: () => loaded,
    mainFrame,
    isDestroyed: () => false,
    send: (...args) => sent.push(args),
    on: (event, fn) => { handlers[event] = fn; },
    setWindowOpenHandler: fn => { handlers.open = fn; },
  };
  class BrowserWindow {
    constructor() { this.webContents = webContents; windowCount++; }
    on(event, fn) { handlers.window[event] = fn; }
    isDestroyed() { return false; }
    isMinimized() { return windowState.minimized; }
    isVisible() { return windowState.visible; }
    isFocused() { return windowState.focused; }
    restore() { windowState.minimized = false; }
    show() { windowState.visible = true; }
    focus() { windowState.focused = true; }
    flashFrame(value) { windowState.flash = value; }
    loadURL(value) { loaded = value; }
  }
  const session = {
    setPermissionRequestHandler: fn => { handlers.permission = fn; },
    setPermissionCheckHandler: fn => { handlers.check = fn; },
    setDisplayMediaRequestHandler: fn => { handlers.display = fn; },
  };
  class Notification extends EventEmitter {
    static isSupported() { return state.supported !== false; }
    constructor(options) { super(); this.options = options; notifications.push(this); }
    show() { this.shown = true; this.emit('show'); }
    close() { this.emit('close'); }
  }
  const electron = {
    app: { requestSingleInstanceLock: () => state.lock !== false, on: (event, fn) => { handlers.app[event] = fn; }, whenReady: () => Promise.resolve(), getVersion: () => '1.0.8', quit: () => { quits++; }, setAppUserModelId: value => { appId = value; } },
    BrowserWindow, Notification, session: { defaultSession: session },
    ipcMain: { handle: (name, fn) => { handlers[name] = fn; } }, desktopCapturer: {},
    shell: { openExternal: value => external.push(value) },
  };
  const log = { transports: { file: {} }, info() {}, warn() {}, error() {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8'), {
    require: name => ({ electron, 'electron-log': log, 'electron-updater': { autoUpdater: { on() {} } },
      './notifications.cjs': fs.existsSync(path.join(__dirname, '../electron/notifications.cjs')) ? require('../electron/notifications.cjs') : undefined,
      './picker.cjs': { pickSource: async () => { picks++; return { id: 'screen:1' }; } }, path })[name],
    __dirname: path.join(__dirname, '../electron'), URL,
    process: { env: url ? { PRESTATIVA_URL: url } : {}, platform: 'win32' },
    setTimeout() {}, setInterval() {},
  });
  await Promise.resolve();
  return { handlers, external, webContents, loaded, picks: () => picks, notifications, sent, windowState, count: () => windowCount, quits: () => quits, appId: () => appId, event: { sender: webContents, senderFrame: mainFrame } };
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

test('background Office uses native notification and flashes taskbar', async () => {
  for (const state of [{ minimized: true, visible: false }, { focused: false }]) {
    const app = await boot(undefined, state);
    assert.equal(typeof app.handlers['prestativa:notification-show'], 'function');
    assert.equal(app.handlers['prestativa:notification-show'](app.event, { title: 'Prestativa Office', body: 'Ana está chamando você para se juntar a ele.', tag: 'join-ana', silent: false }), true);
    assert.equal(app.notifications.length, 1);
    assert.equal(app.notifications[0].options.title, 'Prestativa Office');
    assert.equal(app.notifications[0].options.body, 'Ana está chamando você para se juntar a ele.');
    assert.equal(app.notifications[0].shown, true);
    assert.equal(app.windowState.flash, true);
    assert.equal(app.appId(), 'com.prestativa.virtualoffice');
  }
});

test('focused Office suppresses native toast even if renderer state is stale', async () => {
  const app = await boot();
  assert.equal(typeof app.handlers['prestativa:notification-show'], 'function');
  assert.equal(app.handlers['prestativa:notification-show'](app.event, { title: 'Prestativa Office', body: 'Call', tag: 'join-ana' }), false);
  assert.equal(app.notifications.length, 0);
});

test('native click restores existing window and sends only tag through IPC', async () => {
  const app = await boot(undefined, { minimized: true, visible: false, focused: false });
  assert.equal(typeof app.handlers['prestativa:notification-show'], 'function');
  app.handlers['prestativa:notification-show'](app.event, { title: 'Prestativa Office', body: 'Call', tag: 'join-ana' });
  app.notifications[0].emit('click');
  assert.equal(app.windowState.minimized, false);
  assert.equal(app.windowState.visible, true);
  assert.equal(app.windowState.focused, true);
  assert.equal(app.windowState.flash, false);
  assert.equal(app.count(), 1);
  assert.deepEqual(app.external, []);
  assert.equal(app.loaded, 'https://prestativaoffice.com.br');
  assert.deepEqual(app.sent.filter(([channel]) => channel === 'prestativa:notification-click'), [['prestativa:notification-click', 'join-ana']]);
});

test('notification IPC rejects foreign frames and other webContents', async () => {
  const app = await boot(undefined, { focused: false });
  assert.equal(typeof app.handlers['prestativa:notification-show'], 'function');
  const payload = { title: 'Prestativa Office', body: 'Call', tag: 'join-ana' };
  assert.equal(app.handlers['prestativa:notification-show']({ sender: {}, senderFrame: app.event.senderFrame }, payload), false);
  assert.equal(app.handlers['prestativa:notification-show']({ sender: app.webContents, senderFrame: { url: 'https://foreign.example' } }, payload), false);
  assert.equal(app.notifications.length, 0);
});

test('single instance restores existing window and refused lock creates no window', async () => {
  const app = await boot(undefined, { minimized: true, visible: false, focused: false });
  app.handlers.app['second-instance']();
  assert.equal(app.count(), 1);
  assert.equal(app.windowState.visible, true);
  assert.equal(app.windowState.minimized, false);
  assert.equal(app.windowState.focused, true);
  const refused = await boot(undefined, { lock: false });
  assert.equal(refused.count(), 0);
  assert.equal(refused.quits(), 1);
});

test('same-origin worker popup does not open browser; cross-origin popup does', async () => {
  const app = await boot();
  assert.equal(app.handlers.open({ url: 'https://prestativaoffice.com.br/office' }).action, 'deny');
  assert.deepEqual(app.external, []);
  app.handlers.open({ url: 'https://www.prestativaoffice.com.br/office' });
  assert.deepEqual(app.external, ['https://www.prestativaoffice.com.br/office']);
});


test('unsupported native notifications still flash the existing taskbar entry', async () => {
  const app = await boot(undefined, { focused: false, supported: false });
  assert.equal(app.handlers['prestativa:notification-show'](app.event, { body: 'Call', tag: 'join-ana' }), false);
  assert.equal(app.windowState.flash, true);
  assert.equal(app.notifications.length, 0);
  assert.deepEqual(app.external, []);
});

test('renderer replacement clears old notifications; in-place navigation preserves them', async () => {
  const app = await boot(undefined, { focused: false });
  app.handlers['prestativa:notification-show'](app.event, { body: 'Call', tag: 'join-ana' });
  app.handlers['did-start-navigation']({}, app.loaded, true, true);
  assert.equal(app.windowState.flash, true);
  app.handlers['did-start-navigation']({}, app.loaded, false, true);
  assert.equal(app.windowState.flash, false);
  app.notifications[0].emit('click');
  assert.deepEqual(app.sent.filter(([channel]) => channel === 'prestativa:notification-click'), []);
  assert.equal(app.windowState.focused, false);
});
