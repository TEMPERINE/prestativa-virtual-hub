import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
import { zoneRectFromOverrides, getZoneKind, customZonesFromOverrides, pullOverridesFromCloud, subscribeOverridesFromCloud, spawnPointForZone } from "@/lib/map-overrides";
import officeMap from "@/assets/office-map.jpg";
import parkLeft from "@/assets/scene-park-left.jpg";
import roadRight from "@/assets/scene-road-right.jpg";
import { SPRITES, getSprite, SPRITE_FRAMES as FRAMES, type Facing } from "@/lib/sprite-catalog";
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
import { LogOut, Mic, MicOff, Video, VideoOff, MonitorUp, Users, Pencil, User as UserIcon, Hand, MessageCircle, StickyNote, X as XIcon, Plus, Minus, Locate, ChevronLeft, ChevronRight } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useRtcMesh } from "@/lib/rtc/useRtcMesh";
import { RemoteVideoTiles } from "./RemoteVideoTiles";
import { CamPreviewAndPicker } from "./CamPreviewAndPicker";
import { ScreenShareViewer } from "./ScreenShareViewer";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ProfileMenu } from "@/components/profile/ProfileMenu";
import { EditCharacterModal } from "@/components/profile/EditCharacterModal";
import { EditProfileModal } from "@/components/profile/EditProfileModal";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";

type Profile = {
  id: string;
  display_name: string;
  avatar_color: string;
  sprite_id?: string | null;
  tagline?: string | null;
  status?: "available" | "busy" | "away" | null;
  onboarded_at?: string | null;
};
type RemotePos = { user_id: string; x: number; y: number; zone: string; is_online: boolean; facing?: Facing };
type DeskNote = {
  id: string;
  zone_id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  x: number;
  y: number;
  created_at: string;
  read_at: string | null;
};

const SPEED = 0.0042;
const SEND_INTERVAL_MS = 120;

// "Seat" point of a zone rect — bottom-center, in front of the desk.
// If that point collides with furniture, walk it upward until it's walkable.
function seatPointForRect(rect: { x1: number; y1: number; x2: number; y2: number }): Point {
  const x = (rect.x1 + rect.x2) / 2;
  const bottomMargin = 0.012;
  let y = rect.y2 - bottomMargin;
  for (let i = 0; i < 20; i++) {
    if (!collides({ x, y })) return { x, y };
    y -= 0.012;
    if (y <= rect.y1) break;
  }
  // Fallback: rect center.
  return { x, y: (rect.y1 + rect.y2) / 2 };
}

// Pick a random walkable spot in the corridor/lobby (no claimed zone).
// Used when the user has no workstation assigned so they don't all stack on SPAWN.
function randomCorridorPoint(): Point {
  for (let i = 0; i < 80; i++) {
    const x = 0.18 + Math.random() * 0.72;
    const y = 0.18 + Math.random() * 0.72;
    const p = { x, y };
    if (collides(p)) continue;
    // Must be in the lobby (corridor) — not inside any built-in zone rect.
    const z = zoneAt(p);
    if (z.id !== "lobby") continue;
    return p;
  }
  return SPAWN;
}

export function OfficeScene() {
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [me, setMe] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [positions, setPositions] = useState<Record<string, RemotePos>>({});
  const [pos, setPos] = useState<Point>(SPAWN);
  const [zone, setZone] = useState<ZoneId>("lobby");
  const [showTeam, setShowTeam] = useState(false);
  const [showHint, setShowHint] = useState(true);
  const [facing, setFacing] = useState<Facing>("down");
  const facingRef = useRef<Facing>("down");
  const [reactions, setReactions] = useState<Record<string, { emoji: string; ts: number }>>({});
  // zone_id -> user_id (claims)
  const [claims, setClaims] = useState<Record<string, string>>({});
  const [hoveredZone, setHoveredZone] = useState<string | null>(null);
  const [notes, setNotes] = useState<DeskNote[]>([]);
  const [composeFor, setComposeFor] = useState<{ zoneId: string; recipientId: string; recipientName: string } | null>(null);
  const [composeText, setComposeText] = useState("");
  const [placing, setPlacing] = useState<{ zoneId: string; recipientId: string; body: string } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [openingNote, setOpeningNote] = useState<DeskNote | null>(null);
  const reactionChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const meIdRef = useRef<string | null>(null);
  const [myEmail, setMyEmail] = useState<string>("");
  const [editCharOpen, setEditCharOpen] = useState(false);
  const [editProfOpen, setEditProfOpen] = useState(false);
  const [forceOnboarding, setForceOnboarding] = useState(false);

  const refreshMe = useCallback(async () => {
    const uid = meIdRef.current;
    if (!uid) return;
    const { data } = await supabase.from("profiles").select("id, display_name, avatar_color, sprite_id, tagline, status, onboarded_at").eq("id", uid).maybeSingle();
    if (data) {
      setMe(data as Profile);
      setProfiles((prev) => ({ ...prev, [uid]: data as Profile }));
    }
  }, []);

  // ===== Camera (zoom + pan + follow) =====
  const MIN_ZOOM = 1;
  const MAX_ZOOM = 4; // ~roughly one workspace fills the screen
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 }); // pixel offset of scaled content in stage
  const [followMe, setFollowMe] = useState(true);

  // Auto-hide the welcome hint after 5s.
  useEffect(() => {
    const t = window.setTimeout(() => setShowHint(false), 5000);
    return () => window.clearTimeout(t);
  }, []);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const followRef = useRef(true);
  zoomRef.current = zoom;
  panRef.current = pan;
  followRef.current = followMe;
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number; moved: boolean } | null>(null);
  const wasDragRef = useRef(false);

  const clampPan = useCallback((s: number, p: { x: number; y: number }) => {
    const stage = stageRef.current;
    if (!stage) return p;
    const W = stage.clientWidth, H = stage.clientHeight;
    const minX = W - W * s, minY = H - H * s;
    return {
      x: Math.min(0, Math.max(minX, p.x)),
      y: Math.min(0, Math.max(minY, p.y)),
    };
  }, []);

  const centerOn = useCallback((nx: number, ny: number, s = zoomRef.current) => {
    const stage = stageRef.current;
    if (!stage) return;
    const W = stage.clientWidth, H = stage.clientHeight;
    const tx = W / 2 - nx * W * s;
    const ty = H / 2 - ny * H * s;
    setPan(clampPan(s, { x: tx, y: ty }));
  }, [clampPan]);

  // Smoothly tween zoom + pan to center on a normalized point.
  const tweenRafRef = useRef<number | null>(null);
  const tweenCenterOn = useCallback((nx: number, ny: number, targetZoom: number, duration = 650, onDone?: () => void) => {
    const stage = stageRef.current;
    if (!stage) return;
    if (tweenRafRef.current != null) cancelAnimationFrame(tweenRafRef.current);
    const W = stage.clientWidth, H = stage.clientHeight;
    const startZoom = zoomRef.current;
    const startPan = { ...panRef.current };
    const endZoom = targetZoom;
    const endPan = clampPan(endZoom, {
      x: W / 2 - nx * W * endZoom,
      y: H / 2 - ny * H * endZoom,
    });
    const t0 = performance.now();
    const ease = (t: number) => 1 - Math.pow(1 - t, 3); // easeOutCubic
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      const k = ease(t);
      const z = startZoom + (endZoom - startZoom) * k;
      const px = startPan.x + (endPan.x - startPan.x) * k;
      const py = startPan.y + (endPan.y - startPan.y) * k;
      setZoom(z);
      setPan({ x: px, y: py });
      if (t < 1) {
        tweenRafRef.current = requestAnimationFrame(step);
      } else {
        tweenRafRef.current = null;
        onDone?.();
      }
    };
    tweenRafRef.current = requestAnimationFrame(step);
  }, [clampPan]);

  // Follow avatar smoothly when enabled
  useEffect(() => {
    if (!followMe) return;
    centerOn(pos.x, pos.y, zoom);
  }, [pos.x, pos.y, zoom, followMe, centerOn]);

  // Re-clamp pan on window resize
  useEffect(() => {
    const onResize = () => setPan((p) => clampPan(zoomRef.current, p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampPan]);


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

  // ---- WebRTC mesh: voice/video by proximity or same claimed zone ----
  const PROXIMITY_CONNECT = 0.08;
  const PROXIMITY_DISCONNECT = 0.12;
  const connectedPeersRef = useRef<Set<string>>(new Set());
  const desiredPeers = useMemo(() => {
    const meId = me?.id;
    if (!meId) return [] as string[];
    const myClaimZone = Object.entries(claims).find(([, uid]) => uid === meId)?.[0];
    const result: string[] = [];
    for (const [uid, p] of Object.entries(positions)) {
      if (uid === meId) continue;
      if (!p.is_online) continue;
      // Same claimed zone → always connect
      const peerClaim = Object.entries(claims).find(([, u]) => u === uid)?.[0];
      const sameZone = myClaimZone && peerClaim && peerClaim === myClaimZone;
      // Proximity with hysteresis
      const dx = p.x - pos.x;
      const dy = p.y - pos.y;
      const dist = Math.hypot(dx, dy);
      const already = connectedPeersRef.current.has(uid);
      const closeEnough = already ? dist <= PROXIMITY_DISCONNECT : dist <= PROXIMITY_CONNECT;
      if (sameZone || closeEnough) result.push(uid);
    }
    // cap to 6 peers
    return result.slice(0, 6);
  }, [me?.id, positions, claims, pos.x, pos.y]);

  const rtc = useRtcMesh(me?.id ?? null, desiredPeers);
  useEffect(() => {
    connectedPeersRef.current = new Set(desiredPeers);
  }, [desiredPeers]);

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
    SPRITES.forEach((sp) =>
      Object.values(sp.sheets).forEach((src) => {
        const img = new Image();
        img.src = src;
      }),
    );
  }, []);

  // Hydrate the office map from Lovable Cloud on mount so the layout drawn
  // in the editor (and saved to the `map_overrides` table) is visible to
  // every user on every device. Subscribe to realtime updates and force a
  // re-render when overrides change.
  const [, setMapVersion] = useState(0);
  useEffect(() => {
    const bump = () => setMapVersion((v) => v + 1);
    void pullOverridesFromCloud().then(bump);
    const off = subscribeOverridesFromCloud(() => bump());
    window.addEventListener("map-overrides-changed", bump);
    return () => {
      off();
      window.removeEventListener("map-overrides-changed", bump);
    };
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
      setMyEmail(userData.user.email ?? "");
      const { data: profs } = await supabase.from("profiles").select("id, display_name, avatar_color, sprite_id, tagline, status, onboarded_at");
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

      // If I have a claim, always spawn at that workstation's "seat" point
      // (bottom-center of the zone — in front of the desk).
      const myClaimZone = Object.entries(cmap).find(([, uid]) => uid === userData.user!.id)?.[0];
      let startPoint: Point;
      if (myClaimZone) {
        const z = findZoneById(myClaimZone);
        const sp = spawnPointForZone(myClaimZone);
        const rect = zoneRectFromOverrides(myClaimZone as ZoneId) ?? z?.rect ?? null;
        startPoint = sp ?? (rect ? seatPointForRect(rect) : SPAWN);
      } else {
        const existing = pmap[userData.user.id];
        if (existing && typeof existing.x === "number" && typeof existing.y === "number") {
          const savedStart = { x: existing.x, y: existing.y };
          startPoint = collides(savedStart) ? randomCorridorPoint() : savedStart;
        } else {
          // First time in: drop somewhere random in the corridors so people
          // don't all pile on top of each other at the default spawn.
          startPoint = randomCorridorPoint();
        }
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

    // Load + subscribe to desk notes (post-it gifts left on workstations)
    void (async () => {
      const { data } = await supabase
        .from("desk_notes")
        .select("id, zone_id, sender_id, recipient_id, body, x, y, created_at, read_at")
        .is("read_at", null);
      if (data) setNotes(data as DeskNote[]);
    })();
    const notesCh = supabase
      .channel("desk-notes-room")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "desk_notes" },
        (payload) => {
          setNotes((prev) => {
            if (payload.eventType === "DELETE") {
              const old = payload.old as { id: string };
              return prev.filter((n) => n.id !== old.id);
            }
            const row = payload.new as DeskNote;
            if (row.read_at) return prev.filter((n) => n.id !== row.id);
            const without = prev.filter((n) => n.id !== row.id);
            return [...without, row];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
      supabase.removeChannel(reactionCh);
      supabase.removeChannel(claimsCh);
      supabase.removeChannel(notesCh);
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

  const releaseClaim = useCallback(async () => {
    const uid = meIdRef.current;
    if (!uid) return;
    const { error } = await supabase.from("workspace_claims").delete().eq("user_id", uid);
    if (error) {
      toast.error("Não foi possível deixar a mesa.");
      return;
    }
    toast.success("Você deixou sua mesa. Escolha um novo espaço quando quiser.");
    setClaims((prev) => {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(prev)) if (v !== uid) next[k] = v;
      return next;
    });
  }, []);

  // Live ref to claims so the keyboard handler can read latest values.
  const claimsRef = useRef<Record<string, string>>({});
  useEffect(() => { claimsRef.current = claims; }, [claims]);

  // Auto-walk target: when set, the avatar walks toward this point each tick.
  const autoWalkRef = useRef<{ x: number; y: number } | null>(null);

  // Magic teleport effect: avatar fades out at current spot, then fades in at seat.
  const [teleport, setTeleport] = useState<
    | { from: Point; to: Point; phase: "out" | "in"; id: number }
    | null
  >(null);
  const teleportTimers = useRef<number[]>([]);

  const teleportToZone = useCallback((zoneId: ZoneId, label?: string) => {
    const z = findZoneById(zoneId);
    if (!z) return;
    // If already inside the target zone, do nothing.
    const currentZone = zoneAt(posRef.current);
    if (currentZone.id === zoneId) {
      toast.info(`Você já está em ${label ?? z.label}.`);
      return;
    }
    const sp = spawnPointForZone(zoneId);
    const rect = zoneRectFromOverrides(zoneId) ?? z.rect;
    const target = sp ?? seatPointForRect(rect);
    const from = { ...posRef.current };


    // Cancel any pending auto-walk and clear stale timers
    autoWalkRef.current = null;
    teleportTimers.current.forEach((t) => window.clearTimeout(t));
    teleportTimers.current = [];

    const id = Date.now();
    setTeleport({ from, to: target, phase: "out", id });

    // Phase 1: fade out + sparkle at origin
    teleportTimers.current.push(
      window.setTimeout(() => {
        // Snap to destination
        posRef.current = target;
        setPos(target);
        const z2 = zoneAt(target);
        setZone(z2.id);
        sendPos(target.x, target.y, z2.id, facingRef.current);
        setTeleport({ from, to: target, phase: "in", id });
      }, 450)
    );
    // Phase 2: clear effect
    teleportTimers.current.push(
      window.setTimeout(() => {
        setTeleport((cur) => (cur && cur.id === id ? null : cur));
      }, 1100)
    );

    toast.success(`✨ Teleportando para ${label ?? z.label}...`);
  }, [sendPos]);

  const teleportToMyClaim = useCallback(() => {
    const uid = meIdRef.current;
    if (!uid) return;
    const myZone = Object.entries(claimsRef.current).find(([, u]) => u === uid)?.[0];
    if (!myZone) {
      toast.info("Você ainda não reivindicou nenhum espaço.");
      return;
    }
    teleportToZone(myZone as ZoneId);
  }, [teleportToZone]);

  useEffect(() => {
    return () => {
      teleportTimers.current.forEach((t) => window.clearTimeout(t));
    };
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
      // Ctrl/Cmd + D — teleport to claimed workspace
      if (key === "d" && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        teleportToMyClaim();
        return;
      }
      // Ctrl + R — teleport to meeting room
      if (key === "r" && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        teleportToZone("reuniao", "Sala de Reunião");
        return;
      }
      // Ctrl + F — teleport to feedback room
      if (key === "f" && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        teleportToZone("feedback", "Sala de Feedback");
        return;
      }
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
      // Manual movement cancels auto-walk
      autoWalkRef.current = null;
      keysDown.current.add(dir);
      lastDir.current = dir;
      setLocalFacing(dir);
      // Re-enable camera follow as soon as the user starts moving
      if (!followRef.current) setFollowMe(true);
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
  }, [setLocalFacing, sendReaction, teleportToMyClaim]);

  // movement + animation loop
  useEffect(() => {
    let raf = 0;
    const tick = (t: number) => {
      let dir = lastDir.current;

      // Auto-walk: if no manual key, compute a direction toward the target.
      if (!dir && autoWalkRef.current) {
        const cur = posRef.current;
        const tgt = autoWalkRef.current;
        const dx = tgt.x - cur.x;
        const dy = tgt.y - cur.y;
        const adx = Math.abs(dx);
        const ady = Math.abs(dy);
        if (adx < SPEED && ady < SPEED) {
          // Arrived
          autoWalkRef.current = null;
          const z = zoneAt(cur);
          sendPos(cur.x, cur.y, z.id, facingRef.current);
        } else {
          // Prefer the larger axis; if blocked, fall back to the other.
          const primary: Facing = adx >= ady
            ? (dx > 0 ? "right" : "left")
            : (dy > 0 ? "down" : "up");
          const secondary: Facing = adx >= ady
            ? (dy > 0 ? "down" : "up")
            : (dx > 0 ? "right" : "left");
          setLocalFacing(primary);
          if (tryMove(primary)) {
            dir = primary;
          } else {
            setLocalFacing(secondary);
            if (tryMove(secondary)) {
              dir = secondary;
            } else {
              // Stuck — abort auto-walk
              autoWalkRef.current = null;
            }
          }
        }
      }

      if (dir) {
        // For manual movement, tryMove was already called via keydown path below;
        // when manual key is held we still need to advance position each frame.
        const isManual = lastDir.current === dir;
        const moved = isManual ? tryMove(dir) : true;
        if (moved) {
          if (t - lastFrameTick.current > WALK_FRAME_MS) {
            lastFrameTick.current = t;
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
        const cur = posRef.current;
        const z = zoneAt(cur);
        sendPos(cur.x, cur.y, z.id, facingRef.current);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [tryMove, sendPos, setLocalFacing]);



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
    // Custom zones from the editor — only include those marked as workspace and with painted tiles.
    for (const c of customZonesFromOverrides()) {
      if (getZoneKind(c.id) !== "workspace") continue;
      const rect = zoneRectFromOverrides(c.id as ZoneId);
      if (!rect) continue;
      out.push({ id: c.id, label: c.label, rect });
    }
    return out;
  }, [claims]);




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
        className="relative h-full shrink-0 overflow-hidden select-none"
        style={{ aspectRatio: "1536 / 1024" }}



        onWheel={(e) => {
          e.preventDefault();
          const stage = stageRef.current;
          if (!stage) return;
          const rect = stage.getBoundingClientRect();
          const cx = e.clientX - rect.left;
          const cy = e.clientY - rect.top;
          const s = zoomRef.current;
          const factor = e.deltaY < 0 ? 1.10 : 1 / 1.10;
          const ns = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, s * factor));
          if (ns === s) return;
          const p = panRef.current;
          const np = { x: cx - (cx - p.x) * (ns / s), y: cy - (cy - p.y) * (ns / s) };
          setZoom(ns);
          setPan(clampPan(ns, np));
          setFollowMe(false);
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          // Don't start a drag on interactive children (buttons, etc.)
          const tgt = e.target as HTMLElement;
          if (tgt.closest("button, a, input, textarea, [role='button']")) return;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          dragRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            panX: panRef.current.x,
            panY: panRef.current.y,
            moved: false,
          };
        }}
        onPointerMove={(e) => {
          const d = dragRef.current;
          if (!d) return;
          const dx = e.clientX - d.startX;
          const dy = e.clientY - d.startY;
          if (!d.moved && Math.hypot(dx, dy) < 4) return;
          d.moved = true;
          setFollowMe(false);
          setPan(clampPan(zoomRef.current, { x: d.panX + dx, y: d.panY + dy }));
        }}
        onPointerUp={(e) => {
          const d = dragRef.current;
          dragRef.current = null;
          wasDragRef.current = !!d?.moved;
          try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
        }}
        onClickCapture={(e) => {
          if (wasDragRef.current) {
            e.stopPropagation();
            e.preventDefault();
            wasDragRef.current = false;
          }
        }}
      >
        {/* Camera pan layer */}
        <div
          className="absolute inset-0"
          style={{
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0)`,
            willChange: "transform",
            cursor: dragRef.current?.moved ? "grabbing" : "grab",
          }}
        >
          {/* Camera zoom layer */}
          <div
            className="absolute inset-0"
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: "0 0",
              willChange: "transform",
            }}
          >

        <img
          src={officeMap}
          alt="Escritório Prestativa Virtual"
          className="absolute inset-0 w-full h-full object-cover select-none pointer-events-none"
          draggable={false}
          style={{ imageRendering: "pixelated" }}
        />




        {/* Private-area overlay (Gather-style): darken everything outside the active zone */}
        {focusedZone && (
          <ZoneSpotlight rect={focusedZone.rect} />
        )}

        {/* Workspace-zone hover overlays (claim button / owner tooltip) */}
        {workspaceZones.map((wz) => {
          const ownerId = claims[wz.id];
          const owner = ownerId ? profiles[ownerId] : null;
          const ownerOnline = ownerId ? positions[ownerId]?.is_online ?? false : false;
          const isMyClaim = !!(ownerId && me && ownerId === me.id);
          const iHaveAClaim = !!(me && Object.values(claims).includes(me.id));
          const isHovered = hoveredZone === wz.id;
          // Skip entirely when there's no function available here:
          // - empty zone but I already have a claim → can't claim, nothing to do
          if (!ownerId && iHaveAClaim) return null;
          const showCompose = !!ownerId && !isMyClaim;
          return (
            <WorkspaceZoneHover
              key={`ws-${wz.id}`}
              rect={wz.rect}
              isHovered={isHovered}
              onEnter={() => setHoveredZone(wz.id)}
              onLeave={() => setHoveredZone((cur) => (cur === wz.id ? null : cur))}
            >
              {ownerId ? (
                <OccupantCard
                  profile={owner}
                  online={ownerOnline}
                  isMe={isMyClaim}
                  onLeaveNote={
                    showCompose
                      ? () => {
                          setComposeFor({
                            zoneId: wz.id,
                            recipientId: ownerId,
                            recipientName: owner?.display_name ?? "colega",
                          });
                          setComposeText("");
                          setHoveredZone(null);
                        }
                      : undefined
                  }
                  onLeaveDesk={
                    isMyClaim
                      ? () => {
                          releaseClaim();
                          setHoveredZone(null);
                        }
                      : undefined
                  }
                />
              ) : (
                <button
                  onClick={() => claimZone(wz.id)}
                  className="rounded-full px-3 py-1.5 text-xs font-semibold bg-primary text-primary-foreground shadow-soft hover:opacity-90 whitespace-nowrap"
                >
                  Reivindicar espaço
                </button>
              )}
            </WorkspaceZoneHover>
          );

        })}

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
          const myTeleporting = isMe && teleport;
          const meOpacity = myTeleporting
            ? teleport!.phase === "out" ? 0 : 1
            : 1;
          return (
            <div
              key={profile.id}
              className="absolute pointer-events-none"
              style={{
                left: `${display.x * 100}%`,
                top: `${display.y * 100}%`,
                transform: "translate(-50%, -90%)",
                transition: isMe
                  ? (myTeleporting ? "opacity 420ms ease-in-out, filter 420ms ease-in-out" : "none")
                  : "left 120ms linear, top 120ms linear",
                zIndex: focusedZone ? (inFocus ? 60 : 20) : Math.round(display.y * 1000),
                opacity: isMe ? meOpacity : 1,
                filter: myTeleporting
                  ? `drop-shadow(0 0 18px var(--primary)) drop-shadow(0 0 36px var(--primary-glow)) brightness(${teleport!.phase === "out" ? 1.8 : 1.4})`
                  : "none",
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
                    spriteId={profile.sprite_id}
                  />
                </div>
              </div>
            </div>
          );
        })}

        {/* Magic teleport particles */}
        {teleport && (
          <TeleportFx
            point={teleport.phase === "out" ? teleport.from : teleport.to}
            phase={teleport.phase}
            key={`${teleport.id}-${teleport.phase}`}
          />
        )}

        {/* Desk notes (post-it gifts) sitting on workstations */}
        {notes.map((n) => {
          const isForMe = me?.id === n.recipient_id;
          const sender = profiles[n.sender_id];
          return (
            <button
              key={n.id}
              type="button"
              onClick={() => isForMe && setOpeningNote(n)}
              className="absolute"
              style={{
                left: `${n.x * 100}%`,
                top: `${n.y * 100}%`,
                transform: "translate(-50%, -85%)",
                zIndex: Math.round(n.y * 1000) + 5,
                cursor: isForMe ? "pointer" : "default",
                pointerEvents: isForMe ? "auto" : "none",
              }}
              title={
                isForMe
                  ? `Recadinho de ${sender?.display_name ?? "alguém"} — clique para abrir`
                  : `Recadinho para ${profiles[n.recipient_id]?.display_name ?? ""}`
              }
            >
              <GiftSprite color={sender?.avatar_color} bounce={isForMe} />
            </button>
          );
        })}

        {/* Placement layer — appears after composing a note */}
        {placing && (
          <PlacementLayer
            placing={placing}
            workspaceZones={workspaceZones}
            onMove={(p) => setCursor(p)}
            onCancel={() => {
              setPlacing(null);
              setCursor(null);
            }}
            onConfirm={async (p) => {
              const uid = meIdRef.current;
              if (!uid) return;
              const { error } = await supabase.from("desk_notes").insert({
                zone_id: placing.zoneId,
                sender_id: uid,
                recipient_id: placing.recipientId,
                body: placing.body,
                x: p.x,
                y: p.y,
              });
              if (error) {
                toast.error("Não foi possível deixar o recadinho.");
                return;
              }
              toast.success("✨ Recadinho deixado na mesa!");
              setPlacing(null);
              setCursor(null);
            }}
          />
        )}
        {placing && cursor && (
          <div
            className="absolute pointer-events-none"
            style={{
              left: `${cursor.x * 100}%`,
              top: `${cursor.y * 100}%`,
              transform: "translate(-50%, -85%)",
              zIndex: 95,
              opacity: 0.95,
              filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.35))",
            }}
          >
            <GiftSprite color={me?.avatar_color} bounce />
          </div>
        )}

        <ScreenShareViewer
          localStream={rtc.localScreenStream}
          remoteStreams={rtc.remoteScreenStreams}
          profiles={profiles}
          onStopLocal={() => { rtc.toggleScreen().catch(() => {}); }}
          anchorRect={focusedZone?.rect ?? null}
        />
        </div>
        </div>
        {/* /Camera transform layer */}

        {/* Map navigation controls (bottom-right corner) */}
        <div className="absolute right-3 bottom-3 flex flex-col gap-2 z-[90] pointer-events-auto">
          <button
            type="button"
            title="Aproximar"
            onClick={() => {
              const s = zoomRef.current;
              const ns = Math.min(MAX_ZOOM, s * 1.15);
              const stage = stageRef.current;
              if (!stage || ns === s) return;
              const W = stage.clientWidth, H = stage.clientHeight;
              const cx = W / 2, cy = H / 2;
              const p = panRef.current;
              setZoom(ns);
              setPan(clampPan(ns, { x: cx - (cx - p.x) * (ns / s), y: cy - (cy - p.y) * (ns / s) }));
            }}
            className="w-9 h-9 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center shadow-soft backdrop-blur-sm"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            type="button"
            title="Afastar"
            onClick={() => {
              const s = zoomRef.current;
              const ns = Math.max(MIN_ZOOM, s / 1.15);
              const stage = stageRef.current;
              if (!stage || ns === s) return;
              const W = stage.clientWidth, H = stage.clientHeight;
              const cx = W / 2, cy = H / 2;
              const p = panRef.current;
              setZoom(ns);
              setPan(clampPan(ns, { x: cx - (cx - p.x) * (ns / s), y: cy - (cy - p.y) * (ns / s) }));
            }}
            className="w-9 h-9 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center shadow-soft backdrop-blur-sm"
          >
            <Minus className="w-4 h-4" />
          </button>
          <button
            type="button"
            title={followMe ? "Câmera seguindo você" : "Centralizar em mim"}
            onClick={() => {
              setFollowMe(false);
              const targetZoom = Math.max(zoomRef.current, 2.0);
              tweenCenterOn(posRef.current.x, posRef.current.y, targetZoom, 700, () => {
                setFollowMe(true);
              });
            }}
            className={`w-9 h-9 rounded-full flex items-center justify-center shadow-soft backdrop-blur-sm ${
              followMe ? "bg-primary text-primary-foreground" : "bg-black/60 hover:bg-black/80 text-white"
            }`}
          >
            <Locate className="w-4 h-4" />
          </button>
        </div>
      </div>
      



      {/* Compose note dialog */}
      <Dialog
        open={!!composeFor}
        onOpenChange={(o) => {
          if (!o) setComposeFor(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-center">Deixar um recado</DialogTitle>
          </DialogHeader>
          <div className="relative">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-3xl">🎁</div>
            <div
              className="rounded-lg p-4 shadow-soft"
              style={{
                background: "linear-gradient(180deg, #FFE680 0%, #FFD84D 100%)",
                color: "#3a2e00",
                minHeight: 180,
              }}
            >
              <Textarea
                value={composeText}
                onChange={(e) => setComposeText(e.target.value.slice(0, 280))}
                placeholder="Escreva uma mensagem!"
                className="bg-transparent border-0 focus-visible:ring-0 resize-none text-sm placeholder:text-amber-900/50 min-h-[150px]"
                autoFocus
              />
            </div>
            <div className="text-[10px] text-muted-foreground text-right mt-1">
              {composeText.length}/280
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => setComposeFor(null)}>
              Cancelar
            </Button>
            <Button
              disabled={!composeText.trim()}
              onClick={() => {
                if (!composeFor) return;
                setPlacing({
                  zoneId: composeFor.zoneId,
                  recipientId: composeFor.recipientId,
                  body: composeText.trim(),
                });
                setCursor(null);
                setComposeFor(null);
                toast.info(`Clique na mesa de ${composeFor.recipientName} para deixar o presentinho 🎁`);
              }}
              className="bg-emerald-500 hover:bg-emerald-600 text-white"
            >
              Colocar na mesa dele(a)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Read note dialog */}
      <Dialog
        open={!!openingNote}
        onOpenChange={(o) => {
          if (!o && openingNote) {
            const id = openingNote.id;
            // Mark as read (which removes it for everyone via realtime + filter)
            void supabase.from("desk_notes").update({ read_at: new Date().toISOString() }).eq("id", id);
            setNotes((prev) => prev.filter((n) => n.id !== id));
            setOpeningNote(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-center">
              Recadinho de {openingNote ? profiles[openingNote.sender_id]?.display_name ?? "alguém" : ""}
            </DialogTitle>
          </DialogHeader>
          <div
            className="rounded-lg p-4 shadow-soft whitespace-pre-wrap text-sm"
            style={{
              background: "linear-gradient(180deg, #FFE680 0%, #FFD84D 100%)",
              color: "#3a2e00",
              minHeight: 140,
            }}
          >
            {openingNote?.body}
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                if (!openingNote) return;
                const id = openingNote.id;
                void supabase.from("desk_notes").update({ read_at: new Date().toISOString() }).eq("id", id);
                setNotes((prev) => prev.filter((n) => n.id !== id));
                setOpeningNote(null);
              }}
            >
              Lido (some o recadinho)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


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

      {/* Remote video/audio tiles */}
      <RemoteVideoTiles
        streams={rtc.remoteStreams}
        profiles={profiles}
        speakingPeers={rtc.speakingPeers}
      />


      {/* Topbar */}
      <div className="absolute top-0 left-0 right-0 p-4 pointer-events-none z-[100]">
        <div className="glass-panel rounded-2xl shadow-soft px-4 py-2.5 flex items-center justify-between pointer-events-auto">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl gradient-primary flex items-center justify-center shadow-glow">
              <span className="text-sm font-bold text-primary-foreground">P</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {rtc.connectedPeers.length > 0 && (
              <div className="text-xs text-muted-foreground px-2 hidden sm:block">
                Em chamada com {rtc.connectedPeers.length}
              </div>
            )}
            <IconButton
              active={rtc.micOn}
              onClick={() => {
                rtc.toggleMic().catch(() => toast.error("Não foi possível acessar o microfone"));
              }}
              title="Microfone"
            >
              {rtc.micOn ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
            </IconButton>
            <IconButton
              active={rtc.camOn}
              onClick={() => {
                rtc.toggleCam().catch(() => toast.error("Não foi possível acessar a câmera"));
              }}
              title="Câmera"
            >
              {rtc.camOn ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
            </IconButton>
            <CamPreviewAndPicker
              stream={rtc.localVideoStream}
              devices={rtc.videoDevices}
              selectedId={rtc.selectedVideoDeviceId}
              onSelect={(id) => rtc.setVideoDevice(id).catch(() => toast.error("Falha ao trocar câmera"))}
              visible={rtc.camOn}
            />
            {currentZone.id !== "lobby" && (
              <IconButton
                active={rtc.screenOn}
                onClick={() => {
                  rtc.toggleScreen().catch(() => toast.error("Não foi possível compartilhar a tela"));
                }}
                title={rtc.screenOn ? "Parar compartilhamento" : "Compartilhar tela (janela, aba ou tela inteira)"}
              >
                <MonitorUp className="w-4 h-4" />
              </IconButton>
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
            {me && (
              <ProfileMenu
                me={me}
                email={myEmail}
                hasClaim={Object.values(claims).includes(me.id)}
                onEditCharacter={() => setEditCharOpen(true)}
                onEditProfile={() => setEditProfOpen(true)}
                onGoToMyDesk={teleportToMyClaim}
                onGoToLobby={() => {
                  if (zoneAt(posRef.current).id === "lobby") { toast.info("Você já está no saguão."); return; }
                  const target = randomCorridorPoint();
                  posRef.current = target;
                  setPos(target);
                  setZone("lobby");
                  sendPos(target.x, target.y, "lobby", facingRef.current);
                  toast.success("✨ Te levei ao saguão.");
                }}
                onRestartOnboarding={() => setForceOnboarding(true)}
                onSignOut={signOut}
                onStatusChanged={refreshMe}
              />
            )}
          </div>
        </div>
      </div>


      {/* Zone enter-toast (Gather style) */}
      {focusedZone && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 pointer-events-none z-[100]">
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

      {/* Team panel side toggle — always visible on right edge */}
      <button
        type="button"
        onClick={() => setShowTeam((v) => !v)}
        title={showTeam ? "Ocultar equipe" : "Mostrar equipe"}
        className="absolute top-1/2 -translate-y-1/2 z-[85] w-7 h-14 rounded-l-lg bg-rose-500/90 hover:bg-rose-600 text-white flex items-center justify-center shadow-soft backdrop-blur-sm transition-all"
        style={{ right: showTeam ? "18rem" : "0" }}
      >
        {showTeam ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
      </button>

      {/* Team panel */}
      {showTeam && (
        <div className="absolute right-4 top-24 bottom-4 w-72 pointer-events-auto z-[80]">
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

      {/* Welcome hint — auto-hides after 5s */}
      {showHint && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-none z-[100] animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="glass-panel rounded-full px-4 py-2 shadow-soft text-xs text-muted-foreground">
            Use <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">WASD</kbd> ou{" "}
            <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">setas</kbd> para se mover ·{" "}
            <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">Ctrl+D</kbd> teleporta para seu espaço ✨
          </div>
        </div>
      )}

      {me && (
        <>
          <EditCharacterModal
            open={editCharOpen}
            onOpenChange={setEditCharOpen}
            userId={me.id}
            currentSpriteId={me.sprite_id ?? "marcio"}
            avatarColor={me.avatar_color}
            onSaved={refreshMe}
          />
          <EditProfileModal
            open={editProfOpen}
            onOpenChange={setEditProfOpen}
            userId={me.id}
            initial={{ display_name: me.display_name, avatar_color: me.avatar_color, tagline: me.tagline ?? null }}
            onSaved={refreshMe}
          />
        </>
      )}

      {me && (forceOnboarding || !me.onboarded_at) && (
        <OnboardingWizard
          userId={me.id}
          initialName={me.display_name || (myEmail.split("@")[0] ?? "")}
          onDone={() => { setForceOnboarding(false); refreshMe(); }}
        />
      )}
    </div>
  );
}

/** Magic teleport effect — pink sparkles + halo at the given normalized point. */
/**
 * Hover wrapper for a workspace zone. The zone outline stays inside the
 * scaled stage, but the popup card is rendered via portal at fixed
 * screen coordinates so it escapes the stage's overflow/stacking context.
 */
function WorkspaceZoneHover({
  rect,
  isHovered,
  onEnter,
  onLeave,
  children,
}: {
  rect: { x1: number; y1: number; x2: number; y2: number };
  isHovered: boolean;
  onEnter: () => void;
  onLeave: () => void;
  children: React.ReactNode;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!isHovered) {
      setPos(null);
      return;
    }
    let raf = 0;
    const tick = () => {
      const el = anchorRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        setPos({ left: r.left + r.width / 2, top: r.top + r.height / 2 });
      }
      raf = window.requestAnimationFrame(tick);
    };
    tick();
    return () => window.cancelAnimationFrame(raf);
  }, [isHovered]);

  return (
    <div
      ref={anchorRef}
      className="absolute"
      style={{
        left: `${rect.x1 * 100}%`,
        top: `${rect.y1 * 100}%`,
        width: `${(rect.x2 - rect.x1) * 100}%`,
        height: `${(rect.y2 - rect.y1) * 100}%`,
        zIndex: isHovered ? 55 : 15,
      }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div
        className="absolute inset-0 rounded-md transition-all duration-150 pointer-events-none"
        style={{
          outline: isHovered
            ? `1.5px dashed color-mix(in oklab, var(--destructive) 80%, transparent)`
            : "none",
          outlineOffset: "-1px",
        }}
      />
      {isHovered && pos && typeof document !== "undefined" &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top,
              transform: "translate(-50%, -50%)",
              zIndex: 2147483647,
              pointerEvents: "auto",
            }}
          >
            {children}
          </div>,
          document.body,
        )}
    </div>
  );
}

function TeleportFx({ point, phase }: { point: Point; phase: "out" | "in" }) {

  const particles = useMemo(() => {
    return Array.from({ length: 18 }).map((_, i) => {
      const angle = (i / 18) * Math.PI * 2 + Math.random() * 0.4;
      const dist = 30 + Math.random() * 40;
      const delay = Math.random() * 180;
      const size = 4 + Math.random() * 6;
      return {
        i,
        dx: Math.cos(angle) * dist,
        dy: Math.sin(angle) * dist - 10,
        delay,
        size,
        duration: 600 + Math.random() * 300,
      };
    });
  }, [point.x, point.y, phase]);

  return (
    <div
      className="absolute pointer-events-none z-[80]"
      style={{
        left: `${point.x * 100}%`,
        top: `${point.y * 100}%`,
        transform: "translate(-50%, -70%)",
      }}
    >
      <div
        className="absolute left-1/2 top-1/2 rounded-full"
        style={{
          width: 90,
          height: 90,
          transform: "translate(-50%, -50%)",
          background:
            "radial-gradient(circle, color-mix(in oklab, var(--primary) 70%, transparent) 0%, transparent 70%)",
          animation: `tp-halo-${phase} 600ms ease-out forwards`,
          filter: "blur(2px)",
        }}
      />
      <div
        className="absolute left-1/2 top-1/2 rounded-full border-2"
        style={{
          width: 30,
          height: 30,
          transform: "translate(-50%, -50%)",
          borderColor: "var(--primary)",
          boxShadow: "0 0 24px var(--primary-glow)",
          animation: `tp-ring 700ms ease-out forwards`,
        }}
      />
      {particles.map((p) => (
        <div
          key={p.i}
          className="absolute left-1/2 top-1/2 rounded-full"
          style={{
            width: p.size,
            height: p.size,
            background: "var(--primary)",
            boxShadow: "0 0 8px var(--primary), 0 0 14px var(--primary-glow)",
            ["--tp-dx" as string]: `${p.dx}px`,
            ["--tp-dy" as string]: `${p.dy}px`,
            animation: `tp-particle-${phase} ${p.duration}ms ease-out ${p.delay}ms forwards`,
            opacity: 0,
          }}
        />
      ))}
    </div>
  );
}



/** Animated sprite avatar — 6-frame horizontal sheet per direction. */
function SpriteAvatar({
  facing,
  frame,
  glowColor,
  spriteId,
}: {
  facing: Facing;
  frame: number;
  glowColor?: string;
  spriteId?: string | null;
}) {
  const sprite = getSprite(spriteId);
  // Reference dims = max H across sheets, max W across sheets.
  // Container size is fixed regardless of facing → no "samba" vertical.
  const facings: Facing[] = ["down", "up", "left", "right"];
  const refH = Math.max(...facings.map((f) => sprite.dims[f].h));
  const refW = Math.max(...facings.map((f) => sprite.dims[f].w));
  // Para laterais, substitui o frame 3 pelo idle (frame 0) — quebra a sensação de deslizar.
  const displayFrame = (facing === "left" || facing === "right") && frame === 3 ? 0 : frame;
  return (
    <div
      style={{
        position: "relative",
        height: "min(9vh, 94px)",
        aspectRatio: `${refW} / ${refH}`,
      }}
    >
      {/* Contact shadow — anchors the character to the floor */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: "50%",
          bottom: "-2%",
          width: "62%",
          height: "10%",
          transform: "translateX(-50%)",
          background:
            "radial-gradient(ellipse at center, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.28) 45%, rgba(0,0,0,0) 72%)",
          filter: "blur(1.5px)",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />
      {facings.map((f) => {
        // For mirrored-left sprites, render right sheet flipped when facing left.
        const useMirror = f === "left" && sprite.mirrorLeftFromRight;
        const srcFacing: Facing = useMirror ? "right" : f;
        const h = sprite.dims[srcFacing].h;
        const w = sprite.dims[srcFacing].w;
        const active = f === facing;
        const heightPct = (h / refH) * 100;
        const widthPct = (w / refH) * (refH / refW) * 100; // = (w/refW)*100, kept symmetric
        return (
          <div
            key={f}
            style={{
              position: "absolute",
              left: "50%",
              bottom: 0,
              transform: `translateX(-50%) ${useMirror ? "scaleX(-1)" : ""}`,
              height: `${heightPct}%`,
              width: `${(w / refW) * 100}%`,
              backgroundImage: `url(${sprite.sheets[srcFacing]})`,
              backgroundRepeat: "no-repeat",
              backgroundSize: `${FRAMES * 100}% 100%`,
              backgroundPosition: `${(displayFrame / (FRAMES - 1)) * 100}% 0`,
              imageRendering: "auto",
              visibility: active ? "visible" : "hidden",
              filter: "drop-shadow(0 2px 1px rgba(0,0,0,0.25))",
              zIndex: 1,
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

/** Gather-style hover card showing the occupant + 4 social action icons. */
function OccupantCard({
  profile,
  online,
  isMe,
  onLeaveNote,
  onLeaveDesk,
}: {
  profile: Profile | null;
  online: boolean;
  isMe?: boolean;
  onLeaveNote?: () => void;
  onLeaveDesk?: () => void;
}) {
  const initials = (profile?.display_name ?? "?").charAt(0).toUpperCase();
  return (
    <div
      className="rounded-lg shadow-soft px-2.5 py-2 text-white flex flex-col items-center gap-1.5 min-w-[150px]"
      style={{
        background: "rgba(20, 22, 38, 0.96)",
        border: "1px solid rgba(255,255,255,0.08)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div className="flex items-center gap-2 w-full">
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-white shrink-0"
          style={{ background: profile?.avatar_color ?? "var(--primary)" }}
        >
          {initials}
        </div>
        <div className="leading-tight min-w-0 flex-1">
          <div className="text-xs font-semibold flex items-center gap-1 truncate">
            <span className="truncate">{profile?.display_name ?? "Reservado"}</span>
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${online ? "bg-emerald-400" : "bg-zinc-400"}`}
            />
          </div>
          <div className="text-[9px] opacity-70">
            {isMe ? "você" : online ? "Online" : "Offline"}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <CardIconBtn title="Perfil (em breve)" disabled>
          <UserIcon className="w-3 h-3" />
        </CardIconBtn>
        <CardIconBtn title="Cumprimentar (em breve)" disabled>
          <Hand className="w-3 h-3" />
        </CardIconBtn>
        <CardIconBtn title="Chat (em breve)" disabled>
          <MessageCircle className="w-3 h-3" />
        </CardIconBtn>
        {!isMe && (
          <CardIconBtn
            title="Deixar recadinho"
            onClick={onLeaveNote}
            disabled={!onLeaveNote}
            active
          >
            <StickyNote className="w-3 h-3" />
          </CardIconBtn>
        )}
      </div>
      {isMe && onLeaveDesk && (
        <button
          type="button"
          onClick={onLeaveDesk}
          className="w-full rounded-md px-2 py-1 text-[10px] font-semibold bg-white/10 hover:bg-destructive/80 text-white transition flex items-center justify-center gap-1"
        >
          <LogOut className="w-2.5 h-2.5" />
          Deixar mesa
        </button>
      )}
    </div>
  );
}

function CardIconBtn({
  children,
  title,
  onClick,
  disabled,
  active,
}: {
  children: React.ReactNode;
  title: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`w-7 h-7 rounded-md flex items-center justify-center transition ${
        disabled
          ? "bg-white/5 text-white/30 cursor-not-allowed"
          : active
          ? "bg-primary text-primary-foreground hover:opacity-90"
          : "bg-white/10 text-white/80 hover:bg-white/20"
      }`}
    >
      {children}
    </button>
  );
}

/** Little pixel-art-ish gift box that sits on a desk. */
function GiftSprite({ color, bounce }: { color?: string; bounce?: boolean }) {
  const ribbon = color ?? "var(--primary)";
  return (
    <div
      className={bounce ? "animate-bounce" : ""}
      style={{
        width: "min(4.2vh, 44px)",
        height: "min(4.2vh, 44px)",
        animationDuration: "1.6s",
        filter: "drop-shadow(0 3px 4px rgba(0,0,0,0.4))",
        imageRendering: "pixelated",
      }}
    >
      <svg viewBox="0 0 32 32" width="100%" height="100%" shapeRendering="crispEdges">
        {/* Lid */}
        <rect x="4" y="10" width="24" height="6" fill="#E94B8C" />
        <rect x="4" y="10" width="24" height="2" fill="#FF7AB0" />
        <rect x="4" y="15" width="24" height="1" fill="#A02560" />
        {/* Box body */}
        <rect x="6" y="16" width="20" height="12" fill="#F06AA0" />
        <rect x="6" y="27" width="20" height="1" fill="#A02560" />
        {/* Vertical ribbon */}
        <rect x="14" y="10" width="4" height="18" fill={ribbon} />
        <rect x="14" y="10" width="1" height="18" fill="#FFF" opacity="0.35" />
        {/* Bow */}
        <rect x="11" y="6" width="4" height="4" fill={ribbon} />
        <rect x="17" y="6" width="4" height="4" fill={ribbon} />
        <rect x="14" y="7" width="4" height="3" fill={ribbon} />
        <rect x="15" y="8" width="2" height="2" fill="#FFF" opacity="0.5" />
        {/* Small note sticking out the top */}
        <rect x="20" y="4" width="8" height="6" fill="#FFF7C2" />
        <rect x="20" y="4" width="8" height="1" fill="#E6D98A" />
        <rect x="21" y="6" width="6" height="1" fill="#C9B96A" />
        <rect x="21" y="8" width="4" height="1" fill="#C9B96A" />
      </svg>
    </div>
  );
}

/** Transparent overlay that captures mouse movement + click while placing a note. */
function PlacementLayer({
  placing,
  workspaceZones,
  onMove,
  onCancel,
  onConfirm,
}: {
  placing: { zoneId: string; recipientId: string; body: string };
  workspaceZones: { id: string; rect: { x1: number; y1: number; x2: number; y2: number } }[];
  onMove: (p: { x: number; y: number }) => void;
  onCancel: () => void;
  onConfirm: (p: { x: number; y: number }) => void;
}) {
  const targetRect = workspaceZones.find((wz) => wz.id === placing.zoneId)?.rect ?? null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <>
      <div
        className="absolute inset-0"
        style={{ zIndex: 90, cursor: "crosshair", background: "rgba(0,0,0,0.18)" }}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = (e.clientX - rect.left) / rect.width;
          const y = (e.clientY - rect.top) / rect.height;
          onMove({ x, y });
        }}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = (e.clientX - rect.left) / rect.width;
          const y = (e.clientY - rect.top) / rect.height;
          if (!targetRect) return;
          if (x < targetRect.x1 || x > targetRect.x2 || y < targetRect.y1 || y > targetRect.y2) {
            toast.error("Clique sobre a mesa do destinatário.");
            return;
          }
          onConfirm({ x, y });
        }}
      />
      {/* Highlight target zone */}
      {targetRect && (
        <div
          className="absolute pointer-events-none rounded-md"
          style={{
            left: `${targetRect.x1 * 100}%`,
            top: `${targetRect.y1 * 100}%`,
            width: `${(targetRect.x2 - targetRect.x1) * 100}%`,
            height: `${(targetRect.y2 - targetRect.y1) * 100}%`,
            zIndex: 91,
            outline: "2px dashed color-mix(in oklab, var(--primary) 80%, transparent)",
            background: "color-mix(in oklab, var(--primary) 12%, transparent)",
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.001)",
          }}
        />
      )}
      {/* Cancel pill */}
      <button
        type="button"
        onClick={onCancel}
        className="absolute left-1/2 -translate-x-1/2 bottom-6 z-[120] flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold bg-white text-foreground shadow-soft hover:bg-white/90"
      >
        <XIcon className="w-4 h-4" /> Cancelar (Esc)
      </button>
    </>
  );
}
