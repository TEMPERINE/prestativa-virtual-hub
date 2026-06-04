
# Perfil do avatar + Onboarding de convidados

Vamos criar três peças conectadas: (1) um **menu de perfil** que abre ao clicar no seu avatar no header, (2) telas de **edição de personagem, nome, cor e frase**, e (3) um **fluxo guiado de onboarding** que aparece automaticamente para qualquer pessoa cuja conta ainda não tenha personagem escolhido.

---

## 1. O que cada usuário vai poder personalizar

| Campo | Onde fica | Observação |
|---|---|---|
| **Nome do avatar** (`display_name`) | Editar perfil | Aparece em cima do avatar (não usa mais o email) |
| **Cor do nome** (`avatar_color`) | Editar perfil | Color picker livre — pinta a tag acima do avatar |
| **Frase favorita** (`tagline`, novo) | Editar perfil | Aparece em balãozinho/hover, e abaixo do nome no menu |
| **Status** (`status`, novo: `available` / `busy` / `away`) | Header do menu | Bolinha verde/laranja/cinza ao lado do nome |
| **Sprite do personagem** (`sprite_id`, novo) | Editar personagem | Escolhe de um catálogo (loira, morena, padrão atual, etc.) |

> Inicialmente vou subir mais 2 sprites femininos (loira e morena de cabelo cacheado, dos exemplos enviados). O catálogo é facilmente extensível depois.

---

## 2. Menu de perfil (popover do header)

Ao clicar no próprio avatar/iniciais no canto do header, abre um popover idêntico à referência:

```text
┌────────────────────────────────┐
│ [sprite] Márcio          ⋮  ›  │   ← nome do avatar + status
│          ● Disponível          │
├────────────────────────────────┤
│ 😊 Energia lá em cima…    [x]  │   ← frase favorita editável inline
├────────────────────────────────┤
│ 👕 Editar personagem            │   → abre catálogo de sprites
│ 👤 Editar perfil                │   → abre form (nome, cor, frase)
│ 🪑 Ir até minha mesa   Ctrl+D   │   → teleporta para zona reivindicada
│ ↻ Me leve ao saguão            │   → teleporta para SPAWN do lobby
├────────────────────────────────┤
│ marciotemperine@gmail.com  Sair │
└────────────────────────────────┘
```

Comportamentos:
- O nome em cima do avatar no mapa passa a ser `display_name` (já é, mas vou trocar **Márcio Temperine → Márcio** e cor → **roxo** no seed).
- Clicar no status abre submenu com Disponível / Ocupado / Ausente.
- "Ir até minha mesa" desabilitado (cinza) se o usuário não tem `workspace_claim`.
- "Me leve ao saguão" desabilitado se já está no lobby.

---

## 3. Telas de edição

**Editar personagem** (modal full-screen leve):
- Grid de cards com preview animado de cada sprite disponível.
- Card selecionado fica destacado com a `avatar_color`.
- Botão "Salvar" grava `profiles.sprite_id`.

**Editar perfil** (modal):
- Campo **Nome do avatar** (max 24 chars).
- **Cor do nome** — color picker (input nativo + 8 swatches sugeridos).
- **Frase favorita** (max 80 chars).
- Preview ao vivo da tag flutuante no topo.

---

## 4. Onboarding de convidados

Quando alguém faz login pela primeira vez (`profiles.sprite_id IS NULL` OU `profiles.onboarded_at IS NULL`), o app intercepta antes de renderizar o escritório e mostra um wizard de boas-vindas em **4 passos**, em tela cheia, com a paleta do app:

1. **Boas-vindas** — "Bem-vindo ao Prestativa Office 👋. Vamos montar seu avatar em 1 minuto." + ilustração.
2. **Escolha seu personagem** — grid dos sprites disponíveis (mesma UI do "Editar personagem").
3. **Seu nome e cor** — input do nome (pré-preenche com o prefixo do email, editável) + color picker para a cor da tag.
4. **Sua vibe** — frase favorita (opcional, com sugestões clicáveis: "Bora codar!", "Café primeiro", "Foco total", etc.) + status inicial.

Final → grava tudo + `onboarded_at = now()` e entra no escritório com um toast "Bem-vindo(a), {nome}! 🎉".

Quem já está onboarded nunca mais vê o fluxo. Existe também um botão "Refazer onboarding" escondido em Editar perfil para testes.

---

## 5. Catálogo de sprites

Crio `src/lib/sprite-catalog.ts`:

```ts
export const SPRITES = [
  { id: "marcio",      label: "Márcio (padrão)",  gender: "m", sheets: { down: ..., up: ..., left: ..., right: ... } },
  { id: "blonde-bun",  label: "Loira",            gender: "f", sheets: { ... } },
  { id: "curly-dark",  label: "Morena cacheada",  gender: "f", sheets: { ... } },
];
```

Os sprites laterais novos seguem o mesmo layout 6 frames horizontais que o atual (com o frame 0 = idle, frame 3 substituído por idle — lógica já implementada no OfficeScene). Vou cortar cada linha do seu PNG enviado em 4 arquivos (down/up/left/right) usando o mesmo formato dos atuais e subir como assets.

`AvatarSprite` em `OfficeScene` passa a aceitar `spriteId` e ler do catálogo em vez do import fixo.

---

## 6. Mudanças técnicas (resumo)

**Banco (migration):**
- `ALTER TABLE profiles ADD COLUMN sprite_id text DEFAULT 'marcio'`
- `ALTER TABLE profiles ADD COLUMN tagline text`
- `ALTER TABLE profiles ADD COLUMN status text DEFAULT 'available' CHECK (status IN ('available','busy','away'))`
- `ALTER TABLE profiles ADD COLUMN onboarded_at timestamptz`
- Atualizar perfil do Márcio: `display_name='Márcio'`, `avatar_color='#9b5cf6'` (roxinho).

**Frontend (novos arquivos):**
- `src/components/profile/ProfileMenu.tsx` — popover do header
- `src/components/profile/EditCharacterModal.tsx`
- `src/components/profile/EditProfileModal.tsx`
- `src/components/onboarding/OnboardingWizard.tsx` (com 4 steps internos)
- `src/lib/sprite-catalog.ts`
- Assets: `src/assets/sprites/blonde-bun-{down,up,left,right}.png` e `curly-dark-*.png` (recortados dos PNGs enviados)

**Frontend (edições):**
- `OfficeScene.tsx`: trocar header (botão de avatar abre ProfileMenu), `AvatarSprite` aceita `spriteId`, label do avatar usa `display_name`, hook que dispara onboarding se necessário.

**Sem mudanças** em RLS (já cobre update do próprio profile), nem em realtime.

---

Quer que eu siga assim? Se sim, no próximo passo eu já implemento a migration + menu de perfil + edição + onboarding, atualizo seu nome para "Márcio" em roxo, e adiciono os 2 sprites femininos ao catálogo. Depois disso você cria o segundo usuário pelo fluxo de convite e testamos voz/vídeo entre os dois.
