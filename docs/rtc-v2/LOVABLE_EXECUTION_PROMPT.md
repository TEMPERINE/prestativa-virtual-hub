# Prompt de execução — Prestativa Office RTC v2

Você está trabalhando no projeto existente Prestativa Office. Esta tarefa NÃO é uma investigação aberta e NÃO é um pedido para inventar uma arquitetura alternativa.

Existe uma especificação técnica aprovada e um plano de implementação aprovado. Sua função é EXECUTAR esse desenho com mudanças controladas no projeto atual.

Antes de alterar código, leia integralmente:

1. `PRESTATIVA_OFFICE_RTC_SPEC.md`
2. `PRESTATIVA_OFFICE_RTC_IMPLEMENTATION_PLAN.md`
3. `src/lib/rtc/useLiveKit.ts`
4. `src/lib/rtc/livekit.functions.ts`
5. `src/components/office/OfficeScene.tsx`, especialmente o wiring de zona/RTC/positions/Presence
6. `src/lib/rtc/useRoomRoster.ts`
7. `src/lib/meetings/useMeetingTracker.ts`
8. `src/lib/map-overrides.ts`
9. migrations atuais de meetings, positions e map_overrides

## Regras obrigatórias

- Não diagnostique novamente a arquitetura.
- Não troque LiveKit por outro SFU.
- Não volte para mesh P2P.
- Não implemente Room LiveKit única para todo o workspace.
- Não refatore `OfficeScene.tsx` inteiro.
- Não altere funcionalidades não relacionadas ao RTC.
- Não use a posição de outros usuários para decidir Room privada.
- Não use Supabase Presence para posição.
- Não faça `presence.track()` em timer.
- Não use `clientId` na identity LiveKit.
- Não permita múltiplas sessões ativas da mesma conta.
- Não ligue câmera ou microfone automaticamente.
- Não use selective subscription dentro de salas privadas.
- Não introduza retry concorrente enquanto LiveKit estiver em reconexão nativa.
- Não esconda erros críticos com `catch {}`.
- Não marque a tarefa como resolvida apenas porque o projeto compilou.

## Arquitetura que deve ser executada

1 usuário = 1 sessão = 1 avatar = 1 identity LiveKit (`auth.uid()`).

Lobby/corredores:
- Room `prestativa-office:{workspaceId}:lobby`;
- `autoSubscribe=false`;
- proximity controla subscriptions por distância.

Sala privada:
- Room `prestativa-office:{workspaceId}:{zoneId}`;
- `autoSubscribe=true`;
- roster vem exclusivamente do LiveKit;
- todos recebem todas as tracks publicadas dentro daquela Room.

Supabase:
- Auth = identidade;
- Postgres = sessões, mapa persistido, auditoria e telemetria;
- Presence = online/offline lento;
- Broadcast = movimento;
- LiveKit = mídia e roster real das reuniões.

## Ordem de execução

Siga as 15 etapas de `PRESTATIVA_OFFICE_RTC_IMPLEMENTATION_PLAN.md` exatamente na ordem.

Ao final de CADA etapa:

1. mostre quais arquivos foram criados/modificados;
2. explique em 3 a 6 bullets o que mudou;
3. execute build;
4. execute lint;
5. execute os testes relevantes;
6. reporte o resultado real, inclusive falhas;
7. pare se houver falha e corrija a etapa atual antes de continuar.

Não combine várias etapas em um grande patch sem validação intermediária.

## Critério para declarar sucesso

Você só poderá declarar “RTC v2 concluído” depois que os testes automatizados e a matriz de homologação definidos na especificação tiverem sido executados no que for possível no ambiente.

Para cenários que exigem múltiplos dispositivos/usuários reais e não podem ser executados automaticamente no ambiente Lovable, entregue uma checklist objetiva de homologação e indique exatamente quais eventos `rtc_events` devemos observar durante cada teste.

Se surgir uma incompatibilidade técnica real que impeça seguir a especificação, NÃO escolha outra arquitetura sozinho. Pare, descreva:

- requisito bloqueado;
- arquivo/linha envolvidos;
- evidência técnica;
- menor conjunto de alternativas possíveis;

E aguarde decisão.

O objetivo desta implementação é previsibilidade, simetria e observabilidade, não adicionar novas funcionalidades.
