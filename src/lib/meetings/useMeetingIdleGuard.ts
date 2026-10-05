/**
 * Meeting Inactivity Guard — cola React. Só observa estados existentes (Room,
 * speaking, Movement, screen share) e fala por um canal Broadcast efêmero
 * `workspace:{id}:meeting-idle` (zoneId vai no payload). Sem Postgres, sem
 * polling, sem heartbeat. Nunca chama connect/disconnect: o eject só move o
 * MEU avatar (onEject) e o RTC On Demand decide o resto.
 */
import { useEffect, useRef, useState } from "react";
import {
  MeetingInactivityController,
  parseMeetingIdleMode,
  type MeetingIdleEvent,
  type MeetingIdleMode,
  type MeetingIdleSnapshot,
} from "./meeting-inactivity-controller";
import type { RemoteAvatarState } from "@/lib/rtc/movement-realtime";
import type { RtcTelemetrySink, RtcTelemetryEventType } from "@/lib/rtc/rtc-telemetry-types";
import { emitTelemetry } from "@/lib/rtc/rtc-telemetry-types";
import type { OfficeNotificationService } from "@/lib/notifications/notification-service";

export const MEETING_IDLE_MODE: MeetingIdleMode = parseMeetingIdleMode(
  import.meta.env.VITE_MEETING_IDLE_GUARD,
);
export const MEETING_IDLE_EVENT = "meeting-idle";
export const meetingIdleTopic = (workspaceId: string) => `workspace:${workspaceId}:meeting-idle`;

export interface MeetingIdleGuardArgs {
  enabled: boolean;
  selfId: string | null;
  workspaceId: string | null;
  privateZoneId: string | null;
  privateConnected: boolean;
  remoteIdentities: readonly string[];
  speaking: Record<string, boolean>;
  selfSpeaking: boolean;
  screenShareActive: boolean;
  avatars: ReadonlyMap<string, RemoteAvatarState> | null;
  /** Muda quando EU me movo (ex.: `${x},${y}`). */
  selfMotionKey: string;
  telemetry: RtcTelemetrySink | null;
  notifications: OfficeNotificationService | null;
  playSound: () => void;
  onEject: (zoneId: string) => void;
}

export function useMeetingIdleGuard(a: MeetingIdleGuardArgs) {
  const [snap, setSnap] = useState<MeetingIdleSnapshot | null>(null);
  const ctrlRef = useRef<MeetingInactivityController | null>(null);
  const sendRef = useRef<(e: MeetingIdleEvent) => void>(() => {});
  const argsRef = useRef(a);
  argsRef.current = a;
  const active = MEETING_IDLE_MODE !== "off" && a.enabled && !!a.selfId && !!a.workspaceId;

  // Canal efêmero (só existe enquanto a flag está ligada e há sessão).
  useEffect(() => {
    if (!active || !a.workspaceId) return;
    let channel: { send: (m: unknown) => unknown } | null = null;
    let remove: (() => void) | null = null;
    let alive = true;
    void import("@/integrations/supabase/client").then(({ supabase }) => {
      if (!alive) return;
      const ch = supabase.channel(meetingIdleTopic(a.workspaceId!), {
        config: { private: true, broadcast: { self: false, ack: false } },
      });
      ch.on("broadcast", { event: MEETING_IDLE_EVENT }, ({ payload }) => {
        const e = payload as MeetingIdleEvent;
        if (e && typeof e === "object" && typeof e.type === "string") ctrlRef.current?.receive(e);
      });
      ch.subscribe();
      channel = ch;
      remove = () => void supabase.removeChannel(ch);
    });
    sendRef.current = (e) => {
      void channel?.send({ type: "broadcast", event: MEETING_IDLE_EVENT, payload: e });
    };
    return () => {
      alive = false;
      sendRef.current = () => {};
      remove?.();
    };
  }, [active, a.workspaceId]);

  // Controlador (um por usuário).
  useEffect(() => {
    if (!active || !a.selfId) return;
    const c = new MeetingInactivityController({
      mode: MEETING_IDLE_MODE,
      selfId: a.selfId,
      send: (e) => sendRef.current(e),
      onChange: setSnap,
      onEject: (zone) => argsRef.current.onEject(zone),
      onWarning: () => {
        const r = argsRef.current;
        try {
          r.playSound();
        } catch {
          /* noop */
        }
        const svc = r.notifications;
        if (svc && svc.isAppHidden() && svc.isOptedIn() && svc.getPermission() === "granted") {
          svc.notify({
            title: "Prestativa Office",
            body: "A reunião parece inativa. Abra o Office para continuar.",
            tag: "meeting-idle",
            onClick: () => svc.focusApp(),
          });
        }
      },
      telemetry: (type, meta) => {
        const { zoneId, ...metadata } = meta as { zoneId?: string | null };
        emitTelemetry(argsRef.current.telemetry, type as RtcTelemetryEventType, {
          zoneId: zoneId ?? null,
          metadata,
        });
      },
    });
    ctrlRef.current = c;
    const onVis = () => c.tick();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      c.dispose();
      ctrlRef.current = null;
      setSnap(null);
    };
  }, [active, a.selfId]);

  // Elegibilidade/roster/screen share.
  const rosterKey = [...a.remoteIdentities].sort().join("|");
  useEffect(() => {
    const c = ctrlRef.current;
    if (!c || !a.selfId) return;
    c.update({
      privateConnected: a.privateConnected,
      zoneId: a.privateZoneId,
      participants: [a.selfId, ...a.remoteIdentities],
      screenShareActive: a.screenShareActive,
    });
  }, [snap === null, a.selfId, a.privateConnected, a.privateZoneId, rosterKey, a.screenShareActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fala (speaking do LiveKit; nunca áudio bruto).
  useEffect(() => {
    const c = ctrlRef.current;
    if (!c || !a.selfId) return;
    c.speaking(a.selfId, a.selfSpeaking);
    for (const id of a.remoteIdentities) c.speaking(id, !!a.speaking[id]);
  }, [a.speaking, a.selfSpeaking, rosterKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Movimento remoto: seq avança em MOTION_START/CHANGE/POSITION_SYNC.
  const seqRef = useRef(new Map<string, number>());
  useEffect(() => {
    const c = ctrlRef.current;
    if (!c || !a.avatars) return;
    const ids = new Set(a.remoteIdentities);
    for (const [uid, av] of a.avatars) {
      const prev = seqRef.current.get(uid);
      seqRef.current.set(uid, av.seq);
      if (prev !== undefined && av.seq !== prev && ids.has(uid) && (av.moving || av.vx || av.vy))
        c.movement(uid);
    }
  }, [a.avatars, rosterKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Meu movimento.
  const firstMotion = useRef(true);
  useEffect(() => {
    if (firstMotion.current) {
      firstMotion.current = false;
      return;
    }
    if (a.selfId) ctrlRef.current?.movement(a.selfId);
  }, [a.selfMotionKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    mode: MEETING_IDLE_MODE,
    warning: snap?.state === "WARNING" && snap.deadlineAt ? { deadlineAt: snap.deadlineAt } : null,
    continueMeeting: () => ctrlRef.current?.continueClicked(),
  };
}
