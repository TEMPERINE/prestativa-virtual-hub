
# Jornada de entrada por convite

Modelo escolhido: **dois tipos de convite num mesmo fluxo de URL**, signup público bloqueado, wizard de avatar primeiro, workspace depois. Desenhado pra escalar pra venda self-service no futuro sem refazer schema.

## 1. Tipos de convite

| Tipo | Quem gera | O que faz ao ser redimido |
|---|---|---|
| **Convite de signup** (provision) | Você (super-admin global) | Cria conta + workspace NOVO (a pessoa vira owner), define o plano (`essencial`/`pro`/`premium`) e tier do workspace |
| **Convite de membro** (existente, `workspace_invites`) | Owner/admin de qualquer workspace | Adiciona a pessoa como membro de um workspace JÁ EXISTENTE |

Ambos passam pela mesma URL pública `/convite/$token` — o backend identifica o tipo e roteia o fluxo. O usuário não precisa saber a diferença.

## 2. Schema (nova migration)

**Nova tabela `signup_invites`** (não toca em `workspace_invites`, que já cobre o caso de membro):

- `token` (gerado), `email` (opcional — quando null, qualquer email pode usar), `plan` (`account_plan`), `tier` (1/2/3), `workspace_name_suggestion` (opcional), `max_uses` (default 1), `uses` (default 0), `expires_at` (default 30 dias), `created_by`, `notes`, timestamps.
- RLS: só `has_role(auth.uid(), 'admin')` faz SELECT/INSERT/UPDATE/DELETE. Anônimos NÃO leem direto — leitura pública vai por RPC.

**Relaxar `workspace_invites`**: tornar `email` nullable + adicionar `max_uses`/`uses` pra suportar "link compartilhável" também no convite de membro (sem retrabalho quando workspaces forem vendidos e admins quiserem gerar links abertos pro time).

**Novas RPCs (SECURITY DEFINER, schema public)**:

- `invite_peek(_token text)` → retorna `{ kind, valid, expires_at, workspace_name, plan, tier, email_lock }` sem exigir auth. Permite a tela de convite mostrar "Você foi convidado pro workspace X com plano Pro" antes do cadastro.
- `signup_invite_redeem(_token text)` → autenticado. Valida token, cria workspace tier definido, faz `profiles.plan = invite.plan`, insere `workspace_members` com role `owner`, incrementa `uses`. Retorna `workspace_id`.
- `workspace_accept_invite(_token text)` → já existe; só ajustar pra aceitar tokens sem email travado quando `max_uses > 1`.

## 3. Fluxo de entrada (UX)

```text
Sem convite:
  /auth → só mostra tab "Entrar" (signup escondido)
  CTA pequeno: "Acesso por convite. Fale com a administração."

Com convite (link recebido):
  /convite/<token>
    ├─ peek → mostra "Você foi convidado pra criar seu espaço (plano Pro)"
    │         OU "Você foi convidado pra entrar no espaço 'Prestativa'"
    ├─ se NÃO logado → form signup (email pré-preenchido se invite trava email)
    │   após signup → guarda token em sessionStorage → /onboarding
    ├─ se logado e email casa → botão "Aceitar convite"
    │   ao clicar → redeem → redireciona

/onboarding (wizard de avatar, fluxo atual)
  onDone → se tiver token pendente em sessionStorage:
            chama redeem apropriado → /workspaces/<id>
          senão → /workspaces (lista vazia se não tem invite,
                  com mensagem "Aguardando convite")
```

Wizard de avatar fica **antes** de entrar no workspace (decisão sua). Não muda o `OnboardingWizard.tsx` atual.

## 4. UI de geração de convites

**Super-admin (você) — nova rota `/admin/invites`:**
- Gate: `has_role(auth.uid(), 'admin')`.
- Formulário: email opcional, plano, tier, validade, máx. usos, observações.
- Lista de convites gerados com botão "copiar link" + status (não usado / aceito / expirado).
- Link copiado: `https://<host>/convite/<token>`.

**Owner/admin de workspace — ampliar UI atual de convidar membro:**
- Manter o convite por email (já existe).
- Adicionar botão "Gerar link compartilhável" → cria `workspace_invites` com email null e `max_uses` configurável.
- Útil agora pra você convidar gente fácil, e amanhã pra clientes pagantes convidarem o time deles.

## 5. Bloqueio de signup público

Não tocar em `disable_signup` do Supabase (precisa permitir signup pra quem tem token). O bloqueio é **só de UX**:

- `/auth` sem `?invite=<token>` na URL e sem token em sessionStorage → tab "Criar conta" oculta.
- Backend continua aceitando signup (pra não quebrar fluxo de convite). Defesa em profundidade: ao primeiro login, se a pessoa não tiver workspace E não tiver token pendente, mandar pra `/aguardando-convite`.

## 6. Memória de pricing/produto

Os 3 planos (`essencial`/`pro`/`premium`) já existem em `profiles.plan` e o trigger `workspaces_enforce_owner_plan` já valida tier vs plano. O convite de signup amarra "plano da conta" + "tier do workspace inicial" num único token — então quando virar venda, só trocar a UI de "admin gera convite" por "checkout gera convite automaticamente" (Stripe webhook chama mesma RPC `signup_invite_redeem`).

## 7. Entregas (ordem de implementação)

1. **Migration**: tabela `signup_invites` + RPCs `invite_peek` / `signup_invite_redeem` + relax do `workspace_invites`.
2. **Rota `/convite/$token`** (pública, SSR off) com peek + signup-form-com-token / aceite-direto-se-logado.
3. **Ajustar `/auth`**: esconder tab signup quando não houver token em URL/sessionStorage; ler token de `?invite=` e propagar.
4. **Ajustar `/onboarding`**: após `onDone`, ler token pendente e chamar redeem correto antes do redirect.
5. **Rota `/admin/invites`** pra você gerar links de signup.
6. **Ampliar UI de convites do workspace** com "gerar link compartilhável".
7. **Rota `/aguardando-convite`** como safety net.

## Detalhes técnicos

- Todas RPCs `SECURITY DEFINER` com `search_path = public`.
- `signup_invites` com `GRANT SELECT, INSERT, UPDATE, DELETE TO authenticated` + RLS gateando por `has_role`. `invite_peek` exposta como RPC com `GRANT EXECUTE TO anon, authenticated` (lê via função, não tabela).
- Token em `sessionStorage` (não localStorage) pra não vazar entre sessões diferentes.
- `/convite/$token` é rota top-level (pública, SSR on) com `head()` próprio.
- Toda criação de workspace via redeem usa o mesmo `createWorkspace` helper já existente (ou inlineia no RPC pra atomicidade) — escolho **inline no RPC** pra ser transacional.
