## O diagnóstico (por que está aleatório hoje)

O que parece "sorte" tem causa única: **cada cliente decide sozinho com quem deveria conversar**, e essa decisão é assimétrica.

Hoje, em `useRtcMesh` + `OfficeScene`:

1. Cada navegador calcula `desiredPeers` localmente, a partir da posição que recebeu por broadcast (`positions`, `presentPeerIds`, proximidade). Esse cálculo é **independente** em cada cliente e chega em momentos diferentes.
2. Quando Marcio tem Tracy em `desired` mas Tracy **ainda não** tem Marcio (broadcast de posição da Tracy atrasou 1–2s), Marcio manda `offer` → Tracy executa esta linha:

   ```ts
   if (!desiredRef.current.has(peerId)) {
     sendSignal({ to: peerId, type: "bye" });
     destroyPeer(peerId);
     return;
   }
   ```

   Tracy responde `bye` e descarta. Marcio mantém o `RTCPeerConnection` aberto. O loop de recovery só recria peer se `myId > peerId` **e** não houver entry — como Marcio ainda tem entry "zumbi", **nunca recria**. Stuck para sempre, até alguém sair e voltar.

3. O mesmo acontece com áudio: o sender de áudio está anexado à PC, mas se a PC nunca completou ICE de um dos lados, o outro recebe `ontrack` mas o track fica `muted`. Resultado: "vejo mas não escuto".

4. Tudo isso roda em **um canal global `rtc-mesh-v1`** com filtro client-side. Funciona, mas mistura sinalização de N reuniões simultâneas e ainda piora corridas.

Conclusão: o problema **não é** o WebRTC nem o navegador. É o **modelo de descoberta de pares** — sem fonte única da verdade, alguém sempre fica fora.

## Como Zoom / Google Meet resolvem

Os dois compartilham a mesma regra: **um "room" é uma entidade do servidor; participar do room é simétrico por construção**. Ninguém calcula sozinho "estou na reunião com fulano" — o servidor diz quem está. As diferenças importantes:

- **Sala como recurso**: você entra/sai de um `roomId`. O servidor mantém a lista de participantes em tempo real e empurra para todos.
- **Mídia via SFU**, não mesh. Cada cliente envia **uma vez** para o servidor; o servidor reencaminha. Isso é o que permite 12, 50, 200 pessoas. Mesh P2P (o que temos) **não escala** acima de ~5–6 — o uplink do usuário explode com N² conexões.
- **Sinalização separada por sala**, não global.
- **Estado "join" é confirmado pelo servidor** antes do cliente exibir a UI de "estou na reunião".

## Plano em duas ondas

### Onda A — Consistência (resolve o "aleatório" hoje, sem trocar de stack)

Mantém mesh P2P (adequado para até ~5 pessoas por sala), mas elimina a assimetria.

**Mudança 1 — Fonte da verdade simétrica via presença por sala**

Em vez de cada cliente calcular `desiredPeers` por proximidade local:

- Cada sala (`zoneId` de meeting) vira um **canal Supabase próprio**, ex.: `room:{workspaceId}:{zoneId}`.
- Ao entrar numa zona de reunião, o cliente faz `channel.track({ userId })` (presença Supabase nativa).
- `desiredPeers` da sala = lista de `userId` presentes no channel da sala, **idêntica em todos os participantes**, atualizada pelo evento `presence sync`.
- Lobby/corredor mantém a lógica de proximidade atual para áudio espacial, **mas em um canal separado** (`proximity:{workspaceId}`) e sem entrar em "reunião".

Resultado: quando Tracy entra na sala, o servidor confirma a presença e **todos** os clientes recebem o mesmo `presence sync` no mesmo evento. Não há janela de assimetria. A rejeição "bye-por-não-desired" desaparece porque o `desired` é o próprio roster do canal.

**Mudança 2 — Sinalização por sala, não global**

- Sinalização (`offer`/`answer`/`ice`/`hello`/`bye`/`renegotiate`) viaja no canal da sala em que os dois peers estão.
- Mensagens fora do canal são impossíveis por construção — corrida de stale signal acabou.

**Mudança 3 — Recovery saudável**

- Tirar a guarda `if (peersRef.current.has(peerId)) continue` do loop de reconcile e do hello-loop.
- Adicionar watchdog explícito: se uma PC fica em `failed`/`disconnected` por >8s, **destruir e recriar** com a regra `myId > peerId`. Nenhum peer fica "zumbi".
- "Polite peer" pattern formal: o de `myId` menor é polite, ignora oferta conflitante; o de `myId` maior é impolite, sempre prevalece. Isso já está parcialmente implementado mas não para o caso de PC zumbi.

**Mudança 4 — Estado "entrou na reunião" vem do servidor**

- O badge "Em reunião" e o `useMeetingTracker` deixam de depender de `peerCount >= 1` (que pode mentir enquanto o ICE não completou).
- Passam a depender do roster do canal da sala: >=2 pessoas no roster ⇒ reunião.

Esperado após a Onda A: comportamento determinístico para 2–5 pessoas. Quem entra na sala **sempre** entra na reunião; quem sai, sai. Áudio liga para todos ou para ninguém (não mais "Marcio fala e ninguém ouve").

### Onda B — Escala (necessária para 6+ na mesma sala)

Mesh é inadequado acima de 5–6. Para 12+, **precisa SFU**. Opções:

- **Reabilitar LiveKit** só para salas grandes, com o nosso roteamento por sala (canal da Onda A continua sendo a fonte da verdade). O 429 anterior veio de criar tokens em loop — corrigir gerando token uma vez por sessão/sala.
- Alternativa: SFU self-hosted (Mediasoup) — mais trabalho, sem custo de provedor.

Onda B é opcional agora; se as salas hoje são ≤4 pessoas, a Onda A já resolve o problema relatado. Anoto isso explicitamente no plano para você decidir.

## Arquivos afetados (Onda A)

- `src/lib/rtc/useRtcMesh.ts` — sinalização passa a aceitar `roomChannel`; `desiredPeers` vira derivado de presença; recovery do peer zumbi; polite/impolite formal.
- `src/components/office/OfficeScene.tsx` — `desiredPeers` por sala vem do hook de presença da sala, não do cálculo local de posições. Proximidade no lobby fica num caminho separado.
- Novo: `src/lib/rtc/useRoomPresence.ts` — hook fino sobre `supabase.channel(...).track()` que devolve `{ roster, channel }` para a sala atual.
- `src/lib/meetings/useMeetingTracker.ts` — gatilho passa de `peerCount` para `rosterSize >= 2`.

## Detalhes técnicos (para referência)

- Canal por sala: `supabase.channel(\`room:${ws}:${zoneId}\`, { config: { presence: { key: userId }, broadcast: { self: false } } })`.
- `presence sync` define o roster; `presence join`/`leave` apenas gatilham logs.
- Sinalização vai no mesmo channel via `broadcast` — sem custo extra de conexão.
- Cleanup garantido: ao sair da zona, `channel.untrack()` + `removeChannel()`. Refresh/pagehide → mesma rotina.
- Reuso de mídia: ao trocar de sala, **não** recriamos tracks de mídia (mic/cam continuam); só recriamos as PCs com os novos peers.

## Fora deste plano (intencionalmente)

- Não troco UI, mapas, sprites, gravação, props.
- Não refaço autenticação nem permissões.
- Não removo o cálculo de proximidade do lobby — ele continua útil para áudio espacial.
- Onda B (SFU) fica para depois, se você confirmar que precisa de salas grandes.

## O que preciso de você antes de codar

1. **Tamanho típico das salas**: a maior reunião tem quantas pessoas? Se for ≤5, Onda A basta. Se for 6+, faço Onda A agora e Onda B na sequência.
2. Confirma que posso refatorar `useRtcMesh.ts` (é o arquivo central da chamada) e introduzir o novo hook `useRoomPresence`?
