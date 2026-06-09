
## Objetivo

Eliminar todo o fluxo de auto-cadastro. Só **você (admin)** cria contas. Usuário recebe email + senha, faz login direto, escolhe personagem e cai num espaço que **você já atribuiu**.

---

## Mudanças no comportamento

### 1. Cadastro público — DESLIGADO
- Supabase: `disable_signup: true`, `auto_confirm_email: true` (já está).
- Página `/auth` passa a ter **só login** — aba "Criar conta" some pra sempre.
- Rota `/convite/$token` e tabela `signup_invites` viram desnecessárias → **removidas**.

### 2. Admin cria contas
- Nova tela `/admin/contas` (super-admin only):
  - Campos: email, senha provisória, nome, plano (essencial/pro/premium), opcional: workspace + role pra já entrar como membro.
  - Backend: server function com `supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true })` + define plano no `profiles` + opcionalmente adiciona em `workspace_members`.
  - Lista de contas existentes com: trocar plano, resetar senha, desativar, adicionar a workspaces.

### 3. Onboarding simplificado
- Wizard atual de avatar continua.
- **Some** o passo de criar/escolher workspace.
- Após avatar:
  - Se tem 1 workspace → vai direto pro escritório.
  - Se tem 2+ → tela de seleção.
  - Se tem 0 → tela `aguardando-convite` (renomear pra `sem-acesso`) dizendo "Fale com seu admin".

### 4. Convites de workspace (manter, mas simplificado)
- Admin de um workspace ainda pode adicionar membros, mas **direto** (escolhendo de uma lista de contas existentes) — não por link.
- Mantém `workspace_invites` só pro caso futuro de vendas, mas a UI atual oculta o gerador de link.

### 5. Super-admin
- Você (márcio) é o único `role = 'admin'` na tabela `user_roles`.
- Garante via migration que seu user_id já tem esse role.
- Telas `/admin/*` exigem `has_role(auth.uid(), 'admin')`.

---

## Arquivos afetados

**Removidos:**
- `src/routes/convite.$token.tsx`
- `src/routes/_authenticated/admin.invites.tsx` (substituída por `admin.contas.tsx`)
- `src/lib/invites.ts` (ou reduzido pra zero)

**Editados:**
- `src/routes/auth.tsx` — remove aba signup, remove leitura de `pendingInviteToken`.
- `src/routes/_authenticated/onboarding.tsx` — remove `redeemPendingInvite`, lógica de redirect baseada em quantos workspaces o user tem.
- `src/routes/_authenticated/aguardando-convite.tsx` → renomeada `sem-acesso.tsx`, texto novo.
- `src/routes/_authenticated/workspaces.index.tsx` — remove atalho pra invites.

**Criados:**
- `src/routes/_authenticated/admin.contas.tsx` — UI de gestão de contas.
- `src/lib/admin/accounts.functions.ts` — server functions `createAccount`, `listAccounts`, `resetPassword`, `setPlan`, `assignToWorkspace`.

**Banco (migration):**
- `disable_signup = true` via `configure_auth`.
- Drop `signup_invites` (ou só revoga grants).
- Drop RPCs `signup_invite_redeem` e `invite_peek` (essa última só se nada mais usar).
- Garante seu user como `admin` em `user_roles`.

---

## Detalhes técnicos

**Server fn de criação de conta:**
```ts
createAccount({ email, password, displayName, plan, workspaceId?, role? })
  → supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true,
      user_metadata: { display_name } })
  → trigger handle_new_user já cria profile + user_roles('member')
  → UPDATE profiles SET plan = ? WHERE id = newUser.id
  → if workspaceId: INSERT workspace_members
```

**Guarda admin:**
- Server fn checa `has_role(context.userId, 'admin')` antes de qualquer operação privilegiada.
- Front: `useMyRole()` hook lendo `user_roles` pra esconder/mostrar menu admin.

**Onboarding flow novo:**
```text
login → /onboarding (só avatar)
       → ao terminar, conta workspaces do user:
         0 → /sem-acesso
         1 → /workspaces/<id>
         2+ → /workspaces (lista)
```

---

## O que NÃO faço agora

- Não removo `workspace_invites` (você pode querer reativar pra venda externa).
- Não mexo no fluxo de meetings, sprites, mapa.
- Não construo cobrança/Stripe — fica pra depois.

---

## Pergunta antes de executar

Confirma que **só você** é admin? (vou hardcodar seu email na migration pra garantir o role).
Qual é o email da sua conta admin?
