# Gravação no app desktop (Electron / Windows)

No navegador, a API `getDisplayMedia` **obriga** o diálogo "Compartilhar
esta aba?". Tratamos esse diálogo como a própria confirmação de gravação
(clique único). No app desktop, podemos gravar **sem nenhum diálogo**.

O código em `src/lib/meetings/useMeetingRecorder.ts` já detecta o ambiente
desktop via `window.prestativaDesktop?.getScreenStream()`. Basta o app
Electron expor essa função no preload — nada mais muda no front.

## Passo 1 — `electron/main.cjs`

```js
const { app, BrowserWindow, desktopCapturer, ipcMain, session } = require("electron");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadURL("https://prestativa-virtual-hub.lovable.app"); // ou file:// do build
}

// Handler de seleção automática da janela do próprio app — sem diálogo.
app.whenReady().then(() => {
  session.defaultSession.setDisplayMediaRequestHandler((_req, callback) => {
    desktopCapturer.getSources({ types: ["window", "screen"] }).then((sources) => {
      const own = sources.find((s) => s.name.includes("Prestativa")) ?? sources[0];
      callback({ video: own, audio: "loopback" }); // loopback = áudio do sistema
    });
  });
  createWindow();
});

ipcMain.handle("get-screen-source-id", async () => {
  const sources = await desktopCapturer.getSources({ types: ["window", "screen"] });
  const own = sources.find((s) => s.name.includes("Prestativa")) ?? sources[0];
  return own.id;
});
```

## Passo 2 — `electron/preload.cjs`

```js
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("prestativaDesktop", {
  async getScreenStream() {
    const sourceId = await ipcRenderer.invoke("get-screen-source-id");
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: { chromeMediaSource: "desktop" }, // áudio do sistema
      },
      video: {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: sourceId,
          maxFrameRate: 15,
          maxWidth: 1920,
          maxHeight: 1080,
        },
      },
    });
  },
});
```

## Passo 3 — empacotar

Seguir o card `electron-desktop-app` deste workspace:

```bash
bun add -d electron @electron/packager
npx vite build
npx @electron/packager . "Prestativa" --platform=win32 --arch=x64 \
  --out=electron-release --overwrite
```

## Resultado

- Browser: 1 clique no diálogo "Compartilhar esta aba?" = começa a gravar.
- Desktop (Windows): clica em **Gravar** → grava imediatamente, sem diálogo,
  com áudio do sistema + mic + peers, exatamente como hoje.
