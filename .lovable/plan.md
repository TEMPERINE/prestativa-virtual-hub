# Voz e vídeo entre avatares

## Objetivo
Avatares conversam por áudio/vídeo quando:
- Entram na **mesma zona reivindicada** (sala/mesa), ou
- Se **aproximam** de outro avatar no lobby (raio configurável).

Mic e câmera ficam **desligados por padrão**, mas o navegador sempre **escuta** os streams remotos (recebe áudio dos outros). Cada usuário tem botões para **mutar/desmutar mic** e **abrir/fechar vídeo**.

## UX
- HUD fixo no canto inferior (controles do próprio avatar): botão Mic, botão Câmera, indicador "Em chamada com N".
- Pequenos tiles de vídeo flutuantes (PiP grid) no canto superior direito para cada par conectado que ativou câmera. Áudio toca sem UI.
- Sobre cada avatar remoto que está falando: anel/ícone pulsando (usa Web Audio analyser).
- Toast quando entra/sai de uma "sala de conversa".

## Regras de pareamento
- **Mesma zona reivindicada** (`workspace_claims.zone_id` igual) → conecta com todos os outros na zona.
- **Proximidade no lobby/livre**: distância euclidiana (em coords normalizadas) ≤ `0.08`. Histerese: desconecta só a > `0.12` para evitar flicker.
- Limite: até 6 pares simultâneos.

## Arquitetura técnica
- **Sinalização** via Supabase Realtime (canal `rtc:<userId>`). Mensagens: `offer`, `answer`, `ice`, `bye`.
- **WebRTC P2P mesh** (RTCPeerConnection por par). STUN público `stun:stun.l.google.com:19302`.
- Sempre adiciona transceivers `audio` e `video` em `sendrecv`, mas tracks locais começam com `enabled = false` (mic mudo, câmera off). Trocar enabled em vez de renegociar.
- Tie-breaker para quem cria offer: `userId` menor é "polite/impolite" — quem tem id maior envia offer.

## Arquivos
- `src/lib/rtc/useRtcMesh.ts` — hook principal: gerencia peers, sinalização, streams remotos, controles.
- `src/lib/rtc/signaling.ts` — wrapper de Realtime para envio/recebimento.
- `src/components/office/RtcHud.tsx` — botões Mic/Cam + grid de vídeos remotos.
- Integração em `src/components/office/OfficeScene.tsx`: calcula set de pares desejados (mesma zona OU proximidade) a cada tick e passa pro hook; renderiza `<RtcHud />`.

## Permissões
- `getUserMedia` é solicitado **apenas** ao primeiro clique em Mic ou Câmera (não no load). Antes disso, o usuário ainda recebe áudio dos outros (recvonly via transceivers vazios).

## Observações
- Sem backend novo, sem tabela nova — Realtime já está ativo.
- Não mexe em lógica de claim/movimento existente.
