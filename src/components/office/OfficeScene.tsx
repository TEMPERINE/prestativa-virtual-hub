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
import { useOfficeTheme } from "@/hooks/useOfficeTheme";
import parkLeft from "@/assets/scene-park-left.webp";
import roadRight from "@/assets/scene-road-right.webp";
import { SPRITES, getSprite, SPRITE_FRAMES as FRAMES, type Facing } from "@/lib/sprite-catalog";
import { ensureFrameOffsets, getFrameOffsets, subscribeFrameOffsets } from "@/lib/sprite-alignment";
import { AlignedSprite } from "@/components/sprites/AlignedSprite";
import { PropsLayer } from "./PropsLayer";
import { isMoveGated } from "@/lib/prop-gates";

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
import { LogOut, Mic, MicOff, Video, VideoOff, MonitorUp, Users, Pencil, User as UserIcon, MessageCircle, StickyNote, X as XIcon, Plus, Minus, Locate, ChevronLeft, ChevronRight, Footprints, UserPlus, Hand, Circle, Square, Loader2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useRtcMesh } from "@/lib/rtc/useRtcMesh";
import { installAudioUnlockListeners, unlockAudioPlayback } from "@/lib/rtc/audio-unlock";
import { RemoteVideoTiles } from "./RemoteVideoTiles";
import { CamPreviewAndPicker } from "./CamPreviewAndPicker";
import { DeviceMenu } from "./DeviceMenu";
import prestativaIcon from "@/assets/prestativa-icon.png.asset.json";
import { ScreenShareViewer } from "./ScreenShareViewer";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ProfileMenu } from "@/components/profile/ProfileMenu";
import { SavedNotesDialog } from "@/components/profile/SavedNotesDialog";
import { EditCharacterModal } from "@/components/profile/EditCharacterModal";
import { EditProfileModal } from "@/components/profile/EditProfileModal";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { useMeetingTracker } from "@/lib/meetings/useMeetingTracker";
import { useMeetingRecorder } from "@/lib/meetings/useMeetingRecorder";
import { getCurrentWorkspaceId } from "@/lib/workspace/current";
import { useWorkspaceTier } from "@/lib/workspace/useWorkspaceTier";

type Profile = {
  id: string;
  display_name: string;
  avatar_color: string;
  sprite_id?: string | null;
  tagline?: string | null;
  status?: "available" | "busy" | "away" | null;
  onboarded_at?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  birth_date?: string | null;
  city?: string | null;
  state?: string | null;
  country_code?: string | null;
};

type RemotePos = {
  user_id: string;
  x: number;
  y: number;
  zone: string;
  is_online: boolean;
  facing?: Facing;
  updated_at?: string;
  ts?: number;
};
type LocalSavedPosition = {
  x: number;
  y: number;
  zone?: string;
  facing?: Facing;
  ts: number;
};
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

const SPEED = 0.0042;            // tamanho do passo na cadência alvo de 60 fps
const SPEED_PER_SEC = SPEED * 60; // velocidade real (frações de mapa por segundo)
const MIN_STEP_FACTOR = 0.5;     // não deixa o passo ficar minúsculo em FPS alto
const MAX_STEP_FACTOR = 3;       // evita pulos enormes quando a aba volta do background
const SEND_INTERVAL_MS = 120;
const POSITION_BROADCAST_CHANNEL = "positions-broadcast-v1";
const POSITION_PRESENCE_CHANNEL = "positions-presence-v1";
const REMOTE_TELEPORT_MIN_DISTANCE = 0.075;

const timestampForPosition = (p: Partial<Pick<RemotePos, "updated_at" | "ts">>) =>
  p.ts ?? (p.updated_at ? Date.parse(p.updated_at) : 0);

const distanceBetween = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const validPoint = (p: Point | undefined): p is Point =>
  !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
const LAST_POSITION_KEY_PREFIX = "office:last-position:v1:";

function readLocalSavedPosition(userId: string): LocalSavedPosition | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${LAST_POSITION_KEY_PREFIX}${userId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalSavedPosition>;
    const x = parsed.x;
    const y = parsed.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return {
      x: x as number,
      y: y as number,
      zone: typeof parsed.zone === "string" ? parsed.zone : undefined,
      facing: parsed.facing,
      ts: Number.isFinite(parsed.ts) ? parsed.ts! : 0,
    };
  } catch {
    return null;
  }
}

function writeLocalSavedPosition(userId: string, point: Point, zone: string, facing: Facing) {
  if (typeof window === "undefined" || !validPoint(point)) return;
  try {
    window.localStorage.setItem(
      `${LAST_POSITION_KEY_PREFIX}${userId}`,
      JSON.stringify({ x: point.x, y: point.y, zone, facing, ts: Date.now() } satisfies LocalSavedPosition),
    );
  } catch {
    // localStorage can be unavailable in private modes; DB persistence remains the source of truth.
  }
}

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

// Random walkable point inside a given zone rect. Used by teleport so two
// avatars don't stack on the same fixed seat point.
function randomPointInRect(
  rect: { x1: number; y1: number; x2: number; y2: number },
  avoid: Point[] = [],
  minDist = 0.04,
): Point {
  const pad = 0.008;
  for (let i = 0; i < 120; i++) {
    const x = rect.x1 + pad + Math.random() * Math.max(0, rect.x2 - rect.x1 - pad * 2);
    const y = rect.y1 + pad + Math.random() * Math.max(0, rect.y2 - rect.y1 - pad * 2);
    const p = { x, y };
    if (collides(p)) continue;
    if (avoid.some((a) => Math.hypot(a.x - x, a.y - y) < minDist)) continue;
    return p;
  }
  // Fallback to seat point.
  return seatPointForRect(rect);
}

export function OfficeScene({ onHydrated }: { onHydrated?: () => void } = {}) {
  const officeTheme = useOfficeTheme();
  // Capacidades por nível do espaço atual — controlam botões de gravar,
  // teleporte e troca de personagem.
  const { caps: tierCaps } = useWorkspaceTier(getCurrentWorkspaceId());
  const tierCapsRef = useRef(tierCaps);
  tierCapsRef.current = tierCaps;
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [me, setMe] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [positions, setPositions] = useState<Record<string, RemotePos>>({});
  const positionsRef = useRef<Record<string, RemotePos>>({});
  positionsRef.current = positions;
  // LWW tracker — wall-clock ts of the freshest known sample per user (broadcast/presence).
  // Lets us discard stale DB poll rows that would otherwise snap remote avatars back.
  const positionFreshTs = useRef<Map<string, number>>(new Map());
  // Prevents the initial SPAWN placeholder from being advertised/persisted before
  // the user's real saved position has loaded.
  const positionHydratedRef = useRef(false);
  const [pos, setPos] = useState<Point>(SPAWN);
  const [zone, setZone] = useState<ZoneId>("lobby");
  const [showTeam, setShowTeam] = useState(false);
  const [showHint, setShowHint] = useState(true);
  const [facing, setFacing] = useState<Facing>("down");
  const facingRef = useRef<Facing>("down");
  const [reactions, setReactions] = useState<Record<string, { emoji: string; ts: number }>>({});
  // Active remote-user teleport effects (so others see the sparkle/fade like a game).
  const [remoteTeleports, setRemoteTeleports] = useState<
    Record<string, { from: Point; to: Point; phase: "out" | "in"; id: number }>
  >({});
  const remoteTeleportTimers = useRef<Map<string, number[]>>(new Map());
  const startRemoteTeleport = useCallback((userId: string, from: Point, to: Point) => {
    if (!userId || userId === meIdRef.current || !validPoint(from) || !validPoint(to)) return;
    const id = Date.now() + Math.random();
    const prevTimers = remoteTeleportTimers.current.get(userId) ?? [];
    prevTimers.forEach((t) => window.clearTimeout(t));
    const timers: number[] = [];
    setRemoteTeleports((p) => ({ ...p, [userId]: { from, to, phase: "out", id } }));
    timers.push(
      window.setTimeout(() => {
        setRemoteTeleports((p) =>
          p[userId]?.id === id ? { ...p, [userId]: { ...p[userId], phase: "in" } } : p
        );
      }, 450)
    );
    timers.push(
      window.setTimeout(() => {
        setRemoteTeleports((p) => {
          if (p[userId]?.id !== id) return p;
          const next = { ...p };
          delete next[userId];
          return next;
        });
        remoteTeleportTimers.current.delete(userId);
      }, 1100)
    );
    remoteTeleportTimers.current.set(userId, timers);
  }, []);
  const maybeStartRemoteTeleportFromCurrent = useCallback((userId: string, to: Point, incomingTs: number) => {
    if (!userId || userId === meIdRef.current || !validPoint(to)) return;
    if (remoteTeleportTimers.current.has(userId)) return;
    const cur = positionsRef.current[userId];
    if (!cur || !validPoint(cur)) return;
    const curTs = timestampForPosition(cur) || (positionFreshTs.current.get(userId) ?? 0);
    if (incomingTs && curTs && incomingTs < curTs) return;
    const from = { x: cur.x, y: cur.y };
    if (distanceBetween(from, to) < REMOTE_TELEPORT_MIN_DISTANCE) return;
    startRemoteTeleport(userId, from, to);
  }, [startRemoteTeleport]);
  // Per-remote-user walking animation state. Advances frame while position is changing.
  const remoteAnimRef = useRef<Map<string, { frame: number; lastMove: number; lastX: number; lastY: number; lastTick: number }>>(new Map());
  const [remoteFrames, setRemoteFrames] = useState<Record<string, number>>({});
  // zone_id -> user_id (claims)
  const [claims, setClaims] = useState<Record<string, string>>({});
  const [hoveredZone, setHoveredZone] = useState<string | null>(null);
  const [notes, setNotes] = useState<DeskNote[]>([]);
  const [composeFor, setComposeFor] = useState<{ zoneId: string; recipientId: string; recipientName: string } | null>(null);
  const [composeText, setComposeText] = useState("");
  const [placing, setPlacing] = useState<{ zoneId: string; recipientId: string; body: string } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [openingNote, setOpeningNote] = useState<DeskNote | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [savedNotesOpen, setSavedNotesOpen] = useState(false);
  const [raisedHands, setRaisedHands] = useState<Record<string, boolean>>({});
  const handChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const handChannelReadyRef = useRef(false);
  const reactionChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const positionBroadcastChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const positionBroadcastReadyRef = useRef(false);

  const meIdRef = useRef<string | null>(null);
  const accessTokenRef = useRef<string | null>(null);
  const [myEmail, setMyEmail] = useState<string>("");
  const [editCharOpen, setEditCharOpen] = useState(false);
  const [editProfOpen, setEditProfOpen] = useState(false);
  const [forceOnboarding, setForceOnboarding] = useState(false);

  const refreshMe = useCallback(async () => {
    const uid = meIdRef.current;
    if (!uid) return;
    const { data } = await supabase.from("profiles").select("id, display_name, avatar_color, sprite_id, tagline, status, onboarded_at, first_name, last_name, birth_date, city, state, country_code").eq("id", uid).maybeSingle();
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
  const lastPersisted = useRef(0);
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

  // ---- WebRTC mesh: voice/video by proximity or same physical room ----
  // Raio de "conversa de corredor": só conecta quando os personagens estão
  // bem próximos (cerca da distância de um sprite) e desconecta rapidamente
  // assim que a bolha de papo é rompida.
  const PROXIMITY_CONNECT = 0.05;
  const PROXIMITY_DISCONNECT = 0.06;
  const connectedPeersRef = useRef<Set<string>>(new Set());
  const desiredPeers = useMemo(() => {
    const meId = me?.id;
    if (!meId) return [] as string[];
    const candidates: { uid: string; score: number }[] = [];
    for (const [uid, p] of Object.entries(positions)) {
      if (uid === meId) continue;
      if (!p.is_online) continue;
      // Same physical room/area → connect only while both avatars are there.
      // A claimed desk alone must not pull users into a call from elsewhere.
      const sameActiveRoom = zone !== "lobby" && p.zone === zone;
      // Proximity with hysteresis
      const dx = p.x - pos.x;
      const dy = p.y - pos.y;
      const dist = Math.hypot(dx, dy);
      const already = connectedPeersRef.current.has(uid);
      const closeEnough = already ? dist <= PROXIMITY_DISCONNECT : dist <= PROXIMITY_CONNECT;
      if (sameActiveRoom || closeEnough) {
        const score = (sameActiveRoom ? 0 : 1) + dist;
        candidates.push({ uid, score });
      }
    }
    // A browser mesh is capped to keep the room stable with ~15 collaborators.
    return candidates.sort((a, b) => a.score - b.score).slice(0, 14).map((c) => c.uid);
  }, [me?.id, positions, pos.x, pos.y, zone]);

  const rtc = useRtcMesh(me?.id ?? null, desiredPeers);
  useEffect(() => {
    connectedPeersRef.current = new Set(desiredPeers);
  }, [desiredPeers]);

  // Warm-start mic the moment we know the user — getUserMedia runs once,
  // the track stays disabled until the user clicks unmute. This removes the
  // 1–3s permission/negotiation delay from the first unmute and ensures
  // peers already have an audio sender attached when they connect.
  // Also wires global audio unlock so remote <audio> tags can autoplay.
  const prewarmMic = rtc.prewarmMic;
  useEffect(() => {
    if (!me?.id) return;
    void prewarmMic();
  }, [me?.id, prewarmMic]);
  useEffect(() => {
    const off = installAudioUnlockListeners();
    return off;
  }, []);

  // Keep realtime authenticated forever: re-attach JWT on every token refresh,
  // otherwise the websocket silently loses access to RLS-protected tables
  // after ~1h and movement events stop arriving.
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      accessTokenRef.current = data.session?.access_token ?? null;
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      accessTokenRef.current = session?.access_token ?? null;
      if ((event === "TOKEN_REFRESHED" || event === "SIGNED_IN") && session?.access_token) {
        try { void supabase.realtime.setAuth(session.access_token); } catch { /* noop */ }
      }
    });
    return () => { sub.subscription.unsubscribe(); };
  }, []);

  const sendPos = useCallback((x: number, y: number, z: ZoneId, f: Facing, persistNow = false) => {
    if (!positionHydratedRef.current) return;
    const knownId = meIdRef.current;
    const write = (userId: string) => {
      const payload = { user_id: userId, x, y, zone: z, facing: f, is_online: true, ts: Date.now() };
      writeLocalSavedPosition(userId, { x, y }, z, f);
      const ch = positionBroadcastChannelRef.current;
      if (ch && positionBroadcastReadyRef.current) {
        void ch.send({ type: "broadcast", event: "position", payload });
      }
      const now = performance.now();
      if (persistNow || now - lastPersisted.current > 300) {
        lastPersisted.current = now;
        const _ws = getCurrentWorkspaceId();
        if (_ws) void supabase.from("positions").upsert({
          workspace_id: _ws,
          user_id: userId,
          x,
          y,
          zone: z,
          facing: f,
          is_online: true,
        });
      }
    };
    if (knownId) {
      write(knownId);
      return;
    }
    void supabase.auth.getUser().then(({ data }) => {
      if (data.user) write(data.user.id);
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

  // Remote avatar walk-cycle animation. Detect (x,y) changes per user and
  // step through frames 1..5 while moving; freeze on frame 0 when idle for
  // more than ~220ms. Runs on a single timer so all remotes stay in sync.
  useEffect(() => {
    const MOVE_DECAY_MS = 220;
    const TICK_MS = 110;
    const id = window.setInterval(() => {
      const now = performance.now();
      const tracker = remoteAnimRef.current;
      let changed = false;
      const next: Record<string, number> = {};

      // Sync tracker with current positions (add/update entries).
      Object.values(positions).forEach((p) => {
        if (p.user_id === meIdRef.current) return;
        const t = tracker.get(p.user_id);
        if (!t) {
          tracker.set(p.user_id, { frame: 0, lastMove: 0, lastX: p.x, lastY: p.y, lastTick: now });
          next[p.user_id] = 0;
          return;
        }
        if (t.lastX !== p.x || t.lastY !== p.y) {
          t.lastX = p.x;
          t.lastY = p.y;
          t.lastMove = now;
        }
        const moving = now - t.lastMove < MOVE_DECAY_MS;
        const newFrame = moving
          ? (t.frame >= 5 || t.frame < 1 ? 1 : t.frame + 1)
          : 0;
        if (newFrame !== t.frame) {
          t.frame = newFrame;
          changed = true;
        }
        t.lastTick = now;
        next[p.user_id] = newFrame;
      });

      // Drop trackers for users no longer present.
      for (const key of Array.from(tracker.keys())) {
        if (!(key in next)) {
          tracker.delete(key);
          changed = true;
        }
      }

      if (changed) setRemoteFrames(next);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [positions]);




  const lastGatedToastRef = useRef(0);
  const tryMove = useCallback((dir: Facing, stepFactor = 1) => {
    const cur = posRef.current;
    const step = SPEED * Math.max(MIN_STEP_FACTOR, Math.min(MAX_STEP_FACTOR, stepFactor));
    const dx = dir === "left" ? -step : dir === "right" ? step : 0;
    const dy = dir === "up" ? -step : dir === "down" ? step : 0;
    let nx = cur.x + dx;
    let ny = cur.y + dy;
    if (collides({ x: nx, y: cur.y })) nx = cur.x;
    if (collides({ x: nx, y: ny })) ny = cur.y;
    if (nx === cur.x && ny === cur.y) return false;
    const np = { x: nx, y: ny };
    // Bloqueio por porta/elemento: se o passo cruza a fronteira de uma zona
    // trancada (por ex. porta fechada), reverte o movimento.
    const fromZoneId = zoneAt(cur).id;
    const toZoneId = zoneAt(np).id;
    if (isMoveGated(fromZoneId, toZoneId)) {
      const now = performance.now();
      if (now - lastGatedToastRef.current > 1500) {
        lastGatedToastRef.current = now;
        toast("Porta fechada", { description: "Aperte X para abrir." });
      }
      return false;
    }
    posRef.current = np;
    setPos(np);
    const z = { id: toZoneId };
    const uid = meIdRef.current;
    if (uid) writeLocalSavedPosition(uid, np, z.id, dir);
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
      if (!userData.user) { try { onHydrated?.(); } catch { /* noop */ } return; }
      meIdRef.current = userData.user.id;
      setMyEmail(userData.user.email ?? "");

      // Workspace ativo deste OfficeScene. Tudo (positions, claims, notes,
      // realtime, broadcast) é escopado por ele — espaços são independentes
      // independentes e o usuário só pode estar online em um por vez.
      const wsId = getCurrentWorkspaceId();

      // Garante presença única: marca offline qualquer posição minha em
      // OUTROS workspaces antes de entrar neste.
      if (wsId) {
        void supabase
          .from("positions")
          .update({ is_online: false })
          .eq("user_id", userData.user.id)
          .neq("workspace_id", wsId);
      }

      const { data: profs } = await supabase.from("profiles").select("id, display_name, avatar_color, sprite_id, tagline, status, onboarded_at, first_name, last_name, birth_date, city, state, country_code");
      const map: Record<string, Profile> = {};
      (profs ?? []).forEach((p) => (map[p.id] = p as Profile));
      setProfiles(map);
      setMe(map[userData.user.id] ?? null);

      let posQuery = supabase.from("positions").select("user_id, x, y, zone, facing, is_online, updated_at");
      if (wsId) posQuery = posQuery.eq("workspace_id", wsId);
      const { data: posData } = await posQuery;
      const pmap: Record<string, RemotePos> = {};
      (posData ?? []).forEach((p) => {
        pmap[p.user_id] = p as RemotePos;
        if (p.updated_at) positionFreshTs.current.set(p.user_id, Date.parse(p.updated_at));
      });

      // Load workspace claims (escopado pelo workspace atual)
      let claimQuery = supabase
        .from("workspace_claims")
        .select("zone_id, user_id");
      if (wsId) claimQuery = claimQuery.eq("workspace_id", wsId);
      const { data: claimData } = await claimQuery;
      const cmap: Record<string, string> = {};
      (claimData ?? []).forEach((c: { zone_id: string; user_id: string }) => {
        cmap[c.zone_id] = c.user_id;
      });
      setClaims(cmap);

      // Garante que os overrides do mapa (rects e spawn points custom) estejam
      // carregados do cloud ANTES de calcular o ponto de spawn. Sem isto,
      // zonas customizadas caem em SPAWN porque zoneRectFromOverrides/
      // spawnPointForZone leem do localStorage ainda vazio.
      try { await pullOverridesFromCloud(); } catch { /* noop */ }

      // Ao entrar no workspace, o personagem sempre nasce no spawn point da
      // sua cadeira reivindicada (posição frontal). Quem não tem cadeira cai
      // num ponto aleatório do corredor. Não preservamos posição anterior:
      // entrar no escritório é como spawnar num mundo de jogo.
      const myClaimZone = Object.entries(cmap).find(([, uid]) => uid === userData.user!.id)?.[0];
      let startPoint: Point;
      if (myClaimZone) {
        const z = findZoneById(myClaimZone);
        const rect = zoneRectFromOverrides(myClaimZone as ZoneId) ?? z?.rect ?? null;
        const sp = spawnPointForZone(myClaimZone);
        // Preferimos o spawn point frontal explícito; se não houver, usamos
        // o ponto frontal calculado do rect da cadeira.
        startPoint = sp ?? (rect ? seatPointForRect(rect) : SPAWN);
      } else {
        startPoint = randomCorridorPoint();
      }
      const safeStart = collides(startPoint) ? SPAWN : startPoint;

      posRef.current = safeStart;
      setPos(safeStart);
      const startZone = zoneAt(safeStart).id;
      setZone(startZone);
      const startFacing: Facing = "down";
      facingRef.current = startFacing;
      setFacing(startFacing);
      positionHydratedRef.current = true;
      writeLocalSavedPosition(userData.user.id, safeStart, startZone, startFacing);
      // Sinaliza pro preloader que a posição real já foi resolvida — só
      // depois disso o office aparece (sem flash de snap pro spawn).
      try { onHydrated?.(); } catch { /* noop */ }

      pmap[userData.user.id] = {
        user_id: userData.user.id,
        x: safeStart.x,
        y: safeStart.y,
        zone: startZone,
        facing: startFacing,
        is_online: true,
        ts: Date.now(),
      };
      setPositions(pmap);

      const _wsInit = getCurrentWorkspaceId();
      if (_wsInit) await supabase.from("positions").upsert({
        workspace_id: _wsInit,
        user_id: userData.user.id,
        x: safeStart.x,
        y: safeStart.y,
        zone: startZone,
        facing: startFacing,
        is_online: true,
      });
    })();

    // IMPORTANT: garantir que o socket de realtime carregue o JWT do usuário
    // ANTES de assinar canais. As tabelas abaixo têm RLS exigindo o role
    // `authenticated`; se assinarmos enquanto o socket ainda está anônimo,
    // os eventos postgres_changes (UPDATE/INSERT/DELETE) são filtrados e os
    // outros usuários parecem "congelados", mesmo com as posições sendo
    // gravadas no banco corretamente.
    const realtimeChannelSuffix = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const _wsChan = getCurrentWorkspaceId();
    const wsSuffix = _wsChan ?? "none";
    const ch = supabase
      .channel(`positions-room:${wsSuffix}:${realtimeChannelSuffix}`)
      .on(
        "postgres_changes",
        _wsChan
          ? { event: "*", schema: "public", table: "positions", filter: `workspace_id=eq.${_wsChan}` }
          : { event: "*", schema: "public", table: "positions" },
        (payload) => {
          const row = (payload.new ?? payload.old) as RemotePos & { updated_at?: string };
          if (!row) return;
          const rowTs = timestampForPosition(row) || Date.now();
          if (row.is_online) maybeStartRemoteTeleportFromCurrent(row.user_id, { x: row.x, y: row.y }, rowTs);
          setPositions((prev) => {
            const next = { ...prev };
            if (payload.eventType === "DELETE") {
              delete next[row.user_id];
              return next;
            }
            const dbTs = row.updated_at ? Date.parse(row.updated_at) : 0;
            const freshTs = positionFreshTs.current.get(row.user_id) ?? 0;
            if (dbTs && dbTs < freshTs) {
              const cur = prev[row.user_id];
              if (cur) {
                next[row.user_id] = { ...cur, is_online: row.is_online };
                return next;
              }
            }
            if (dbTs) positionFreshTs.current.set(row.user_id, dbTs);
            next[row.user_id] = row;
            return next;
          });
        }
      );


    const reactionCh = supabase
      .channel(`reactions-room:${wsSuffix}`)
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
      });
    reactionChannelRef.current = reactionCh;

    const positionBroadcastCh = supabase
      .channel(`${POSITION_BROADCAST_CHANNEL}:${wsSuffix}`, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "position" }, (payload) => {
        const row = payload.payload as RemotePos;
        if (!row?.user_id) return;
        const incomingTs = timestampForPosition(row) || Date.now();
        maybeStartRemoteTeleportFromCurrent(row.user_id, { x: row.x, y: row.y }, incomingTs);
        setPositions((prev) => {
          const curTs = timestampForPosition(prev[row.user_id] ?? {}) || (positionFreshTs.current.get(row.user_id) ?? 0);
          if (incomingTs < curTs) return prev;
          positionFreshTs.current.set(row.user_id, incomingTs);
          return { ...prev, [row.user_id]: { ...row, ts: incomingTs } };
        });
      })
      .on("broadcast", { event: "teleport" }, (payload) => {
        const { user_id, from, to } = (payload.payload ?? {}) as {
          user_id?: string;
          from?: Point;
          to?: Point;
        };
        if (!user_id || !from || !to) return;
        startRemoteTeleport(user_id, from, to);
        // Crava o destino em positions[user_id] já no aviso de teleport — sem
        // isso, se o broadcast de "position" pós-snap se perder/atrasar, o
        // avatar volta a renderizar no ponto antigo quando o efeito termina
        // (e pode ficar fora do enquadramento, parecendo que "sumiu" até
        // o próximo poll do DB rodar).
        const ts = Date.now();
        positionFreshTs.current.set(user_id, ts);
        setPositions((prev) => {
          const cur = prev[user_id];
          return {
            ...prev,
            [user_id]: {
              user_id,
              x: to.x,
              y: to.y,
              zone: zoneAt(to).id,
              facing: cur?.facing ?? "down",
              is_online: true,
              ts,
            },
          };
        });
      });
    positionBroadcastChannelRef.current = positionBroadcastCh;

    // Presence is only an online heartbeat. It must not be allowed to move an
    // existing avatar, because an old/hidden tab can keep heartbeating SPAWN
    // and pull a stopped colleague back to the origin.
    type PresenceState = { user_id: string; x: number; y: number; zone: string; facing?: Facing; ts: number };
    const presenceCh = supabase.channel(`${POSITION_PRESENCE_CHANNEL}:${wsSuffix}`, {
      config: { presence: { key: meIdRef.current ?? `anon:${realtimeChannelSuffix}` } },
    });
    const presenceLastTs = new Map<string, number>();
    const mergePresence = (raw: unknown) => {
      const arr = raw as PresenceState[] | undefined;
      if (!Array.isArray(arr)) return;
      for (const s of arr) {
        if (!s?.user_id || s.user_id === meIdRef.current) continue;
        const prev = presenceLastTs.get(s.user_id) ?? 0;
        if (s.ts <= prev) continue;
        presenceLastTs.set(s.user_id, s.ts);
        maybeStartRemoteTeleportFromCurrent(s.user_id, { x: s.x, y: s.y }, s.ts);
        setPositions((p) => {
          const cur = p[s.user_id];
          // Presence heartbeat is hydration-guarded (never advertises SPAWN),
          // so its x/y always reflects the peer's real current position.
          // Accept it so an F5'd tab learns "where they are right now" within
          // 1s (the heartbeat cadence) instead of waiting for a DB write.
          positionFreshTs.current.set(s.user_id, s.ts);
          return {
            ...p,
            [s.user_id]: {
              user_id: s.user_id,
              x: s.x,
              y: s.y,
              zone: s.zone,
              facing: s.facing ?? cur?.facing ?? "down",
              is_online: true,
              ts: s.ts,
            },
          };
        });
      }
    };
    // Presence is the authoritative source for "who is currently inside this
    // workspace world". DB rows can stay is_online=true if a peer closed the
    // app without firing beforeunload/pagehide (common on Electron quit). After
    // a short grace period (so peers have time to track themselves), we
    // reconcile: any peer in our positions map that is NOT in the presence
    // state is treated as offline locally.
    let presenceReconcileReady = false;
    const reconcilePresence = () => {
      if (!presenceReconcileReady) return;
      const state = presenceCh.presenceState() as Record<string, PresenceState[]>;
      const onlineIds = new Set<string>();
      for (const list of Object.values(state)) {
        for (const s of list) if (s?.user_id) onlineIds.add(s.user_id);
      }
      const myId = meIdRef.current;
      setPositions((p) => {
        let changed = false;
        const next = { ...p };
        for (const [uid, cur] of Object.entries(p)) {
          if (uid === myId) continue;
          if (cur.is_online && !onlineIds.has(uid)) {
            next[uid] = { ...cur, is_online: false };
            changed = true;
          }
        }
        return changed ? next : p;
      });
    };
    presenceCh.on("presence", { event: "sync" }, () => {
      const state = presenceCh.presenceState() as Record<string, PresenceState[]>;
      for (const list of Object.values(state)) mergePresence(list);
      reconcilePresence();
    });
    presenceCh.on("presence", { event: "join" }, ({ newPresences }) => mergePresence(newPresences));
    presenceCh.on("presence", { event: "leave" }, ({ leftPresences }) => {
      const arr = leftPresences as unknown as PresenceState[];
      for (const s of arr ?? []) {
        if (!s?.user_id || s.user_id === meIdRef.current) continue;
        setPositions((p) => {
          const cur = p[s.user_id];
          if (!cur) return p;
          return { ...p, [s.user_id]: { ...cur, is_online: false } };
        });
      }
    });

    const claimsCh = supabase
      .channel(`claims-room:${wsSuffix}:${realtimeChannelSuffix}`)
      .on(
        "postgres_changes",
        _wsChan
          ? { event: "*", schema: "public", table: "workspace_claims", filter: `workspace_id=eq.${_wsChan}` }
          : { event: "*", schema: "public", table: "workspace_claims" },
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
      );

    void (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (token) {
        try { await supabase.realtime.setAuth(token); } catch { /* noop */ }
      }
      ch.subscribe();
      reactionCh.subscribe();
      positionBroadcastCh.subscribe((status) => {
        positionBroadcastReadyRef.current = status === "SUBSCRIBED";
      });
      claimsCh.subscribe();
      presenceCh.subscribe(async (status) => {
        if (status !== "SUBSCRIBED") return;
        // Ativa a reconciliação independentemente do nosso estado de
        // hidratação — peers fantasmas (que fecharam o app sem aviso) precisam
        // ser detectados mesmo enquanto ainda estamos entrando.
        window.setTimeout(() => {
          presenceReconcileReady = true;
          reconcilePresence();
        }, 3000);
        const uid = meIdRef.current;
        if (!uid || !positionHydratedRef.current) return;
        const cur = posRef.current;
        try {
          await presenceCh.track({
            user_id: uid, x: cur.x, y: cur.y,
            zone: zoneAt(cur).id, facing: facingRef.current, ts: Date.now(),
          });
        } catch { /* noop */ }
      });

    })();

    // Heartbeat presence every second so peers detect each other within 1s of
    // joining and the "frozen avatar" symptom can't happen even if both
    // postgres_changes and broadcasts get dropped on flaky networks.
    const presenceHeartbeat = window.setInterval(() => {
      const uid = meIdRef.current;
      if (!uid || !positionHydratedRef.current) return;
      const cur = posRef.current;
      void presenceCh.track({
        user_id: uid, x: cur.x, y: cur.y,
        zone: zoneAt(cur).id, facing: facingRef.current, ts: Date.now(),
      }).catch(() => { /* noop */ });
    }, 1000);

    // Reconcile periódico: peers que fecharam o app sem disparar
    // beforeunload/pagehide ficam com is_online=true no DB. A reconciliação
    // baseada em presence é a fonte da verdade.
    const reconcileInterval = window.setInterval(() => {
      reconcilePresence();
    }, 5000);


    // Reconnection + resync watchdog: when the tab regains focus (or the
    // browser wakes from sleep), force a position sync, re-track presence
    // and re-broadcast our position. Supabase Realtime auto-reconnects the
    // socket, but channels can miss events while the page was hidden — this
    // closes the gap so the other avatars don't appear "frozen".
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const uid = meIdRef.current;
      if (!uid || !positionHydratedRef.current) return;
      const cur = posRef.current;
      const curZone = zoneAt(cur).id;
      // 1) Re-attach the latest JWT to the realtime socket
      void supabase.auth.getSession().then(({ data }) => {
        const token = data.session?.access_token;
        if (token) { try { void supabase.realtime.setAuth(token); } catch { /* noop */ } }
      });
      // 2) Force a full positions reload from DB
      void syncPositions();
      // 3) Refresh presence heartbeat immediately
      void presenceCh.track({
        user_id: uid, x: cur.x, y: cur.y, zone: curZone,
        facing: facingRef.current, ts: Date.now(),
      }).catch(() => { /* noop */ });
      // 4) Re-broadcast our position so peers update without waiting 1s
      const pbCh = positionBroadcastChannelRef.current;
      if (pbCh && positionBroadcastReadyRef.current) {
        void pbCh.send({
          type: "broadcast", event: "position",
          payload: { user_id: uid, x: cur.x, y: cur.y, zone: curZone, facing: facingRef.current, is_online: true, ts: Date.now() },
        });
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    // Persist the user's CURRENT position synchronously on unload/hide so a
    // refresh, tab close or app switch never loses the last few movements
    // (which would make the avatar appear to "respawn" at an old spot).
    const persistFinalPosition = () => {
      const uid = meIdRef.current;
      if (!uid || !positionHydratedRef.current) return;
      const cur = posRef.current;
      const z = zoneAt(cur).id;
      writeLocalSavedPosition(uid, cur, z, facingRef.current);
      const body = JSON.stringify({
        user_id: uid,
        x: cur.x,
        y: cur.y,
        zone: z,
        facing: facingRef.current,
        is_online: false,
      });
      try {
        const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/positions?on_conflict=user_id`;
        const token = accessTokenRef.current;
        const headers = {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          Prefer: "resolution=merge-duplicates",
        };
        // Prefer fetch keepalive (allows custom headers); fall back to sendBeacon
        void fetch(url, { method: "POST", headers, body, keepalive: true }).catch(() => {
          try { navigator.sendBeacon?.(url, new Blob([body], { type: "application/json" })); } catch { /* noop */ }
        });
      } catch { /* noop */ }
      // Also fire a normal async upsert as a backup (works if the page isn't fully torn down yet)
      const _wsOff = getCurrentWorkspaceId();
      if (_wsOff) void supabase.from("positions").upsert({
        workspace_id: _wsOff,
        user_id: uid,
        x: cur.x,
        y: cur.y,
        zone: z,
        facing: facingRef.current,
        is_online: false,
      });
    };
    const onPageHide = () => persistFinalPosition();
    const onVisibilityHidden = () => {
      if (document.visibilityState === "hidden") persistFinalPosition();
    };
    window.addEventListener("beforeunload", persistFinalPosition);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibilityHidden);


    const syncPositions = async () => {
      let q = supabase.from("positions").select("user_id, x, y, zone, facing, is_online, updated_at");
      if (_wsChan) q = q.eq("workspace_id", _wsChan);
      const { data } = await q;
      if (!data) return;
      const uid = meIdRef.current;
      setPositions((prev) => {
        const next: Record<string, RemotePos> = { ...prev };
        (data as Array<RemotePos & { updated_at?: string }>).forEach((p) => {
          if (uid && p.user_id === uid) return; // handled below
          const dbTs = p.updated_at ? Date.parse(p.updated_at) : 0;
          const freshTs = positionFreshTs.current.get(p.user_id) ?? 0;
          if (p.is_online) maybeStartRemoteTeleportFromCurrent(p.user_id, { x: p.x, y: p.y }, dbTs || Date.now());
          // Strict LWW: DB rows older than the freshest known live sample are
          // never allowed to move a stopped avatar back to a spawn/old spot.
          if (dbTs && dbTs < freshTs) {
            const cur = prev[p.user_id];
            if (cur) next[p.user_id] = { ...cur, is_online: p.is_online };
            else next[p.user_id] = p;
          } else {
            if (dbTs) positionFreshTs.current.set(p.user_id, dbTs);
            next[p.user_id] = p;
          }
        });
        if (uid) {
          const cur = posRef.current;
          const curZone = zoneAt(cur).id;
          next[uid] = {
            ...(next[uid] ?? { user_id: uid, x: cur.x, y: cur.y, zone: curZone, is_online: true }),
            x: cur.x,
            y: cur.y,
            zone: curZone,
            facing: facingRef.current,
            is_online: true,
          };
        }
        return next;
      });
    };
    const positionsPoll = window.setInterval(() => {
      void syncPositions();
    }, 1000);

    // Idle DB heartbeat — persist the local position every 2s even when
    // standing still, so other clients' DB poll never reads a stale row and
    // can't snap our avatar back to a previous spot.
    const persistHeartbeat = window.setInterval(() => {
      const uid = meIdRef.current;
      if (!uid || !positionHydratedRef.current) return;
      const cur = posRef.current;
      // Don't persist while we're still on the default SPAWN sentinel —
      // the init effect hasn't hydrated the saved position yet, and writing
      // SPAWN here would clobber the real DB row and snap us back for peers.
      if (cur.x === SPAWN.x && cur.y === SPAWN.y) return;
      writeLocalSavedPosition(uid, cur, zoneAt(cur).id, facingRef.current);
      const _wsHb = getCurrentWorkspaceId();
      if (_wsHb) void supabase.from("positions").upsert({
        workspace_id: _wsHb,
        user_id: uid,
        x: cur.x,
        y: cur.y,
        zone: zoneAt(cur).id,
        facing: facingRef.current,
        is_online: true,
      });
    }, 750);


    // Load + subscribe to desk notes (post-it gifts left on workstations)
    void (async () => {
      let nq = supabase
        .from("desk_notes")
        .select("id, zone_id, sender_id, recipient_id, body, x, y, created_at, read_at")
        .is("read_at", null);
      if (_wsChan) nq = nq.eq("workspace_id", _wsChan);
      const { data } = await nq;
      if (data) setNotes(data as DeskNote[]);
    })();
    const notesCh = supabase
      .channel(`desk-notes-room:${wsSuffix}:${realtimeChannelSuffix}`)
      .on(
        "postgres_changes",
        _wsChan
          ? { event: "*", schema: "public", table: "desk_notes", filter: `workspace_id=eq.${_wsChan}` }
          : { event: "*", schema: "public", table: "desk_notes" },
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
      );
    // assina depois que o JWT estiver hidratado no socket de realtime
    void (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (token) {
        try { await supabase.realtime.setAuth(token); } catch { /* noop */ }
      }
      notesCh.subscribe();
    })();

    return () => {
      supabase.removeChannel(ch);
      supabase.removeChannel(reactionCh);
      supabase.removeChannel(positionBroadcastCh);
      supabase.removeChannel(claimsCh);
      supabase.removeChannel(presenceCh);
      supabase.removeChannel(notesCh);
      reactionChannelRef.current = null;
      positionBroadcastChannelRef.current = null;
      positionBroadcastReadyRef.current = false;
      window.clearInterval(positionsPoll);
      window.clearInterval(presenceHeartbeat);
      window.clearInterval(reconcileInterval);

      window.clearInterval(persistHeartbeat);
      window.removeEventListener("beforeunload", persistFinalPosition);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibilityHidden);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      persistFinalPosition();
    };
  }, []);

  // Atalho: pressionar X dentro de uma zona que tenha um recadinho para mim,
  // abre o recadinho (mesmo comportamento da overlay flutuante).
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const zoneRef = useRef(zone);
  zoneRef.current = zone;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.toLowerCase() !== "x") return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      const uid = meIdRef.current;
      if (!uid) return;
      const curZone = zoneRef.current;
      const candidate = notesRef.current.find(
        (n) => n.recipient_id === uid && n.zone_id === curZone
      );
      if (!candidate) return;
      e.preventDefault();
      setOpeningNote(candidate);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // -------- Levantar a mão (broadcast realtime) --------
  const toggleRaiseHand = useCallback(() => {
    const uid = meIdRef.current;
    if (!uid) return;
    setRaisedHands((prev) => {
      const next = { ...prev };
      const newVal = !prev[uid];
      if (newVal) next[uid] = true;
      else delete next[uid];
      const ch = handChannelRef.current;
      if (ch && handChannelReadyRef.current) {
        void ch.send({ type: "broadcast", event: "hand", payload: { user_id: uid, raised: newVal } });
      }
      if (newVal) toast.success("✋ Você levantou a mão", { duration: 1800 });
      return next;
    });
  }, []);

  useEffect(() => {
    if (!me?.id) return;
    const ch = supabase
      .channel("meet-hands-v1", { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "hand" }, (payload) => {
        const { user_id, raised } = (payload.payload ?? {}) as { user_id?: string; raised?: boolean };
        if (!user_id) return;
        setRaisedHands((prev) => {
          const next = { ...prev };
          if (raised) next[user_id] = true;
          else delete next[user_id];
          return next;
        });
        if (raised) {
          const name = profiles[user_id]?.display_name ?? "Alguém";
          toast(`✋ ${name} levantou a mão`, { duration: 2500 });
        }
      });
    handChannelRef.current = ch;
    void ch.subscribe((status) => {
      handChannelReadyRef.current = status === "SUBSCRIBED";
    });
    return () => {
      handChannelReadyRef.current = false;
      supabase.removeChannel(ch);
      handChannelRef.current = null;
    };
    // intentionally not depending on profiles (only need name at toast time, read via closure of latest)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

  // -------- Toasts entrada/saída da chamada --------
  const prevConnectedRef = useRef<string[]>([]);
  useEffect(() => {
    const prev = prevConnectedRef.current;
    const cur = rtc.connectedPeers;
    const entered = cur.filter((p) => !prev.includes(p));
    const left = prev.filter((p) => !cur.includes(p));
    for (const id of entered) {
      const name = profiles[id]?.display_name ?? "Alguém";
      toast(`🎧 ${name} entrou na chamada`, { duration: 2200 });
    }
    for (const id of left) {
      const name = profiles[id]?.display_name ?? "Alguém";
      toast(`👋 ${name} saiu da chamada`, { duration: 2200 });
      // Limpa mão levantada caso saia da chamada
      setRaisedHands((p) => {
        if (!p[id]) return p;
        const next = { ...p };
        delete next[id];
        return next;
      });
    }
    prevConnectedRef.current = cur;
  }, [rtc.connectedPeers, profiles]);

  // -------- HUD de atalhos da reunião --------
  // Mostra o HUD por alguns segundos quando o usuário entra numa call ou usa
  // um atalho. Some sozinho para não poluir a UI.
  const [shortcutsHudVisible, setShortcutsHudVisible] = useState(false);
  const shortcutsHudTimerRef = useRef<number | null>(null);
  const pingShortcutsHud = useCallback((ms = 3500) => {
    setShortcutsHudVisible(true);
    if (shortcutsHudTimerRef.current) window.clearTimeout(shortcutsHudTimerRef.current);
    shortcutsHudTimerRef.current = window.setTimeout(() => {
      setShortcutsHudVisible(false);
      shortcutsHudTimerRef.current = null;
    }, ms);
  }, []);
  // Mostra o HUD ao entrar numa chamada
  const inCallRef = useRef(false);
  useEffect(() => {
    const inCall = rtc.connectedPeers.length > 0;
    if (inCall && !inCallRef.current) {
      pingShortcutsHud(6000);
    }
    inCallRef.current = inCall;
  }, [rtc.connectedPeers.length, pingShortcutsHud]);
  useEffect(() => () => {
    if (shortcutsHudTimerRef.current) window.clearTimeout(shortcutsHudTimerRef.current);
  }, []);

  // -------- Atalhos estilo Meet --------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      // Alt + M = mic
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        void unlockAudioPlayback();
        const willBeOn = !rtc.micOn;
        rtc.toggleMic()
          .then(() => {
            pingShortcutsHud(2500);
            toast(willBeOn ? "🎤 Microfone ligado" : "🔇 Microfone desligado", { duration: 1400 });
          })
          .catch(() => toast.error("Não foi possível acessar o microfone"));
        return;
      }
      // Alt + V = cam
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === "v") {
        e.preventDefault();
        void unlockAudioPlayback();
        const willBeOn = !rtc.camOn;
        rtc.toggleCam()
          .then(() => {
            pingShortcutsHud(2500);
            toast(willBeOn ? "📷 Câmera ligada" : "📷 Câmera desligada", { duration: 1400 });
          })
          .catch(() => toast.error("Não foi possível acessar a câmera"));
        return;
      }
      // Alt + H = levantar a mão
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === "h") {
        e.preventDefault();
        toggleRaiseHand();
        pingShortcutsHud(2500);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rtc, toggleRaiseHand, pingShortcutsHud]);


  const claimZone = useCallback(async (zoneId: string) => {
    const uid = meIdRef.current;
    if (!uid) return;
    // Release any previous claim by this user (one workstation per user).
    await supabase.from("workspace_claims").delete().eq("user_id", uid);
    const _wsClaim = getCurrentWorkspaceId();
    if (!_wsClaim) { toast.error("Workspace inválido."); return; }
    const { error } = await supabase
      .from("workspace_claims")
      .insert({ workspace_id: _wsClaim, zone_id: zoneId, user_id: uid });
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

  const teleportToZone = useCallback((zoneId: ZoneId, label?: string, useSpawnPoint = false) => {
    if (!tierCapsRef.current.canTeleport) {
      toast.info("Teleporte está disponível a partir do Nível 2.");
      return;
    }
    const z = findZoneById(zoneId);
    if (!z) return;
    // If already inside the target zone, do nothing.
    const currentZone = zoneAt(posRef.current);
    if (currentZone.id === zoneId) {
      toast.info(`Você já está em ${label ?? z.label}.`);
      return;
    }
    const rect = zoneRectFromOverrides(zoneId) ?? z.rect;
    let target: Point;
    if (useSpawnPoint) {
      // Own workspace: land at the determined spawn point (or fixed seat).
      const spawn = spawnPointForZone(zoneId);
      target = spawn ?? seatPointForRect(rect);
    } else {
      // Shared rooms: random walkable point so people don't stack.
      const occupied: Point[] = Object.entries(positionsRef.current)
        .filter(([uid, p]) => uid !== meIdRef.current && p && p.zone === zoneId)
        .map(([, p]) => ({ x: p.x, y: p.y }));
      target = randomPointInRect(rect, occupied, 0.05);
    }
    const from = { ...posRef.current };


    // Cancel any pending auto-walk and clear stale timers
    autoWalkRef.current = null;
    teleportTimers.current.forEach((t) => window.clearTimeout(t));
    teleportTimers.current = [];

    const id = Date.now();
    setTeleport({ from, to: target, phase: "out", id });

    // Tell peers immediately so they see the sparkle/fade at the origin,
    // BEFORE the position snaps. Without this, remote viewers only see the
    // avatar slide between points.
    const uid = meIdRef.current;
    const ch = positionBroadcastChannelRef.current;
    if (uid && ch && positionBroadcastReadyRef.current) {
      void ch.send({
        type: "broadcast",
        event: "teleport",
        payload: { user_id: uid, from, to: target },
      });
    }

    // Phase 1: fade out + sparkle at origin
    teleportTimers.current.push(
      window.setTimeout(() => {
        // Snap to destination
        posRef.current = target;
        setPos(target);
        const z2 = zoneAt(target);
        setZone(z2.id);
        sendPos(target.x, target.y, z2.id, facingRef.current, true);
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
    teleportToZone(myZone as ZoneId, undefined, true);
  }, [teleportToZone]);

  useEffect(() => {
    return () => {
      teleportTimers.current.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  // ===== Follow / Lead (Seguir / Pedir para conduzir) =====
  // followingUid: when set, my avatar auto-walks behind this user until I press
  // a movement key (or the other side cancels).
  const [followingUid, setFollowingUid] = useState<string | null>(null);
  const followingUidRef = useRef<string | null>(null);
  useEffect(() => { followingUidRef.current = followingUid; }, [followingUid]);
  const profilesRef = useRef<Record<string, Profile>>({});
  profilesRef.current = profiles;
  const leadChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const [hoveredAvatarUid, setHoveredAvatarUid] = useState<string | null>(null);
  const [avatarMenuUid, setAvatarMenuUid] = useState<string | null>(null);

  const broadcastFollowStop = useCallback((toUid: string) => {
    const ch = leadChannelRef.current;
    const from = meIdRef.current;
    if (!ch || !from || !toUid) return;
    void ch.send({ type: "broadcast", event: "follow-stop", payload: { from, to: toUid } });
  }, []);

  const stopFollowing = useCallback((notify = true) => {
    const cur = followingUidRef.current;
    if (!cur) return;
    if (notify) broadcastFollowStop(cur);
    followingUidRef.current = null;
    setFollowingUid(null);
    autoWalkRef.current = null;
  }, [broadcastFollowStop]);

  const startFollowing = useCallback((uid: string) => {
    if (!uid || uid === meIdRef.current) return;
    followingUidRef.current = uid;
    setFollowingUid(uid);
    const name = profilesRef.current[uid]?.display_name ?? "personagem";
    toast.success(`Seguindo ${name}. Pressione qualquer direção para parar.`);
  }, []);

  const requestLead = useCallback((uid: string) => {
    const ch = leadChannelRef.current;
    const from = meIdRef.current;
    if (!ch || !from) { toast.error("Conexão indisponível."); return; }
    const fromName = profilesRef.current[from]?.display_name ?? "Alguém";
    void ch.send({ type: "broadcast", event: "lead-request", payload: { from, to: uid, fromName } });
    const target = profilesRef.current[uid]?.display_name ?? "personagem";
    toast.info(`Pedido enviado a ${target}. Aguardando resposta...`);
  }, []);

  const acceptLead = useCallback((fromUid: string) => {
    const ch = leadChannelRef.current;
    const me = meIdRef.current;
    if (!ch || !me) return;
    void ch.send({ type: "broadcast", event: "lead-accept", payload: { from: me, to: fromUid } });
    // Requester is the leader → I (receiver) will follow them
    startFollowing(fromUid);
  }, [startFollowing]);

  const declineLead = useCallback((fromUid: string) => {
    const ch = leadChannelRef.current;
    const me = meIdRef.current;
    if (!ch || !me) return;
    void ch.send({ type: "broadcast", event: "lead-decline", payload: { from: me, to: fromUid } });
  }, []);

  // Lead channel — separate from positions so we can subscribe independently
  // once we know our user id (the broadcast handlers need stable closures).
  useEffect(() => {
    const uid = me?.id;
    if (!uid) return;
    const ch = supabase
      .channel(`lead-events`, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "lead-request" }, ({ payload }) => {
        const p = payload as { from?: string; to?: string; fromName?: string };
        if (!p?.from || p.to !== uid) return;
        const from = p.from;
        toast(`${p.fromName ?? "Alguém"} pediu para te conduzir`, {
          description: "Aceite para seguir essa pessoa até onde ela for.",
          duration: 20000,
          action: { label: "Aceitar", onClick: () => acceptLead(from) },
          cancel: { label: "Recusar", onClick: () => declineLead(from) },
        });
      })
      .on("broadcast", { event: "lead-accept" }, ({ payload }) => {
        const p = payload as { from?: string; to?: string };
        if (!p?.from || p.to !== uid) return;
        const name = profilesRef.current[p.from]?.display_name ?? "Alguém";
        toast.success(`${name} aceitou! Pode começar a andar — ${name} vai te seguir.`);
      })
      .on("broadcast", { event: "lead-decline" }, ({ payload }) => {
        const p = payload as { from?: string; to?: string };
        if (!p?.from || p.to !== uid) return;
        toast.info("Pedido recusado.");
      })
      .on("broadcast", { event: "follow-stop" }, ({ payload }) => {
        const p = payload as { from?: string; to?: string };
        if (!p?.from || p.to !== uid) return;
        const name = profilesRef.current[p.from]?.display_name ?? "Alguém";
        toast.info(`${name} parou de te seguir.`);
      })
      .subscribe();
    leadChannelRef.current = ch;
    return () => {
      supabase.removeChannel(ch);
      if (leadChannelRef.current === ch) leadChannelRef.current = null;
    };
  }, [me?.id, acceptLead, declineLead]);

  // Close avatar menu on outside click / Esc
  useEffect(() => {
    if (!avatarMenuUid) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || !t.closest("[data-avatar-menu]")) setAvatarMenuUid(null);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setAvatarMenuUid(null); };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onEsc);
    };
  }, [avatarMenuUid]);






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
      // Manual movement cancels auto-walk and any active follow
      autoWalkRef.current = null;
      if (followingUidRef.current) stopFollowing(true);
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
      // Quando o usuário para de andar (nenhuma tecla pressionada), persiste
      // a posição final IMEDIATAMENTE no banco. Isso garante que ao recarregar
      // a página o personagem volte exatamente onde parou — sem cair no spawn.
      if (keysDown.current.size === 0) {
        const cur = posRef.current;
        sendPos(cur.x, cur.y, zoneAt(cur).id, facingRef.current, true);
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
  }, [setLocalFacing, sendReaction, teleportToMyClaim, sendPos]);

  // movement + animation loop
  useEffect(() => {
    let raf = 0;
    let lastT = 0;
    const tick = (t: number) => {
      // Delta-time: torna a velocidade independente do FPS. Quando a aba
      // perde frames, o passo cresce proporcionalmente para que o
      // personagem continue parecendo fluido em vez de "arrastado".
      const dtMs = lastT ? t - lastT : 16.667;
      lastT = t;
      const stepFactor = dtMs / 16.667;

      let dir = lastDir.current;

      // Follow: keep autoWalk pointing at the leader as they move.
      if (!dir && followingUidRef.current) {
        const tgt = positionsRef.current[followingUidRef.current];
        if (!tgt || !tgt.is_online) {
          followingUidRef.current = null;
          setFollowingUid(null);
          autoWalkRef.current = null;
        } else {
          const cur = posRef.current;
          const d = Math.hypot(tgt.x - cur.x, tgt.y - cur.y);
          if (d > 0.06) autoWalkRef.current = { x: tgt.x, y: tgt.y };
          else autoWalkRef.current = null;
        }
      }

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
          sendPos(cur.x, cur.y, z.id, facingRef.current, true);
        } else {
          // Prefer the larger axis; if blocked, fall back to the other.
          const primary: Facing = adx >= ady
            ? (dx > 0 ? "right" : "left")
            : (dy > 0 ? "down" : "up");
          const secondary: Facing = adx >= ady
            ? (dy > 0 ? "down" : "up")
            : (dx > 0 ? "right" : "left");
          if (facingRef.current !== primary) setLocalFacing(primary);
          if (tryMove(primary, stepFactor)) {
            dir = primary;
          } else {
            if (facingRef.current !== secondary) setLocalFacing(secondary);
            if (tryMove(secondary, stepFactor)) {
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
        const moved = isManual ? tryMove(dir, stepFactor) : true;
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
        sendPos(cur.x, cur.y, z.id, facingRef.current, true);
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

  // Histórico "Minhas reuniões" — registra entrada/saída quando o usuário
  // está numa sala de reunião (supportsVideo) com pelo menos 1 outro peer.
  const { activeMeetingId } = useMeetingTracker({
    zoneId: currentZone.id,
    zoneLabel: currentZone.label,
    isMeetingZone: !!currentZone.supportsVideo,
    peerCount: rtc.connectedPeers.length,
    enabled: !!me?.id,
  });

  // Gravação manual (botão). Mixa mic + áudio dos peers e envia ao storage.
  const recorder = useMeetingRecorder({
    getLocalAudioTrack: rtc.getLocalAudioTrack,
    remoteStreams: rtc.remoteStreams,
  });





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




  // Re-evaluate "is fresh" periodically — a peer that died without cleanup
  // keeps is_online=true in DB but stops heartbeating; we treat anyone whose
  // freshest sample is older than STALE_MS as offline for rendering purposes.
  // NOTE: browsers throttle (or fully pause) setInterval in background tabs and
  // suspend timers when the OS sleeps, so a short window made idle peers vanish
  // for everyone after ~30s of inactivity. We rely on explicit cleanup
  // (sign-out, tab close via beforeunload, presence "leave") for real
  // disconnects, and use a very generous staleness threshold here only as a
  // safety net against truly dead sessions that never cleaned up.
  const STALE_MS = 24 * 60 * 60_000; // 24h
  const [staleTick, setStaleTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setStaleTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const onlineList = useMemo(() => {
    const now = Date.now();
    const myId = meIdRef.current;
    return Object.values(positions)
      .filter((p) => {
        if (!p.is_online) return false;
        if (p.user_id === myId) return true; // self is always fresh
        const tsBroadcast = p.ts ?? 0;
        const tsDb = p.updated_at ? new Date(p.updated_at).getTime() : 0;
        const fresh = Math.max(tsBroadcast, tsDb, positionFreshTs.current.get(p.user_id) ?? 0);
        return fresh > 0 && now - fresh < STALE_MS;
      })
      .map((p) => ({ pos: p, profile: profiles[p.user_id] }))
      .filter((x) => x.profile);
  }, [positions, profiles, staleTick]);

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
          if (placing) return;
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
          if (placing) {
            wasDragRef.current = false;
            return;
          }
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
          src={officeTheme.url}
          alt="Espaço Prestativa Virtual"
          className="absolute inset-0 w-full h-full object-cover select-none pointer-events-none"
          draggable={false}
          style={{ imageRendering: "pixelated" }}
        />

        {/* Elementos sobrepostos (mobília, portas etc.) */}
        <PropsLayer selfX={pos.x} selfY={pos.y} focusedRect={focusedZone?.rect ?? null} />




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

        {/* Bolhas de "conversa de corredor" — raio de alcance de voz/vídeo
            ao redor de cada personagem que NÃO está numa sala reivindicada.
            Mostra visualmente onde o microfone/câmera se conectam quando
            dois colegas se aproximam no corredor. */}
        {onlineList.map(({ pos: p, profile }) => {
          const isMe = me?.id === profile.id;
          const display = isMe ? pos : { x: p.x, y: p.y };
          const inClaim = Object.values(claims).includes(profile.id);
          const inRoom = (isMe ? zone : p.zone) !== "lobby";
          if (inClaim || inRoom) return null;
          // Diâmetro = 2 * raio de desconexão, em unidades de % do mapa.
          const diameter = PROXIMITY_DISCONNECT * 2 * 100;
          return (
            <div
              key={`chat-radius-${profile.id}`}
              className="absolute pointer-events-none"
              style={{
                left: `${display.x * 100}%`,
                top: `${display.y * 100}%`,
                width: `${diameter}%`,
                // Perspectiva isométrica → elipse achatada (~45% da largura).
                height: `${diameter * 0.45}%`,
                transform: "translate(-50%, -50%)",
                borderRadius: "50%",
                background:
                  "radial-gradient(ellipse at center, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.12) 55%, rgba(255,255,255,0) 100%)",
                border: "1px solid rgba(255,255,255,0.35)",
                boxShadow: "inset 0 0 24px rgba(255,255,255,0.15)",
                zIndex: Math.round(display.y * 1000) - 1,
                transition: isMe ? "none" : "left 120ms linear, top 120ms linear",
              }}
            />
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
          const remoteTp = !isMe ? remoteTeleports[profile.id] : null;
          const teleporting = myTeleporting || remoteTp;
          // While the "out" phase plays, render the avatar at the ORIGIN so the
          // sparkle is anchored there; on "in", render at destination. This
          // matches what the teleporter themself sees.
          const tpData = myTeleporting ? teleport! : remoteTp;
          const renderPoint = tpData
            ? (tpData.phase === "out" ? tpData.from : tpData.to)
            : display;
          const tpOpacity = tpData ? (tpData.phase === "out" ? 0 : 1) : 1;
          return (
            <div
              key={profile.id}
              className="absolute pointer-events-none"
              style={{
                left: `${renderPoint.x * 100}%`,
                top: `${renderPoint.y * 100}%`,
                transform: "translate(-50%, -90%)",
                transition: teleporting
                  ? "opacity 420ms ease-in-out, filter 420ms ease-in-out"
                  : isMe
                  ? "none"
                  : "left 120ms linear, top 120ms linear",
                zIndex: (focusedZone ? (inFocus ? 60000 : 20000) : 0) + Math.round(renderPoint.y * 1000),
                opacity: tpOpacity,
                filter: tpData
                  ? `drop-shadow(0 0 18px var(--primary)) drop-shadow(0 0 36px var(--primary-glow)) brightness(${tpData.phase === "out" ? 1.8 : 1.4})`
                  : "none",
              }}
            >
              <div className="flex flex-col items-center">
                {(isMe ? (rtc.micOn && rtc.selfSpeaking) : !!rtc.speakingPeers[profile.id]) && (
                  <SpeechBubble />
                )}
                <div
                  className="px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap mb-0.5 shadow-soft backdrop-blur-sm text-white"
                  style={{
                    background: profile.avatar_color,
                    border: isMe ? "none" : `1.5px solid ${profile.avatar_color}`,
                  }}
                >
                  {profile.display_name}
                </div>
                <div className="relative">
                  {/* Selection ring on the floor (perspective ellipse) for remote avatars */}
                  {!isMe && (hoveredAvatarUid === profile.id || avatarMenuUid === profile.id) && (
                    <div
                      className="absolute left-1/2 -translate-x-1/2 pointer-events-none"
                      style={{ bottom: -6, width: 56, height: 16, zIndex: 1 }}
                    >
                      <div
                        className="w-full h-full rounded-[50%] border-2"
                        style={{
                          borderColor: "var(--primary)",
                          boxShadow: "0 0 14px var(--primary), inset 0 0 8px color-mix(in oklab, var(--primary) 40%, transparent)",
                          animation: "pulse 1.4s ease-in-out infinite",
                        }}
                      />
                    </div>
                  )}
                  <div className="absolute left-1/2 -translate-x-1/4 -top-5 z-10 pointer-events-none">
                    <ReactionBubble emoji={reactions[profile.id]?.emoji ?? null} />
                  </div>
                  <SpriteAvatar
                    facing={isMe ? facing : (p.facing ?? "down")}
                    frame={isMe ? frame : (remoteFrames[profile.id] ?? 0)}
                    glowColor={isMe ? profile.avatar_color : undefined}
                    spriteId={profile.sprite_id}
                  />
                  {/* Hover/click hit-area for remote avatars (sits over the sprite) */}
                  {!isMe && (
                    <AvatarHitArea
                      profileId={profile.id}
                      displayName={profile.display_name}
                      isOpen={avatarMenuUid === profile.id}
                      onHoverIn={() => {
                        setHoveredAvatarUid(profile.id);
                        setHoveredZone(null);
                      }}
                      onHoverOut={() =>
                        setHoveredAvatarUid((c) => (c === profile.id ? null : c))
                      }
                      onToggle={() =>
                        setAvatarMenuUid((cur) => (cur === profile.id ? null : profile.id))
                      }
                      menu={
                        <AvatarInteractionMenu
                          profile={profile}
                          onClose={() => setAvatarMenuUid(null)}
                          onFollow={() => { startFollowing(profile.id); setAvatarMenuUid(null); }}
                          onLead={() => { requestLead(profile.id); setAvatarMenuUid(null); }}
                        />
                      }
                    />
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Magic teleport particles — local + every remote teleport in progress */}
        {teleport && (
          <TeleportFx
            point={teleport.phase === "out" ? teleport.from : teleport.to}
            phase={teleport.phase}
            key={`me-${teleport.id}-${teleport.phase}`}
          />
        )}
        {Object.entries(remoteTeleports).map(([uid, tp]) => (
          <TeleportFx
            key={`${uid}-${tp.id}-${tp.phase}`}
            point={tp.phase === "out" ? tp.from : tp.to}
            phase={tp.phase}
          />
        ))}


        {/* Desk notes (post-it gifts) sitting on workstations */}
        {notes.map((n) => {
          const isForMe = me?.id === n.recipient_id;
          const isMine = me?.id === n.sender_id;
          const sender = profiles[n.sender_id];
          const interactive = isForMe || isMine;
          const isSelected = selectedNoteId === n.id && isMine;
          const inMyZone = isForMe && zone === n.zone_id;
          return (
            <div
              key={n.id}
              className="absolute"
              style={{
                left: `${n.x * 100}%`,
                top: `${n.y * 100}%`,
                transform: "translate(-50%, -85%)",
                zIndex: Math.round(n.y * 1000) + 5,
                pointerEvents: interactive ? "auto" : "none",
              }}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (isForMe) setOpeningNote(n);
                  else if (isMine) setSelectedNoteId((cur) => (cur === n.id ? null : n.id));
                }}
                className="block"
                style={{ cursor: interactive ? "pointer" : "default" }}
                title={
                  isForMe
                    ? `Recadinho de ${sender?.display_name ?? "alguém"} — clique ou aperte X`
                    : isMine
                      ? "Seu recadinho — clique para cancelar"
                      : `Recadinho para ${profiles[n.recipient_id]?.display_name ?? ""}`
                }
              >
                <GiftSprite color={sender?.avatar_color} bounce={isForMe} />
              </button>

              {/* Overlay "Aperte X" para o destinatário quando está na mesma sala */}
              {inMyZone && (
                <div
                  className="absolute left-1/2 -translate-x-1/2 -top-7 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/70 backdrop-blur-sm text-[11px] text-white/90 shadow-lg whitespace-nowrap pointer-events-none"
                  style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif" }}
                >
                  <span className="opacity-80">Aperte</span>
                  <kbd className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded bg-white/15 border border-white/20 font-bold text-white text-[10px] leading-none">X</kbd>
                  <span className="opacity-80">para ler</span>
                </div>
              )}

              {/* Botão excluir para quem enviou */}
              {isSelected && (
                <button
                  type="button"
                  onClick={async (e) => {
                    e.stopPropagation();
                    const id = n.id;
                    const { error } = await supabase.from("desk_notes").delete().eq("id", id);
                    if (error) { toast.error("Não foi possível excluir."); return; }
                    setNotes((p) => p.filter((x) => x.id !== id));
                    setSelectedNoteId(null);
                    toast.success("Recadinho cancelado.");
                  }}
                  className="absolute left-1/2 -translate-x-1/2 -bottom-8 flex items-center gap-1 px-2 py-1 rounded-full bg-destructive text-destructive-foreground text-[11px] font-medium shadow-lg hover:opacity-90 whitespace-nowrap"
                >
                  🗑️ Cancelar recadinho
                </button>
              )}
            </div>
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
              const _wsNote = getCurrentWorkspaceId();
              if (!_wsNote) { toast.error("Workspace inválido."); return; }
              const { error } = await supabase.from("desk_notes").insert({
                workspace_id: _wsNote,
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
              zIndex: 200002,
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
          participants={(() => {
            const list: Array<{
              id: string;
              profile: { id: string; display_name: string; avatar_color: string };
              stream: MediaStream | null;
              hasVideo: boolean;
              micOn: boolean;
              speaking: boolean;
              isSelf?: boolean;
            }> = [];
            const hasLive = (s: MediaStream | null) =>
              !!s && s.getVideoTracks().some((t) => t.enabled && t.readyState === "live" && !t.muted);
            if (me) {
              list.push({
                id: me.id,
                profile: { id: me.id, display_name: me.display_name, avatar_color: me.avatar_color },
                stream: rtc.localVideoStream,
                hasVideo: rtc.camOn && hasLive(rtc.localVideoStream),
                micOn: rtc.micOn,
                speaking: false,
                isSelf: true,
              });
            }
            for (const peerId of rtc.connectedPeers) {
              const p = profiles[peerId] ?? { id: peerId, display_name: "Convidado", avatar_color: "#475569" };
              const stream = rtc.remoteStreams[peerId] ?? null;
              list.push({
                id: peerId,
                profile: p,
                stream,
                hasVideo: hasLive(stream),
                micOn: true,
                speaking: !!rtc.speakingPeers[peerId],
              });
            }
            return list;
          })()}
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
        onOpenChange={(o) => { if (!o) setOpeningNote(null); }}
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
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setOpeningNote(null)}
            >
              Fechar
            </Button>
            <Button
              className="bg-emerald-500 hover:bg-emerald-600 text-white"
              onClick={async () => {
                if (!openingNote || !me) return;
                const note = openingNote;
                const senderName = profiles[note.sender_id]?.display_name ?? null;
                const { error: saveErr } = await supabase.from("saved_notes").insert({
                  user_id: me.id,
                  sender_id: note.sender_id,
                  sender_name: senderName,
                  body: note.body,
                  original_created_at: note.created_at,
                });
                if (saveErr) { toast.error("Não foi possível guardar."); return; }
                await supabase.from("desk_notes").update({ read_at: new Date().toISOString() }).eq("id", note.id);
                setNotes((prev) => prev.filter((n) => n.id !== note.id));
                setOpeningNote(null);
                toast.success("💛 Recadinho guardado no seu perfil (30 dias).");
              }}
            >
              Guardar recadinho
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {me && (
        <SavedNotesDialog
          open={savedNotesOpen}
          onOpenChange={setSavedNotesOpen}
          userId={me.id}
        />
      )}




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
        myId={me?.id ?? null}
        myProfile={me ? { id: me.id, display_name: me.display_name, avatar_color: me.avatar_color } : null}
        localStream={rtc.localVideoStream}
        localCamOn={rtc.camOn}
        localMicOn={rtc.micOn}
        selfSpeaking={rtc.selfSpeaking}
        streams={rtc.remoteStreams}
        profiles={profiles}
        speakingPeers={rtc.speakingPeers}
        connectedPeers={rtc.connectedPeers}
        raisedHands={raisedHands}
      />

      {/* HUD de atalhos de reunião — aparece ao entrar numa call e ao usar um atalho */}
      {rtc.connectedPeers.length > 0 && (
        <div
          className={`absolute bottom-3 left-1/2 -translate-x-1/2 z-[110] pointer-events-none transition-all duration-300 ${
            shortcutsHudVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
          }`}
        >
          <div
            className="flex items-center gap-3 px-3 py-1.5 rounded-full text-[11px] text-white/90 backdrop-blur-md shadow-lg"
            style={{
              background: "color-mix(in oklab, #0b0f1a 78%, transparent)",
              border: "1px solid color-mix(in oklab, #ffffff 14%, transparent)",
            }}
          >
            <span className="inline-flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 rounded bg-white/10 font-mono text-[10px]">Alt+M</kbd>
              mic
            </span>
            <span className="w-px h-3 bg-white/15" />
            <span className="inline-flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 rounded bg-white/10 font-mono text-[10px]">Alt+V</kbd>
              câmera
            </span>
            <span className="w-px h-3 bg-white/15" />
            <span className="inline-flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 rounded bg-white/10 font-mono text-[10px]">Alt+H</kbd>
              levantar a mão
            </span>
          </div>
        </div>
      )}





      {/* Topbar — slim, sticky, sophisticated */}
      <div className="absolute top-0 left-0 right-0 pointer-events-none z-[100]">
        <div
          className="pointer-events-auto flex items-center justify-between h-11 pl-3 pr-2 backdrop-blur-xl"
          style={{
            background:
              "linear-gradient(180deg, color-mix(in oklab, var(--card) 78%, transparent) 0%, color-mix(in oklab, var(--card) 60%, transparent) 100%)",
            borderBottom: "1px solid color-mix(in oklab, var(--border) 70%, transparent)",
            boxShadow: "0 1px 0 0 color-mix(in oklab, var(--foreground) 4%, transparent), 0 8px 24px -16px color-mix(in oklab, var(--foreground) 25%, transparent)",
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <img
              src={prestativaIcon.url}
              alt="Prestativa"
              className="w-6 h-6 rounded-md object-contain"
              draggable={false}
            />
            <div className="flex items-baseline gap-1.5 min-w-0">
              <span className="text-[13px] font-semibold tracking-tight text-foreground">Prestativa</span>
              <span className="text-[11px] text-muted-foreground font-medium hidden sm:inline">Virtual Office</span>
            </div>
            <span className="hidden md:inline mx-2 h-4 w-px bg-border/80" aria-hidden />
            <span className="hidden md:inline text-[11px] text-muted-foreground truncate">
              {currentZone.label}
            </span>
          </div>

          <div className="flex items-center gap-1">
            {rtc.connectedPeers.length > 0 && (
              <div className="text-[11px] text-muted-foreground px-2 hidden sm:flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_var(--color-emerald-500,#10b981)]" />
                Em chamada com {rtc.connectedPeers.length}
              </div>
            )}
            <div className="flex items-center">
              <IconButton
                active={rtc.micOn}
                onClick={() => {
                  void unlockAudioPlayback();
                  rtc.toggleMic().catch(() => toast.error("Não foi possível acessar o microfone"));
                }}
                title={rtc.micOn ? "Desligar microfone (Alt+M)" : "Ligar microfone (Alt+M)"}
              >
                {rtc.micOn ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
              </IconButton>
              <DeviceMenu
                title="Configurações de áudio"
                sections={[
                  {
                    label: "Microfone",
                    devices: rtc.audioInputDevices,
                    selectedId: rtc.selectedAudioInputDeviceId,
                    onSelect: (id) =>
                      rtc.setAudioInputDevice(id).catch(() => toast.error("Falha ao trocar microfone")),
                    fallbackLabel: "Microfone do sistema",
                  },
                  {
                    label: "Caixas de som",
                    devices: rtc.audioOutputDevices,
                    selectedId: rtc.selectedAudioOutputDeviceId,
                    onSelect: (id) =>
                      rtc.setAudioOutputDevice(id).catch(() => toast.error("Falha ao trocar saída de áudio")),
                    fallbackLabel: "Saída padrão",
                  },
                ]}
              />
            </div>
            <div className="flex items-center">
              <IconButton
                active={rtc.camOn}
                onClick={() => {
                  void unlockAudioPlayback();
                  rtc.toggleCam().catch(() => toast.error("Não foi possível acessar a câmera"));
                }}
                title={rtc.camOn ? "Desligar câmera (Alt+V)" : "Ligar câmera (Alt+V)"}
              >
                {rtc.camOn ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
              </IconButton>
              <DeviceMenu
                title="Configurações de câmera"
                sections={[
                  {
                    label: "Câmera",
                    devices: rtc.videoDevices,
                    selectedId: rtc.selectedVideoDeviceId,
                    onSelect: (id) =>
                      rtc.setVideoDevice(id).catch(() => toast.error("Falha ao trocar câmera")),
                    fallbackLabel: "Câmera do sistema",
                  },
                ]}
              />
            </div>
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
            <IconButton
              active={!!(me && raisedHands[me.id])}
              onClick={toggleRaiseHand}
              title={me && raisedHands[me.id] ? "Abaixar a mão (Alt+H)" : "Levantar a mão (Alt+H)"}
            >
              <Hand className="w-4 h-4" />
            </IconButton>

            {/* Botão de gravação — aparece em qualquer sala de reunião (mesmo sozinho).
                Se não houver reunião ativa ainda, criamos sob demanda via meeting_join. */}
            {!!currentZone.supportsVideo && tierCaps.canRecordMeetings && (
              <button
                onClick={async () => {
                  if (recorder.isUploading) return;
                  if (recorder.isRecording) {
                    void recorder.stop();
                    return;
                  }
                  let meetingId = activeMeetingId;
                  if (!meetingId) {
                    try {
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      const _wsJoin = getCurrentWorkspaceId();
                      if (!_wsJoin) throw new Error("workspace não encontrado");
                      const { data, error } = await (supabase as any).rpc("meeting_join", {
                        _workspace_id: _wsJoin,
                        _zone_id: currentZone.id,
                        _zone_label: currentZone.label,
                      });
                      if (error || !data) throw error ?? new Error("no meeting id");
                      meetingId = data as string;
                    } catch (err) {
                      console.error("[rec] failed to ensure meeting:", err);
                      toast.error("Não foi possível iniciar a gravação.");
                      return;
                    }
                  }
                  void recorder.start(meetingId);
                }}
                disabled={recorder.isUploading}
                title={
                  recorder.isUploading
                    ? "Enviando gravação…"
                    : recorder.isRecording
                    ? `Parar gravação (${formatRecTime(recorder.elapsedSeconds)})`
                    : "Gravar reunião"
                }
                className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium transition ${
                  recorder.isRecording
                    ? "bg-red-500/15 text-red-600 hover:bg-red-500/25 ring-1 ring-red-500/40"
                    : "text-foreground/70 hover:text-foreground hover:bg-foreground/10"
                } disabled:opacity-60 disabled:cursor-not-allowed`}
              >
                {recorder.isUploading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span className="hidden md:inline">Enviando…</span>
                  </>
                ) : recorder.isRecording ? (
                  <>
                    <Square className="w-3 h-3 fill-current" />
                    <span className="font-mono tabular-nums">
                      {formatRecTime(recorder.elapsedSeconds)}
                    </span>
                  </>
                ) : (
                  <>
                    <Circle className="w-3 h-3 fill-red-500 text-red-500" />
                    <span className="hidden md:inline">Gravar</span>
                  </>
                )}
              </button>
            )}



            <IconButton active={showTeam} onClick={() => setShowTeam(!showTeam)} title="Equipe">
              <Users className="w-4 h-4" />
            </IconButton>
            <Link
              to="/office/editor"
              title="Editor de mapa"
              className="inline-flex items-center justify-center w-8 h-8 rounded-md text-foreground/70 hover:text-foreground hover:bg-foreground/10 transition"
            >
              <Pencil className="w-4 h-4" />
            </Link>
            {me && (
              <ProfileMenu
                me={me}
                email={myEmail}
                hasClaim={Object.values(claims).includes(me.id)}
                onEditCharacter={() => setEditCharOpen(true)}
                canEditCharacter={tierCaps.canChangeSprite}
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
                onOpenSavedNotes={() => setSavedNotesOpen(true)}
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
            initial={{
              display_name: me.display_name,
              avatar_color: me.avatar_color,
              tagline: me.tagline ?? null,
              first_name: me.first_name ?? null,
              last_name: me.last_name ?? null,
              birth_date: me.birth_date ?? null,
              city: me.city ?? null,
              state: me.state ?? null,
              country_code: me.country_code ?? null,
            }}

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
              // Centraliza dentro do retângulo do espaço — assim o mouse
              // que está sobre a mesa já está sobre o botão (sem "gap" que
              // faz o hover sumir antes de alcançar).
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



/**
 * Hit-area + portal anchor para o sprite remoto. O menu é renderizado via
 * portal no body, posicionado dinamicamente sobre o sprite (clamp na viewport)
 * pra nunca ficar fora da tela e estar sempre acima do card da mesa.
 */
function AvatarHitArea({
  profileId,
  displayName,
  isOpen,
  onHoverIn,
  onHoverOut,
  onToggle,
  menu,
}: {
  profileId: string;
  displayName: string;
  isOpen: boolean;
  onHoverIn: () => void;
  onHoverOut: () => void;
  onToggle: () => void;
  menu: React.ReactNode;
}) {
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let raf = 0;
    const tick = () => {
      const el = anchorRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        const menuW = 240;
        const menuH = 180;
        const margin = 8;
        // âncora: direita do sprite, alinhado pelo topo
        let left = r.right + 12;
        let top = r.top - 8;
        if (left + menuW > window.innerWidth - margin) {
          // não cabe à direita → tenta à esquerda
          left = r.left - menuW - 12;
        }
        if (left < margin) left = margin;
        if (top + menuH > window.innerHeight - margin) {
          top = window.innerHeight - menuH - margin;
        }
        if (top < margin) top = margin;
        setPos({ left, top });
      }
      raf = window.requestAnimationFrame(tick);
    };
    tick();
    return () => window.cancelAnimationFrame(raf);
  }, [isOpen]);

  // Fecha ao clicar fora
  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest("[data-avatar-menu]")) return;
      onToggle();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [isOpen, onToggle]);

  return (
    <>
      <button
        type="button"
        ref={anchorRef}
        data-avatar-menu
        className="absolute left-1/2 -translate-x-1/2 pointer-events-auto"
        style={{
          bottom: 0,
          width: 80,
          height: 130,
          cursor: "pointer",
          zIndex: 2_000_000_000,
          background: "transparent",
          border: 0,
          padding: 0,
        }}
        onMouseEnter={onHoverIn}
        onMouseLeave={onHoverOut}
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
        onMouseDown={(e) => {
          e.stopPropagation();
        }}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        aria-label={`Interagir com ${displayName}`}
        title={`Interagir com ${displayName}`}
      />
      {isOpen && pos && typeof document !== "undefined" &&
        createPortal(
          <div
            data-avatar-menu
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top,
              zIndex: 2147483647,
              pointerEvents: "auto",
            }}
          >
            {menu}
          </div>,
          document.body,
        )}
    </>
  );
}

/** Menu derivado do personagem (portalado pelo AvatarHitArea). */
function AvatarInteractionMenu({
  profile,
  onClose,
  onFollow,
  onLead,
}: {
  profile: Profile;
  onClose: () => void;
  onFollow: () => void;
  onLead: () => void;
}) {
  return (
    <div
      data-avatar-menu
      className="w-60 rounded-xl bg-popover text-popover-foreground shadow-2xl border"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b">
        <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
        <div className="text-sm font-semibold truncate" style={{ color: profile.avatar_color }}>
          {profile.display_name}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto p-1 rounded hover:bg-muted text-muted-foreground"
          aria-label="Fechar"
        >
          <XIcon className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="p-1">
        <button
          type="button"
          onClick={() => {
            const bits = [profile.tagline, profile.status].filter(Boolean).join(" • ");
            toast(profile.display_name, { description: bits || "Perfil sem descrição." });
            onClose();
          }}
          className="w-full flex items-center gap-2 px-2 py-2 text-sm rounded hover:bg-muted text-left"
        >
          <UserIcon className="w-4 h-4" /> Ver perfil
        </button>
        <button
          type="button"
          onClick={onFollow}
          className="w-full flex items-center gap-2 px-2 py-2 text-sm rounded hover:bg-muted text-left"
        >
          <Footprints className="w-4 h-4" /> Seguir
        </button>
        <button
          type="button"
          onClick={onLead}
          className="w-full flex items-center gap-2 px-2 py-2 text-sm rounded hover:bg-muted text-left"
        >
          <UserPlus className="w-4 h-4" /> Pedir para conduzir
        </button>
      </div>
    </div>
  );
}

function SpriteAvatar({
  facing,
  frame,
  spriteId,
}: {
  facing: Facing;
  frame: number;
  glowColor?: string;
  spriteId?: string | null;
}) {
  return (
    <AlignedSprite
      spriteId={spriteId}
      facing={facing}
      frame={frame}
      mode="scene"
    />
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

function SpeechBubble() {
  return (
    <div
      className="relative mb-1 select-none pointer-events-none animate-in fade-in zoom-in-95 duration-200"
      style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.25))" }}
      aria-label="Conversando"
    >
      <div
        className="flex flex-col justify-center gap-[3px] bg-[#efeae0] rounded-[10px] px-2"
        style={{ width: 32, height: 22 }}
      >
        <span className="block h-[2px] rounded-full bg-[#7a7165]" style={{ width: "85%", animation: "speech-line 1.1s ease-in-out infinite" }} />
        <span className="block h-[2px] rounded-full bg-[#7a7165]" style={{ width: "60%", animation: "speech-line 1.1s ease-in-out infinite 0.25s" }} />
      </div>
      <div
        className="absolute left-1/2 -bottom-[3px] w-0 h-0"
        style={{
          transform: "translateX(-60%)",
          borderLeft: "4px solid transparent",
          borderRight: "4px solid transparent",
          borderTop: "5px solid #efeae0",
        }}
      />
      <style>{`@keyframes speech-line { 0%,100% { opacity: 0.45; } 50% { opacity: 1; } }`}</style>
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
      className={`w-8 h-8 rounded-md flex items-center justify-center transition ${
        active
          ? "bg-primary text-primary-foreground shadow-[0_0_0_1px_color-mix(in_oklab,var(--primary)_50%,transparent)]"
          : "text-foreground/75 hover:text-foreground hover:bg-foreground/10"
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
        style={{ zIndex: 200000, cursor: "crosshair", background: "rgba(0,0,0,0.18)" }}
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
            zIndex: 200001,
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
        className="absolute left-1/2 -translate-x-1/2 bottom-6 z-[200003] flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold bg-white text-foreground shadow-soft hover:bg-white/90"
      >
        <XIcon className="w-4 h-4" /> Cancelar (Esc)
      </button>
    </>
  );
}

function formatRecTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
