// Presentation only: this module never owns invites, RTC, or avatar movement.
function setupDesktopNotifications({ Notification, ipcMain, getWindow, isAllowedAppUrl, log }) {
  const alerts = new Map();
  const window = () => {
    const w = getWindow();
    return w && !w.isDestroyed() ? w : null;
  };
  const trusted = (event) => {
    const w = window();
    return !!w && event.sender === w.webContents &&
      event.senderFrame === w.webContents.mainFrame && isAllowedAppUrl(event.senderFrame?.url);
  };
  const state = () => {
    const w = window();
    return { supported: Notification.isSupported(), background: !w || w.isMinimized() || !w.isVisible() || !w.isFocused() };
  };
  function focus() {
    const w = window();
    if (!w) return false; // Never create a new window/instance for a notification.
    if (w.isMinimized()) w.restore();
    w.show();
    w.focus();
    w.flashFrame(false);
    return true;
  }
  function clear() {
    for (const note of alerts.values()) note.close();
    alerts.clear();
    window()?.flashFrame(false);
  }
  ipcMain.handle("prestativa:notification-state", (event) => trusted(event) ? state() : { supported: false, background: true });
  ipcMain.handle("prestativa:notification-focus", (event) => trusted(event) && focus());
  ipcMain.handle("prestativa:notification-clear", (event) => { if (trusted(event)) clear(); });
  ipcMain.handle("prestativa:notification-show", (event, payload) => {
    if (!trusted(event) || !state().background) return false;
    if (!payload || typeof payload.tag !== "string" || payload.tag.length > 160 ||
      !/^(join|follow)-[\w-]+$/.test(payload.tag) || typeof payload.body !== "string" || payload.body.length > 500) return false;
    const w = window();
    log.info("desktop-notify:requested", { minimized: w.isMinimized(), visible: w.isVisible(), focused: w.isFocused() });
    w.flashFrame(true);
    if (!Notification.isSupported()) { log.warn("desktop-notify:unsupported"); return false; }
    const previous = alerts.get(payload.tag);
    previous?.close();
    const note = new Notification({ title: "Prestativa Office", body: payload.body, silent: payload.silent === true, timeoutType: "never" });
    alerts.set(payload.tag, note);
    // Bound presentation objects only; pending invitations stay in JoinInviteCenter.
    if (alerts.size > 100) {
      const oldest = alerts.keys().next().value;
      alerts.get(oldest)?.close(); alerts.delete(oldest);
    }
    note.on("click", () => {
      // A replaced/dismissed alert must never reveal a stale workspace invitation.
      if (alerts.get(payload.tag) !== note) return;
      if (focus()) window().webContents.send("prestativa:notification-click", payload.tag);
      alerts.delete(payload.tag);
      note.close();
      log.info("desktop-notify:clicked");
    });
    note.on("failed", (_event, error) => {
      if (alerts.get(payload.tag) === note) alerts.delete(payload.tag);
      log.error("desktop-notify:failed", String(error).slice(0, 250));
    });
    note.on("show", () => log.info("desktop-notify:shown"));
    note.show();
    return true;
  });
  const w = window();
  for (const event of ["minimize", "restore", "show", "hide", "focus", "blur"]) {
    w.on(event, () => {
      if (event === "focus") w.flashFrame(false);
      if (!w.isDestroyed()) w.webContents.send("prestativa:notification-state", state());
    });
  }
  // Reload/navigation replaces the renderer that owns the pending invitations.
  w.webContents.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) clear();
  });
  w.webContents.on("render-process-gone", clear);
  w.on("closed", clear);
  return { focus };
}
module.exports = { setupDesktopNotifications };
