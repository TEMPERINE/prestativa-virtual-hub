---
name: Sprite head alignment
description: Pipeline completo de alinhamento de sprites — AlignedSprite (runtime), process-skin-sheet.py (lote/batch) e fatiamento no browser via SkinSheetEditor (admin)
type: design
---

# Pipeline de sprites

## Runtime
- `<AlignedSprite>` (src/components/sprites/AlignedSprite.tsx) é o ÚNICO ponto de renderização. Aplica per-frame head offsets, sombra de referência, mirror right-from-left.
- Skin nova = registrar em `sprite-catalog.ts` (skins hard-coded) OU inserir em `sprite_skins` via UI admin (skins dinâmicas).

## Processamento de imagem-fonte
Duas opções equivalentes — ambas produzem 3 PNGs (down/up/left) com 6 frames horizontais, baseline e centro uniformes:

1. **Browser (admin)** — `/admin/personagens` usa `SkinSheetEditor` (src/components/admin/SkinSheetEditor.tsx) + `sheet-processor.ts` (src/lib/sprites/sheet-processor.ts). Sobe 1 PNG 4×6, fatia automaticamente, permite ajuste manual de bbox/centro/baseline por frame. Default.

2. **CLI (batch/dev)** — `python3 scripts/process-skin-sheet.py <fonte> <id>` para reprocessamento em massa ou pipelines fora da UI.

Ambos compartilham o algoritmo: flood-fill 8-connected do branco a partir das bordas + erosão de halo (2 passes) + maior blob conectado por célula (com merge de satélites internos/abaixo) + centro por média ponderada de colunas + baseline pela borda inferior do blob.
