
# Jornada do Usuário com Múltiplos Espaços

Hoje o app só tem o "Prestativa Office" hard-coded em `/office`. Vamos transformar em uma plataforma de espaços, onde cada usuário tem **um perfil/personagem global** e pode pertencer a **vários workspaces** (escritórios). Tudo o que hoje é "do escritório" passa a ser escopado por `workspace_id`.

## Fluxo final

```
/auth (login/cadastro)
   │
   ├─ não onboardado → /onboarding  (perfil + personagem, 1x na vida)
   │
   └─ onboardado → /workspaces       (hub: lista de espaços do usuário)
                       │
                       └─ clica no card → /workspaces/$workspaceId  (cenário carrega)
```

Importante: **personagem/perfil é global** (uma vez por conta). Só o cenário, posições, reuniões, mapa, props e chat são por workspace.

## Modelo de dados

Novas tabelas:

- **`workspaces`** — `id`, `slug`, `name`, `description`, `cover_url`, `owner_id`, `created_at`. Seed: o "Prestativa Office" atual.
- **`workspace_members`** — `workspace_id`, `user_id`, `role` (`owner` / `admin` / `member`), `joined_at`. PK composta `(workspace_id, user_id)`.
- **`workspace_invites`** — `id`, `workspace_id`, `email`, `role`, `token`, `invited_by`, `accepted_at`, `expires_at`. Aceito ao logar (match por email).

Migração das tabelas existentes (adicionar `workspace_id uuid NOT NULL` + backfill com o ID do workspace "Prestativa Office"):

`positions`, `meetings`, `meeting_participants`, `messages`, `map_overrides`, `prop_states`, `custom_props`, `desk_notes`, `workspace_claims`.

RLS de todas elas passa a exigir `workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())` — via uma função `is_workspace_member(_ws, _uid)` `SECURITY DEFINER` para evitar recursão.

`profiles`, `user_roles`, `saved_notes`, `meeting_notes`, `meeting_folders`, `meeting_favorites` continuam **globais** (são do usuário, não do workspace).

## Novas rotas

- `src/routes/_authenticated/onboarding.tsx` — extrai o `OnboardingWizard` atual (hoje aparece como modal dentro de `/office`). Só roda se `profiles.onboarded_at IS NULL`. Ao terminar → redireciona pra `/workspaces`.
- `src/routes/_authenticated/workspaces.tsx` — hub. Lista cards dos workspaces do usuário (`workspace_members` join `workspaces`), botão "Aceitar convite" se houver `workspace_invites` pendentes pra esse email, e (futuro) "Criar espaço".
- `src/routes/_authenticated/workspaces.$workspaceId.tsx` — substitui `/office`. Carrega `OfficeScene` passando `workspaceId` via prop/context. Faz guard: se o usuário não é membro → redireciona pra `/workspaces`.
- `/office` vira redirect → `/workspaces` (compat).

Em `_authenticated/route.tsx`, depois do `getUser`, buscar `profiles.onboarded_at`:
- se nulo → `redirect /onboarding`
- caso contrário, deixar seguir.

## Scope no código existente

Tudo em `OfficeScene.tsx` e helpers (`useMeetingTracker`, `useMeetingRecorder`, `useRtcMesh`, `map-overrides.ts`, `custom-props.ts`, realtime channels, queries de `positions` / `meetings` / `messages`) precisa receber `workspaceId` e:

1. filtrar todas as queries por `workspace_id`;
2. setar `workspace_id` em todo INSERT;
3. nomear canais realtime com `:${workspaceId}` para não vazar presença entre espaços;
4. RPCs (`meeting_join`, `meeting_leave`, etc.) ganham parâmetro `_workspace_id` e validam membership.

Hub (`/workspaces`) mostra, por card: nome, cover, contagem de membros online (`positions.is_online` filtrado por workspace), papel do usuário, e CTA "Entrar".

## Convites (mínimo viável agora)

- Owner/admin de um workspace gera convite por email (UI simples no hub, na aba "Gerenciar" do card — pode ser fase 2 se quisermos cortar escopo).
- Ao logar, sistema procura `workspace_invites` por email do usuário, mostra banner "Você foi convidado para X — Aceitar/Recusar". Aceitar = INSERT em `workspace_members` + `accepted_at = now()`.

Se quiser cortar escopo nessa primeira leva, posso só criar o owner do workspace seed (você) como membro e deixar a UI de convite pra próxima etapa — me diga.

## Seed / migração de dados

Migration faz tudo em uma transação:
1. Cria `workspaces`, `workspace_members`, `workspace_invites` + GRANTs + RLS.
2. Insere o workspace `Prestativa Office` (id fixo via `gen_random_uuid()` capturado em CTE).
3. Adiciona membership de **todos os usuários atuais** (`SELECT id FROM auth.users`) como `member` desse workspace (`owner` = você, definir por email).
4. Adiciona coluna `workspace_id` nas 9 tabelas existentes (nullable), backfill com o id do workspace seed, depois `SET NOT NULL` + FK.
5. Reescreve as policies dessas tabelas pra exigir membership.
6. Cria função `is_workspace_member` e RPCs novas.

## Detalhes técnicos relevantes

- O `OnboardingWizard` hoje vive dentro de `OfficeScene` como overlay; vamos movê-lo pra rota própria sem mudar o componente em si, só onde ele é montado.
- `workspace_claims` (mesa reservada) passa a ter PK `(workspace_id, zone_id)` em vez de `zone_id` — duas pessoas podem reservar a mesma mesa "Mesa 3" em workspaces diferentes.
- `map_overrides.id` hoje é texto único; vira `(workspace_id, id)` ou simplesmente `workspace_id` como PK (1 mapa por workspace).
- RPCs novas: `workspace_accept_invite(_token)`, `workspace_list_for_me()` (opcional, dá pra usar SELECT direto).
- Realtime: prefixar canais (`office:${workspaceId}:positions`, `office:${workspaceId}:chat`, etc.).

## Ordem de implementação sugerida

1. **Migration** (tabelas novas + scope + RLS + seed + reescrita de policies + RPC `meeting_join` etc.).
2. **Tipos** regenerados, depois ajustar OfficeScene + hooks pra receber e propagar `workspaceId`.
3. **Rotas novas** (`/onboarding`, `/workspaces`, `/workspaces/$workspaceId`), redirect de `/office`.
4. **Guard** em `_authenticated/route.tsx` (onboarding check).
5. **UI do hub** (cards de espaços + aceitar convite básico).
6. (Opcional fase 2) UI de criar workspace e gerenciar convites.

Confirma esse plano (ou me diz o que cortar/ampliar) que eu sigo pra build mode.
