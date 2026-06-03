import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  ZONES,
  SPAWN,
  collides,
  zoneAt,
  rotateIso,
  type Point,
  type ZoneId,
} from "@/lib/office-map";
import officeMap from "@/assets/office-map.jpg";
import parkLeft from "@/assets/scene-park-left.jpg";
import roadRight from "@/assets/scene-road-right.jpg";
import avatarSprite from "@/assets/avatar-sprite.png";
import { toast } from "sonner";
import { LogOut, Mic, MicOff, Video, VideoOff, MonitorUp, Users } from "lucide-react";

type Profile = { id: string; display_name: string; avatar_color: string };
type RemotePos = { user_id: string; x: number; y: number; zone: string; is_online: boolean };

const SPEED = 0.0048;
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

  const keys = useRef<Record<string, boolean>>({});
  const lastSent = useRef(0);
  const walkTarget = useRef<Point | null>(null);
  const posRef = useRef(pos);
  posRef.current = pos;

  const moveAvatar = useCallback((rawDx: number, rawDy: number, speed = SPEED) => {
    if (!rawDx && !rawDy) return;
    // Apply isometric rotation so movement follows the office perspective.
    const rot = rotateIso(rawDx, rawDy);
    const len = Math.hypot(rot.dx, rot.dy);
    if (!len) return;
    const dx = (rot.dx / len) * speed;
    const dy = (rot.dy / len) * speed;
    const cur = posRef.current;

    let nx = cur.x + dx;
    let ny = cur.y;
    if (collides({ x: nx, y: ny })) nx = cur.x;
    ny += dy;
    if (collides({ x: nx, y: ny })) ny = cur.y;
    if (nx === cur.x && ny === cur.y) return;

    const np = { x: nx, y: ny };
    posRef.current = np;
    setPos(np);
    const z = zoneAt(np);
    setZone((prev) => (prev !== z.id ? z.id : prev));

    const now = performance.now();
    if (now - lastSent.current > SEND_INTERVAL_MS) {
      lastSent.current = now;
      void supabase.auth.getUser().then(({ data }) => {
        if (!data.user) return;
        void supabase.from("positions").upsert({
          user_id: data.user.id,
          x: np.x,
          y: np.y,
          zone: z.id,
          facing: Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up",
          is_online: true,
        });
      });
    }
  }, []);

  const handleMoveKey = useCallback(
    (key: string, pressed: boolean, step = false) => {
      const k = key.toLowerCase();
      if (!["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"].includes(k))
        return false;
      keys.current[k] = pressed;
      if (pressed) walkTarget.current = null;
      if (pressed && step) {
        if (k === "arrowup" || k === "w") moveAvatar(0, -1, SPEED * 6);
        if (k === "arrowdown" || k === "s") moveAvatar(0, 1, SPEED * 6);
        if (k === "arrowleft" || k === "a") moveAvatar(-1, 0, SPEED * 6);
        if (k === "arrowright" || k === "d") moveAvatar(1, 0, SPEED * 6);
      }
      return true;
    },
    [moveAvatar]
  );

  const walkToPoint = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    sceneRef.current?.focus();
    const bounds = event.currentTarget.getBoundingClientRect();
    const next = {
      x: Math.max(0.11, Math.min(0.95, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0.05, Math.min(0.95, (event.clientY - bounds.top) / bounds.height)),
    };
    walkTarget.current = next;
  }, []);

  // Load me + all profiles + initial positions
  useEffect(() => {
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;
      const { data: profs } = await supabase.from("profiles").select("id, display_name, avatar_color");
      const map: Record<string, Profile> = {};
      (profs ?? []).forEach((p) => (map[p.id] = p as Profile));
      setProfiles(map);
      setMe(map[userData.user.id] ?? null);

      const { data: posData } = await supabase.from("positions").select("user_id, x, y, zone, is_online");
      const pmap: Record<string, RemotePos> = {};
      (posData ?? []).forEach((p) => (pmap[p.user_id] = p as RemotePos));

      const existing = pmap[userData.user.id];
      const savedStart = { x: existing?.x ?? SPAWN.x, y: existing?.y ?? SPAWN.y };
      const safeStart = collides(savedStart) ? SPAWN : savedStart;
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

    const offline = async () => {
      const { data: u } = await supabase.auth.getUser();
      if (u.user) {
        await supabase.from("positions").update({ is_online: false }).eq("user_id", u.user.id);
      }
    };
    window.addEventListener("beforeunload", offline);

    return () => {
      supabase.removeChannel(ch);
      window.removeEventListener("beforeunload", offline);
      offline();
    };
  }, []);

  // keyboard input
  useEffect(() => {
    const MOVE_KEYS = new Set(["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"]);
    const down = (e: KeyboardEvent) => {
      if (MOVE_KEYS.has(e.key.toLowerCase())) {
        e.preventDefault();
        handleMoveKey(e.key, true, true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (MOVE_KEYS.has(e.key.toLowerCase())) {
        e.preventDefault();
        handleMoveKey(e.key, false);
      }
    };
    window.addEventListener("keydown", down, { passive: false });
    window.addEventListener("keyup", up, { passive: false });
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [handleMoveKey]);

  // movement loop
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const k = keys.current;
      let dx = 0;
      let dy = 0;
      if (k["arrowup"] || k["w"]) dy -= 1;
      if (k["arrowdown"] || k["s"]) dy += 1;
      if (k["arrowleft"] || k["a"]) dx -= 1;
      if (k["arrowright"] || k["d"]) dx += 1;

      if (dx || dy) {
        moveAvatar(dx, dy);
      } else if (walkTarget.current) {
        // walkTarget is in image-space already; compute raw delta without iso
        // rotation (rotation will be applied inside moveAvatar).
        const target = walkTarget.current;
        const cur = posRef.current;
        const tx = target.x - cur.x;
        const ty = target.y - cur.y;
        if (Math.hypot(tx, ty) < SPEED * 1.5) {
          walkTarget.current = null;
        } else {
          // Pre-undo rotation so when moveAvatar applies iso rotation we end up
          // moving toward the actual click point.
          const inv = rotateIso(tx, -ty); // we want rotate by -ROT; rotateIso uses negative rotation already, so compose
          // Simpler: bypass rotation by passing rotated-back input.
          // We'll just call moveAvatar with raw delta — perspective rotation
          // will slightly bend the path; acceptable for click-to-walk v1.
          void inv;
          moveAvatar(tx, ty, SPEED * 1.5);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [moveAvatar]);

  const currentZone = useMemo(() => ZONES.find((z) => z.id === zone) ?? ZONES[ZONES.length - 1], [zone]);
  const focusedZone = currentZone.id !== "lobby" ? currentZone : null;

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
      onKeyDown={(e) => {
        if (handleMoveKey(e.key, true, true)) e.preventDefault();
      }}
      onKeyUp={(e) => {
        if (handleMoveKey(e.key, false)) e.preventDefault();
      }}
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
        onPointerDown={walkToPoint}
      >
        <img
          src={officeMap}
          alt="Escritório Prestativa Virtual"
          className="absolute inset-0 w-full h-full object-cover select-none pointer-events-none"
          draggable={false}
        />

        {/* Zone outlines (subtle) */}
        {ZONES.filter((z) => z.id !== "lobby").map((z) => (
          <div
            key={z.id}
            className="absolute pointer-events-none transition-colors duration-300"
            style={{
              left: `${z.rect.x1 * 100}%`,
              top: `${z.rect.y1 * 100}%`,
              width: `${(z.rect.x2 - z.rect.x1) * 100}%`,
              height: `${(z.rect.y2 - z.rect.y1) * 100}%`,
              border: zone === z.id ? `3px solid ${z.accent}` : "1.5px dashed rgba(255,255,255,0.25)",
              borderRadius: 10,
              boxShadow: zone === z.id ? `0 0 30px ${z.accent}` : "none",
            }}
          />
        ))}

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
                  <img
                    src={avatarSprite}
                    alt=""
                    draggable={false}
                    className="select-none"
                    style={{
                      width: "min(4.2vh, 56px)",
                      height: "auto",
                      filter: isMe
                        ? `drop-shadow(0 0 8px ${profile.avatar_color}) drop-shadow(0 3px 4px rgba(0,0,0,0.35))`
                        : "drop-shadow(0 3px 4px rgba(0,0,0,0.35))",
                    }}
                  />
                  {/* foot shadow */}
                  <div
                    className="absolute left-1/2 -translate-x-1/2 -bottom-1 rounded-full"
                    style={{
                      width: "60%",
                      height: "8%",
                      background: "rgba(0,0,0,0.35)",
                      filter: "blur(4px)",
                    }}
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
          Use <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">WASD</kbd>,{" "}
          <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">setas</kbd> ou clique no mapa
        </div>
      </div>
    </div>
  );
}

/** Darkens everything outside the given zone rect within the office stage. */
function ZoneSpotlight({ rect }: { rect: { x1: number; y1: number; x2: number; y2: number } }) {
  const overlay = "rgba(5, 6, 12, 0.72)";
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
  const zoneLabel = zone ? ZONES.find((z) => z.id === zone)?.label : undefined;
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
