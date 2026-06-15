import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteParticipant,
  type LocalTrackPublication,
  type Participant,
} from "livekit-client";
import { getLiveKitAccess } from "./livekit.functions";

export type RtcMeshState = {
  micOn: boolean;
  camOn: boolean;
  screenOn: boolean;
  toggleMic: () => Promise<void>;
  toggleCam: () => Promise<void>;
  toggleScreen: () => Promise<void>;
  remoteStreams: Record<string, MediaStream>;
  remoteScreenStreams: Record<string, MediaStream>;
  connectedPeers: string[];
  speakingPeers: Record<string, boolean>;
  selfSpeaking: boolean;
  localVideoStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  videoDevices: MediaDeviceInfo[];
  selectedVideoDeviceId: string | null;
  setVideoDevice: (deviceId: string) => Promise<void>;
  audioInputDevices: MediaDeviceInfo[];
  selectedAudioInputDeviceId: string | null;
  setAudioInputDevice: (deviceId: string) => Promise<void>;
  audioOutputDevices: MediaDeviceInfo[];
  selectedAudioOutputDeviceId: string | null;
  setAudioOutputDevice: (deviceId: string) => Promise<void>;
  prewarmMic: () => Promise<void>;
  getLocalAudioTrack: () => MediaStreamTrack | null;
};

function makeStream(track: MediaStreamTrack): MediaStream {
  const s = new MediaStream();
  s.addTrack(track);
  return s;
}

export function useLiveKit(
  myId: string | null,
  roomKey: string | null,
  /**
   * Conjunto de userIds cujo vídeo de câmera DEVE ser assinado. Quando
   * `null`/`undefined`, todos os vídeos são assinados (comportamento legado).
   * Compartilhamento de tela ignora esse filtro (sempre assinado).
   * Áudio também ignora esse filtro — a chamada permanece audível.
   *
   * Quando a aba fica oculta (`document.hidden`), todo vídeo é desinscrito
   * automaticamente; ao voltar, re-aplica o filtro. Isso evita decodificação
   * de N vídeos em background, principal causa de "computador lento".
   */
  videoVisibleIds?: ReadonlySet<string> | null,
): RtcMeshState {
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [remoteScreenStreams, setRemoteScreenStreams] = useState<Record<string, MediaStream>>({});
  const [connectedPeers, setConnectedPeers] = useState<string[]>([]);
  const [speakingPeers, setSpeakingPeers] = useState<Record<string, boolean>>({});
  const [selfSpeaking, setSelfSpeaking] = useState(false);
  const [localVideoStream, setLocalVideoStream] = useState<MediaStream | null>(null);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);

  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedVideoDeviceId, setSelectedVideoDeviceId] = useState<string | null>(null);
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioInputDeviceId, setSelectedAudioInputDeviceId] = useState<string | null>(null);
  const [audioOutputDevices, setAudioOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioOutputDeviceId, setSelectedAudioOutputDeviceId] = useState<string | null>(null);

  const roomRef = useRef<Room | null>(null);
  const currentRoomKeyRef = useRef<string | null>(null);
  const connectingRef = useRef(false);
  // Sticky desire flags: persist mic/cam state across room hops.
  const wantMicRef = useRef(false);
  const wantCamRef = useRef(false);
  const wantScreenRef = useRef(false);

  // ---------- Devices (independent of room) ----------
  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setVideoDevices(list.filter((d) => d.kind === "videoinput"));
      setAudioInputDevices(list.filter((d) => d.kind === "audioinput"));
      setAudioOutputDevices(list.filter((d) => d.kind === "audiooutput"));
    } catch { /* noop */ }
  }, []);

  useEffect(() => {
    void refreshDevices();
    const handler = () => void refreshDevices();
    try { navigator.mediaDevices.addEventListener?.("devicechange", handler); } catch { /* noop */ }
    return () => {
      try { navigator.mediaDevices.removeEventListener?.("devicechange", handler); } catch { /* noop */ }
    };
  }, [refreshDevices]);

  // ---------- Helpers to rebuild remote streams ----------
  const rebuildRemotes = useCallback(() => {
    const r = roomRef.current;
    if (!r) {
      setRemoteStreams({});
      setRemoteScreenStreams({});
      setConnectedPeers([]);
      return;
    }
    const av: Record<string, MediaStream> = {};
    const screens: Record<string, MediaStream> = {};
    const peers: string[] = [];
    r.remoteParticipants.forEach((p) => {
      peers.push(p.identity);
      const avStream = new MediaStream();
      let hasAv = false;
      p.trackPublications.forEach((pub) => {
        const track = pub.track;
        if (!track || !track.mediaStreamTrack) return;
        if (track.source === Track.Source.ScreenShare || track.source === Track.Source.ScreenShareAudio) {
          let s = screens[p.identity];
          if (!s) { s = new MediaStream(); screens[p.identity] = s; }
          s.addTrack(track.mediaStreamTrack);
        } else {
          avStream.addTrack(track.mediaStreamTrack);
          hasAv = true;
        }
      });
      if (hasAv) av[p.identity] = avStream;
    });
    setRemoteStreams(av);
    setRemoteScreenStreams(screens);
    setConnectedPeers(peers);
  }, []);

  // ---------- Connect / disconnect on room key change ----------
  useEffect(() => {
    let cancelled = false;

    const teardown = async () => {
      const r = roomRef.current;
      roomRef.current = null;
      currentRoomKeyRef.current = null;
      setRemoteStreams({});
      setRemoteScreenStreams({});
      setConnectedPeers([]);
      setSpeakingPeers({});
      setSelfSpeaking(false);
      setLocalVideoStream(null);
      setLocalScreenStream(null);
      setMicOn(false);
      setCamOn(false);
      setScreenOn(false);
      if (r) {
        try { await r.disconnect(); } catch { /* noop */ }
      }
    };

    if (!myId || !roomKey) {
      void teardown();
      return;
    }

    if (currentRoomKeyRef.current === roomKey && roomRef.current) return;

    connectingRef.current = true;
    void (async () => {
      try {
        await teardown();
        if (cancelled) return;

        const { url, token } = await getLiveKitAccess({ data: { roomName: roomKey } });
        if (cancelled) return;

        const room = new Room({
          adaptiveStream: true,
          dynacast: true,
          publishDefaults: { dtx: true, red: true },
        });
        roomRef.current = room;
        currentRoomKeyRef.current = roomKey;

        const onParticipants = () => rebuildRemotes();
        room.on(RoomEvent.ParticipantConnected, onParticipants);
        room.on(RoomEvent.ParticipantDisconnected, onParticipants);
        room.on(RoomEvent.TrackSubscribed, (_t: RemoteTrack, _p: RemoteTrackPublication, _rp: RemoteParticipant) => {
          rebuildRemotes();
        });
        room.on(RoomEvent.TrackUnsubscribed, () => rebuildRemotes());
        room.on(RoomEvent.TrackMuted, () => rebuildRemotes());
        room.on(RoomEvent.TrackUnmuted, () => rebuildRemotes());
        room.on(RoomEvent.LocalTrackPublished, (pub: LocalTrackPublication) => {
          if (pub.source === Track.Source.Camera && pub.track?.mediaStreamTrack) {
            setLocalVideoStream(makeStream(pub.track.mediaStreamTrack));
            setCamOn(true);
          } else if (pub.source === Track.Source.ScreenShare && pub.track?.mediaStreamTrack) {
            setLocalScreenStream(makeStream(pub.track.mediaStreamTrack));
            setScreenOn(true);
          } else if (pub.source === Track.Source.Microphone) {
            setMicOn(!pub.isMuted);
          }
        });
        room.on(RoomEvent.LocalTrackUnpublished, (pub: LocalTrackPublication) => {
          if (pub.source === Track.Source.Camera) {
            setLocalVideoStream(null);
            setCamOn(false);
          } else if (pub.source === Track.Source.ScreenShare) {
            setLocalScreenStream(null);
            setScreenOn(false);
            wantScreenRef.current = false;
          } else if (pub.source === Track.Source.Microphone) {
            setMicOn(false);
          }
        });
        room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
          const next: Record<string, boolean> = {};
          let selfActive = false;
          for (const s of speakers) {
            if (s.identity === myId) selfActive = true;
            else next[s.identity] = true;
          }
          setSpeakingPeers(next);
          setSelfSpeaking(selfActive);
        });
        room.on(RoomEvent.Disconnected, () => {
          if (currentRoomKeyRef.current === roomKey) {
            setRemoteStreams({});
            setRemoteScreenStreams({});
            setConnectedPeers([]);
            setSpeakingPeers({});
          }
        });

        await room.connect(url, token);
        if (cancelled) {
          try { await room.disconnect(); } catch { /* noop */ }
          return;
        }

        rebuildRemotes();
        void refreshDevices();

        // Re-apply sticky desires for new room.
        if (wantMicRef.current) {
          try { await room.localParticipant.setMicrophoneEnabled(true); setMicOn(true); } catch { /* noop */ }
        }
        if (wantCamRef.current) {
          try {
            await room.localParticipant.setCameraEnabled(true, selectedVideoDeviceId ? { deviceId: selectedVideoDeviceId } : undefined);
            const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
            if (pub?.track?.mediaStreamTrack) setLocalVideoStream(makeStream(pub.track.mediaStreamTrack));
            setCamOn(true);
          } catch { /* noop */ }
        }
      } catch (err) {
        if (!cancelled) {
          console.error("[livekit] connect failed", err);
        }
      } finally {
        connectingRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId, roomKey, rebuildRemotes, refreshDevices]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const r = roomRef.current;
      roomRef.current = null;
      if (r) { try { void r.disconnect(); } catch { /* noop */ } }
    };
  }, []);

  // ---------- Toggles ----------
  const toggleMic = useCallback(async () => {
    const r = roomRef.current;
    const want = !wantMicRef.current;
    wantMicRef.current = want;
    if (!r) { setMicOn(want); return; }
    try {
      await r.localParticipant.setMicrophoneEnabled(want);
      setMicOn(want);
    } catch (e) {
      wantMicRef.current = !want;
      throw e;
    }
  }, []);

  const toggleCam = useCallback(async () => {
    const r = roomRef.current;
    const want = !wantCamRef.current;
    wantCamRef.current = want;
    if (!r) { setCamOn(want); return; }
    try {
      if (want) {
        await r.localParticipant.setCameraEnabled(true, selectedVideoDeviceId ? { deviceId: selectedVideoDeviceId } : undefined);
        const pub = r.localParticipant.getTrackPublication(Track.Source.Camera);
        if (pub?.track?.mediaStreamTrack) setLocalVideoStream(makeStream(pub.track.mediaStreamTrack));
        setCamOn(true);
      } else {
        await r.localParticipant.setCameraEnabled(false);
        setLocalVideoStream(null);
        setCamOn(false);
      }
    } catch (e) {
      wantCamRef.current = !want;
      throw e;
    }
  }, [selectedVideoDeviceId]);

  const toggleScreen = useCallback(async () => {
    const r = roomRef.current;
    const want = !wantScreenRef.current;
    wantScreenRef.current = want;
    if (!r) { setScreenOn(false); return; }
    try {
      if (want) {
        await r.localParticipant.setScreenShareEnabled(true, { audio: true });
        const pub = r.localParticipant.getTrackPublication(Track.Source.ScreenShare);
        if (pub?.track?.mediaStreamTrack) setLocalScreenStream(makeStream(pub.track.mediaStreamTrack));
        setScreenOn(true);
      } else {
        await r.localParticipant.setScreenShareEnabled(false);
        setLocalScreenStream(null);
        setScreenOn(false);
      }
    } catch (e) {
      wantScreenRef.current = !want;
      throw e;
    }
  }, []);

  // ---------- Device switching ----------
  const setVideoDevice = useCallback(async (deviceId: string) => {
    setSelectedVideoDeviceId(deviceId);
    const r = roomRef.current;
    if (!r) return;
    try { await r.switchActiveDevice("videoinput", deviceId); } catch { /* noop */ }
    const pub = r.localParticipant.getTrackPublication(Track.Source.Camera);
    if (pub?.track?.mediaStreamTrack) setLocalVideoStream(makeStream(pub.track.mediaStreamTrack));
  }, []);

  const setAudioInputDevice = useCallback(async (deviceId: string) => {
    setSelectedAudioInputDeviceId(deviceId);
    const r = roomRef.current;
    if (!r) return;
    try { await r.switchActiveDevice("audioinput", deviceId); } catch { /* noop */ }
  }, []);

  const setAudioOutputDevice = useCallback(async (deviceId: string) => {
    setSelectedAudioOutputDeviceId(deviceId);
    const r = roomRef.current;
    if (!r) return;
    try { await r.switchActiveDevice("audiooutput", deviceId); } catch { /* noop */ }
  }, []);

  const prewarmMic = useCallback(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      void refreshDevices();
    } catch { /* noop — user can grant later */ }
  }, [refreshDevices]);

  const getLocalAudioTrack = useCallback((): MediaStreamTrack | null => {
    const r = roomRef.current;
    if (!r) return null;
    const pub = r.localParticipant.getTrackPublication(Track.Source.Microphone);
    return pub?.track?.mediaStreamTrack ?? null;
  }, []);

  return useMemo(
    () => ({
      micOn,
      camOn,
      screenOn,
      toggleMic,
      toggleCam,
      toggleScreen,
      remoteStreams,
      remoteScreenStreams,
      connectedPeers,
      speakingPeers,
      selfSpeaking,
      localVideoStream,
      localScreenStream,
      videoDevices,
      selectedVideoDeviceId,
      setVideoDevice,
      audioInputDevices,
      selectedAudioInputDeviceId,
      setAudioInputDevice,
      audioOutputDevices,
      selectedAudioOutputDeviceId,
      setAudioOutputDevice,
      prewarmMic,
      getLocalAudioTrack,
    }),
    [
      micOn, camOn, screenOn, toggleMic, toggleCam, toggleScreen,
      remoteStreams, remoteScreenStreams, connectedPeers, speakingPeers, selfSpeaking,
      localVideoStream, localScreenStream,
      videoDevices, selectedVideoDeviceId, setVideoDevice,
      audioInputDevices, selectedAudioInputDeviceId, setAudioInputDevice,
      audioOutputDevices, selectedAudioOutputDeviceId, setAudioOutputDevice,
      prewarmMic, getLocalAudioTrack,
    ],
  );
}
