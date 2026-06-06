# Plano: Polimento de UX + "Minhas Reuniões" (gravação tipo Loom com IA)

## Parte 1 — Melhorias de UX nas funcionalidades já existentes

Lista priorizada (P0 = alto impacto, P2 = nice-to-have):

### Reunião / vídeo / áudio

- **P0** Indicador de quem está falando (anel verde animado em volta da tile quando o nível de áudio passa de um threshold — usa `AudioContext` + `AnalyserNode`, baratíssimo).
- **P0** Botão "Levantar a mão" ✋ que aparece como badge na tile do avatar e na lista de participantes.
- &nbsp;
- **P0** Notificação visual ao entrar/sair alguém da chamada (toast discreto) + som suave opcional.
- **P1** Pinar uma tile específica em modo share/grid.
- **P1** Modo "spotlight" automático: a tile de quem está compartilhando ou falando vira a principal.
- **P1** Estado de conexão por peer (verde/amarelo/vermelho) baseado em `getStats()` (RTT + packet loss).
- **P1** Background blur na câmera (via `@mediapipe/selfie_segmentation`, opcional e leve, só liga sob demanda).
- **P2** Reações rápidas com emoji flutuando na tile (👏 ❤️ 😂).

### Avatar / cenário / navegação

- **P0** Minimapa no canto mostrando salas e densidade de pessoas (clique para teletransportar quando permitido).
- **P0** Tooltip ao passar mouse em outro avatar com nome, status, e botão "ir até".
- **P1** Indicador "ocupado em reunião" no avatar (já está em chamada) com ícone de headset.
- **P1** Pathfinding suave ao clicar no chão (em vez de teleporte direto), respeitando colisão.
- **P2** Modo "seguir" um colega (anda atrás dele automaticamente).

### Presença / colaboração

- **P0** Lista lateral colapsável de quem está online por sala (substituindo/complementando o minimapa).
- **P0** "Bater na porta" antes de entrar em sala fechada — pinga o ocupante.
- **P1** Status customizado com emoji (🍕 almoço, 🎧 foco, 📞 em call).
- **P1** Histórico de mensagens do chat persistido + busca.

### Recadinhos / props

- **P1** Preview do recadinho em hover antes de abrir.
- **P2** Animação de "voa até a mesa" ao enviar recadinho.

### Onboarding / performance

- **P0** Skeleton loaders enquanto sprites carregam (reduz a sensação de tela travada).
- **P1** Lazy-load de sprite sheets fora do viewport.
- **P1** Atalho `?` que abre um modal com todos os atalhos.

---

## Parte 2 — "Minhas Reuniões": gravação + IA (leve e funcional)

### Visão geral

Permitir que um participante grave a reunião (vídeo composto + áudio mixado), suba para storage, e dispare um pipeline IA que gera **transcrição com timestamps + resumo executivo + tópicos + action items**. Tudo fica em `/perfil/minhas-reunioes`.

### Arquitetura (escolhas pensadas pra ser leve)

**Captura — 100% no cliente, zero servidor de mídia:**

- Usar `MediaRecorder` nativo gravando uma `CanvasCaptureMediaStream` que combina:
  - Tiles de vídeo dos peers (já temos os `MediaStream` no `useRtcMesh`)
  - Tela compartilhada quando ativa
  - Áudios mixados via `AudioContext` (`createMediaStreamDestination`)
- Codec: `video/webm; codecs=vp9,opus` (suportado em Chrome/Edge, fallback vp8). Bitrate ~1.2 Mbps vídeo + 64 kbps áudio = ~9 MB/min — leve.
- Só **um** participante grava por vez (o que apertou "iniciar gravação"). Banner vermelho "🔴 Gravando" visível pra todos via canal realtime — consentimento explícito.

**Upload — direto pro Supabase Storage:**

- Bucket privado `meeting-recordings` (RLS: dono lê/escreve; participantes lêem).
- Upload em chunks via `MediaRecorder` com `timeslice: 5000` ms → cada chunk vai pro storage com `upload` resumível (`tus`). Se cair a conexão, retoma.
- Tamanho médio reunião 30 min ≈ 270 MB. Aceitável; mostrar aviso "reuniões longas consomem armazenamento".

**Transcrição — Lovable AI Gateway:**

- Após upload completo, server function `transcribeRecording` extrai áudio (já gravamos áudio separadamente em `.opus` pra evitar precisar de ffmpeg no Worker — **importante**: gravar 2 streams em paralelo, um vídeo+áudio pra reprodução e um só áudio comprimido pra IA).
- Enviar `.opus` (ou `.webm` audio-only) pro modelo de transcrição. Lovable AI Gateway hoje serve LLMs de texto/imagem; **precisamos confirmar disponibilidade de STT** — se não houver, alternativas:
  - (a) Usar `Web Speech API` em tempo real no navegador do gravador (grátis, mas qualidade variável e só Chrome).
  - (b) Conectar Deepgram/AssemblyAI via secret manual (alta qualidade, custo baixo ~$0.004/min).
  - (c) Whisper via Replicate connector.
- **Recomendação:** começar com (a) Web Speech API em paralelo à gravação (legendas ao vivo + transcrição grátis), e oferecer upgrade pra Deepgram quando o usuário quiser maior qualidade.

**Resumo + tópicos + action items — Lovable AI (Gemini Flash):**

- Server function `summarizeMeeting` recebe a transcrição e devolve JSON estruturado via `Output.object`:
  ```ts
  { summary: string, topics: string[], action_items: {who, what, due?}[], highlights: {timestamp, text}[] }
  ```
- Modelo: `google/gemini-3-flash-preview` — barato, rápido, bom em pt-BR.

**Persistência — Supabase:**

- Tabela `meeting_recordings`:
  - `id, owner_id, started_at, ended_at, duration_s, title, video_path, audio_path, transcript jsonb, summary jsonb, participants uuid[], status (recording|uploading|transcribing|summarizing|ready|failed)`
- Tabela `meeting_participants` (N:N) pra permitir que cada participante veja a reunião em "minhas reuniões".
- RLS: SELECT se `auth.uid() = owner_id OR auth.uid() = ANY(participants)`.
- Realtime na coluna `status` pra UI mostrar progresso ("transcrevendo… resumindo…").

### Fluxo UX

1. Botão 🔴 "Gravar" na barra de controles da reunião (só pra quem está em call).
2. Confirmação modal: "Todos os participantes serão notificados. Iniciar?" + checkbox "incluir tela compartilhada".
3. Banner pulsante no topo: "🔴 Reunião sendo gravada por X" — todos vêem.
4. Parar gravação → toast "Processando… você receberá notificação".
5. Pipeline: upload → transcrição → resumo → status `ready`.
6. Em `/perfil/minhas-reunioes`: cards com thumbnail, duração, participantes, resumo curto, e player ao clicar (vídeo + transcrição lado a lado, clique no timestamp pula no vídeo).
7. Ações: baixar mp4/pdf do resumo, deletar, compartilhar link com participantes.

### Limites pra manter leve

- Máx 60 min por gravação (UI bloqueia depois).
- Máx 5 gravações simultâneas na plataforma (lock via tabela).
- Auto-delete vídeo após 30 dias (resumo + transcrição ficam). Configurável.
- Gravação local-first: nada toca o servidor enquanto grava — zero overhead na reunião.

### Riscos / decisões pendentes

- **STT provider**: confirmar se Lovable AI tem speech-to-text. Se não, qual fallback? (Web Speech grátis vs Deepgram pago).
- **Custo de storage**: 270 MB × N reuniões pode estourar. Considerar transcodar pra resolução menor pós-upload (mas isso pede um worker externo — fora do escopo "leve").
- **Compatibilidade**: `MediaRecorder` com Canvas composto só funciona bem em Chromium. Firefox/Safari ficam sem gravação (mostrar aviso).

---

## Entrega proposta em fases

**Fase 1 (UX P0):** indicador de fala, levantar mão, atalhos, toasts de entrada/saída, tooltip de avatar, minimapa básico.

**Fase 2 (Gravação MVP):** captura local + upload + tabela + página "minhas reuniões" só com vídeo (sem IA ainda).

**Fase 3 (IA):** Web Speech para transcrição + Gemini Flash para resumo estruturado + player com transcrição clicável.

**Fase 4 (Polish):** UX P1, pin/spotlight, status de conexão, opção Deepgram via secret, compartilhamento de reunião.

---

## Perguntas antes de eu começar

1. Qual fase você quer que eu implemente **primeiro**? Sugiro **Fase 1** (UX P0) — entrega valor rápido sem mexer em backend pesado. Mas se a gravação é prioridade, vamos direto pra Fase 2+3. IMPLEMENTE UMA FASE DE CADA VEZ>.. e vamos dando check dando tudo certo
2. Pra transcrição: topa começar com **Web Speech API** (grátis, qualidade ok, só Chrome) e deixar Deepgram como upgrade opcional? Me diga o custo antes de implementar.. e o que preciso fazer... e se a opcao gratis funciona bem
3. Quer que TODOS os participantes vejam a reunião em "minhas reuniões", ou só quem gravou (com opção de compartilhar)?  quem participou em algum segundo... vai ter disponivel em MINHAS REUNIOES (logo abaixo de meus recados)  
4. Algum dos itens da lista de UX que você quer **remover** ou **adicionar** antes de eu priorizar?