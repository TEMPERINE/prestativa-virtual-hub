const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

test('preload exposes narrow native bridge, strips IPC event and unsubscribes', async () => {
  const ipc = new EventEmitter();
  const calls = [];
  ipc.invoke = async (channel, payload) => {
    calls.push([channel, payload]);
    if (channel === 'prestativa:notification-state') return { background: false, supported: true };
    return true;
  };
  let bridge;
  vm.runInNewContext(readFileSync(join(__dirname, '../electron/preload.cjs'), 'utf8'), {
    require: () => ({ ipcRenderer: ipc, contextBridge: { exposeInMainWorld: (_name, exposed) => { bridge = exposed; } } }),
    process: { platform: 'win32' },
  });
  await Promise.resolve();
  assert.equal(bridge.notifications.getState().background, false);
  ipc.emit('prestativa:notification-state', {}, { background: true, supported: true });
  assert.equal(bridge.notifications.getState().background, true);
  const clicks = [];
  const off = bridge.notifications.onClick((...args) => clicks.push(args));
  ipc.emit('prestativa:notification-click', { sender: 'privileged' }, 'join-ana');
  assert.deepEqual(clicks, [['join-ana']]);
  off(); ipc.emit('prestativa:notification-click', {}, 'join-ana');
  assert.equal(clicks.length, 1);
  await bridge.notifications.show({ tag: 'join-ana' });
  await bridge.notifications.focus();
  assert.deepEqual(calls.slice(-2).map(([name]) => name), ['prestativa:notification-show', 'prestativa:notification-focus']);
});
