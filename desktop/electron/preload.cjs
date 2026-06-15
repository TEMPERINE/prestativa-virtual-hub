// Preload script — única ponte entre o renderer (web app) e o Node/Electron.
// contextBridge expõe APENAS o que o app precisa, nada de Node bruto.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("prestativaDesktop", {
  isDesktop: true,
  platform: process.platform,

  async getAppVersion() {
    return await ipcRenderer.invoke("prestativa:get-app-version");
  },

  // Devolve só o sourceId — o getUserMedia precisa rodar no renderer (main world),
  // porque MediaStream não atravessa o contextBridge entre worlds isolados.
  async getScreenSourceId() {
    return await ipcRenderer.invoke("prestativa:get-screen-source-id");
  },
});
