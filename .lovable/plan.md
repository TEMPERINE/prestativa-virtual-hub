Sim — as três melhorias são totalmente viáveis e necessárias para chegar perto da fluidez do Gather. O código atual já tem as fundações (broadcast de posições, grace period RTC, polling 1s), mas várias peças críticas ainda faltam ou estão sub-otimizadas. Plano abaixo trata cada eixo de ponta a ponta.

## 1. Mídia warm-start (reduzir delay do vídeo, garantir áudio)

Hoje a câmera/mic só são adquiridos quando o usuário clica nos botões, **depois** o `replaceTrack` é feito em cada peer. Isso causa o delay percebido e janelas onde o áudio não sai.

- **Pré-adquirir mic na entrada do `/office`** (depois do gesto inicial de "Entrar"), com `getUserMedia({ audio: true, video: false })` e manter o track `enabled=false` até o usuário ativar. Toggle vira instantâneo (só flip de `enabled`), sem renegociação SDP.
- **Pré-aquecer a câmera opcionalmente** com resolução baixa (160x120) assim que o usuário concede permissão uma vez; `track.enabled=false` para não acender LED. Ao ligar, sobe para 320x240 via `applyConstraints` — sem novo `getUserMedia` e sem renegociar.
- **Transceivers já criados com direção `sendrecv` desde o connect** (já existe) + `setCodecPreferences` priorizando **Opus DTX/FEC** para áudio e **VP8** para vídeo (melhor compatibilidade cross-browser do que VP9/AV1 default).
- **Sinalização paralela ao `getUserMedia`**: hoje o `createPeer` espera o track. Vamos disparar offer assim que o transceiver existe, e fazer `replaceTrack(null→track)` quando a mídia ficar pronta — peer já está conectado, só o frame aparece.
- **Audio unlock global**: na primeira interação do usuário (clique no botão "Entrar"), criar/retomar um `AudioContext` compartilhado e chamar `.play()` em um `<audio>` silencioso. Isso destrava autoplay para todos os `<audio>` remotos futuros (problema atual: áudio remoto às vezes fica "preso" até o usuário interagir de novo).
- **Jitter buffer mínimo**: `RTCRtpReceiver.playoutDelayHint = 0.05` nos receivers de áudio quando suportado, reduzindo latência percebida.

## 2. Sincronização contínua de posições (heartbeat + reconciliação)

Hoje há broadcast a cada 120ms + polling DB a 1s + Postgres changes. Falta o "cinto e suspensório" que o Gather usa:

- **Heartbeat de presença via canal `presence`** do Supabase Realtime: cada cliente faz `track({ user_id, x, y, zone, facing, ts })` a cada 1s. Eventos `sync/join/leave` reconciliam o `positions` state — funciona mesmo se Postgres CDC falhar e revela quem está online instantaneamente (atual `is_online` depende de `beforeunload`, que falha em mobile/crash).
- **Last-write-wins por timestamp** em todas as 3 fontes (broadcast, presence, polling/CDC) para evitar "teletransporte" quando uma fonte chega atrasada.
- **Interpolação de posição** no render do avatar remoto: ao receber nova posição, interpolar do ponto atual ao alvo nos próximos 120ms (mesma cadência do envio). Movimento fica fluido em vez de "saltar" a cada update.
- **Detecção de stale**: se um peer não mandar heartbeat por 5s, marca como offline localmente (sem esperar polling DB).
- **Throttle inteligente do persist**: só persistir no DB quando há movimento real OU a cada 5s (vs 1s hoje) — reduz carga com 15 usuários e libera o canal realtime para broadcast.

## 3. Reconexão automática (sem derrubar mídia)

Hoje, se o WebSocket cair, os canais ficam "fantasmas". Plano:

- **Watchdog do Realtime** (`supabase.realtime.connection.socket`): observa `onclose`/`onerror`, e quando reconecta refaz `setAuth(token)` + re-`subscribe` em todos os canais (positions, broadcast, claims, notes, reactions, rtc-mesh) preservando handlers. Usa backoff exponencial 1s→2s→5s→10s (cap).
- **Refresh proativo de JWT**: assinar `supabase.auth.onAuthStateChange` e em `TOKEN_REFRESHED` chamar `realtime.setAuth(newToken)` — evita o canal cair silenciosamente após 1h.
- **WebRTC ICE restart**: em `pc.oniceconnectionstatechange === "failed"` ou `"disconnected" > 5s`, chamar `pc.restartIce()` e renegociar — **sem fechar o PC**, então mic/câmera continuam. Hoje o código destrói o peer após grace period, o que faz a mídia piscar.
- **Buffer de sinalização persistente**: a fila `pendingSignalsRef` já existe; estender para sobreviver à reconexão do canal (não esvazia no `CLOSED`).
- **Visibilidade**: ao voltar de `document.visibilitychange`, forçar um `syncPositions()` e um round de `hello` em todos os peers ativos.
- **TURN server**: hoje só tem STUN. Para garantir conexão atrás de NAT simétrico (comum em redes corporativas brasileiras), adicionar TURN (Twilio/Metered free tier ou self-hosted coturn). Sem isso, ~10% dos usuários nunca conectam vídeo P2P. **Decisão necessária do usuário** — ver pergunta abaixo.

## 4. Detalhes técnicos (resumo)

- `useRtcMesh.ts`: mover criação dos transceivers/PC para o mount (peers são criados antes da mídia); adicionar `restartIce()` watchdog; expor `prewarmAudio()`/`prewarmVideo()`; preferências de codec.
- `OfficeScene.tsx`: trocar polling DB por presence channel + interpolação; adicionar `RealtimeReconnector` hook; chamar `prewarmAudio` após "Entrar"; audio-unlock no mesmo gesto.
- `RemoteVideoTiles.tsx`: já está OK pós-últimas mudanças; manter.
- Novo arquivo: `src/lib/rtc/useRealtimeWatchdog.ts` centralizando reconexão de canais.
- Novo arquivo: `src/lib/rtc/audio-unlock.ts` para destravar autoplay global.

## 5. Escala (15+ usuários)

- Manter cap de 14 peers no mesh (já existe).
- Quando lobby tiver >8 pessoas, **desligar vídeo automaticamente** para peers fora da zona ativa, mantendo só áudio (como Gather faz com "spatial audio"). Vídeo só liga em proximidade <0.15 ou mesma zona.
- Áudio com volume proporcional à distância (já temos as posições; trivial de adicionar via `GainNode`).

## Pergunta antes de implementar

**TURN server**: você quer que eu (a) provisione TURN gratuito via Metered.ca (precisa de uma chave gratuita — 50GB/mês), (b) deixe só STUN por enquanto e a gente adiciona depois se aparecer problema, ou (c) você já tem um TURN?

Posso seguir com tudo o resto independente da resposta — só essa decisão afeta a robustez em redes restritas.