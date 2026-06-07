
## Objetivo

Na tela `/workspaces`, contas com papel `admin` (app_role) ganham um botão **"+ Novo escritório"** que abre um **passo a passo (wizard)** para criar um novo workspace já configurado — nome, tema visual, áreas/zonas e props — sem afetar o escritório atual em produção.

## Por que isso é seguro para o escritório atual

Toda a configuração visual já é **escopada por `workspace_id`** no banco:

- `map_overrides.workspace_id` (mapa, zonas, props, tema) — 1 linha por workspace
- `prop_states.workspace_id` (estados dos props)
- `custom_props.workspace_id` (props customizadas)
- `workspace_claims`, `positions`, `messages`, `meetings` — todos por workspace

Criar um novo `workspaces` row + `workspace_members` (owner) + `map_overrides` próprio **não toca em nada do workspace atual**. O `MapEditor` e `OfficeScene` já leem/escrevem via `getCurrentWorkspaceId()`.

A única coisa global hoje é o `localStorage` (`office-map-overrides:v1`, `lastWorkspaceId`). Para isolar a edição do novo escritório sem poluir o atual, o wizard fará a configuração **direto na nuvem por `workspace_id`** (sem mexer no cache local do workspace ativo).

## Fluxo do wizard

Botão "+ Novo escritório" (visível só para `has_role(admin)`) abre um modal/rota `/_authenticated/workspaces/new` com 5 passos:

1. **Identidade** — Nome, slug (auto), descrição, cor/cover opcional.
2. **Tema visual** — Cards com os temas de `OFFICE_THEMES` (Padrão / Rumo ao Hexa / Festa Junina). Preview da imagem de fundo.
3. **Ponto de partida do mapa** — Escolher:
   - "Em branco" (overrides vazios — `newOverrides()`)
   - "Copiar do escritório atual" (clona `map_overrides.data` do workspace ativo — útil para começar parecido e ajustar)
4. **Áreas (opcional, pular permitido)** — Reaproveita `MapEditor` em **modo "workspace alvo"**: recebe um `targetWorkspaceId` por prop e lê/grava overrides desse workspace, **sem** tocar no cache local nem no workspace ativo. Admin pode pintar zonas, blocked, props, spawn points. Pode pular e editar depois entrando no espaço.
5. **Revisão & criação** — Mostra resumo. Botão "Criar escritório" executa, em ordem:
   1. `INSERT workspaces (owner_id = auth.uid(), name, slug, description, cover_url)`
   2. `INSERT workspace_members (workspace_id, user_id = auth.uid(), role = 'owner')`
   3. `UPSERT map_overrides (workspace_id, data = { ...overridesEscolhidos, theme })`
   4. (opcional) Copia `custom_props` do workspace de origem se "Copiar atual" foi escolhido.
   5. Toast de sucesso → redireciona para `/workspaces/$workspaceId` do novo espaço (e seta `lastWorkspaceId`).

Cancelar em qualquer passo: nada é persistido (estado só em memória até o passo 5).

## Mudanças de código

### Novos arquivos
- `src/routes/_authenticated/workspaces.new.tsx` — rota do wizard (5 passos com stepper).
- `src/components/workspace/NewWorkspaceWizard.tsx` — UI dos passos.
- `src/lib/workspace/create.ts` — função `createWorkspace({ name, slug, description, themeId, seedFrom: "blank" | "current", overrides })` que faz os inserts acima de forma transacional do lado cliente (com rollback best-effort se algum passo falhar).

### Ajustes
- `src/routes/_authenticated/workspaces.index.tsx` — adicionar botão "+ Novo escritório" no header, visível apenas se `user_roles` contém `admin` (consulta já feita ou nova). Link para `/workspaces/new`.
- `src/components/office/MapEditor.tsx` — aceitar prop opcional `targetWorkspaceId?: string`. Quando presente:
  - Carrega overrides direto via `supabase.from("map_overrides").select` desse ws (não usa `loadOverrides()` local).
  - Salva via `upsert` nesse ws (não chama `saveOverrides` local, não dispara `map-overrides-changed`).
  - Quando ausente (comportamento atual), nada muda.
- `src/lib/map-overrides.ts` — exportar helpers já existentes não muda; usar diretamente `supabase` no `create.ts` para evitar interferência com o cache.

### Banco de dados
**Nenhuma migração necessária.** Schema atual já suporta tudo:
- `workspaces` tem policy de INSERT para `owner_id = auth.uid()`.
- `workspace_members` permite admin/self inserir.
- `map_overrides` aceita upsert por workspace admin.

## Gate de acesso

Botão e rota só funcionam se `has_role(auth.uid(), 'admin')`. Verificação no client (esconder UI) + as próprias RLS protegem o INSERT. Se um non-admin tentar acessar a rota, mostramos "Sem permissão" e redirecionamos.

## Isolamento garantido

- `MapEditor` em modo `targetWorkspaceId` **não** escreve em `localStorage["office-map-overrides:v1"]`.
- **Não** despacha `map-overrides-changed` (que faria o `OfficeScene` do workspace atual re-renderizar).
- **Não** muda `lastWorkspaceId` até o final, quando o admin escolher entrar no novo espaço.
- Workspace atual continua exatamente como está rodando.

## Fora de escopo (próximas iterações)
- Convites de membros já no wizard (hoje feito depois em `/workspaces/$workspaceId`).
- Templates pré-prontos além de "em branco" e "copiar atual".
- Edição em tempo real colaborativa do novo workspace antes de criar.
