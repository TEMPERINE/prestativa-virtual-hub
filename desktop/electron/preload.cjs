// Preload script — única ponte entre o renderer (web app) e o Node/Electron.
// contextBridge expõe APENAS o que o app precisa, nada de Node bruto.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("prestativaDesktop", {
  isDesktop: true,
  platform: process.platform,

  async getAppVersion() {
    return await ipcRenderer.invoke("prestativa:get-app-version");
  },

  // Usado por src/lib/meetings/useMeetingRecorder.ts — grava tela
  // sem mostrar o diálogo "Compartilhar esta janela?" do navegador.
  async getScreenStream() {
    const sourceId = await ipcRenderer.invoke(
      "prestativa:get-screen-source-id",
    );
    if (!sourceId) throw new Error("no-screen-source");
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: { chromeMediaSource: "desktop" },
      },
      video: {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: sourceId,
          maxFrameRate: 30,
          maxWidth: 1920,
          maxHeight: 1080,
        },
      },
    });
  },
});
