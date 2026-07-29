
# Relatório técnico — Reuniões do Prestativa Office

> Documento para análise por outra IA/engenheiro sênior. Contém o problema, a arquitetura atual, tudo que já foi tentado, os arquivos envolvidos e hipóteses ainda não testadas. Nada aqui será implementado sem ordem — é diagnóstico.

---

## 1. O produto (contexto mínimo)

- App web (TanStack Start + React 19 + Vite) que renderiza um "escritório virtual 2D" tipo Gather.town.
- Cada usuário controla um avatar sprite num mapa. O mapa é dividido em **zonas** (`lobby`, `sala-reuniao-1`, `copa`, etc.). Zonas do tipo `common` (salas) habilitam vídeo/áudio; `lobby` faz áudio espacial por proximidade.
- Backend: Lovable Cloud (Supabase) — Postgres + Realtime + Storage + Auth.
- Posições dos avatares trafegam por Supabase Realtime broadcast (`positions`) — cada cliente publica sua posição e recebe as dos outros.
- Mídia (áudio/vídeo/tela): **LiveKit Cloud** (SFU). Já tentamos mesh P2P puro antes; abandonado por não escalar acima de ~5.
- Meta: até **20 pessoas** simultâneas numa sala de reunião.

---

## 2. O problema em uma frase

> **Quem entra na sala nem sempre entra na reunião.** O comportamento é assimétrico e não determinístico: usuário A vê B; B só vê a si mesmo; C vê A e B; áudio funciona para uns e não para outros; alguns nem chegam a conectar no SFU. Reproduzível principalmente quando 3+ pessoas entram na mesma sala em navegadores/redes diferentes.

Historicamente **piorou** com correções sucessivas — hoje está pior do que estava quando funcionava só com mesh P2P para 2 pessoas.

---

## 3. Sintomas observados (dados brutos dos testes com usuários reais)

| Cenário | Resultado |
|---|---|
| Marcio (host) + Dani entram juntos | Se ouvem/se veem OK |
| Fram entra por cima | Fram conecta na reunião |
| Tracy entra por cima | Tracy fica visível no mapa mas **não entra** no room LiveKit |
| Maria entra | Idem Tracy |
| Marcio vê todos; Dani vê só a si e Tracy; Tracy vê só a si mesma | Rosters assimétricos entre clientes na mesma sala |
| Mic aberto por todos | Nem todos se escutam ao mesmo tempo |
| Tracy usando **mesma conta** em duas máquinas diferentes | Uma conecta, outra não; ou ambas conectam mas ficam mudas entre si |
| Redes: usuários em casa (NAT restrito) sofrem mais que os em escritório | LiveKit Cloud faz TURN automático, mas connect às vezes trava em `connecting…` sem erro |
| Frequência de 429 (rate limit) da API de token do LiveKit | Aparece quando muitos usuários entram/saem em <60s de uma mesma sala |

Nenhum navegador loga erro fatal do WebRTC. A UI mostra “Conectando…” indefinidamente ou “Conectado” sem que a track de áudio flua.

---

## 4. Arquitetura atual (pós várias correções)

### 4.1 Fluxo de decisão de sala

```text
posição do avatar (x,y) ──► callZoneAt(p) ──► localZoneId
                                                 │
                                                 ├─► roomKey = `prestativa-office:{ws}:{localZoneId}`
                                                 │      (null se lobby ou zona sem vídeo)
                                                 │
                                                 └─► desiredPeers = ids cujo callZoneAt(pos) == localZoneId
                                                          │
                                                          ▼
                                                    useLiveKit(myId, roomKey, audiblePeerIds)
                                                          │
                                                          ├─► conecta ao room
                                                          ├─► publica mic/cam/screen (sticky refs)
                                                          └─► setSubscribed(true/false) por participante
                                                              conforme audiblePeerIds
```

### 4.2 Contrato "quem está na reunião"

- **Fonte da verdade atual**: cada cliente calcula localmente `desiredPeers` a partir de `positions` broadcast + `callZoneAt`.
- Esperado: como todos rodam a mesma função sobre os mesmos dados, o roster deveria ser simétrico.
- Realidade: **não é**, porque `positions` chega em cada cliente em momentos diferentes, e `callZoneAt` depende de `mapVersion` (overrides do mapa) que também podem estar dessincronizados.

### 4.3 Identidade LiveKit

- `identity = "{userId}:{clientId}"` onde `clientId` é armazenado em `sessionStorage`.
- `attributes.userId` e `metadata.userId` carregam o userId "real" para o front deduplicar tiles.
- Motivo: mesmo usuário abrindo 2 abas/máquinas não deve colidir na identidade LiveKit.

### 4.4 Áudio/vídeo capture

Padrão Zoom/Meet:
```ts
{ echoCancellation: true, noiseSuppression: true, autoGainControl: true,
  channelCount: 1, sampleRate: 48000, sampleSize: 16 }
```
Vídeo 640×360 @ 15fps. Publica com `AudioPresets.speech` (~40 kbps Opus).

### 4.5 Falhas conhecidas na arquitetura atual

1. **Assimetria de `desiredPeers`** — cada navegador chega numa resposta ligeiramente diferente porque `positions` é eventualmente consistente. Não existe roster autoritativo do servidor.
2. **`roomKey` acoplado a `localZoneId`** — se um cliente classifica a posição do outro em zona diferente (bug de `callZoneAt` ou overrides de mapa dessincronizados), eles ficam em rooms diferentes e nunca se falam.
3. **Sem confirmação servidor-side de "entrei na reunião"** — o badge "em reunião" olha `desiredPeers.length` ou `audibleConnectedPeers.length`, ambos derivados de estado local.
4. **429 do LiveKit** em churn alto: entrar+sair+entrar em <10s cria N tokens; a API rate-limita.
5. **Auto-retry com backoff exponencial** mascara falhas sem sinalizar ao usuário se convergiu.
6. **`videoVisibleIds`** filtra `setSubscribed` — se o filtro nega alguém que já está no room, o outro lado publica, mas você não recebe, gerando "eu não vejo X" enquanto X vê você.
7. **Overrides de mapa** (`map_overrides` no DB) alteram as zonas dinamicamente; se um cliente ainda não recebeu o override, ele avalia `callZoneAt` sobre o mapa antigo → zona diferente do vizinho.

---

## 5. Arquivos-chave

| Arquivo | Papel | Tamanho |
|---|---|---|
| `src/lib/rtc/useLiveKit.ts` | Hook único que gerencia Room LiveKit, publish/subscribe, devices, retries | 785 linhas |
| `src/lib/rtc/livekit.functions.ts` | serverFn que emite JWT com `AccessToken` do `livekit-server-sdk`; valida `userId == context.userId`; TTL 6h | 51 linhas |
| `src/components/office/OfficeScene.tsx` | Cena principal: computa `roomKey`, `desiredPeers`, integra `useLiveKit`, renderiza avatares e tiles | 4605 linhas |
| `src/lib/meetings/useMeetingTracker.ts` | Chama RPC `meeting_join` quando entra em zona privada (debounce 800ms) | 124 linhas |
| `src/lib/rtc/useRtcMesh.ts` | **Antigo** hook P2P mesh — não está em uso hoje, mantido como referência | 1042 linhas |
| `src/lib/rtc/useRoomRoster.ts` | Presence do Supabase por sala — **existe mas não está plugado**; foi criado na "Onda A" que nunca foi finalizada | 64 linhas |
| `src/components/office/RemoteVideoTiles.tsx` | UI dos tiles remotos | 216 linhas |
| `src/routes/_authenticated/workspaces.$workspaceId.tsx` | Rota que monta `OfficeScene` após membership check | 103 linhas |

RPCs Postgres relevantes: `meeting_join`, `meeting_leave`, `meeting_mark_recording_started`, `is_meeting_participant`, `is_workspace_member`.

Tabelas: `meetings`, `meeting_participants`, `positions`, `workspace_members`, `map_overrides`.

Secrets: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `TURN_USERNAME`, `TURN_CREDENTIAL` (TURN próprio já foi removido do path atual do useLiveKit — deixamos LiveKit Cloud gerenciar TURN).

---

## 6. Tudo que já foi tentado (cronológico)

| # | Hipótese | Ação | Resultado |
|---|---|---|---|
| 1 | Assentos internos das salas criavam mini-zonas que separavam usuários | `callZoneAt` reescrita para usar envelope visual da sala | Falso positivo — sintoma persistiu |
| 2 | Multi-tab da mesma conta gerava colisão de identidade | JWT passou a incluir `clientId` único por sessionStorage | Melhorou multi-tab, mas não resolveu assimetria entre contas diferentes |
| 3 | Rate limit 429 causava falha silenciosa | Adicionado retry com backoff exponencial no `useLiveKit` | Reduz falha "seca" mas mascara o problema |
| 4 | ICE customizado (TURN próprio) atrapalhava failover do LiveKit Cloud | Removido config custom de ICE — LiveKit Cloud usa seus próprios TURN regionais | Melhorou usuários com NAT restrito, não resolveu assimetria |
| 5 | Room global do workspace saturava sinalização | Voltou para `roomKey` por zona (`prestativa-office:{ws}:{zone}`) | Reduziu 429, mas re-introduziu o problema de "zonas diferentes = rooms diferentes" |
| 6 | Áudio inaudível vs. campainha alta | Ligado `autoGainControl`, `AudioPresets.speech`, 48 kHz mono | Volume ficou adequado |
| 7 | Local preview sumindo com `dynacast` | Removido check `!t.muted` do render do self-tile | Preview local estável |
| 8 | `peerCount >= 1` bloqueava badge "em reunião" | `useMeetingTracker` passou a chamar `meeting_join` só por entrar em zona privada, sem depender de peers | Badge corrige, conexão de mídia continua assimétrica |
| 9 | mesh P2P puro (SDP direto entre pares) via `useRtcMesh` | Removido do caminho principal | Não escala para 6+ e sofria da mesma assimetria de `desiredPeers` |
| 10 | Presence Supabase autoritativo (`useRoomRoster`) | Hook foi criado, **nunca plugado no OfficeScene** | Parcial — bloqueado por outras prioridades |
| 11 | Discord API como stack alternativo | Descartado — sem API pública para transmitir mídia externa em voice channels | N/A |

---

## 7. Root cause consolidado (hipótese mais forte)

O sistema não tem **fonte da verdade autoritativa e simétrica** para "quem está em qual sala neste instante". Cada cliente decide sozinho, usando dois inputs eventualmente consistentes (`positions` broadcast + `mapVersion`), e o resultado depende da ordem de chegada dos eventos. Consequência combinada:

1. `roomKey` de A ≠ `roomKey` de B em uma janela de 200ms–vários segundos → conectam em rooms LiveKit diferentes → **nunca se veem**, mesmo com mídia publicada.
2. Se converge para o mesmo room, `videoVisibleIds` de A ainda pode não conter B, gerando **audio/video visto por um lado e não pelo outro**.
3. Token requests em churn geram 429 → o cliente entra em backoff sem sinalizar claramente ao usuário.
4. `map_overrides` fora de sync entre clientes agrava (1) porque `callZoneAt` retorna zonas distintas para o mesmo ponto físico.

---

## 8. Direções ainda não testadas (para a "IA elevada" avaliar)

### 8.1 Servidor-autoritativo por presence Supabase (parcialmente pronto)
- Cada sala tem um canal `room:{ws}:{zoneId}` com `channel.track()`.
- `desiredPeers` = roster do `presence sync` (não mais cálculo local por posição).
- `roomKey` continua zone-scoped, mas a decisão "entrar/sair" vem do servidor Realtime, não da posição interpolada.
- Peça pronta: `src/lib/rtc/useRoomRoster.ts` (não integrada).

### 8.2 Room LiveKit único por workspace + policy server-side
- Um único room LiveKit por workspace (persistente).
- Um serverFn `getMeetingPolicy(zoneId)` responde qual conjunto de identities deve estar `subscribed`.
- Elimina reconnect ao mudar de sala; troca só as subscriptions.
- Risco: `identity` LiveKit não muda quando muda de zona → precisa metadata dinâmico via `RoomServiceClient.updateParticipant`.

### 8.3 Trocar SFU
- **Daily.co**: dev experience mais previsível, prebuilt UI opcional, sem 429 relatado nesse volume.
- **100ms / Jitsi as a Service**: alternativas.
- Custo/complexidade alto — só se 8.1 + 8.2 não resolverem.

### 8.4 Instrumentação obrigatória antes de novas tentativas
Nenhum dado telemétrico hoje. Precisa de:
- Log estruturado no cliente: `{userId, clientId, zoneId, roomKey, connState, ts}` a cada transição.
- Envio para uma tabela `rtc_events` (Supabase).
- Painel simples para reconstruir a timeline de uma reunião defeituosa.
- Sem isso, qualquer nova correção é adivinhação.

---

## 9. Perguntas em aberto

1. Existe garantia contratual de rate no plano LiveKit Cloud atual? (Sem saber, não dá para descartar 429 como sintoma vs. causa.)
2. `map_overrides` chega igual em todos os clientes num tempo aceitável? (Nunca medimos.)
3. É aceitável exigir que o servidor confirme "join" antes da UI reagir? (Introduz ~200ms de latência.)
4. 20 pessoas é ceiling real? Se sim, mesh está definitivamente descartado e SFU é obrigatório — a discussão fica só entre "qual SFU e qual policy".

---

## 10. Onde começar (recomendação para a análise externa)

1. Ler `src/lib/rtc/useLiveKit.ts` inteiro (785 linhas) — hook central.
2. Ler `src/components/office/OfficeScene.tsx` linhas 200–670 — `callZoneAt`, `roomKey`, `desiredPeers`, `useLiveKit` wiring.
3. Ler `src/lib/rtc/useRoomRoster.ts` — presence Supabase pronta mas não usada.
4. Ler `src/lib/rtc/livekit.functions.ts` — emissão de token.
5. Considerar: presence autoritativa (8.1) + room único (8.2) + telemetria (8.4) parecem o caminho mínimo para sair do não-determinismo.
