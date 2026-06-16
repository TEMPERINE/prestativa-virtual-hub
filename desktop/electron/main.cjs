// Virtual Office — Electron main process
// Boas práticas: contextIsolation + nodeIntegration:false + sandbox + CSP.
// Carrega a URL publicada (web app) e adiciona capacidades nativas via preload.

const { app, BrowserWindow, desktopCapturer, ipcMain, session, shell } = require("electron");
const path = require("path");
const log = require("electron-log");
const { autoUpdater } = require("electron-updater");
const { pickSource } = require("./picker.cjs");

// ============================================================
// Config
// ============================================================
const APP_URL =
  process.env.PRESTATIVA_URL || "https://prestativa-virtual-hub.lovable.app";

log.transports.file.level = "info";
autoUpdater.logger = log;
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

let mainWindow = null;

// ============================================================
// Janela principal
// ============================================================
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: "#0b0b12",
    title: "Virtual Office",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  // Abrir links externos no navegador padrão, nunca em janela Electron nova.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (u.origin !== new URL(APP_URL).origin) {
        shell.openExternal(url);
        return { action: "deny" };
      }
    } catch {
      return { action: "deny" };
    }
    return { action: "deny" };
  });

  // Bloquear navegação para fora do domínio do app.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    try {
      const u = new URL(url);
      if (u.origin !== new URL(APP_URL).origin) {
        event.preventDefault();
        shell.openExternal(url);
      }
    } catch {
      event.preventDefault();
    }
  });

  mainWindow.loadURL(APP_URL);
}

// ============================================================
// getDisplayMedia
// - Gravação da reunião usa IPC dedicado `prestativa:get-screen-source-id`
//   (captura direto a janela do Prestativa, sem seletor).
// - Compartilhamento de tela na chamada usa `navigator.mediaDevices.getDisplayMedia`
//   e SEMPRE abre o seletor de telas/janelas (estilo Windows) antes de
//   compartilhar. Nunca compartilha automaticamente.
//   Obs.: o Electron 32 não expõe o picker nativo do SO no Windows, então o
//   seletor é a janela do Prestativa com miniaturas de todas as telas/janelas.
function setupDisplayMediaHandler() {
  const ses = session.defaultSession;
  log.info("display-media-picker:setup", { appVersion: app.getVersion() });

  ses.setDisplayMediaRequestHandler(async (_request, callback) => {
    log.info("display-media-picker:request — abrindo seletor");
    try {
      const source = await pickSource(mainWindow);
      if (!source) {
        // Usuário cancelou — nega o compartilhamento.
        callback({});
        return;
      }
      log.info("display-media-picker:picked", { id: source.id, name: source.name });
      callback({ video: source, audio: "loopback" });
    } catch (err) {
      log.error("display-media-picker", err);
      callback({});
    }
  });
}

function setupMediaPermissions() {
  const ses = session.defaultSession;
  const allowedOrigin = new URL(APP_URL).origin;

  const isAllowedAppUrl = (url) => {
    try {
      return new URL(url).origin === allowedOrigin;
    } catch {
      return false;
    }
  };

  const wantsMediaDevice = (details) => {
    const mediaTypes = details?.mediaTypes ?? [];
    const mediaType = details?.mediaType;
    return mediaTypes.includes("audio") || mediaTypes.includes("video") || mediaType === "audio" || mediaType === "video";
  };

  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (permission === "media" && isAllowedAppUrl(webContents.getURL())) {
      callback(wantsMediaDevice(details));
      return;
    }
    callback(false);
  });

  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
    const origin = details?.securityOrigin || requestingOrigin;
    if (permission !== "media" || !isAllowedAppUrl(origin)) return false;
    return wantsMediaDevice(details);
  });
}

ipcMain.handle("prestativa:get-screen-source-id", async () => {
  const sources = await desktopCapturer.getSources({
    types: ["window", "screen"],
  });
  const own =
    sources.find((s) => s.name.includes("Virtual Office") || s.name.includes("Prestativa")) ?? sources[0];
  return own ? own.id : null;
});

ipcMain.handle("prestativa:get-app-version", () => app.getVersion());

// ============================================================
// Auto-update
// ============================================================
function setupAutoUpdate() {
  autoUpdater.on("update-available", (info) => {
    log.info("update-available", info.version);
  });
  autoUpdater.on("update-downloaded", (info) => {
    log.info("update-downloaded", info.version);
  });
  autoUpdater.on("error", (err) => log.error("updater-error", err));

  // Checa após 5s do boot e a cada 6h.
  setTimeout(() => autoUpdater.checkForUpdatesAndNotify().catch(() => {}), 5000);
  setInterval(
    () => autoUpdater.checkForUpdatesAndNotify().catch(() => {}),
    6 * 60 * 60 * 1000,
  );
}

// ============================================================
// Lifecycle
// ============================================================
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    setupMediaPermissions();
    setupDisplayMediaHandler();
    createWindow();
    setupAutoUpdate();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
