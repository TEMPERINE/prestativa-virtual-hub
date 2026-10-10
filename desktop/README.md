# Prestativa Office — Desktop Windows

O Electron carrega `https://prestativaoffice.com.br`. O Office, o RTC e os overlays
continuam sendo o aplicativo web publicado. A gravação V2 usa LiveKit Egress + R2,
sem captura local. O seletor Electron é usado somente para compartilhamento de tela.

O pacote fica neste repositório, atualmente `TEMPERINE/prestativa-virtual-office`
(o endereço antigo `prestativa-virtual-hub` redireciona para ele).

## Desenvolvimento e build

```sh
cd desktop
npm ci
npm test
npm start
```

`PRESTATIVA_URL` permite testar um preview. Somente a origem configurada pode
usar mídia/notificações; a decisão de ligar mic/câmera e o opt-in de notificações
continuam sob controle do Office. Um novo domínio tem armazenamento/sessão próprios:
o primeiro uso pode exigir login e preferências novamente.

Em Windows:

```sh
npm run dist:win
npm run verify:update
```

O build não publica. Produz em `dist/` o instalador
`Virtual-Office-Setup-X.Y.Z.exe`, seu `.blockmap` e `latest.yml`.
A validação confere versão, nomes, existência, tamanho e SHA-512 do instalador.
Preservamos appId, instalação por máquina e atalhos para atualizar instalações existentes.
O executável ainda não possui assinatura de editor configurada; checksum não substitui
assinatura Authenticode nem homologação.

## Homologação antes da release

O workflow `.github/workflows/release.yml` gera um artifact Windows sem publicar.
Pushes para branches `desktop/**` também geram somente o artifact para teste,
sem alterar a branch sincronizada com o Lovable ou distribuir atualizações.
Execução manual usa o commit/ref selecionado, com `prepare_draft=false` por padrão.
Se solicitado, `prepare_draft=true` cria somente um rascunho novo, recusando substituir
uma release/tag existente. Tags também geram apenas artifacts. Publicação do rascunho
exige autorização explícita do responsável.

Antes de publicar, testar no Windows:

- Instalar sobre 1.0.6; confirmar versão 1.0.7 com
  `await window.prestativaDesktop.getAppVersion()` no DevTools.
- Login e seleção de workspace permanecem no EXE, inclusive após fechar/reabrir.
- Mic/câmera iniciam OFF; testar ligação, desligamento físico e Privacy Guard.
- Chamada com dois usuários; compartilhar tela/janela, cancelar seletor e encerrar.
- Overlays na composição real: MeetingStage, compartilhamento legado e fullscreen.
- Gravação V2 até playback R2; nenhuma captura local para gravar.
- Notificações com opt-in, clique apenas foca; não aceita convite/teleporta.
- Atualização de uma versão antiga, download em background e instalação ao fechar.

## Página de download e atualização

`/download` consulta a última release publicada no GitHub e usa o asset `.exe`.
Um commit web não gera nem troca o instalador. Um rascunho não aparece nessa página.
O EXE consulta updates após 5 segundos e a cada 6 horas; instala o download ao sair.
Mudanças exclusivamente web aparecem ao carregar o site; mudanças do shell exigem
uma nova versão do instalador.

Na release 1.0.6 observada em 10/10/2026, `latest.yml` referencia
`Virtual-Office-Setup-1.0.6.exe` (404), mas o asset publicado é
`Virtual.Office.Setup.1.0.6.exe` (200). A 1.0.7 fixa explicitamente o nome gerado.
Não alteramos os assets publicados da 1.0.6.

Depois de publicar a versão homologada, tentar primeiro abrir o EXE antigo,
aguardar o download e fechar/reabrir. Se continuar antigo ou houver falha no updater,
baixar a nova versão em `https://prestativaoffice.com.br/download` e instalar sobre
a existente, com o Office fechado. Não é necessário desinstalar antes.
A página só deve mostrar a versão nova quando a release estiver publicada.
