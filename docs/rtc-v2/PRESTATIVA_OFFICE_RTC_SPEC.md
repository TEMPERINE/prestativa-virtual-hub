# Prestativa Office — Especificação RTC v2

Data: 2026-09-14

## Objetivo

Reconstruir apenas o subsistema de presença/mídia do Prestativa Office para eliminar assimetria de reuniões, conexões presas, conflitos de identidade, uso incorreto de Supabase Presence e acoplamento entre posição visual e roster de mídia.

Não reescrever o produto inteiro. Preservar mapa, avatares, editor, UI, gravação e recursos não relacionados, salvo adaptações necessárias à nova interface RTC.

## Invariantes não negociáveis

1. 1 conta = 1 usuário = 1 avatar = 1 identidade LiveKit = 1 sessão ativa.
2. `LiveKit identity = auth.uid()`; não usar `userId:clientId`.
3. Nova sessão em outro dispositivo assume a conta e invalida a anterior.
4. Novo login sempre inicia microfone OFF e câmera OFF.
5. Entrar em proximidade ou sala nunca liga microfone/câmera automaticamente.
6. Estado de mic/câmera persiste durante a mesma sessão ao trocar lobby/sala.
7. Screen share é encerrado ao trocar de contexto e nunca religa sozinho.
8. Um cliente participa de no máximo uma Room LiveKit por vez.
9. Espaço aberto e sala privada usam estratégias diferentes.
10. Posição de outros usuários nunca decide em qual Room privada o usuário entra.
11. Roster de reunião privada vem exclusivamente da Room LiveKit.
12. Supabase Presence nunca carrega posição e nunca é atualizado por timer de 1 segundo.
13. Movimento usa Supabase Broadcast; renderização local pode ser 60 FPS, rede não.
14. Apenas um controlador pode executar `room.connect()` e `room.disconnect()`.
15. Nenhum `catch {}` silencioso no caminho crítico RTC; erros devem gerar telemetria.

## Modelo de comunicação

### Lobby / corredores

Room LiveKit única por workspace:

`prestativa-office:{workspaceId}:lobby`

- Todos os usuários no espaço aberto pertencem a essa Room.
- `autoSubscribe = false`.
- Posição chega por Supabase Broadcast.
- Distância controla apenas `RemoteTrackPublication.setSubscribed()`.
- Usar histerese: `CONNECT_RADIUS < DISCONNECT_RADIUS`.
- A posição não cria/destroi Rooms entre pares.

### Salas privadas

Room LiveKit por zona:

`prestativa-office:{workspaceId}:{zoneId}`

- Entrar fisicamente na zona inicia transição automática.
- Sair fisicamente inicia transição de volta ao lobby.
- `autoSubscribe = true`.
- Todos os participantes conectados recebem as tracks publicadas de todos.
- Não executar `setSubscribed()` manualmente em salas privadas.
- Não usar `desiredPeers`, `audiblePeerIds`, `videoVisibleIds`, `positions` ou `meeting_participants` para montar roster de mídia.

## Máquina de estados

Estados lógicos:

- `OFFLINE`
- `LOBBY_CONNECTING`
- `LOBBY_CONNECTED`
- `TRANSITIONING_TO_PRIVATE`
- `PRIVATE_CONNECTED(zoneId)`
- `TRANSITIONING_TO_LOBBY`
- `RECONNECTING`
- `FAILED`

O controlador recebe somente estado do próprio usuário:

- `myZone`
- `mapVersion`
- `sessionOwnership`

Nunca recebe posição de outros usuários para escolher Room.

### Regras de transição

- Zona candidata precisa permanecer estável por 300 ms antes de solicitar mudança.
- Só existe uma transição ativa por vez.
- Se o usuário mudar novamente enquanto uma transição estiver em curso, atualizar `latestDesiredContext`; não iniciar conexão concorrente.
- Ao concluir a transição atual, comparar `activeContext` com `latestDesiredContext` e, se necessário, executar a próxima transição.
- Antes de entrar em Room privada, validar sessão, workspace, zona e `mapVersion` no servidor.
- `MAP_VERSION_STALE` bloqueia a entrada até sincronizar o mapa.
- Considerar a Room ativa somente após conexão LiveKit efetiva.
- Reconexão de rede usa primeiro o mecanismo nativo do LiveKit (`Reconnecting`/`Reconnected`); não criar uma segunda Room em paralelo.

## Identidade e sessão única

Criar `office_sessions` com uma linha por usuário:

- `user_id uuid primary key`
- `session_id uuid not null`
- `generation bigint not null`
- `workspace_id uuid not null`
- `claimed_at timestamptz not null`
- `updated_at timestamptz not null`

RPC `claim_office_session(session_id, workspace_id)`:

- obter usuário via `auth.uid()`;
- validar membership do workspace;
- incrementar `generation` atomicamente;
- tornar a nova sessão a única válida;
- retornar `session_id` e `generation`.

RPC `release_office_session(session_id, generation)`:

- liberar apenas se `session_id` e `generation` ainda forem os atuais;
- uma sessão antiga nunca pode apagar a sessão nova.

Canal privado de takeover:

`user:{userId}:session`

Evento `SESSION_REPLACED` faz a sessão antiga:

- parar input e movimento;
- parar Broadcast;
- `untrack` Presence;
- desconectar LiveKit;
- encerrar tracks locais;
- mostrar mensagem de sessão substituída.

Todos os eventos efêmeros relevantes carregam `generation`; gerações antigas são ignoradas.

## Supabase Realtime

Separar canais:

- `workspace:{workspaceId}:presence` — somente online/offline e metadados lentos.
- `workspace:{workspaceId}:movement` — movimento efêmero.
- `workspace:{workspaceId}:map` — atualização de versão do mapa.
- `user:{userId}:session` — takeover.

Presence payload mínimo:

- `userId`
- `sessionId`
- `generation`
- `displayName`
- `avatarId`

Não incluir `x`, `y`, `velocity`, `zone`, distância ou heartbeat periódico.

## Movimento

Broadcast não deve espelhar cada frame.

Eventos:

- `MOTION_START`
- `MOTION_CHANGE`
- `MOTION_STOP`
- `POSITION_SYNC`
- `POSITION_SNAPSHOT_REQUEST`
- `POSITION_SNAPSHOT`

Transmitir imediatamente início, mudança e parada. Enquanto o avatar se move, enviar correção `POSITION_SYNC` aproximadamente 1 vez por segundo. Os outros clientes interpolam visualmente entre eventos.

A tabela `positions` pode continuar armazenando última posição/spawn, mas deixa de ser fonte de verdade de RTC.

## Mapa e mapVersion

Adicionar `version bigint not null default 1` a `map_overrides`.

Toda alteração incrementa versão monotonamente.

Criar uma única função `normalizeMapOverrides()` usada em:

- initial fetch;
- Realtime update;
- cache restore;
- editor save.

Nenhum mapa cru pode entrar em `callZoneAt()`.

Durante `MAP_SYNCING`, bloquear novas transições de Room privada.

## LiveKit token

A função de servidor recebe:

- `workspaceId`
- `sessionId`
- `generation`
- `context: LOBBY | PRIVATE_ROOM`
- `zoneId?`
- `mapVersion`

Não confiar em `userId`, `identity` ou `roomName` enviados pelo browser.

Servidor:

1. usa `context.userId` / sessão autenticada;
2. valida membership;
3. valida `office_sessions` e `generation`;
4. valida `mapVersion`;
5. valida zona quando privada;
6. constrói `roomName`;
7. emite token com `identity = userId`.

## Decomposição de código

Criar módulos focados em `src/lib/rtc/`:

- `office-session.ts` — claim, takeover, generation.
- `media-context.ts` — máquina de estados e transições.
- `livekit-room-manager.ts` — único dono de Room/connect/disconnect.
- `local-media.ts` — mic, câmera, tela, dispositivos e intents.
- `remote-media.ts` — roster e eventos remotos LiveKit.
- `spatial-subscriptions.ts` — subscriptions por proximidade somente no lobby.
- `rtc-telemetry.ts` — eventos diagnósticos.
- `useLiveKit.ts` — fachada temporariamente compatível com `OfficeScene`.

Não refatorar `OfficeScene.tsx` inteiro nesta entrega. Alterar somente o wiring necessário para RTC v2.

## Código legado que deve sair do caminho RTC v2

- `clientId` compondo identidade LiveKit;
- `participantOwnerId()` / parsing de identity;
- `desiredPeers` controlando reuniões privadas;
- `audiblePeerIds` controlando reuniões privadas;
- `videoVisibleIds` controlando salas privadas;
- Presence heartbeat de 1 segundo;
- Presence carregando posição;
- retry paralelo/customizado que cria nova Room enquanto LiveKit reconecta;
- roster privado reconstruído a partir de `positions`;
- qualquer decisão de Room baseada na posição dos outros usuários.

`useRtcMesh.ts` permanece apenas como legado não utilizado e não deve voltar ao path principal.

## Telemetria

Criar `rtc_events` append-only:

- `id`
- `user_id`
- `session_id`
- `generation`
- `workspace_id`
- `zone_id`
- `map_version`
- `context`
- `room_name`
- `event_type`
- `connection_state`
- `disconnect_reason`
- `details jsonb`
- `created_at`

Eventos mínimos:

- `SESSION_CLAIMED`
- `SESSION_REPLACED`
- `CONTEXT_CHANGE_REQUESTED`
- `CONTEXT_CHANGED`
- `ROOM_CONNECT_REQUESTED`
- `ROOM_SIGNAL_CONNECTED`
- `ROOM_MEDIA_ACTIVE`
- `ROOM_RECONNECTING`
- `ROOM_RECONNECTED`
- `ROOM_DISCONNECTED`
- `ROOM_CONNECT_FAILED`
- `MIC_ENABLED` / `MIC_DISABLED` / `MIC_FAILED`
- `CAM_ENABLED` / `CAM_DISABLED` / `CAM_FAILED`
- `MAP_STALE`
- `PRESENCE_ERROR`
- `BROADCAST_ERROR`

Não registrar cada movimento.

## Meetings administrativos

Manter `meetings` e `meeting_participants` para histórico/gravação/auditoria, não para roster RTC.

`meeting_join` somente após `PRIVATE_ROOM` estar realmente conectada.

`meeting_leave` ao sair/desconectar daquela Room.

Falha em registrar histórico não pode derrubar a mídia.

## Feature flag de migração

Introduzir temporariamente `VITE_RTC_ENGINE=v1|v2`.

- v1 preserva comportamento atual para rollback durante homologação.
- v2 usa exclusivamente arquitetura nova.
- Depois de aceite final, remover v1 e o flag em uma entrega separada.

## Critérios de aceite obrigatórios

### Automatizados

Adicionar Vitest ao projeto e cobrir no mínimo:

1. sessão nova incrementa generation e invalida sessão anterior;
2. geração antiga não pode liberar sessão nova;
3. novo login começa mic OFF / cam OFF;
4. mic/cam intents sobrevivem troca lobby ↔ sala na mesma sessão;
5. screen share desliga na troca;
6. media context nunca possui duas Rooms ativas;
7. mudança de zona durante transição é coalescida em `latestDesiredContext`;
8. `MAP_VERSION_STALE` impede entrada privada;
9. private room usa `autoSubscribe=true`;
10. lobby usa `autoSubscribe=false`;
11. `spatial-subscriptions` nunca executa em private room;
12. histerese não oscila na fronteira do raio;
13. posição de outro usuário não altera `mediaContext` local;
14. token não aceita identity/userId/roomName arbitrários do cliente.

### Homologação real

**2 usuários**
- corredor próximo: ambos recebem mídia publicada;
- afastar: subscriptions encerram conforme raio;
- sala: ambos veem/ouvem tracks publicadas;
- sair da sala: ambos retornam ao lobby corretamente.

**3 e 5 usuários**
- entrada simultânea e sequencial na mesma sala;
- todos devem ter exatamente `N-1` participantes remotos;
- roster deve ser simétrico em todos os clientes;
- repetir entrar/sair 5 vezes sem cliente preso em `connecting`.

**Privacidade**
- login sempre mic OFF/cam OFF;
- entrar em proximidade não liga dispositivo;
- entrar em sala não liga dispositivo;
- dispositivo ligado pelo usuário permanece ligado na mesma sessão após transição;
- screen share não atravessa troca de contexto.

**Sessão única**
- abrir mesma conta em dispositivo B;
- B assume;
- A perde input, Presence e LiveKit e recebe aviso;
- nunca existir dois avatares/mídias ativos para o mesmo userId.

**Rede**
- alternar rede ou interromper conectividade brevemente;
- LiveKit deve entrar em `RECONNECTING` e voltar via `RECONNECTED` sem nova Room concorrente;
- se falhar definitivamente, UI sai de “conectando infinito” e mostra erro/retry.

**Mapa**
- alterar mapa enquanto clientes estão conectados;
- todos convergem para mesma versão;
- cliente stale não entra em Room privada até sincronizar.

**10 usuários**
- todos na mesma sala, roster N-1 e mídia estável por pelo menos 10 minutos.

**20 usuários**
- teste final de ceiling da sala;
- roster N-1 em todos;
- nenhum 429 atribuído ao fluxo de token da aplicação;
- nenhum Presence rate-limit;
- nenhuma Room duplicada por usuário;
- telemetria capaz de explicar qualquer falha.

## Definition of Done

A entrega só é considerada concluída quando:

- `npm run build` passa;
- `npm run lint` passa sem novos erros introduzidos;
- testes Vitest passam;
- matriz manual 2/3/5 usuários passa integralmente;
- takeover de sessão passa;
- privacidade passa;
- network reconnect passa;
- telemetria mostra timeline coerente;
- teste 10 usuários passa antes do teste 20;
- v2 é habilitado em produção somente após homologação.

Compilar não significa corrigido. Testar com apenas dois navegadores não significa corrigido.
