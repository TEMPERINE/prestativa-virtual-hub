import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  ZONES,
  SPAWN,
  collides,
  zoneAtWithOverrides as zoneAt,
  findZoneById,
  type Point,
  type ZoneId,
} from "@/lib/office-map";
import { zoneRectFromOverrides, getZoneKind } from "@/lib/map-overrides";
import officeMap from "@/assets/office-map.jpg";
import parkLeft from "@/assets/scene-park-left.jpg";
import roadRight from "@/assets/scene-road-right.jpg";
import avatarDown from "@/assets/avatar-down.png";
import avatarUp from "@/assets/avatar-up.png";
import avatarLeft from "@/assets/avatar-left.png";
import avatarRight from "@/assets/avatar-right.png";

type Facing = "up" | "down" | "left" | "right";
const AVATAR_SPRITES: Record<Facing, string> = {
  up: avatarUp,
  down: avatarDown,
  left: avatarLeft,
  right: avatarRight,
};
// Each sheet: 1536px wide, 6 frames of 256px wide. Heights vary per direction.
const SHEET_HEIGHT: Record<Facing, number> = {
  down: 237,
  up: 231,
  left: 221,
  right: 218,
};
const FRAME_W = 256;
const FRAMES = 6; // frame 0 = idle, frames 1..5 = walk cycle
const WALK_FRAME_MS = 110;

function dirFromKey(k: string): Facing | null {
  if (k === "arrowup" || k === "w") return "up";
  if (k === "arrowdown" || k === "s") return "down";
  if (k === "arrowleft" || k === "a") return "left";
  if (k === "arrowright" || k === "d") return "right";
  return null;
}

const EMOJI_MAP: Record<string, string> = {
  "1": "❤️",
  "2": "👏",
  "3": "🤣",
  "4": "🙌",
  "5": "🤯",
  "6": "💩",
};
const REACTION_DURATION_MS = 3000;
import { toast } from "sonner";
import { LogOut, Mic, MicOff, Video, VideoOff, MonitorUp, Users, Pencil } from "lucide-react";
import { Link } from "@tanstack/react-router";

type Profile = { id: string; display_name: string; avatar_color: string };
type RemotePos = { user_id: string; x: number; y: number; zone: string; is_online: boolean; facing?: Facing };

const SPEED = 0.0042;
const SEND_INTERVAL_MS = 120;

export function OfficeScene() {
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [me, setMe] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [positions, setPositions] = useState<Record<string, RemotePos>>({});
  const [pos, setPos] = useState<Point>(SPAWN);
  const [zone, setZone] = useState<ZoneId>("lobby");
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [showTeam, setShowTeam] = useState(true);
  const [facing, setFacing] = useState<Facing>("down");
  const facingRef = useRef<Facing>("down");
  const [reactions, setReactions] = useState<Record<string, { emoji: string; ts: number }>>({});
  // zone_id -> user_id (claims)
  const [claims, setClaims] = useState<Record<string, string>>({});
  const [hoveredZone, setHoveredZone] = useState<string | null>(null);
  const reactionChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const meIdRef = useRef<string | null>(null);

  const keysDown = useRef<Set<Facing>>(new Set());
  const lastDir = useRef<Facing | null>(null);
  const lastSent = useRef(0);
  const posRef = useRef(pos);
  posRef.current = pos;

  // Walk animation frame (0 = idle, 1..5 = walk cycle)
  const [frame, setFrame] = useState(0);
  const frameRef = useRef(0);
  const lastFrameTick = useRef(0);

  const setLocalFacing = useCallback((nextFacing: Facing) => {
    if (facingRef.current === nextFacing) return;
    facingRef.current = nextFacing;
    setFacing(nextFacing);
  }, []);

  const sendPos = useCallback((x: number, y: number, z: ZoneId, f: Facing) => {
    void supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return;
      void supabase.from("positions").upsert({
        user_id: data.user.id,
        x, y, zone: z, facing: f, is_online: true,
      });
    });
  }, []);

  // Preload all directional sprites so swapping facing never shows a blank frame
  useEffect(() => {
    (Object.values(AVATAR_SPRITES) as string[]).forEach((src) => {
      const img = new Image();
      img.src = src;
    });
  }, []);

  const tryMove = useCallback((dir: Facing) => {
    const cur = posRef.current;
    const dx = dir === "left" ? -SPEED : dir === "right" ? SPEED : 0;
    const dy = dir === "up" ? -SPEED : dir === "down" ? SPEED : 0;
    let nx = cur.x + dx;
    let ny = cur.y + dy;
    if (collides({ x: nx, y: cur.y })) nx = cur.x;
    if (collides({ x: nx, y: ny })) ny = cur.y;
    if (nx === cur.x && ny === cur.y) return false;
    const np = { x: nx, y: ny };
    posRef.current = np;
    setPos(np);
    const z = zoneAt(np);
    setZone((prev) => (prev !== z.id ? z.id : prev));
    const now = performance.now();
    if (now - lastSent.current > SEND_INTERVAL_MS) {
      lastSent.current = now;
      sendPos(np.x, np.y, z.id, dir);
    }
    return true;
  }, [sendPos]);


  // Load me + all profiles + initial positions
  useEffect(() => {
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;
      meIdRef.current = userData.user.id;
      const { data: profs } = await supabase.from("profiles").select("id, display_name, avatar_color");
      const map: Record<string, Profile> = {};
      (profs ?? []).forEach((p) => (map[p.id] = p as Profile));
      setProfiles(map);
      setMe(map[userData.user.id] ?? null);

      const { data: posData } = await supabase.from("positions").select("user_id, x, y, zone, is_online");
      const pmap: Record<string, RemotePos> = {};
      (posData ?? []).forEach((p) => (pmap[p.user_id] = p as RemotePos));

      // Load workspace claims
      const { data: claimData } = await supabase
        .from("workspace_claims")
        .select("zone_id, user_id");
      const cmap: Record<string, string> = {};
      (claimData ?? []).forEach((c: { zone_id: string; user_id: string }) => {
        cmap[c.zone_id] = c.user_id;
      });
      setClaims(cmap);

      // If I have a claim, always spawn at that workstation (center of its rect).
      const myClaimZone = Object.entries(cmap).find(([, uid]) => uid === userData.user!.id)?.[0];
      let startPoint: Point;
      if (myClaimZone) {
        const z = findZoneById(myClaimZone);
        const rect = zoneRectFromOverrides(myClaimZone as ZoneId) ?? z?.rect ?? null;
        if (rect) {
          startPoint = { x: (rect.x1 + rect.x2) / 2, y: (rect.y1 + rect.y2) / 2 };
        } else {
          startPoint = SPAWN;
        }
      } else {
        const existing = pmap[userData.user.id];
        const savedStart = { x: existing?.x ?? SPAWN.x, y: existing?.y ?? SPAWN.y };
        startPoint = collides(savedStart) ? SPAWN : savedStart;
      }
      const safeStart = collides(startPoint) ? SPAWN : startPoint;
      setPos(safeStart);
      const startZone = zoneAt(safeStart).id;
      setZone(startZone);

      pmap[userData.user.id] = {
        user_id: userData.user.id,
        x: safeStart.x,
        y: safeStart.y,
        zone: startZone,
        is_online: true,
      };
      setPositions(pmap);

      await supabase.from("positions").upsert({
        user_id: userData.user.id,
        x: safeStart.x,
        y: safeStart.y,
        zone: startZone,
        facing: "down",
        is_online: true,
      });
    })();

    const ch = supabase
      .channel("positions-room")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "positions" },
        (payload) => {
          const row = (payload.new ?? payload.old) as RemotePos;
          if (!row) return;
          setPositions((prev) => {
            const next = { ...prev };
            if (payload.eventType === "DELETE") delete next[row.user_id];
            else next[row.user_id] = row;
            return next;
          });
        }
      )
      .subscribe();

    const reactionCh = supabase
      .channel("reactions-room")
      .on("broadcast", { event: "reaction" }, (payload) => {
        const { user_id, emoji } = (payload.payload ?? {}) as { user_id?: string; emoji?: string };
        if (!user_id || !emoji) return;
        const ts = Date.now();
        setReactions((prev) => ({ ...prev, [user_id]: { emoji, ts } }));
        setTimeout(() => {
          setReactions((prev) => {
            const cur = prev[user_id];
            if (!cur || cur.ts !== ts) return prev;
            const next = { ...prev };
            delete next[user_id];
            return next;
          });
        }, REACTION_DURATION_MS);
      })
      .subscribe();
    reactionChannelRef.current = reactionCh;

    const claimsCh = supabase
      .channel("claims-room")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "workspace_claims" },
        (payload) => {
          const row = (payload.new ?? payload.old) as { zone_id: string; user_id: string };
          if (!row) return;
          setClaims((prev) => {
            const next = { ...prev };
            if (payload.eventType === "DELETE") delete next[row.zone_id];
            else next[row.zone_id] = row.user_id;
            return next;
          });
        }
      )
      .subscribe();

    const offline = async () => {
      const { data: u } = await supabase.auth.getUser();
      if (u.user) {
        await supabase.from("positions").update({ is_online: false }).eq("user_id", u.user.id);
      }
    };
    window.addEventListener("beforeunload", offline);

    return () => {
      supabase.removeChannel(ch);
      supabase.removeChannel(reactionCh);
      supabase.removeChannel(claimsCh);
      reactionChannelRef.current = null;
      window.removeEventListener("beforeunload", offline);
      offline();
    };
  }, []);

  const claimZone = useCallback(async (zoneId: string) => {
    const uid = meIdRef.current;
    if (!uid) return;
    // Release any previous claim by this user (one workstation per user).
    await supabase.from("workspace_claims").delete().eq("user_id", uid);
    const { error } = await supabase
      .from("workspace_claims")
      .insert({ zone_id: zoneId, user_id: uid });
    if (error) {
      toast.error("Não foi possível reivindicar esse espaço.");
      return;
    }
    const label = findZoneById(zoneId)?.label ?? zoneId;
    toast.success(`Você reivindicou ${label}. Esta é a sua posição oficial.`);
    setClaims((prev) => {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(prev)) if (v !== uid) next[k] = v;
      next[zoneId] = uid;
      return next;
    });
  }, []);


  const sendReaction = useCallback((emoji: string) => {
    const uid = meIdRef.current;
    if (!uid) return;
    const ts = Date.now();
    setReactions((prev) => ({ ...prev, [uid]: { emoji, ts } }));
    setTimeout(() => {
      setReactions((prev) => {
        const cur = prev[uid];
        if (!cur || cur.ts !== ts) return prev;
        const next = { ...prev };
        delete next[uid];
        return next;
      });
    }, REACTION_DURATION_MS);
    const ch = reactionChannelRef.current;
    if (ch) {
      void ch.send({
        type: "broadcast",
        event: "reaction",
        payload: { user_id: uid, emoji },
      });
    }
  }, []);

  // keyboard input — standard 2D game movement (hold to walk, release to idle)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const emoji = EMOJI_MAP[key];
      if (emoji && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA" && !target?.isContentEditable) {
          e.preventDefault();
          sendReaction(emoji);
          return;
        }
      }
      const dir = dirFromKey(key);
      if (!dir) return;
      e.preventDefault();
      if (e.repeat) return;
      keysDown.current.add(dir);
      lastDir.current = dir;
      setLocalFacing(dir);
    };
    const up = (e: KeyboardEvent) => {
      const dir = dirFromKey(e.key.toLowerCase());
      if (!dir) return;
      e.preventDefault();
      keysDown.current.delete(dir);
      if (lastDir.current === dir) {
        // Fall back to any other key still held
        const remaining = Array.from(keysDown.current);
        lastDir.current = remaining[remaining.length - 1] ?? null;
        if (lastDir.current) setLocalFacing(lastDir.current);
      }
    };
    const blur = () => {
      keysDown.current.clear();
      lastDir.current = null;
    };
    window.addEventListener("keydown", down, { passive: false });
    window.addEventListener("keyup", up, { passive: false });
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [setLocalFacing, sendReaction]);

  // movement + animation loop
  useEffect(() => {
    let raf = 0;
    const tick = (t: number) => {
      const dir = lastDir.current;
      if (dir) {
        const moved = tryMove(dir);
        if (moved) {
          if (t - lastFrameTick.current > WALK_FRAME_MS) {
            lastFrameTick.current = t;
            // cycle frames 1..5
            const next = frameRef.current >= 5 || frameRef.current < 1 ? 1 : frameRef.current + 1;
            frameRef.current = next;
            setFrame(next);
          }
        } else if (frameRef.current !== 0) {
          frameRef.current = 0;
          setFrame(0);
        }
      } else if (frameRef.current !== 0) {
        frameRef.current = 0;
        setFrame(0);
        // send final idle position so remotes see exact pose
        const cur = posRef.current;
        const z = zoneAt(cur);
        sendPos(cur.x, cur.y, z.id, facingRef.current);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [tryMove, sendPos]);


  const currentZone = useMemo(() => findZoneById(zone) ?? ZONES[ZONES.length - 1], [zone]);
  // Prefer the painted bounding box (editor overrides) over the hardcoded rect
  // so the spotlight visually matches exactly what the user painted.
  const focusedZone = useMemo(() => {
    if (currentZone.id === "lobby") return null;
    const painted = zoneRectFromOverrides(currentZone.id);
    return painted
      ? { ...currentZone, rect: painted }
      : currentZone;
  }, [currentZone]);

  // All workspace zones (built-in + custom) with their effective rect for hover overlays.
  const workspaceZones = useMemo(() => {
    const out: { id: string; label: string; rect: { x1: number; y1: number; x2: number; y2: number } }[] = [];
    for (const z of ZONES) {
      if (z.id === "lobby") continue;
      if (getZoneKind(z.id) !== "workspace") continue;
      const rect = zoneRectFromOverrides(z.id) ?? z.rect;
      out.push({ id: z.id, label: z.label, rect });
    }
    // Custom zones from editor overrides.
    import("@/lib/map-overrides").then(() => {}); // no-op (kept dep tree honest)
    return out;
  }, []);



  const onlineList = useMemo(() => {
    return Object.values(positions)
      .filter((p) => p.is_online)
      .map((p) => ({ pos: p, profile: profiles[p.user_id] }))
      .filter((x) => x.profile);
  }, [positions, profiles]);

  const offlineList = useMemo(() => {
    const onlineIds = new Set(onlineList.map((x) => x.profile.id));
    return Object.values(profiles).filter((p) => !onlineIds.has(p.id));
  }, [profiles, onlineList]);

  const signOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/auth";
  };

  return (
    <div
      ref={sceneRef}
      tabIndex={0}
      className="relative w-screen h-screen overflow-hidden bg-black outline-none flex items-stretch"
      onMouseDown={() => sceneRef.current?.focus()}
    >
      {/* Extended scenery — park on the left */}
      <div
        className="flex-1 h-full"
        style={{
          backgroundImage: `url(${parkLeft})`,
          backgroundSize: "auto 100%",
          backgroundPosition: "right center",
          backgroundRepeat: "repeat-x",
        }}
        aria-hidden
      />

      {/* Office stage — fixed aspect, full height */}
      <div
        ref={stageRef}
        className="relative h-full shrink-0"
        style={{ aspectRatio: "1536 / 1024" }}
      >

        <img
          src={officeMap}
          alt="Escritório Prestativa Virtual"
          className="absolute inset-0 w-full h-full object-cover select-none pointer-events-none"
          draggable={false}
        />


        {/* Private-area overlay (Gather-style): darken everything outside the active zone */}
        {focusedZone && (
          <ZoneSpotlight rect={focusedZone.rect} />
        )}

        {/* Avatars */}
        {onlineList.map(({ pos: p, profile }) => {
          const isMe = me?.id === profile.id;
          const display = isMe ? pos : { x: p.x, y: p.y };
          // When zone overlay active, dim avatars outside the zone
          const inFocus =
            !focusedZone ||
            (display.x >= focusedZone.rect.x1 &&
              display.x <= focusedZone.rect.x2 &&
              display.y >= focusedZone.rect.y1 &&
              display.y <= focusedZone.rect.y2);
          return (
            <div
              key={profile.id}
              className="absolute pointer-events-none"
              style={{
                left: `${display.x * 100}%`,
                top: `${display.y * 100}%`,
                transform: "translate(-50%, -90%)",
                transition: isMe ? "none" : "left 120ms linear, top 120ms linear",
                zIndex: focusedZone ? (inFocus ? 60 : 20) : Math.round(display.y * 1000),
                opacity: inFocus ? 1 : 0.35,
                filter: inFocus ? "none" : "grayscale(0.5)",
              }}
            >
              <div className="flex flex-col items-center">
                <div
                  className={`px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap mb-0.5 ${
                    isMe ? "bg-primary text-primary-foreground" : "bg-card/95 text-foreground"
                  } shadow-soft backdrop-blur-sm`}
                  style={{
                    border: isMe ? "none" : `1.5px solid ${profile.avatar_color}`,
                  }}
                >
                  {profile.display_name}
                </div>
                <div className="relative">
                  <div className="absolute left-1/2 -translate-x-1/4 -top-5 z-10 pointer-events-none">
                    <ReactionBubble emoji={reactions[profile.id]?.emoji ?? null} />
                  </div>
                  <SpriteAvatar
                    facing={isMe ? facing : (p.facing ?? "down")}
                    frame={isMe ? frame : 0}
                    glowColor={isMe ? profile.avatar_color : undefined}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Extended scenery — road on the right */}
      <div
        className="flex-1 h-full"
        style={{
          backgroundImage: `url(${roadRight})`,
          backgroundSize: "auto 100%",
          backgroundPosition: "left center",
          backgroundRepeat: "repeat-x",
        }}
        aria-hidden
      />

      {/* Topbar */}
      <div className="absolute top-0 left-0 right-0 p-4 pointer-events-none">
        <div className="glass-panel rounded-2xl shadow-soft px-4 py-2.5 flex items-center justify-between pointer-events-auto">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl gradient-primary flex items-center justify-center shadow-glow">
              <span className="text-sm font-bold text-primary-foreground">P</span>
            </div>
            <div>
              <div className="text-xs text-muted-foreground leading-tight">Você está em</div>
              <div className="text-sm font-semibold leading-tight">{currentZone.label}</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <IconButton
              active={micOn}
              onClick={() => {
                setMicOn(!micOn);
                toast.info(micOn ? "Microfone desligado" : "Microfone ligado (áudio chega na próxima fase)");
              }}
              title="Microfone"
            >
              {micOn ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
            </IconButton>
            {currentZone.supportsVideo && (
              <>
                <IconButton
                  active={camOn}
                  onClick={() => {
                    setCamOn(!camOn);
                    toast.info("Vídeo chega na próxima fase");
                  }}
                  title="Câmera"
                >
                  {camOn ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
                </IconButton>
                <IconButton
                  onClick={() => toast.info("Compartilhamento de tela chega na próxima fase")}
                  title="Compartilhar tela"
                >
                  <MonitorUp className="w-4 h-4" />
                </IconButton>
              </>
            )}
            <IconButton active={showTeam} onClick={() => setShowTeam(!showTeam)} title="Equipe">
              <Users className="w-4 h-4" />
            </IconButton>
            <Link
              to="/office/editor"
              title="Editor de mapa"
              className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white"
            >
              <Pencil className="w-4 h-4" />
            </Link>
            <IconButton onClick={signOut} title="Sair">
              <LogOut className="w-4 h-4" />
            </IconButton>
          </div>
        </div>
      </div>

      {/* Zone enter-toast (Gather style) */}
      {focusedZone && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 pointer-events-none z-[70]">
          <div
            className="px-4 py-2 rounded-full text-sm font-medium shadow-soft backdrop-blur-sm"
            style={{
              background: "rgba(15,15,20,0.85)",
              color: "white",
              border: `1px solid ${focusedZone.accent}`,
            }}
          >
            Você entrou em <strong>{focusedZone.label}</strong>
          </div>
        </div>
      )}

      {/* Team panel */}
      {showTeam && (
        <div className="absolute right-4 top-24 bottom-24 w-72 pointer-events-auto z-[80]">
          <div className="glass-panel rounded-2xl shadow-soft h-full flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b">
              <div className="text-sm font-semibold">Equipe</div>
              <div className="text-xs text-muted-foreground">
                {onlineList.length} online · {offlineList.length} offline
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
              {onlineList.map(({ profile, pos: p }) => (
                <TeamRow
                  key={profile.id}
                  profile={profile}
                  zone={p.zone}
                  online
                  isMe={me?.id === profile.id}
                />
              ))}
              {offlineList.map((profile) => (
                <TeamRow key={profile.id} profile={profile} online={false} />
              ))}
              {onlineList.length === 0 && offlineList.length === 0 && (
                <div className="text-xs text-muted-foreground p-3 text-center">
                  Nenhuma colega cadastrada ainda. Peça à administração para criar contas.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Movement hint */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-none z-[70]">
        <div className="glass-panel rounded-full px-4 py-2 shadow-soft text-xs text-muted-foreground">
          Use <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">WASD</kbd> ou{" "}
          <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">setas</kbd> para se mover
        </div>
      </div>
    </div>
  );
}

/** Animated sprite avatar — 6-frame horizontal sheet per direction. */
function SpriteAvatar({
  facing,
  frame,
  glowColor,
}: {
  facing: Facing;
  frame: number;
  glowColor?: string;
}) {
  const sheetH = SHEET_HEIGHT[facing];
  return (
    <div
      style={{
        position: "relative",
        height: "min(9vh, 94px)",
        aspectRatio: `${FRAME_W} / ${sheetH}`,
      }}
    >
      {(Object.keys(AVATAR_SPRITES) as Facing[]).map((f) => {
        const h = SHEET_HEIGHT[f];
        const active = f === facing;
        return (
          <div
            key={f}
            style={{
              position: "absolute",
              left: "50%",
              bottom: 0,
              transform: "translateX(-50%)",
              height: "100%",
              aspectRatio: `${FRAME_W} / ${h}`,
              backgroundImage: `url(${AVATAR_SPRITES[f]})`,
              backgroundRepeat: "no-repeat",
              backgroundSize: `${FRAMES * 100}% 100%`,
              backgroundPosition: `${(frame / (FRAMES - 1)) * 100}% 0`,
              imageRendering: "pixelated",
              visibility: active ? "visible" : "hidden",
            }}
          />
        );
      })}
    </div>
  );
}

/** Speech-bubble reaction shown above an avatar. */
function ReactionBubble({ emoji }: { emoji: string | null }) {
  const [visible, setVisible] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    if (emoji) {
      setCurrent(emoji);
      // small delay so the DOM mount happens before the CSS transition kicks in
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [emoji]);

  const onTransitionEnd = () => {
    if (!visible) setCurrent(null);
  };

  return (
    <div
      className={`select-none transition-all duration-300 ease-out ${
        visible ? "opacity-100 translate-y-0 scale-100" : "opacity-0 -translate-y-2 scale-90"
      }`}
      onTransitionEnd={onTransitionEnd}
    >
      {current && (
        <div
          className="px-2.5 py-1 rounded-2xl bg-white shadow-soft border border-black/5 whitespace-nowrap"
          style={{ fontSize: "clamp(16px, 2.6vh, 28px)", lineHeight: 1 }}
        >
          {current}
        </div>
      )}
    </div>
  );
}






/** Darkens everything outside the given zone rect within the office stage. */
function ZoneSpotlight({ rect }: { rect: { x1: number; y1: number; x2: number; y2: number } }) {
  const overlay = "rgba(5, 6, 12, 0.20)";
  return (
    <>
      {/* top */}
      <div
        className="absolute left-0 right-0 top-0 pointer-events-none z-50"
        style={{ height: `${rect.y1 * 100}%`, background: overlay, transition: "all 200ms" }}
      />
      {/* bottom */}
      <div
        className="absolute left-0 right-0 bottom-0 pointer-events-none z-50"
        style={{ height: `${(1 - rect.y2) * 100}%`, background: overlay, transition: "all 200ms" }}
      />
      {/* left */}
      <div
        className="absolute left-0 pointer-events-none z-50"
        style={{
          top: `${rect.y1 * 100}%`,
          bottom: `${(1 - rect.y2) * 100}%`,
          width: `${rect.x1 * 100}%`,
          background: overlay,
          transition: "all 200ms",
        }}
      />
      {/* right */}
      <div
        className="absolute right-0 pointer-events-none z-50"
        style={{
          top: `${rect.y1 * 100}%`,
          bottom: `${(1 - rect.y2) * 100}%`,
          width: `${(1 - rect.x2) * 100}%`,
          background: overlay,
          transition: "all 200ms",
        }}
      />
    </>
  );
}

function IconButton({
  children,
  onClick,
  active,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`w-9 h-9 rounded-lg flex items-center justify-center transition ${
        active
          ? "bg-primary text-primary-foreground shadow-glow"
          : "bg-muted/60 hover:bg-muted text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function TeamRow({
  profile,
  zone,
  online,
  isMe,
}: {
  profile: Profile;
  zone?: string;
  online: boolean;
  isMe?: boolean;
}) {
  const zoneLabel = zone ? findZoneById(zone)?.label : undefined;
  return (
    <div
      className={`flex items-center gap-3 px-2.5 py-2 rounded-lg ${
        isMe ? "bg-primary/10" : "hover:bg-muted/60"
      } transition cursor-pointer`}
    >
      <div className="relative">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold"
          style={{ background: profile.avatar_color, opacity: online ? 1 : 0.4 }}
        >
          {profile.display_name.charAt(0).toUpperCase()}
        </div>
        <div
          className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-background ${
            online ? "bg-emerald-500" : "bg-muted-foreground/40"
          }`}
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">
          {profile.display_name} {isMe && <span className="text-xs text-muted-foreground">(você)</span>}
        </div>
        {online && zoneLabel && (
          <div className="text-[11px] text-muted-foreground truncate">{zoneLabel}</div>
        )}
      </div>
    </div>
  );
}
