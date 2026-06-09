## Objetivo

Em `/admin/personagens`, substituir o fluxo atual (rodar script Python + enviar 3-4 PNGs separados) por:

1. **Subir 1 PNG** (4×6 — down, up, left, right).
2. **Auto-fatiar no browser** com a mesma lógica do `process-skin-sheet.py` (remoção de fundo branco + flood, maior componente conectado, normalização de altura, padding por baseline).
3. **Editor visual frame-a-frame** com handles arrastáveis pra corrigir qualquer frame que ficou torto.
4. **Salvar** gerando 3 sheets finais (down/up/left, right espelhado) e enviando ao bucket `sprite-sheets`.

## Fluxo na UI

```
[1] Upload folha-fonte (PNG 4x6)
       │
       ▼
[2] Auto-fatiamento (Canvas API + flood fill)
       │  detecta 24 frames, calcula bbox/centro/baseline
       ▼
[3] Grid 4×6 de mini-previews + painel de edição
       ┌──────────────────────────────────┐
       │  down  [F0][F1][F2][F3][F4][F5]  │
       │  up    [F0][F1][F2][F3][F4][F5]  │
       │  left  [F0][F1][F2][F3][F4][F5]  │
       │  right [F0][F1][F2][F3][F4][F5]  │
       └──────────────────────────────────┘
       Clica num frame → editor grande com:
         - retângulo arrastável (move bbox)
         - 4 handles pra redimensionar
         - botão "auto" (refaz detecção só desse frame)
         - sliders fine-tune (offset X/Y do centro e do pé)
       Botões globais: "Refazer auto em todos", "Aplicar offset a toda a linha"
       │
       ▼
[4] Preview animado (caminhada down/up/left) usando AlignedSprite
       │
       ▼
[5] Compor 3 PNGs finais (down/up/left) com mesmo padding/baseline
    e fazer upload para o bucket sprite-sheets via signed URL
```

## Mudanças concretas

### Novo: `src/lib/sprites/sheet-processor.ts`
- Port em TypeScript da lógica do `process-skin-sheet.py` usando Canvas/ImageData puro (sem PIL/numpy).
- Funções: `removeWhiteBackground(imageData)`, `findLargestBlobBbox(alpha)`, `robustCenterX(mask)`, `sliceSheet(image, rows=4, cols=6)` → devolve `Frame[]` `{ srcX, srcY, w, h, centerX, footY, dataUrl }`.
- Algoritmo idêntico ao Python (flood-fill 8-connected, erosão de halo 2 passes, blob principal + satélites internos/abaixo, mediana de altura por facing).

### Novo: `src/components/admin/SkinSheetEditor.tsx`
- Recebe `File` da folha-fonte, renderiza o grid 4×6 de previews.
- Cada frame tem retângulo + handles em SVG (drag para mover/resize, snap opcional).
- Painel lateral: facing selecionado, offset global por linha (botão "aplicar a toda a linha"), botão "refazer auto neste frame", botão "refazer auto em tudo".
- Live preview animado embaixo (usa `<AlignedSprite>` com dataURL temporário).
- Ao confirmar: gera 3 canvas finais (1 por facing usado: down/up/left) com o mesmo algoritmo de padding/baseline do script, exporta PNGs.

### Editado: `src/routes/_authenticated/admin.personagens.tsx`
- Substituir os 4 inputs separados por 1 input único de PNG da folha-fonte.
- Embedar o `SkinSheetEditor` no formulário "Novo personagem".
- Manter ID/Rótulo/Gênero/Espaço/"Espelhar right do left" como hoje.
- Ao submeter: usar os 3 PNGs gerados pelo editor → fluxo de signed URL + `adminSaveSkin` continua igual.
- Remover o aviso "antes de enviar rode o script python".

### Sem mudanças no servidor
- `sprites.functions.ts`, bucket, tabela `sprite_skins`, `AlignedSprite`, `useSpriteCatalog` — tudo continua igual. Toda a etapa de processamento sai do build-time (Python) e vai pro browser do admin.

### Memória
- Atualizar `mem://design/sprite-alignment` removendo a obrigatoriedade do script Python (continua sendo opção pra processamento em lote, mas o admin agora processa pelo browser).

## Detalhes técnicos

- **Workers/SSR**: rota tem `ssr: false`; processamento usa `Canvas`/`createImageBitmap` só no browser. Sem dependências server-side.
- **Performance**: folha-fonte típica ~1500×2000 px → ~3M pixels. Flood-fill iterativo + label connected components em JS roda em ~200-400ms; ok pra UX (mostrar spinner durante o auto-fatiamento).
- **Sem libs externas**: tudo com APIs nativas (`HTMLCanvasElement`, `ImageData`). Evita peso e mantém Worker-safe se um dia mudar.
- **Compatibilidade**: o PNG gerado mantém exatamente a estrutura que `AlignedSprite` espera hoje (6 frames horizontais, baseline alinhada), então skins novas e antigas convivem sem retoque.

## Fora do escopo

- Edição de skins já salvas (continua só renomear / mover de workspace / excluir). Pra re-cropar, sobe a folha-fonte de novo.
- Suporte a layouts diferentes de 4×6 (mantemos como hoje).
