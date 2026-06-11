import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { loadOverrides, subscribeOverridesFromCloud, zoneFromOverrides, type PropInstance } from "@/lib/map-overrides";
import { getPropDef, subscribePropCatalog } from "@/lib/prop-catalog";
import { loadCustomPropsFromCloud } from "@/lib/custom-props";
import { publishProps, publishFrames } from "@/lib/prop-gates";
import { getCurrentWorkspaceId, subscribeCurrentWorkspaceId } from "@/lib/workspace/current";

const INTERACT_RADIUS = 0.1; // distância (em fração do mapa) para o avatar poder interagir

type Props = {
  /** posição normalizada (0..1) do avatar local; usada para gating de tecla */
  selfX: number;
  selfY: number;
  /** quando uma zona está focada, props dentro dela recebem o mesmo boost de
   *  z-index dos avatares para se intercalarem corretamente. */
  focusedRect?: { x1: number; y1: number; x2: number; y2: number } | null;
};

type PropStateRow = { prop_id: string; frame: number };

export function PropsLayer({ selfX, selfY, focusedRect = null }: Props) {
  const [propsList, setPropsList] = useState<PropInstance[]>(
    () => loadOverrides()?.props ?? []
  );
  const [frames, setFrames] = useState<Record<string, number>>({});
  // Override local de frame durante animação one-shot (não persiste no servidor).
  const [animFrames, setAnimFrames] = useState<Record<string, number>>({});
  const animTimersRef = useRef<Record<string, number>>({});
  // Ticks já processados localmente — evita que o eco realtime do nosso
  // próprio clique reinicie a animação no meio.
  const handledTicksRef = useRef<Record<string, number>>({});
  // Último tick que ESTE cliente já enviou para o servidor — usado para
  // calcular o próximo tick sem depender do eco do realtime voltar primeiro.
  const lastSentTickRef = useRef<Record<string, number>>({});
  const [, setCatalogVersion] = useState(0);
  const selfRef = useRef({ x: selfX, y: selfY });
  selfRef.current = { x: selfX, y: selfY };
  const propsRef = useRef(propsList);
  propsRef.current = propsList;


  // Carrega elementos personalizados e re-renderiza quando o catálogo muda
  useEffect(() => {
    void loadCustomPropsFromCloud();
    return subscribePropCatalog(() => setCatalogVersion((v) => v + 1));
  }, []);

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

  // Publica props/frames atuais no store global para que o sistema de
  // movimento (OfficeScene) saiba quais zonas estão trancadas.
  useEffect(() => { publishProps(propsList); }, [propsList]);

  // Carrega estados (frames) e escuta realtime — escopado por workspace.
  // PK real é (workspace_id, prop_id) e a tabela é per-workspace, então
  // precisamos refazer fetch/subscribe sempre que o workspace ativo muda.
  const [wsId, setWsId] = useState<string | null>(() => getCurrentWorkspaceId());
  useEffect(() => { const u = subscribeCurrentWorkspaceId(setWsId); return () => { u(); }; }, []);

  useEffect(() => {
    if (!wsId) { setFrames({}); return; }
    let cancelled = false;
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from("prop_states")
        .select("prop_id, frame")
        .eq("workspace_id", wsId);
      if (cancelled || !data) return;
      const map: Record<string, number> = {};
      for (const row of data as PropStateRow[]) {
        map[row.prop_id] = row.frame;
        // Marca tick atual como já tratado — evita disparar animação/som
        // ao carregar o workspace (estado pré-existente não é um novo evento).
        handledTicksRef.current[row.prop_id] = row.frame;
      }
      setFrames(map);
    })();
    const channel = supabase
      .channel(`prop_states-${wsId}-${Date.now()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "prop_states", filter: `workspace_id=eq.${wsId}` },
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
  }, [wsId]);

  useEffect(() => { publishFrames(frames); }, [frames]);


  // Roda animação one-shot localmente (sem persistir no servidor).
  // Reproduz def.animation.sequence e termina no restFrame.
  const playAnimation = useCallback((propId: string) => {
    const prop = propsRef.current.find((p) => p.id === propId);
    if (!prop) return;
    const def = getPropDef(prop.defId);
    // Som: cada disparo cria uma nova instância e sobrepõe sem cortar
    // (campainha tocada múltiplas vezes). Roda independente da animação.
    if (def?.soundUrl) {
      try {
        const audio = new Audio(def.soundUrl);
        audio.volume = 0.9;
        void audio.play().catch(() => { /* autoplay bloqueado */ });
      } catch { /* noop */ }
    }
    const anim = def?.animation;
    if (!anim) return;
    // Se já está animando, reinicia do começo (não acumula timers).
    if (animTimersRef.current[propId]) {
      window.clearTimeout(animTimersRef.current[propId]);
      delete animTimersRef.current[propId];
    }
    const rest = anim.restFrame ?? 0;
    // IMPORTANTE: capturar o frame ANTES do setState. O updater do React roda
    // de forma assíncrona (no render), e ler `sequence[i]` lá dentro pega o
    // `i` já incrementado — sob lag de render todos os updates colapsam para
    // `undefined` e a animação parece "não rodar".
    let i = 0;
    const step = () => {
      if (i >= anim.sequence.length) {
        delete animTimersRef.current[propId];
        setAnimFrames((p) => {
          const n = { ...p };
          delete n[propId];
          return n;
        });
        return;
      }
      const frameValue = anim.sequence[i];
      i++;
      setAnimFrames((p) => ({ ...p, [propId]: frameValue }));
      animTimersRef.current[propId] = window.setTimeout(step, anim.frameMs);
    };
    setAnimFrames((p) => ({ ...p, [propId]: rest }));
    animTimersRef.current[propId] = window.setTimeout(step, 0);
  }, []);

  // Cleanup timers no unmount
  useEffect(() => {
    return () => {
      for (const id of Object.keys(animTimersRef.current)) {
        window.clearTimeout(animTimersRef.current[id]);
      }
      animTimersRef.current = {};
    };
  }, []);

  // Ação de interação reutilizável (chamada pelo teclado e pelo botão flutuante)
  const triggerInteract = useCallback((prop: PropInstance) => {
    const def = getPropDef(prop.defId);
    if (!def?.interactive) return;
    const ws = getCurrentWorkspaceId();
    if (!ws) return;
    // Animação one-shot: dispara local e broadcasta um "tick" via upsert.
    // Cada clique incrementa um contador no campo frame para garantir que
    // o realtime envie o evento mesmo se o valor não mudou.
    if (def.animation) {
      playAnimation(prop.id);
      // IMPORTANTE: avançar o tick a partir de um ref local (não do estado
      // `frames`, que só é atualizado pelo eco do realtime). Cliques rápidos
      // calculavam o mesmo tick → o servidor gravava o mesmo valor → as
      // outras abas/desktop deduplicavam via handledTicksRef e o sino
      // "travava" do outro lado.
      const prev = Math.max(
        lastSentTickRef.current[prop.id] ?? 0,
        frames[prop.id] ?? 0,
      );
      const tick = (prev % 1_000_000) + 1;
      lastSentTickRef.current[prop.id] = tick;
      handledTicksRef.current[prop.id] = tick;
      void (async () => {
        const { data: u } = await supabase.auth.getUser();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase as any).from("prop_states").upsert(
          {
            workspace_id: ws,
            prop_id: prop.id,
            frame: tick,
            updated_by: u.user?.id ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "workspace_id,prop_id" }
        );
        if (error) console.error("[PropsLayer] upsert prop_states failed:", error);
      })();
      return;
    }
    setFrames((p) => {
      const cur = p[prop.id] ?? 0;
      const next = (cur + 1) % def.frames.length;
      void (async () => {
        const { data: u } = await supabase.auth.getUser();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase as any).from("prop_states").upsert(
          {
            workspace_id: ws,
            prop_id: prop.id,
            frame: next,
            updated_by: u.user?.id ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "workspace_id,prop_id" }
        );
        if (error) console.error("[PropsLayer] upsert prop_states failed:", error);
      })();
      return { ...p, [prop.id]: next };
    });
  }, [frames, playAnimation]);

  // Dispara animação local quando o frame remoto muda em props animados.
  // Ignora ticks que nós mesmos originamos (já animados localmente).
  useEffect(() => {
    for (const prop of propsList) {
      const def = getPropDef(prop.defId);
      if (!def?.animation) continue;
      const f = frames[prop.id];
      if (f === undefined || f === (def.animation.restFrame ?? 0)) continue;
      if (handledTicksRef.current[prop.id] === f) continue;
      handledTicksRef.current[prop.id] = f;
      playAnimation(prop.id);
    }
  }, [frames, propsList, playAnimation]);


  // Prop interativo mais próximo dentro do raio — usado pelo botão flutuante
  const nearestInteractive = useMemo(() => {
    let best: { prop: PropInstance; dist: number } | null = null;
    for (const prop of propsList) {
      if (!prop.interactive) continue;
      const def = getPropDef(prop.defId);
      if (!def?.interactive) continue;
      const d = Math.hypot(prop.x - selfX, prop.y - selfY);
      if (d <= INTERACT_RADIUS && (!best || d < best.dist)) {
        best = { prop, dist: d };
      }
    }
    return best?.prop ?? null;
  }, [propsList, selfX, selfY]);

  // Tecla de interação — alterna o frame do prop interativo mais próximo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
      triggerInteract(best.prop);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [triggerInteract]);

  // Atalho global: Ctrl+X alterna qualquer prop com ação `gate-zone` cuja
  // zona alvo seja a zona onde o avatar está atualmente. Permite "trancar
  // a sala" de dentro sem precisar estar perto da porta.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() !== "x") return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      const me = selfRef.current;
      const currentZone = zoneFromOverrides({ x: me.x, y: me.y });
      if (!currentZone) return;
      const candidates = propsRef.current.filter((p) => {
        if (!p.interactive || !p.actions) return false;
        const def = getPropDef(p.defId);
        if (!def?.interactive) return false;
        return p.actions.some((a) => a.type === "gate-zone" && a.zoneId === currentZone);
      });
      if (candidates.length === 0) return;
      e.preventDefault();
      for (const p of candidates) triggerInteract(p);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [triggerInteract]);

  const rendered = useMemo(() => propsList, [propsList]);

  return (
    <>
      {rendered.map((p) => {
        const def = getPropDef(p.defId);
        if (!def) return null;
        const baseFrame = def.animation
          ? (def.animation.restFrame ?? 0)
          : (frames[p.id] ?? p.frame ?? 0);
        const frame = animFrames[p.id] ?? baseFrame;
        const src = def.frames[frame] ?? def.frames[0];

        const wPct = p.w * 100;
        const hPct = (p.w / def.aspectRatio) * 100;
        const hNorm = p.w / def.aspectRatio;
        const refY = p.y - hNorm * (1 - (def.depthRefY ?? 1));
        const focusOffset = focusedRect && def.foregroundWhenFocused ? 60000 : 0;
        const zIndex = focusOffset + Math.max(1, Math.round(refY * 1000));
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

      {nearestInteractive && (() => {
        const def = getPropDef(nearestInteractive.defId);
        if (!def?.interactive) return null;
        const hNorm = nearestInteractive.w / def.aspectRatio;
        const topPct = (nearestInteractive.y - hNorm) * 100; // topo do bounding box
        const keyLabel = (def.interactKey ?? "x").toUpperCase();
        return (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              triggerInteract(nearestInteractive);
            }}
            className="absolute -translate-x-1/2 -translate-y-full flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/70 backdrop-blur-sm text-[11px] text-white/90 shadow-lg hover:bg-black/80 transition-colors"
            style={{
              left: `${nearestInteractive.x * 100}%`,
              top: `${topPct}%`,
              zIndex: 1_000_000,
              fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
            }}
            aria-label={`Interagir com ${def.label}`}
          >
            <span className="opacity-80">Aperte</span>
            <kbd className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded bg-white/15 border border-white/20 font-bold text-white text-[10px] leading-none">
              {keyLabel}
            </kbd>
          </button>
        );
      })()}
    </>
  );
}

