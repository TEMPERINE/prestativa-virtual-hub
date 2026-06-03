
# Prestativa Office — Plano de Construção

Aplicação web (preparada para empacotar como desktop) que recria fielmente o escritório da imagem de referência como um ambiente 2D navegável, com presença em tempo real, chat e comunicação A/V por zona via LiveKit.

## Stack

- **Frontend:** TanStack Start + React + Tailwind
- **Renderização do mapa:** Canvas 2D com **PixiJS** (sistema de camadas, sprites, colisão, performance para 20+ avatares)
- **Backend / Realtime / Auth / DB:** Lovable Cloud (Supabase) — Realtime channels para posição, presença e chat
- **A/V e Screen Share:** **LiveKit Cloud** (1 room por zona; troca automática ao caminhar)
- **Empacotamento desktop (fase futura):** Tauri (mais leve que Electron, ideal para "app sempre aberto")

## Entregas em fases

### Fase 1 — Fundação visual e navegação (esta entrega)
1. Auth por convite (admin cria contas)
2. Mapa renderizado fielmente à referência
3. Avatar, movimentação, colisão, sistema de camadas
4. Detecção de zona (Operação, Supervisão, Diretoria, Reunião, Feedback, Descompressão)

### Fase 2 — Presença e chat
5. Presença em tempo real (online/offline, posição compartilhada)
6. Painel lateral da equipe
7. Chat: privado, geral e por ambiente

### Fase 3 — Comunicação A/V
8. Integração LiveKit (1 room por zona)
9. Áudio automático ao entrar na zona
10. Vídeo + screen share nas salas de Reunião e Feedback

### Fase 4 — Empacotamento desktop (futuro)
11. Wrap em Tauri (Windows/macOS)

---

## Estrutura inicial do escritório (fiel à referência)

Zonas mapeadas como polígonos lógicos:
- **Operação / Atendimento** (10 estações + supervisora destacada à esquerda)
- **Diretoria** (mesas abertas Márcio + Dani, sem paredes)
- **Sala de Reunião** (fechada, mesa para 16, telão)
- **Sala de Feedback** (fechada, pequena, poltronas)
- **Área de Descompressão** (sofás, café, biblioteca, parede "Respire. Desacelere. Recomece.")
- **Áreas externas** (jardim, rua) — não navegáveis

---

## Tela e fluxo

```text
┌─────────────────────────────────────────────────────────────┐
│ Topbar: logo Prestativa | zona atual | mic | cam | tela     │
├──────────────────────────────────────────────┬──────────────┤
│                                              │  EQUIPE      │
│                                              │  ● Dani      │
│         CANVAS DO ESCRITÓRIO                 │  ● Márcio    │
│         (PixiJS, 1920x1080 base)             │  ○ Ana       │
│         WASD/setas p/ mover                  │  ● Júlia     │
│         Click p/ ir até                      │  …           │
│                                              │              │
│                                              │  CHAT        │
│                                              │  [Geral]     │
│                                              │  [Zona]      │
│                                              │  [DM]        │
└──────────────────────────────────────────────┴──────────────┘
```

---

## Detalhes técnicos

### Sistema de camadas (PixiJS)
Quatro camadas Z ordenadas:
1. **Base** — piso, tapetes, sombras, marcadores de zona
2. **Mid** — avatares (z-index dinâmico pelo Y do sprite, para perspectiva top-down)
3. **Overlay** — mesas, sofás, balcões (qualquer objeto que o avatar pode passar "atrás")
4. **UI** — labels de zona, nomes flutuantes

### Mapa e assets — abordagem "tileset modular, fiel à referência"
- Mapa dividido em **grid de tiles 32×32** (canvas total ~60×34 tiles)
- Definição do mapa em **JSON** (camadas de piso, colisão, zonas, spawns) — editável sem mexer no código
- **Sprites placeholder** gerados com `generate_image` (premium) reproduzindo fielmente cada elemento da referência: mesas, cadeiras rosa, sofás, plantas, telão, parede com logo, etc. — todos com fundo transparente
- Cada zona = polígono nomeado no JSON com `audioRoom: "operacao" | "reuniao" | ...`
- Estrutura preparada para você substituir os sprites por arte profissional depois (mesmo grid, mesmos nomes de arquivo)

### Colisão
- Camada de colisão no JSON do mapa (matriz booleana 32×32)
- Movimento valida cada passo contra a matriz
- Paredes, mesas, sofás e objetos fixos = bloqueados

### Movimentação
- Teclado (WASD/setas) + click-to-move (pathfinding A* simples no grid)
- Posição enviada ao servidor com throttle de 100 ms via Supabase Realtime

### Detecção de zona → áudio
- A cada movimento o cliente recalcula em qual polígono o avatar está
- Ao mudar de zona: `livekitRoom.disconnect()` → `livekitRoom.connect(zoneRoomName)`
- Mic entra automaticamente mutado; usuário ativa pelo topbar

### Banco de dados (Lovable Cloud)
```text
profiles        (id, display_name, avatar_seed, role, created_by_admin)
user_roles      (user_id, role: 'admin' | 'supervisor' | 'member')
positions       (user_id, x, y, zone, updated_at)         ← realtime
presence        gerenciado via Supabase Realtime Presence
messages        (id, channel_type, channel_id, sender_id, body, created_at)
                  channel_type: 'general' | 'zone' | 'dm'
dm_threads      (id, user_a, user_b)
invitations     (token, email, role, expires_at)          ← convite admin
```

RLS em todas as tabelas. `user_roles` em tabela separada com `has_role()` security-definer.

### LiveKit — geração de token
Server function `createServerFn` que valida o usuário Supabase e devolve um JWT LiveKit com `roomJoin` para a zona atual. Secrets: `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL`.

### Rooms LiveKit
- `zone:operacao` — áudio só (sempre que >1 pessoa na Operação)
- `zone:supervisao`, `zone:diretoria`, `zone:descompressao` — áudio só
- `zone:reuniao` — áudio + vídeo + screen share
- `zone:feedback` — áudio + vídeo + screen share

### Convite manual (admin)
- Admin loga em `/admin`, cria convite (email + role) → gera link único
- Convidada acessa link, define senha, entra direto no mapa

---

## Visual / Design system
- Paleta: rosa Prestativa (#E94B8C aprox., extraído da referência), creme, verde-jardim, madeira
- Tipografia: sans-serif moderna (Inter ou DM Sans) — interface limpa
- UI flutuante translúcida sobre o canvas (glass effect leve)
- Topbar minimalista com controles essenciais (mic/cam/tela/sair)

---

## O que **não** vai entrar nesta primeira versão
- Customização de avatar (usa seed/iniciais por enquanto)
- Auditório, Universidade Corporativa, Sala Comercial (arquitetura suporta, mas não construídos)
- Gravação de reuniões
- Notificações desktop
- App desktop empacotado (vem na Fase 4)
- Status custom além de online/offline

---

## Pré-requisitos seus para eu começar a Fase 3 (A/V)
Quando chegarmos lá vou pedir 3 secrets:
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `LIVEKIT_URL` (ex.: `wss://prestativa.livekit.cloud`)

Conta gratuita em https://cloud.livekit.io (free tier cobre desenvolvimento).

---

## Próximo passo
Ao aprovar, começo pela **Fase 1**: habilito Lovable Cloud, monto auth por convite, e construo o canvas do mapa com sprites gerados fiéis à referência + movimentação e colisão funcionando. Em seguida, encadeio Fases 2 e 3 sem precisar de nova aprovação ampla, só ajustes pontuais.
