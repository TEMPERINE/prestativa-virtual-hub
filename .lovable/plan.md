# Onda 1 — Aliviar a máquina do usuário sem mudar a experiência

Três mudanças focadas, baixo risco, alto impacto. Nada de refatoração estrutural agora.

## 1. Pausar vídeo quando a aba fica oculta

**Problema:** com a aba do Prestativa em segundo plano, o navegador continua decodificando todos os vídeos remotos. É a maior queixa de "computador lento" para quem deixa o app aberto o dia todo.

**O que muda para o usuário:**
- Trocar de aba → vídeos remotos somem (placeholder com avatar/nome).
- Áudio continua normal (não perde conversa).
- Voltar para a aba → vídeos voltam em ~1 segundo.

**Onde mexer:**
- `src/lib/rtc/useLiveKit.ts` (e/ou `useRtcMesh.ts`, dependendo de qual está ativo): adicionar listener de `document.visibilitychange`.
- Quando `hidden`: chamar `setSubscribed(false)` nos `RemoteTrackPublication` de vídeo (LiveKit suporta nativo). Áudio permanece subscrito.
- Quando `visible`: re-subscrever.
- Cobrir também tela compartilhada (mesma lógica).

## 2. Vídeo sob demanda por proximidade no mapa

**Problema:** hoje todos recebem vídeo de todos. Sala com 8 pessoas = 7 decodes simultâneos sempre. Maior ofensor de CPU/GPU.

**O que muda para o usuário:**
- Só vê vídeo de quem está **perto no mapa** (raio configurável, ex.: 6 tiles) ou de quem está na **mesma zona de reunião**.
- Quem está longe aparece como avatar parado, sem vídeo (igual hoje quando câmera desligada).
- Áudio espacial continua de todos no alcance auditivo (mais amplo que o de vídeo).

**Onde mexer:**
- `src/components/office/OfficeScene.tsx`: já existe `positions` e `zoneAt()`. Calcular a cada ~500 ms o conjunto de `userId`s "visíveis" (distância ≤ N **ou** mesma zona de reunião).
- Passar esse `Set<string>` para `RemoteVideoTiles.tsx` / camada RTC.
- Na camada RTC: subscrever vídeo só dos IDs do set; `setSubscribed(false)` no resto.
- Debounce: só mudar subscrição se entrou/saiu do set por mais de 1,5 s (evita liga/desliga ao passar perto).

**Constantes propostas (ajustáveis depois):**
- Raio de vídeo: 6 tiles.
- Janela de debounce: 1500 ms.
- Em zona de reunião: todos da zona sempre visíveis, ignora raio.

## 3. Throttle de persistência de posição

**Problema:** `upsert` em `positions` a cada 300 ms enquanto o avatar anda = ~3 writes/s/usuário. Custo de Cloud + rede do cliente sem ganho perceptível (broadcast já cobre tempo real).

**O que muda para o usuário:** nada visível. Reduz tráfego de upload e custo de banco.

**Onde mexer:**
- `OfficeScene.tsx` por volta da linha 557: subir o limiar de `lastPersisted` de 300 ms para 2000 ms.
- Manter o `persistNow=true` que já existe no `keyup` (linha ~1981) e no `pagehide` — garante snapshot final correto.

## Como vou validar antes de entregar

1. **Aba oculta:** abrir DevTools → Performance, trocar de aba por 30 s, conferir queda de CPU e que áudio continua.
2. **Proximidade:** simular 2 usuários distantes no mapa, confirmar que vídeo não é decodificado (LiveKit stats mostram `subscribed: false`).
3. **Persistência:** monitor de rede mostrando ≤1 request a `positions` durante caminhada contínua, e 1 request no `keyup`.
4. **Regressão:** sala com 3 pessoas próximas continua com vídeo + áudio normais.

## Fora do escopo desta onda

- Mutação direta de `transform` no avatar local (Onda 2).
- Interpolação de avatares remotos (Onda 2).
- Quebrar `OfficeScene` em hooks (Onda 3).
- Modo leve adaptativo por hardware (Onda 4).

## Estimativa

1 a 2 dias de implementação + 0,5 dia de teste com sala cheia real. Risco baixo: nenhuma mudança de schema, nenhuma quebra de protocolo de presence/broadcast.

---

**Confirma que sigo por aqui?** Se quiser ajustar o raio de proximidade (6 tiles) ou o intervalo de persistência (2 s) antes, me diz agora.