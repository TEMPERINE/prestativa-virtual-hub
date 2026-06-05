## Objetivo

Adicionar ao construtor de mapas uma **galeria de elementos** (mobílias, portas, etc.) que ficam sobrepostos ao cenário e podem ser interativos (ex.: porta com 2 frames alternados pela tecla **X**).

## Escopo desta entrega

1. Cadastrar **Porta** na galeria (frame 1 = fechada, frame 2 = aberta), usando as duas imagens enviadas.
2. Permitir no editor: arrastar da galeria → soltar no mapa, mover, redimensionar, deletar, e alternar interatividade.
3. No jogo: renderizar os props sobre o cenário com z-index baseado em `y` (mesma regra dos avatares — quem está mais embaixo aparece na frente). Quando o avatar está **adjacente** a um prop interativo, pressionar **X** alterna o frame (todos os jogadores veem em tempo real).

## Arquitetura

### Galeria (catálogo de assets)
Novo arquivo `src/lib/prop-catalog.ts` com tipo:
```ts
type PropDef = {
  id: string;              // "door"
  label: string;           // "Porta"
  frames: string[];        // URLs dos frames (1 = default, 2 = ativado)
  defaultW: number;        // largura padrão em % do mapa
  interactive: boolean;    // suporta tecla X
  interactKey?: "X";
};
```
Registro inicial: `door` com `frames: [porta-fechada.png, porta-aberta.png]`.

Os PNGs ficam em `src/assets/props/` e são importados estaticamente (já têm fundo transparente).

### Instâncias no mapa
Estender `MapOverrides` com:
```ts
props?: Array<{
  id: string;            // uuid
  defId: string;         // "door"
  x: number; y: number;  // normalizado 0..1 (centro do prop)
  w: number;             // largura normalizada
  rotation?: number;     // 0 por padrão
  interactive: boolean;  // toggle do editor
}>;
```
Persistido junto com o resto do doc (localStorage + tabela `map_overrides` já cobre, pois é JSONB).

### Estado runtime dos props (sync entre jogadores)
Nova tabela `prop_states` (`prop_id text pk, frame int, updated_by uuid, updated_at`) com realtime habilitado. Frame default = 0; toggle via tecla X faz upsert. Todos os clientes escutam via realtime e atualizam.

### Editor (`MapEditor.tsx`)
- Nova aba/painel "Elementos" listando os defs do catálogo (thumbnail + nome).
- Clique no item → modo "colocar prop", próximo clique no mapa insere instância.
- Props renderizados como `<img>` absolutos com handles de mover/resize e botão deletar/toggle-interativo quando selecionados.

### Cena (`OfficeScene.tsx`)
- Renderizar cada prop como `<img>` com `style.zIndex = Math.round(y * 1000) + 50000` (entre piso e avatares — props altos tipo porta cobrem corretamente).
- Listener global `keydown` "x": se há prop interativo dentro do raio do avatar local, dispara toggle.

## Detalhes técnicos

### Migração
```sql
create table public.prop_states (
  prop_id text primary key,
  frame int not null default 0,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.prop_states to authenticated;
grant all on public.prop_states to service_role;
alter table public.prop_states enable row level security;
create policy "read all" on public.prop_states for select to authenticated using (true);
create policy "write authenticated" on public.prop_states for insert to authenticated with check (auth.uid() = updated_by);
create policy "update authenticated" on public.prop_states for update to authenticated using (true);
alter publication supabase_realtime add table public.prop_states;
```

### Assets
- `src/assets/props/door-closed.png`
- `src/assets/props/door-open.png`

### Arquivos novos / alterados
- **novo** `src/lib/prop-catalog.ts`
- **novo** `src/components/office/PropsLayer.tsx` (render runtime + tecla X)
- alterado `src/lib/map-overrides.ts` (campo `props`, helpers `addProp/updateProp/removeProp`)
- alterado `src/components/office/MapEditor.tsx` (galeria + edição de props)
- alterado `src/components/office/OfficeScene.tsx` (montar `PropsLayer`)
- nova migration

## Fora do escopo (próximas etapas, se quiser)
- Mais props na galeria além da porta.
- Outras teclas de interação (E, F) ou mais de 2 frames.
- Colisão dos props (por enquanto, decorativos — não bloqueiam movimento).
- Animação suave de transição entre frames.

Confirmar e parto pra implementação.
