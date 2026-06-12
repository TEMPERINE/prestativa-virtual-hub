# Diagnóstico: movimento do avatar

Escopo desta rodada: **só diagnóstico**, foco em **movimento do avatar**. Nenhum arquivo será alterado. Abaixo está o que encontrei lendo `OfficeScene.tsx` (linhas 117-2090), priorizado por impacto.

---

## 🔴 Alta prioridade (afeta suavidade visível)

### 1. Avatares remotos não têm interpolação — andam aos "saltos"
- A posição remota é aplicada direto em `setPositions` sempre que chega um broadcast (`OfficeScene.tsx:937-948`).
- Como `SEND_INTERVAL_MS = 120` (linha 121), cada peer recebe ~8 amostras/s e renderiza nelas — o avatar pula 120 ms por vez em vez de deslizar.
- **Efeito:** stutter perceptível em outros usuários, principalmente sob latência variável.
- **Fix sugerido (futuro):** guardar `targetPos` e interpolar (`lerp` a ~60 fps) entre amostras dentro do mesmo `rAF` que já roda em `:2002`. Pode reaproveitar `remoteAnimRef` para ter posição renderizada por usuário.

### 2. `tryMove` roda 2× por frame durante movimento manual
- O loop em `:2063-2067` chama `tryMove(dir, stepFactor)` quando há tecla pressionada, **e** o `keydown` (`:1955`) também muda direção/faz `setLocalFacing` — mas o passo inicial não dispara `tryMove` (ok). Já o `tick` chama `tryMove` mesmo no frame em que a tecla foi solta, porque `lastDir.current` só zera no `up`. Pequeno, mas vale checar.
- Maior problema: dentro de `tryMove` (`:686`) você faz `setPos(np)` toda iteração. A 60 fps isso = 60 re-renders/s do componente inteiro (4165 linhas, muito JSX). React consegue, mas é a maior fonte de CPU/jank.
- **Fix sugerido:** separar a posição em uma `ref` + aplicar via `transform: translate(...)` num único `<div ref>` (mutação direta no DOM) sem `setState`. Só sincronizar `state` quando a zona/facing muda.

### 3. `sendPos` faz `supabase.auth.getUser()` async dentro do hot path
- `:572-578` — se `meIdRef.current` não estiver setado, `sendPos` cai num `await getUser()` por movimento. Em condições normais o id já existe, mas se houver corrida no boot, vira uma chamada de rede por passo.
- **Fix sugerido:** garantir hidratação antes de habilitar movimento (já temos `positionHydratedRef`), e remover o fallback assíncrono — se sem id, descarta sem mais.

### 4. `setInterval` da animação de remotos roda mesmo com ninguém andando
- `:610-656` — timer de 110 ms enumera `positions` toda hora e chama `setRemoteFrames` quando `changed`. Tudo bem, mas o filtro `changed` ignora o caso "todos parados, frame já = 0" e ainda recria `next` objeto cada tick. Pode ser fundido ao `rAF` principal e só rodar enquanto algum remoto tem `lastMove` recente.

---

## 🟡 Média prioridade (qualidade de código / risco)

### 5. `OfficeScene.tsx` tem 4165 linhas
- Um único componente concentra: render de mapa, input de teclado, loop de movimento, presence, broadcast, persistência, raise-hand, reações, confete, recadinhos, follow, auto-walk, atalhos. Cada `useEffect` extra força React a reavaliar deps de todos os outros.
- **Hoje:** funcional, mas qualquer mudança tem alto risco de regressão.
- **Fix sugerido (médio escopo):** extrair pelo menos `useAvatarMovement`, `usePositionsChannel`, `usePresenceHeartbeat` como hooks dedicados (sem mexer em lógica).

### 6. Múltiplos listeners `keydown` globais
- Há 4+ `addEventListener("keydown", ...)` (`:1437, :1581, :1988, :4107`) — cada um faz seu próprio guard de `INPUT/TEXTAREA`. Unificar num único dispatcher reduz alocação e simplifica regras (ex.: quando o picker de emoji estiver aberto, hoje só funciona porque o foco vai pro popover).

### 7. `MAX_STEP_FACTOR = 3` permite teleporte em frame drop
- Se a aba travar por 200 ms, o avatar avança 3× o passo num só frame — pode atravessar parede fina (a colisão é por destino, não por raycast). `collides({x:nx,y:cur.y})` só checa o ponto final.
- **Fix sugerido:** sub-stepping (dividir o passo grande em N passos pequenos com colisão entre eles) **ou** reduzir `MAX_STEP_FACTOR` para 2.

### 8. Persistência em `positions` a cada 300 ms enquanto anda
- `:557` — `lastPersisted > 300` ms aciona `upsert` no Supabase **durante** o movimento. Isso é write amplification (~3 writes/s/usuário só andando). O broadcast já cobre tempo real; o DB só precisa do snapshot quando parar (já temos `persistNow=true` no `keyup` em `:1981`).
- **Fix sugerido:** subir o intervalo para 2-3 s ou só persistir no `keyup`/`pagehide` (já existe).

### 9. `SPEED` em frações de mapa, não em pixels/segundo
- `SPEED = 0.0042` por frame a 60 fps = ~0.25/s. Funciona, mas mistura unidade de tempo com unidade de espaço — qualquer ajuste de "velocidade do avatar" exige recalcular. `SPEED_PER_SEC` já existe (linha 118) mas não é usado em `tryMove`. Migrar `tryMove` para `dt*SPEED_PER_SEC` deixa o código auto-documentado e elimina `MIN/MAX_STEP_FACTOR`.

---

## 🟢 Baixa prioridade (polimento)

### 10. Preload de sprites no mount
- `:582-589` cria `new Image()` por sheet a cada mount do `OfficeScene`. Já está em cache do browser, mas mover para módulo top-level (executa 1× na vida do app) é mais limpo.

### 11. `Array.from(keysDown.current).slice(-1)` no `keyup`
- `:1972` cria array só pra pegar o último. `let last; keysDown.current.forEach(k => last = k)` evita alocação. Microbench, mas roda em hot path.

### 12. `zoneAt(cur)` chamada 3× por frame de movimento
- Em `tryMove` (`:675-676`) e novamente nos callers (`:2038, :2083`). Cachear o resultado por frame.

---

## Resumo executivo

| # | Item | Impacto | Esforço |
|---|------|---------|---------|
| 1 | Interpolar avatares remotos | Alto (suavidade) | Médio |
| 2 | Trocar `setPos` 60Hz por mutação direta de `transform` | Alto (CPU) | Médio |
| 7 | Sub-stepping de colisão | Médio (evita bug) | Baixo |
| 8 | Reduzir writes no DB durante movimento | Médio (custo Cloud) | Baixo |
| 5 | Quebrar `OfficeScene` em hooks | Médio (manutenção) | Alto |
| 9 | Migrar `tryMove` para `dt*SPEED_PER_SEC` | Baixo (clareza) | Baixo |
| 3,4,6,10-12 | Polimento diverso | Baixo | Baixo |

Quando quiser aplicar, me diga quais itens entram e eu volto com um plano de implementação focado neles.
