# Prestativa Virtual — Desktop (Windows)

Casca **Electron** que empacota o app web em um `.exe` instalável,
com **gravação de tela sem diálogo** e **auto-update** via GitHub Releases.

> ⚠️ Este diretório é independente do app web. Você deve copiá-lo para
> um **repositório GitHub separado** (sugestão: `prestativa-virtual-desktop`)
> e rodar o build em uma máquina Windows ou via GitHub Actions.

---

## Estrutura

```
desktop/
├── package.json          # deps Electron + scripts
├── electron/
│   ├── main.cjs          # processo principal (janela, auto-update, displayMedia)
│   └── preload.cjs       # ponte segura → window.prestativaDesktop
├── build/
│   └── icon.ico          # (coloque aqui o ícone 256x256 multi-resolução)
└── README.md
```

---

## Setup inicial (uma vez)

```bash
cd desktop
npm install
```

### Ícone
Gere `build/icon.ico` (256x256, multi-resolução) a partir de
`src/assets/prestativa-icon.png`. No Linux:
```bash
nix run nixpkgs#imagemagick -- convert prestativa-icon.png -define icon:auto-resize=256,128,64,48,32,16 build/icon.ico
```

---

## Rodar em modo dev

```bash
npm start
```

Abre uma janela carregando `https://prestativa-virtual-hub.lovable.app`.
Para testar contra outro ambiente:
```bash
PRESTATIVA_URL=https://id-preview--xxx.lovable.app npm start
```

---

## Build do instalador Windows (.exe NSIS)

Em uma máquina **Windows** (ou GitHub Actions com runner `windows-latest`):

```bash
npm run dist:win
```

Saída em `dist/`:
- `Prestativa Virtual Setup X.Y.Z.exe` — instalador
- `latest.yml` — manifesto para o auto-updater

Para apenas empacotar sem instalador (mais rápido, gera pasta portável):
```bash
npm run pack:win
```

---

## Auto-update (GitHub Releases)

1. Crie um repositório GitHub (privado ou público) com este diretório.
2. Edite `package.json` → `build.publish`:
   ```json
   "owner": "SEU_USUARIO_GITHUB",
   "repo": "prestativa-virtual-desktop"
   ```
3. Crie um Personal Access Token (classic) com escopo `repo`
   e exporte como `GH_TOKEN`.
4. Bump da versão em `package.json` → `"version": "0.1.1"` etc.
5. Rode `npm run dist:win`. O `--publish always` faz upload pra
   GitHub Releases automaticamente como **draft**.
6. No GitHub, marque a release como **Published** quando estiver pronto.

Apps instalados checam updates no boot (5s após abrir) e a cada 6h.
Baixam em background e instalam ao fechar/reabrir.

---

## CI/CD recomendado — `.github/workflows/release.yml`

```yaml
name: Release Desktop
on:
  push:
    tags: ["v*"]
jobs:
  release:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - run: npm ci
      - run: npm run dist:win
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Tag → release automática. Bump `package.json`, commit, `git tag v0.1.1 && git push --tags`.

---

## Segurança aplicada

- `contextIsolation: true` — renderer não acessa Node direto
- `nodeIntegration: false` — sem `require` no front
- `sandbox: true`
- `allowRunningInsecureContent: false`
- Carrega apenas HTTPS do domínio configurado em `APP_URL`
- `will-navigate` e `setWindowOpenHandler` bloqueiam navegação externa,
  abrindo no browser padrão
- Single-instance lock (não abre duas janelas)
- Auto-updater verifica assinatura criptográfica do manifesto antes de instalar
- Preload expõe **apenas** `getAppVersion` e `getScreenStream`

---

## Code signing (opcional, recomendado pós-beta)

Sem assinatura digital, o Windows SmartScreen mostra
"Editor desconhecido — Mais informações → Executar mesmo assim".

Para assinar, obtenha um certificado **OV** (~US$ 100/ano) ou **EV**
(~US$ 300/ano, sem warm-up) e configure:

```bash
set CSC_LINK=caminho/certificado.pfx
set CSC_KEY_PASSWORD=sua_senha
npm run dist:win
```

`electron-builder` assina o `.exe` e o manifesto de update automaticamente.
