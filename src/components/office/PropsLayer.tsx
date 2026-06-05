import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { loadOverrides, subscribeOverridesFromCloud, type PropInstance } from "@/lib/map-overrides";
import { getPropDef } from "@/lib/prop-catalog";

const INTERACT_RADIUS = 0.06; // distância (em fração do mapa) para o avatar poder interagir

type Props = {
  /** posição normalizada (0..1) do avatar local; usada para gating de tecla */
  selfX: number;
  selfY: number;
};

type PropStateRow = { prop_id: string; frame: number };

export function PropsLayer({ selfX, selfY }: Props) {
  const [propsList, setPropsList] = useState<PropInstance[]>(
    () => loadOverrides()?.props ?? []
  );
  const [frames, setFrames] = useState<Record<string, number>>({});
  const selfRef = useRef({ x: selfX, y: selfY });
  selfRef.current = { x: selfX, y: selfY };
  const propsRef = useRef(propsList);
  propsRef.current = propsList;

  // Recarrega lista quando os overrides do mapa mudam
  useEffect(() => {
    const onLocal = () => setPropsList(loadOverrides()?.props ?? []);
    onLocal();
    window.addEventListener("map-overrides-changed", onLocal);
    const unsub = subscribeOverridesFromCloud((o) => {
      setPropsList(o?.props ?? []);
    });
    return () => {
      window.removeEventListener("map-overrides-changed", onLocal);
      unsub();
    };
  }, []);

  // Carrega estados (frames) e escuta realtime
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any).from("prop_states").select("prop_id, frame");
      if (cancelled || !data) return;
      const map: Record<string, number> = {};
      for (const row of data as PropStateRow[]) map[row.prop_id] = row.frame;
      setFrames(map);
    })();
    const channel = supabase
      .channel(`prop_states-${Date.now()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "prop_states" },
        (payload) => {
          const row = (payload.new ?? payload.old) as PropStateRow | null;
          if (!row?.prop_id) return;
          if (payload.eventType === "DELETE") {
            setFrames((p) => {
              const n = { ...p };
              delete n[row.prop_id];
              return n;
            });
          } else {
            setFrames((p) => ({ ...p, [row.prop_id]: row.frame }));
          }
        }
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  // Tecla de interação — alterna o frame do prop interativo mais próximo
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      const key = e.key.toLowerCase();
      const me = selfRef.current;
      let best: { prop: PropInstance; dist: number } | null = null;
      for (const prop of propsRef.current) {
        if (!prop.interactive) continue;
        const def = getPropDef(prop.defId);
        if (!def?.interactive || def.interactKey !== key) continue;
        const d = Math.hypot(prop.x - me.x, prop.y - me.y);
        if (d <= INTERACT_RADIUS && (!best || d < best.dist)) {
          best = { prop, dist: d };
        }
      }
      if (!best) return;
      e.preventDefault();
      const def = getPropDef(best.prop.defId)!;
      setFrames((p) => {
        const cur = p[best!.prop.id] ?? 0;
        const next = (cur + 1) % def.frames.length;
        // fire-and-forget upsert
        void (async () => {
          const { data: u } = await supabase.auth.getUser();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase as any).from("prop_states").upsert(
            { prop_id: best!.prop.id, frame: next, updated_by: u.user?.id ?? null, updated_at: new Date().toISOString() },
            { onConflict: "prop_id" }
          );
        })();
        return { ...p, [best!.prop.id]: next };
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const rendered = useMemo(() => propsList, [propsList]);

  return (
    <>
      {rendered.map((p) => {
        const def = getPropDef(p.defId);
        if (!def) return null;
        const frame = frames[p.id] ?? p.frame ?? 0;
        const src = def.frames[frame] ?? def.frames[0];
        const wPct = p.w * 100;
        const hPct = (p.w / def.aspectRatio) * 100;
        // z-index ordenado por y (mais embaixo = mais à frente). Faixa: 30000..40000
        // (abaixo dos avatares, que usam zIndex maior).
        const zIndex = 30000 + Math.round(p.y * 5000);
        return (
          <img
            key={p.id}
            src={src}
            alt={def.label}
            draggable={false}
            className="absolute pointer-events-none select-none"
            style={{
              left: `${p.x * 100}%`,
              top: `${p.y * 100}%`,
              width: `${wPct}%`,
              height: `${hPct}%`,
              transform: "translate(-50%, -100%)",
              objectFit: "contain",
              objectPosition: "bottom center",
              zIndex,
              imageRendering: "pixelated",
            }}
          />
        );
      })}
    </>
  );
}
