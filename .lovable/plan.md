# Hub Admin único — Contas, Espaços e Personagens

Hoje só você é admin. A ideia é centralizar tudo em `/admin/*` para que ninguém mais precise (nem possa) criar/editar espaços ou cadastrar personagens.

## 1. Espaços (workspaces) — só admin cria

**Mudanças de regra:**
- Remover criação de workspace pelo usuário comum. A rota `/workspaces/new` passa a redirecionar para `/workspaces` (ou some do menu). O botão "Criar novo espaço" no hub de workspaces some para não-admins.
- Migration: política RLS de INSERT em `workspaces` passa a exigir `has_role(auth.uid(), 'admin')`. UPDATE/DELETE idem (já tem owner check, vou somar admin override).

**Nova aba `/admin/espacos`:**
- Listar todos os workspaces (nome, tier, dono, nº membros).
- Criar novo: nome, tier (1/2/3), dono (escolhe entre contas existentes — usa lista que já está em `/admin/contas`).
- Para cada workspace, atalhos diretos pros editores **sem precisar entrar no workspace**:
  - "Editar mapa" → abre `/office/editor?workspaceId=<id>` (a rota `office_.editor.tsx` já existe; vou ajustar pra aceitar `workspaceId` na query e, se admin, carregar o mapa daquele ws sem exigir membership).
  - "Áreas / zonas" → mesmo editor (é tudo no MapEditor).
  - "Props customizados" → reaproveita o editor existente, escopado ao workspace selecionado.
- Renomear, mudar tier, excluir.

## 2. Personagens (sprites) — editor admin

Hoje sprites são **hard-coded** em `src/lib/sprite-catalog.ts` (importados como assets do bundle). Para você poder adicionar/renomear/criar exclusivos por workspace em runtime, precisamos mover pra banco + storage:

**Banco (migration):**
- Tabela `sprite_skins`:
  - `id` (slug, ex: `marcio`), `label`, `gender` (m/f/n)
  - `workspace_id uuid null` — `null` = global (todo mundo vê); preenchido = exclusivo daquele workspace
  - `mirror_right_from_left bool`, `mirror_left_from_right bool`
  - `sheets jsonb` — `{ up: path, down: path, left: path, right: path }` (paths no bucket)
  - `dims jsonb` — `{ up:{w,h}, down:{w,h}, ... }`
  - `created_by`, timestamps
- Bucket storage **público** `sprite-sheets/` (sprites precisam ser lidos no `<img>`, então público é simples).
- RLS: SELECT liberado pra `authenticated` que seja membro do workspace OU sprite global. INSERT/UPDATE/DELETE só admin.
- Seed: inserir as 9 skins atuais (marcio, blonde, curly, redhead, afro, japa, morena, latina, indi) como global, com os mesmos `dims` e os assets já no bucket (upload do `src/assets/sprites/*` via script de seed na própria migration usando os caminhos atuais — alternativa: manter as 9 atuais hard-coded como fallback e o catálogo db é "extras". **Vou fazer essa rota** — mais simples e zero risco de quebrar o que já funciona.).

**Catálogo runtime (`sprite-catalog.ts`):**
- Mantém as 9 skins atuais hard-coded (fallback offline-friendly).
- Nova função `loadSpriteCatalog(workspaceId)` que faz fetch das skins do db (globais + do ws) e devolve `SPRITES` merged. Hook `useSpriteCatalog(workspaceId)` com cache.
- `AlignedSprite` continua igual — só passa a aceitar sprite dinâmico do catálogo merged.

**Nova aba `/admin/personagens`:**
- Lista todas as skins (badge "Global" ou nome do workspace).
- Renomear (label), trocar gender, ajustar dims/mirror, excluir, **renomear inclui as 9 default** (vou permitir override de label das default skins gravando uma row "override" — ou mais simples: também migrar as 9 pro db e sumir com o hard-code). Decisão: **migro as 9 pro banco** com upload automático dos PNGs atuais via storage na primeira inicialização (script `seed-default-sprites.ts` rodado uma vez via server fn admin-only "Inicializar skins padrão"). Catálogo passa a vir 100% do db.
- Criar nova skin: upload de 3 ou 4 sheets PNG (down/up/left + opcional right), dims auto-detectadas (lê dimensões da imagem no browser antes do upload e divide largura por 6 frames), opção "espelhar right do left", workspace (global ou um específico).
- O script `scripts/process-skin-sheet.py` continua sendo o jeito recomendado pra preparar a folha; UI vai mostrar uma nota "Recomendado: rode o script de pré-processamento antes do upload".

## 3. Mover navegação para um hub admin

`/admin` vira página índice com 3 cards:
- Contas (`/admin/contas` — já existe)
- Espaços (`/admin/espacos` — novo)
- Personagens (`/admin/personagens` — novo)

Botão "Admin" só aparece no hub de workspaces se `has_role admin`.

## Arquivos afetados

**Novos:**
- `src/routes/_authenticated/admin.index.tsx` (hub)
- `src/routes/_authenticated/admin.espacos.tsx`
- `src/routes/_authenticated/admin.personagens.tsx`
- `src/lib/admin/workspaces.functions.ts`
- `src/lib/admin/sprites.functions.ts`
- `src/lib/sprites/useSpriteCatalog.ts`
- Migration (tabela `sprite_skins`, bucket `sprite-sheets`, políticas, RLS de `workspaces` para admin)

**Editados:**
- `src/lib/sprite-catalog.ts` (passa a ser async + fallback)
- `src/components/sprites/AlignedSprite.tsx` (aceitar SpriteDef direto além de spriteId)
- `src/components/profile/SpritePreview.tsx`, `EditCharacterModal.tsx`, `OnboardingWizard.tsx` (usar hook com workspaceId)
- `src/routes/_authenticated/workspaces.index.tsx` (link "Admin", remove "Criar novo espaço" para não-admin)
- `src/routes/_authenticated/workspaces.new.tsx` (redirect ou bloqueio para não-admin)
- `src/routes/_authenticated/office_.editor.tsx` (aceitar `?workspaceId=` admin override)
- `src/routes/_authenticated/admin.contas.tsx` (vira sub-aba do hub admin, sem mudanças funcionais)

## Escopo / ordem de entrega

Como é grande, sugiro entregar em 2 PRs lógicos no mesmo loop:
1. **Espaços** (mais simples — só RLS + UI nova, reaproveita editor).
2. **Personagens** (migração das skins pro banco + uploader).

## Pergunta antes de começar

1. **Migrar as 9 skins atuais pro banco** (recomendo) ou **manter hard-coded e só permitir adicionar extras**? Migrar é mais limpo (você renomeia tudo, edita dims, deleta o que não quer), mas exige um seed automático que sobe os PNGs pro storage na primeira execução. Se preferir o caminho conservador (mais rápido, menos risco), faço só "extras".

2. **Editor de mapa "fora do workspace"**: o editor atual usa o workspace atual ativo. Topo: te permito trocar de workspace ali dentro (dropdown "Editando: <ws>"). Confirmo essa abordagem?

3. **Sprites por workspace exclusivos** podem ser vistos por **membros daquele ws apenas** (correto?), ou você quer também conseguir atribuir um sprite exclusivo de um ws para um usuário que não é membro?

Responde 1/2/3 e eu sigo.