// Preload script — única ponte entre o renderer (web app) e o Node/Electron.
// contextBridge expõe APENAS o que o app precisa, nada de Node bruto.

const { contextBridge, ipcRenderer } = require("electron");

let notificationState = { background: true, supported: true };
ipcRenderer.on("prestativa:notification-state", (_event, state) => { notificationState = state; });
void ipcRenderer.invoke("prestativa:notification-state").then(state => { notificationState = state; }).catch(() => {});

contextBridge.exposeInMainWorld("prestativaDesktop", {
  isDesktop: true,
  platform: process.platform,
  notifications: {
    getState: () => ({ ...notificationState }),
    show: payload => ipcRenderer.invoke("prestativa:notification-show", payload),
    focus: () => ipcRenderer.invoke("prestativa:notification-focus"),
    clear: () => ipcRenderer.invoke("prestativa:notification-clear"),
    onClick(callback) {
      const listener = (_event, tag) => { if (typeof tag === "string") callback(tag); };
      ipcRenderer.on("prestativa:notification-click", listener);
      return () => ipcRenderer.removeListener("prestativa:notification-click", listener);
    },
  },

  async getAppVersion() {
    return await ipcRenderer.invoke("prestativa:get-app-version");
  },

  // Devolve só o sourceId — o getUserMedia precisa rodar no renderer (main world),
  // porque MediaStream não atravessa o contextBridge entre worlds isolados.
  async getScreenSourceId() {
    return await ipcRenderer.invoke("prestativa:get-screen-source-id");
  },
});
