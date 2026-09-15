# Prestativa Office RTC v2 — Plano de Implementação

**Objetivo:** substituir o subsistema RTC atual por uma arquitetura determinística, testável e observável, sem reescrever o restante do Prestativa Office.

**Stack:** TanStack Start, React 19, TypeScript, Supabase Auth/Postgres/Realtime, LiveKit Cloud, Vite.

**Especificação:** `PRESTATIVA_OFFICE_RTC_SPEC.md`.

## Regra de execução

Executar uma etapa por vez. Ao final de cada etapa: build + lint + testes da etapa. Não iniciar a etapa seguinte se a anterior estiver quebrada. Não misturar refactors não relacionados.

## Etapa 1 — Base de testes e feature flag

Arquivos principais:
- `package.json`
- `vite.config.ts`
- novos `src/lib/rtc/**/*.test.ts`

Ações:
1. adicionar Vitest;
2. adicionar script `test`;
3. criar `VITE_RTC_ENGINE=v1|v2`;
4. manter v1 como default durante construção;
5. criar primeiros testes da máquina de estados antes da implementação.

Gate: build, lint e teste mínimo executando.

## Etapa 2 — Migração Supabase

Criar nova migration em `supabase/migrations/` contendo:

1. `office_sessions` + RLS;
2. RPC `claim_office_session`;
3. RPC `release_office_session`;
4. `rtc_events` append-only + RLS;
5. coluna `version` em `map_overrides`;
6. mecanismo atômico para incremento de map version;
7. permissões necessárias para canais privados Realtime.

Gate: migrations aplicam sem destruir dados existentes e RPCs rejeitam usuário fora do workspace.

## Etapa 3 — Sessão única

Criar:
- `src/lib/rtc/office-session.ts`

Responsabilidades:
- claim/release;
- geração monotônica;
- canal `user:{userId}:session`;
- takeover;
- evento `SESSION_REPLACED`;
- bloquear sessão velha.

Integrar no mount/unmount do workspace autenticado, não no tile de vídeo.

Gate: teste manual mesma conta em dois navegadores. Apenas o último mantém controle.

## Etapa 4 — Mapa determinístico

Modificar:
- `src/lib/map-overrides.ts`
- `src/components/office/MapEditor.tsx`

Criar uma única `normalizeMapOverrides()`.

Todo fetch, Realtime update, cache restore e save passa pelo mesmo normalizador.

Expor `mapVersion` e estado `MAP_READY | MAP_SYNCING`.

Gate: dois clientes recebem a mesma versão e a mesma classificação de zona após alteração.

## Etapa 5 — MediaContextController

Criar:
- `src/lib/rtc/media-context.ts`
- testes correspondentes.

Implementar estados e `latestDesiredContext`.

Entrada de zona usa debounce de 300 ms.

Apenas posição do próprio avatar é entrada da máquina.

Gate: teste comprova que posição de outro usuário não muda a Room local e que mudanças rápidas não criam transições concorrentes.

## Etapa 6 — Novo LiveKitRoomManager

Criar:
- `src/lib/rtc/livekit-room-manager.ts`

Único arquivo autorizado a criar/conectar/desconectar `Room`.

Lobby:
- room `prestativa-office:{workspace}:lobby`;
- `autoSubscribe=false`.

Private:
- room `prestativa-office:{workspace}:{zone}`;
- `autoSubscribe=true`.

Usar eventos nativos `Reconnecting`, `Reconnected`, `Disconnected`, `ParticipantConnected`, `ParticipantDisconnected` e `ParticipantActive` quando disponível.

Não criar retry paralelo durante reconexão nativa.

Gate: teste/mocks garantem máximo de uma Room ativa e opções corretas de subscribe.

## Etapa 7 — Token v2

Modificar:
- `src/lib/rtc/livekit.functions.ts`

Remover contrato dependente de `clientId` e `userId` enviado pelo browser.

Validar no servidor:
- Auth;
- membership;
- sessão/generation;
- mapVersion;
- zone;
- context.

Servidor constrói roomName e `identity=auth user id`.

Gate: tentativas de roomName/identity arbitrários não são possíveis pela interface pública.

## Etapa 8 — LocalMedia e RemoteMedia

Criar:
- `src/lib/rtc/local-media.ts`
- `src/lib/rtc/remote-media.ts`

LocalMedia:
- novo login OFF/OFF;
- intent separado da Room;
- reaplicar mic/cam ao conectar nova Room se usuário deixou ON;
- screen share encerra em transição.

RemoteMedia:
- roster exclusivamente de `room.remoteParticipants`;
- não deduplicar por ownerId;
- identity já é userId.

Gate: privacidade e roster passam com 2 e 3 usuários.

## Etapa 9 — SpatialSubscriptions do lobby

Criar:
- `src/lib/rtc/spatial-subscriptions.ts`

Este é o único módulo que pode chamar `setSubscribed()`.

Executar somente se `context=LOBBY`.

Implementar histerese configurável para conectar/desconectar.

Gate: aproximação conecta, afastamento desconecta, borda não oscila e private room nunca chama selective subscription.

## Etapa 10 — Realtime de movimento e Presence

Modificar somente o necessário no wiring atual de `OfficeScene.tsx`.

Separar canais:
- presence;
- movement;
- map;
- session.

Remover heartbeat Presence de 1 segundo.

Movement usa start/change/stop + sync periódico de ~1 s e snapshots para novos clientes.

Manter interpolação visual local.

Gate: 5 usuários andando não geram Presence rate-limit e movimento permanece visualmente fluido.

## Etapa 11 — Telemetria

Criar:
- `src/lib/rtc/rtc-telemetry.ts`

Registrar somente eventos relevantes definidos na spec.

Remover `catch {}` silencioso do caminho novo, substituindo por tratamento + telemetria.

Gate: uma entrada completa em sala pode ser reconstruída cronologicamente em `rtc_events`.

## Etapa 12 — Fachada `useLiveKit.ts`

Refatorar `src/lib/rtc/useLiveKit.ts` para fachada do RTC v2, preservando a interface externa necessária para evitar reescrever `OfficeScene.tsx` inteiro.

No path v2 remover dependências de:
- clientId identity;
- participantOwnerId;
- desiredPeers para private;
- videoVisibleIds para private;
- retries paralelos.

Gate: v1 e v2 compilam durante homologação; v2 é funcional.

## Etapa 13 — Meeting tracker

Modificar:
- `src/lib/meetings/useMeetingTracker.ts`

`meeting_join` somente após private room conectada.

`meeting_leave` ao sair/desconectar.

Falha administrativa não derruba mídia.

Gate: registro histórico corresponde a participantes que efetivamente conectaram.

## Etapa 14 — Homologação progressiva

Ordem obrigatória:

1. 2 usuários;
2. 3 usuários;
3. 5 usuários;
4. takeover mesma conta;
5. proximidade lobby;
6. troca lobby/sala repetida 5 vezes;
7. queda/reconexão de rede;
8. alteração de mapa;
9. 10 usuários por 10 min;
10. 20 usuários.

Se um nível falhar, não avançar para o seguinte. Usar `rtc_events` para encontrar a camada que divergiu antes de modificar código.

## Etapa 15 — Cutover

Somente após aceite:

1. ativar `VITE_RTC_ENGINE=v2` em produção;
2. observar telemetria;
3. manter rollback v1 por uma janela curta de homologação;
4. em tarefa separada, remover v1, `useRtcMesh.ts` e código RTC legado comprovadamente não utilizado.

Não realizar a limpeza pesada na mesma entrega do cutover.
