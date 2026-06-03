import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ZONES, SPAWN, collides, zoneAt, type Point, type ZoneId } from "@/lib/office-map";
import officeMap from "@/assets/office-map.jpg";
import { toast } from "sonner";
import { LogOut, Mic, MicOff, Video, VideoOff, MonitorUp, Users } from "lucide-react";

type Profile = { id: string; display_name: string; avatar_color: string };
type RemotePos = { user_id: string; x: number; y: number; zone: string; is_online: boolean };

const SPEED = 0.0045; // normalized units per frame at 60fps
const SEND_INTERVAL_MS = 120;

export function OfficeScene() {
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
  const posRef = useRef(pos);
  posRef.current = pos;

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

      // upsert my position as online (preserve existing coords if any)
      const existing = pmap[userData.user.id];
      const startX = existing?.x ?? SPAWN.x;
      const startY = existing?.y ?? SPAWN.y;
      const startZone = existing?.zone ?? "lobby";
      setPos({ x: startX, y: startY });
      setZone(startZone as ZoneId);

      const mine: RemotePos = {
        user_id: userData.user.id,
        x: startX,
        y: startY,
        zone: startZone,
        is_online: true,
      };
      pmap[userData.user.id] = mine;
      setPositions(pmap);

      await supabase.from("positions").upsert({
        user_id: userData.user.id,
        x: startX,
        y: startY,
        zone: startZone,
        facing: "down",
        is_online: true,
      });
    })();

    // realtime positions
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

    // mark offline on unload
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
    const down = (e: KeyboardEvent) => {
      keys.current[e.key.toLowerCase()] = true;
    };
    const up = (e: KeyboardEvent) => {
      keys.current[e.key.toLowerCase()] = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

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
        const len = Math.hypot(dx, dy);
        dx = (dx / len) * SPEED;
        dy = (dy / len) * SPEED;
        const cur = posRef.current;
        // try axis-separated movement to allow sliding along walls
        let nx = cur.x + dx;
        let ny = cur.y;
        if (collides({ x: nx, y: ny })) nx = cur.x;
        ny = ny + dy;
        if (collides({ x: nx, y: ny })) ny = cur.y;
        nx = Math.max(0.02, Math.min(0.98, nx));
        ny = Math.max(0.02, Math.min(0.98, ny));
        if (nx !== cur.x || ny !== cur.y) {
          const np = { x: nx, y: ny };
          setPos(np);
          const z = zoneAt(np);
          setZone((prev) => (prev !== z.id ? z.id : prev));

          // throttle network send
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
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const currentZone = useMemo(() => ZONES.find((z) => z.id === zone) ?? ZONES[ZONES.length - 1], [zone]);

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
    <div className="relative w-screen h-screen overflow-hidden bg-background">
      {/* Ambient extended scenery (blurred & dimmed copy of the map filling the viewport) */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url(${officeMap})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          filter: "blur(28px) brightness(0.85) saturate(1.05)",
          transform: "scale(1.15)",
        }}
        aria-hidden
      />
      <div className="absolute inset-0 bg-black/10" aria-hidden />

      {/* Map stage */}
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div
          className="relative shadow-soft rounded-2xl overflow-hidden ring-1 ring-white/20"
          style={{ aspectRatio: "1536 / 1024", width: "min(100%, calc((100vh - 6rem) * 1.5))" }}
        >
          <img
            src={officeMap}
            alt="Escritório Prestativa Virtual"
            className="absolute inset-0 w-full h-full object-cover select-none pointer-events-none"
            draggable={false}
          />


          {/* Zone label overlays */}
          {ZONES.filter((z) => z.id !== "lobby").map((z) => (
            <div
              key={z.id}
              className="absolute pointer-events-none"
              style={{
                left: `${z.rect.x1 * 100}%`,
                top: `${z.rect.y1 * 100}%`,
                width: `${(z.rect.x2 - z.rect.x1) * 100}%`,
                height: `${(z.rect.y2 - z.rect.y1) * 100}%`,
                border: zone === z.id ? `2px solid ${z.accent}` : "2px solid transparent",
                borderRadius: 12,
                transition: "border-color 200ms",
              }}
            />
          ))}

          {/* Avatars */}
          {onlineList.map(({ pos: p, profile }) => {
            const isMe = me?.id === profile.id;
            const display = isMe ? pos : { x: p.x, y: p.y };
            return (
              <div
                key={profile.id}
                className="absolute"
                style={{
                  left: `${display.x * 100}%`,
                  top: `${display.y * 100}%`,
                  transform: "translate(-50%, -100%)",
                  transition: isMe ? "none" : "left 120ms linear, top 120ms linear",
                  zIndex: Math.round(display.y * 1000),
                }}
              >
                <div className="flex flex-col items-center gap-1">
                  <div
                    className={`px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap ${
                      isMe ? "bg-primary text-primary-foreground" : "bg-card/90 text-foreground"
                    } shadow-soft backdrop-blur-sm`}
                  >
                    {profile.display_name}
                  </div>
                  <div
                    className="w-7 h-7 rounded-full border-2 border-white shadow-soft flex items-center justify-center text-white text-xs font-bold"
                    style={{
                      background: profile.avatar_color,
                      boxShadow: isMe
                        ? `0 0 0 3px color-mix(in oklab, ${profile.avatar_color} 40%, transparent), 0 4px 12px rgba(0,0,0,0.2)`
                        : "0 4px 12px rgba(0,0,0,0.2)",
                    }}
                  >
                    {profile.display_name.charAt(0).toUpperCase()}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

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

      {/* Team panel */}
      {showTeam && (
        <div className="absolute right-4 top-24 bottom-24 w-72 pointer-events-auto">
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
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-none">
        <div className="glass-panel rounded-full px-4 py-2 shadow-soft text-xs text-muted-foreground">
          Use <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">WASD</kbd> ou{" "}
          <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">setas</kbd> para caminhar
        </div>
      </div>
    </div>
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
