# Desktop 1.0.8 — diagnóstico e homologação de notificações

## Fluxo observado no código da 1.0.7

`lead-events` → `join-request` → `JoinInviteCenter.receive` → popup +
`OfficeNotificationService`. `OfficeScene` selecionava sempre
`createWebNotificationAdapter`, também no Electron. O adapter usa
Service Worker (`showNotification`) e fallback `new Notification` do renderer.
Não havia bridge de notificações no preload, `Electron.Notification`, flash da
barra ou `setAppUserModelId`. Permissão do renderer era liberada apenas à origem
configurada, mas isso não cria um adapter nativo nem garante banners do Windows.
O handoff já registra casos de banners ocultos pelo SO: não atribuir a ausência
visual exclusivamente ao Service Worker sem logs do dispositivo.

O worker, ao clicar, tenta focar um cliente e reexibir o convite; se nenhum
cliente existir, chama `clients.openWindow('/office')`. O main do Electron nega
novas janelas na mesma origem sem abrir navegador. Outra origem aciona
`shell.openExternal` em `setWindowOpenHandler` ou `will-navigate`.
Teste reproduziu: `https://prestativaoffice.com.br/office` é negado sem navegador;
`https://www.prestativaoffice.com.br/office` abre externamente. Isso prova os
caminhos do código, mas o endereço do incidente relatado ainda não foi confirmado.
Não houve bloqueio adicional de URLs nem alteração do worker para mascarar a causa.
O main agora registra `navigation:external` com origem, categoria da rota e
handler, sem query, fragmento, identificador de workspace ou URL assinada.

## Correção

A factory `createOfficeNotificationAdapter` seleciona o adapter Desktop somente
quando o preload oferece a capacidade nativa; navegador mantém o adapter Web.
`OfficeNotificationService` continua sendo o contrato único. Web adapter e
`public/office-notify-sw.js` foram preservados sem alterações.

Desktop: renderer → preload restrito → IPC validado (janela/frame/origem) →
`Electron.Notification` + `flashFrame(true)`. O main confere novamente foco,
visibilidade e minimização, configura o AppUserModelID igual ao appId do instalador,
e suprime toast nativo em primeiro plano. Clique restaura/mostra/foca a janela
existente, cancela flash e envia apenas a tag ao renderer. O callback chama
`JoinInviteCenter.restore`, respeitando TTL e resolução existentes.

O main mantém apenas objetos de apresentação; não guarda posição/estado de convite.
Não aceita nem teletransporta. Aceitar/Recusar, deduplicação (5s), TTL (120s),
RTC, RoomManager, Presence e movimento continuam existentes. A trava single-instance
foi mantida e restauração passa a mostrar/focar a janela e cancelar o flash.
Opt-in continua no dispositivo. Menu/onboarding delegam ao serviço selecionado;
Desktop não pede permissão ao navegador nem registra Service Worker.
Ao sair do Office, listeners/callbacks/notificações nativas são limpos.

## Dependência de preview

O EXE carrega o site remoto; o novo preload sozinho não troca a factory no site
publicado. A homologação precisa do código web desta mesma branch em um preview.
Não publicar release nem atualizar main para conseguir testar.

No Lovable, usar a branch `desktop/notifications-1.0.8` em preview, obter o endereço
direto que abre o Office e iniciar o EXE com `PRESTATIVA_URL` apontando para esse
endereço. O domínio/origem configurado vale também para o IPC. Fechar o EXE antes
de iniciar com outra URL, pois a trava single-instance não troca o ambiente da janela.
Remover a variável ao terminar os testes. Preview e produção podem ter flags diferentes:
confirmar as flags reais de RTC antes de comparar comportamentos.

## Testes e homologação

Automatizados executam o main/preload reais com hosts Electron substituídos,
o adapter e o JoinInviteCenter reais, e os handlers reais de popup/Aceitar/Recusar
extraídos da fonte via TypeScript. Cobrem fundo/foco, restore/flash, IPC restrito,
instância única, clique sem navegação/aceite/movimento, resolução, TTL, cleanup,
opt-in e seleção Web. Geometria, rede e Windows são fronteiras simuladas: esses testes
não comprovam que o SO exibiu um banner.

No Windows, com notificações ativadas no perfil e dois usuários reais:

1. Em foco: popup interno; nenhum toast nativo intrusivo.
2. Minimizado: toast nativo e flash da barra; repetir atrás de outro programa.
3. Clique no toast: restaura a mesma janela, mantém workspace e reexibe Aceitar/Recusar.
4. Clique não abre navegador, não responde e não move avatar.
5. Aceitar teletransporta; Recusar não move. Convite resolvido/expirado não reaparece.
6. Abrir EXE novamente não cria segunda instância.
7. Repetir no navegador Web e conferir o fluxo antigo de Service Worker.
8. Testar com Office/MeetingStage/share/fullscreen e conferir que RTC e Presence persistem.

Se o banner não aparecer, conferir suporte/configuração Windows e os logs
`desktop-notify:requested`, `shown`, `failed` e `clicked`. `shown` confirma entrega
à API, não a presença visual do banner. Para Chrome inesperado, correlacionar
`navigation:external` e o passo realizado. Nenhum log inclui corpo do convite,
token, cookie ou URL assinada completa.
