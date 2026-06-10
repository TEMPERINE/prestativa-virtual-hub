// In-app screen/window picker for getDisplayMedia.
// Mostra uma janela modal com miniaturas; resolve com o source escolhido.

const { BrowserWindow, desktopCapturer, ipcMain } = require("electron");
const path = require("path");

let pickerWindow = null;
let pendingResolve = null;

function buildHtml(sources) {
  const items = sources
    .map(
      (s) => `
      <button class="card" data-id="${s.id}">
        <img src="${s.thumbnail.toDataURL()}" alt="" />
        <div class="label">${escapeHtml(s.name)}</div>
        <div class="kind">${s.id.startsWith("screen:") ? "Tela" : "Janela"}</div>
      </button>`,
    )
    .join("");

  return `<!doctype html>
<html><head><meta charset="utf-8" />
<title>Compartilhar tela</title>
<style>
  *{box-sizing:border-box}
  html,body{margin:0;height:100%;background:#0b0b12;color:#fff;font-family:system-ui,Segoe UI,Roboto,sans-serif}
  header{padding:14px 18px;border-bottom:1px solid #ffffff14;display:flex;align-items:center;justify-content:space-between}
  header h1{font-size:14px;font-weight:600;margin:0}
  header button{background:#ffffff14;color:#fff;border:0;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:12px}
  header button:hover{background:#ffffff22}
  main{padding:14px;display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;overflow:auto;height:calc(100% - 50px)}
  .card{background:#181826;border:1px solid #ffffff14;border-radius:10px;padding:8px;cursor:pointer;color:#fff;text-align:left;display:flex;flex-direction:column;gap:6px}
  .card:hover{border-color:#7c3aed;background:#1f1f30}
  .card img{width:100%;height:140px;object-fit:contain;background:#000;border-radius:6px}
  .label{font-size:12px;font-weight:500;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .kind{font-size:10px;color:#ffffff80;text-transform:uppercase;letter-spacing:.05em}
</style></head>
<body>
<header>
  <h1>Escolha o que compartilhar</h1>
  <button id="cancel">Cancelar</button>
</header>
<main>${items || '<div style="padding:20px;opacity:.7">Nenhuma fonte disponível</div>'}</main>
<script>
  const { ipcRenderer } = require('electron');
  document.querySelectorAll('.card').forEach(el => {
    el.addEventListener('click', () => {
      ipcRenderer.send('prestativa:picker-pick', el.dataset.id);
    });
  });
  document.getElementById('cancel').addEventListener('click', () => {
    ipcRenderer.send('prestativa:picker-pick', null);
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') ipcRenderer.send('prestativa:picker-pick', null);
  });
</script>
</body></html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

ipcMain.on("prestativa:picker-pick", (_e, id) => {
  if (pendingResolve) {
    const resolve = pendingResolve;
    pendingResolve = null;
    resolve(id);
  }
  if (pickerWindow) {
    pickerWindow.close();
    pickerWindow = null;
  }
});

async function pickSource(parent) {
  if (pickerWindow) {
    pickerWindow.focus();
    return null;
  }
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 320, height: 200 },
    fetchWindowIcons: false,
  });

  const id = await new Promise((resolve) => {
    pendingResolve = resolve;
    pickerWindow = new BrowserWindow({
      width: 880,
      height: 600,
      parent: parent ?? undefined,
      modal: !!parent,
      resizable: true,
      minimizable: false,
      maximizable: false,
      title: "Compartilhar tela — Prestativa",
      backgroundColor: "#0b0b12",
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: false,
        nodeIntegration: true,
        sandbox: false,
      },
    });
    pickerWindow.removeMenu();
    pickerWindow.on("closed", () => {
      pickerWindow = null;
      if (pendingResolve) {
        const r = pendingResolve;
        pendingResolve = null;
        r(null);
      }
    });

    const html = buildHtml(sources);
    pickerWindow.loadURL(
      "data:text/html;charset=utf-8," + encodeURIComponent(html),
    );
  });

  if (!id) return null;
  return sources.find((s) => s.id === id) ?? null;
}

module.exports = { pickSource };
