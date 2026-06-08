# Plano: Beta versionado + App Desktop Windows

## Objetivo

1. Congelar este projeto como **beta estável** para sua operação usar.
2. Criar um **projeto separado de testes** (lab) onde você continua experimentando sem afetar usuários.
3. Empacotar o app como **executável Windows (.exe)** estilo Gather, com **auto-update** ao publicar nova versão.

---

## Parte 1 — Estratégia de versionamento

### Ambientes
```text
[Lab Project]  ─── experimentos, quebra à vontade
     │ (você porta o que amadurece)
     ▼
[Beta Project] ─── este projeto, sua operação usa
     │ Publish = nova versão
     ▼
[Desktop App] ─── instalado nos PCs, auto-update
```

### Numeração de versão (SemVer + canal)
- `v0.1.0-beta` → primeira versão pra operação
- `v0.1.1-beta` → bugfix
- `v0.2.0-beta` → nova feature
- `v1.0.0` → quando sair de beta (futuro)

### O que vou fazer neste projeto (beta)
1. Criar `src/lib/version.ts` com versão atual + canal (`beta`).
2. Mostrar **badge de versão** discreto no rodapé (ex: canto do `workspaces.index`) — operação sabe qual versão tá rodando, você sabe pra qual reportar bug.
3. Criar `CHANGELOG.md` na raiz — toda Publish você anota o que mudou.
4. Criar tela `/sobre` (rota) com versão, changelog resumido, link de suporte.

### Sobre o projeto "lab"
Você cria via **Remix** deste projeto (botão na UI do Lovable, não algo que eu faço por código). Ambos compartilham o mesmo banco Supabase **só se você quiser** — recomendo banco separado pra não contaminar dados reais com testes.

---

## Parte 2 — App Desktop Windows (Electron)

### Stack
- **Electron** (mesma base do Gather, VS Code, Slack, Discord)
- **@electron/packager** pra gerar o `.exe` (já validado no template, ver card `electron-desktop-app`)
- **electron-updater** pra auto-update via GitHub Releases (grátis)

### Arquitetura do app desktop
```text
PrestativaVirtual.exe
  └── Electron shell (Chromium + Node)
       ├── carrega https://prestativa-virtual-hub.lovable.app
       ├── preload.cjs → expõe window.prestativaDesktop
       │     ├── getScreenStream()    (gravação sem diálogo)
       │     └── getAppVersion()
       └── auto-updater → checa GitHub Releases ao abrir
```

### Boas práticas de segurança (alinhadas ao que o Gather faz)
- `contextIsolation: true` — renderer não tem acesso direto a Node
- `nodeIntegration: false` — sem `require` no front
- `sandbox: true` no renderer
- `contextBridge.exposeInMainWorld` é a **única** ponte preload→renderer
- CSP no HTML carregado
- Carrega só HTTPS da URL publicada (sem `file://` arbitrário)
- Auto-updates **assinados** (verificação criptográfica antes de instalar)
- Sem `eval`, sem `webview` aberto, sem `allowRunningInsecureContent`

### Code signing (assinatura digital do .exe)
**Sem assinar:** Windows mostra alerta "Editor desconhecido" no SmartScreen — usuário precisa clicar "Mais informações → Executar mesmo assim". Funciona, mas assusta.
**Com assinar:** sem alerta. Custa ~US$ 100/ano (certificado OV) ou ~US$ 300/ano (EV, sem warm-up).

**Recomendação:** começar **sem assinatura** (operação pequena, todos sabem que é seu app). Adicionar certificado quando sair de beta.

### Auto-update via GitHub Releases
1. Você cria repo GitHub privado do desktop wrapper (não precisa colocar o app web lá — só a casca Electron).
2. Toda nova versão: build local → upload do `.exe` + `latest.yml` no GitHub Releases.
3. App instalado checa esse feed no boot, baixa em background, instala no próximo restart.

**Importante:** o **app web** atualiza sozinho (é só recarregar a página) sempre que você clicar Publish neste projeto. O **shell Electron** só precisa de update quando mudar algo na casca (preload, versão do Electron, ícone, etc) — o que é raro.

Ou seja:
- Publish no Lovable → operação recebe nova versão **na próxima vez que abrir o app desktop** (recarrega a URL).
- Nova versão do Electron shell → distribuída via GitHub Releases (raro).

---

## Detalhes técnicos

### Arquivos que vou criar/editar neste projeto (beta)
- `src/lib/version.ts` — constante `APP_VERSION = "0.1.0-beta"`
- `src/components/VersionBadge.tsx` — badge canto inferior
- `src/routes/_authenticated/workspaces.index.tsx` — inserir badge
- `src/routes/sobre.tsx` (público) — página de versão/changelog
- `CHANGELOG.md` — histórico de releases

### Repositório Electron (separado, fora do Lovable)
Vou te entregar os arquivos prontos pra você criar um repo GitHub e rodar localmente:
- `electron/main.cjs` — janela + auto-updater + display media handler
- `electron/preload.cjs` — expõe `window.prestativaDesktop`
- `package.json` — deps (`electron`, `@electron/packager`, `electron-updater`)
- `build-icon.ico` — ícone do app (gero a partir do `prestativa-icon.png` existente)
- `README.md` — passo a passo de build/release

### Comando de build (Windows .exe)
```bash
npm install
npx @electron/packager . "PrestativaVirtual" \
  --platform=win32 --arch=x64 \
  --icon=build-icon.ico \
  --out=release --overwrite
```
Saída: `release/PrestativaVirtual-win32-x64/PrestativaVirtual.exe`.

Pra distribuir um **instalador único** (.exe estilo Gather/NSIS), uso `electron-builder` numa máquina Windows ou via GitHub Actions (Linux/sandbox não consegue gerar NSIS confiável — limitação documentada no card `electron-desktop-app`).

### Sobre o Gather.exe que você enviou
Confirmo que recebi (`/mnt/user-uploads/Gather-1.18.0-Setup_1.exe`, ~95 MB). É um instalador NSIS Electron padrão, code-signed. **Não vou copiar nem extrair nada** — só uso como confirmação de que a arquitetura escolhida (Electron + NSIS + auto-update + signing) é exatamente a do Gather. Boas práticas que vou replicar já listadas acima.

---

## Ordem de execução (quando aprovar)

1. **Versionamento** (rápido, dentro do Lovable) — versão, badge, página /sobre, CHANGELOG.
2. **Publish v0.1.0-beta** — sua operação já pode usar pela web.
3. **Electron shell** — gero os arquivos do app desktop num diretório `desktop/` aqui no projeto pra você baixar e colocar no GitHub.
4. **Primeiro build .exe** — você roda local no Windows (ou eu te entrego instruções pra GitHub Actions buildar).
5. **Auto-update** — configurado apontando pro seu GitHub Releases.

---

## Fora de escopo (decisões futuras)
- macOS / Linux — só Windows agora, conforme você definiu.
- Code signing — quando sair de beta.
- App Store / Microsoft Store — distribuição direta por enquanto.
- Mobile (Capacitor) — caminho diferente, não confundir com desktop.
