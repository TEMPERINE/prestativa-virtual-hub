// Prestativa Virtual Office — Electron main process
// Boas práticas: contextIsolation + nodeIntegration:false + sandbox + CSP.
// Carrega a URL publicada (web app) e adiciona capacidades nativas via preload.

const { app, BrowserWindow, desktopCapturer, ipcMain, session, shell } = require("electron");
const path = require("path");
const log = require("electron-log");
const { autoUpdater } = require("electron-updater");

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
    title: "Prestativa Virtual",
    icon: path.join(__dirname, "..", "build", "icon.ico"),
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
// getDisplayMedia sem diálogo — usado por useMeetingRecorder
// ============================================================
function setupDisplayMediaHandler() {
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ["window", "screen"] })
        .then((sources) => {
          const own =
            sources.find((s) => s.name.includes("Prestativa")) ?? sources[0];
          callback({ video: own, audio: "loopback" });
        })
        .catch(() => callback({}));
    },
    { useSystemPicker: false },
  );
}

ipcMain.handle("prestativa:get-screen-source-id", async () => {
  const sources = await desktopCapturer.getSources({
    types: ["window", "screen"],
  });
  const own =
    sources.find((s) => s.name.includes("Prestativa")) ?? sources[0];
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
