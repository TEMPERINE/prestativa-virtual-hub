import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type SignalType = "offer" | "answer" | "ice" | "bye" | "hello";
type SignalMsg = {
  from: string;
  to: string;
  sessionId?: string;
  targetSessionId?: string;
  type: SignalType;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit | null;
};

type PeerEntry = {
  pc: RTCPeerConnection;
  audioSender: RTCRtpSender | null;
  videoSender: RTCRtpSender | null;
  screenTransceiver: RTCRtpTransceiver | null;
  screenSender: RTCRtpSender | null;
  makingOffer: boolean;
  isOfferer: boolean;
  pendingIce: RTCIceCandidateInit[];
  remoteStream: MediaStream;
  remoteScreenStream: MediaStream;
};

const ICE_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }],
};

const SIGNAL_CHANNEL = "rtc-mesh-v1";

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
  localVideoStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  videoDevices: MediaDeviceInfo[];
  selectedVideoDeviceId: string | null;
  setVideoDevice: (deviceId: string) => Promise<void>;
};

export function useRtcMesh(myId: string | null, desiredPeers: string[]): RtcMeshState {
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [remoteScreenStreams, setRemoteScreenStreams] = useState<Record<string, MediaStream>>({});
  const [connectedPeers, setConnectedPeers] = useState<string[]>([]);
  const [speakingPeers, setSpeakingPeers] = useState<Record<string, boolean>>({});
  const [localVideoStream, setLocalVideoStream] = useState<MediaStream | null>(null);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedVideoDeviceId, setSelectedVideoDeviceId] = useState<string | null>(null);

  const peersRef = useRef<Map<string, PeerEntry>>(new Map());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const channelReadyRef = useRef(false);
  const pendingSignalsRef = useRef<Omit<SignalMsg, "from" | "sessionId" | "targetSessionId">[]>([]);
  const localSessionIdRef = useRef(`${Date.now()}:${Math.random().toString(36).slice(2)}`);
  const remoteSessionsRef = useRef<Map<string, string>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioTrackRef = useRef<MediaStreamTrack | null>(null);
  const videoTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const desiredRef = useRef<Set<string>>(new Set());
  const disconnectTimersRef = useRef<Map<string, number>>(new Map());

  const sendSignal = useCallback((msg: Omit<SignalMsg, "from" | "sessionId" | "targetSessionId">) => {
    const ch = channelRef.current;
    if (!ch || !myId) {
      pendingSignalsRef.current.push(msg);
      return;
    }
    if (!channelReadyRef.current) {
      pendingSignalsRef.current.push(msg);
      return;
    }
    void ch.send({
      type: "broadcast",
      event: "rtc",
      payload: {
        ...msg,
        from: myId,
        sessionId: localSessionIdRef.current,
        targetSessionId: remoteSessionsRef.current.get(msg.to),
      },
    });
  }, [myId]);

  const flushSignals = useCallback(() => {
    const ch = channelRef.current;
    if (!ch || !myId || !channelReadyRef.current) return;
    const pending = pendingSignalsRef.current.splice(0);
    for (const msg of pending) {
      void ch.send({
        type: "broadcast",
        event: "rtc",
        payload: {
          ...msg,
          from: myId,
          sessionId: localSessionIdRef.current,
          targetSessionId: remoteSessionsRef.current.get(msg.to),
        },
      });
    }
  }, [myId]);

  // Create a PC for a peer
  const createPeer = useCallback((peerId: string, initiator: boolean) => {
    if (!myId) return null;
    if (peersRef.current.has(peerId)) return peersRef.current.get(peerId)!;

    const pc = new RTCPeerConnection(ICE_CONFIG);
    const remoteStream = new MediaStream();
    const remoteScreenStream = new MediaStream();

    // Always add transceivers so we can both send/recv without renegotiation later
    const audioTx = pc.addTransceiver("audio", { direction: "sendrecv" });
    const videoTx = pc.addTransceiver("video", { direction: "sendrecv" });
    const screenTx = pc.addTransceiver("video", { direction: "sendrecv" });

    // If we already have local tracks, attach now
    if (audioTrackRef.current) void audioTx.sender.replaceTrack(audioTrackRef.current);
    if (videoTrackRef.current) void videoTx.sender.replaceTrack(videoTrackRef.current);
    if (screenTrackRef.current) void screenTx.sender.replaceTrack(screenTrackRef.current);

    const entry: PeerEntry = {
      pc,
      audioSender: audioTx.sender,
      videoSender: videoTx.sender,
      screenTransceiver: screenTx,
      screenSender: screenTx.sender,
      makingOffer: false,
      isOfferer: initiator,
      pendingIce: [],
      remoteStream,
      remoteScreenStream,
    };

    pc.onicecandidate = (e) => {
      sendSignal({ to: peerId, type: "ice", candidate: e.candidate ? e.candidate.toJSON() : null });
    };

    pc.ontrack = (e) => {
      const isScreen = e.transceiver === entry.screenTransceiver;
      const target = isScreen ? remoteScreenStream : remoteStream;
      if (!target.getTracks().find((rt) => rt.id === e.track.id)) target.addTrack(e.track);
      if (isScreen) {
        setRemoteScreenStreams((prev) => ({ ...prev, [peerId]: remoteScreenStream }));
        e.track.onended = () => {
          target.removeTrack(e.track);
          setRemoteScreenStreams((prev) => {
            if (target.getVideoTracks().length === 0) {
              const next = { ...prev };
              delete next[peerId];
              return next;
            }
            return { ...prev, [peerId]: target };
          });
        };
      } else {
        setRemoteStreams((prev) => ({ ...prev, [peerId]: remoteStream }));
      }
    };

    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === "connected") {
        setConnectedPeers((prev) => (prev.includes(peerId) ? prev : [...prev, peerId]));
      } else if (st === "failed" || st === "closed" || st === "disconnected") {
        setConnectedPeers((prev) => prev.filter((p) => p !== peerId));
      }
    };

    pc.onnegotiationneeded = async () => {
      if (!entry.isOfferer || pc.signalingState !== "stable") return;
      try {
        entry.makingOffer = true;
        const offer = await pc.createOffer();
        if (pc.signalingState !== "stable") return;
        await pc.setLocalDescription(offer);
        sendSignal({ to: peerId, type: "offer", sdp: pc.localDescription! });
      } catch (err) {
        console.error("negotiationneeded failed", err);
      } finally {
        entry.makingOffer = false;
      }
    };

    peersRef.current.set(peerId, entry);

    // If we're the initiator, kick off offer immediately
    if (initiator) {
      // negotiationneeded will fire from the transceivers; nothing more to do
    }
    return entry;
  }, [myId, sendSignal]);

  const destroyPeer = useCallback((peerId: string) => {
    const pending = disconnectTimersRef.current.get(peerId);
    if (pending) {
      window.clearTimeout(pending);
      disconnectTimersRef.current.delete(peerId);
    }
    const entry = peersRef.current.get(peerId);
    if (!entry) return;
    try { entry.pc.close(); } catch { /* noop */ }
    peersRef.current.delete(peerId);
    remoteSessionsRef.current.delete(peerId);
    setRemoteStreams((prev) => {
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
    setRemoteScreenStreams((prev) => {
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
    setConnectedPeers((prev) => prev.filter((p) => p !== peerId));
    setSpeakingPeers((prev) => {
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
  }, []);

  // Handle incoming signaling
  const handleSignal = useCallback(async (msg: SignalMsg) => {
    if (!myId || msg.to !== myId || msg.from === myId) return;
    if (msg.targetSessionId && msg.targetSessionId !== localSessionIdRef.current) return;
    const peerId = msg.from;
    const knownSessionId = remoteSessionsRef.current.get(peerId);
    const sessionChanged = !!msg.sessionId && !!knownSessionId && msg.sessionId !== knownSessionId;
    if (sessionChanged) destroyPeer(peerId);
    if (msg.sessionId) remoteSessionsRef.current.set(peerId, msg.sessionId);

    if (msg.type === "bye") {
      destroyPeer(peerId);
      return;
    }

    if (msg.type === "hello") {
      // Other side announces presence; if we should connect and our id wins, create offer
      if (desiredRef.current.has(peerId) && myId > peerId) {
        createPeer(peerId, true);
      }
      return;
    }

    // Make sure peer exists for incoming offer/answer/ice
    let entry = peersRef.current.get(peerId);
    if (!entry) {
      if (msg.type === "offer") {
        entry = createPeer(peerId, false) ?? undefined;
      } else {
        return; // ignore stray ice/answer
      }
    }
    if (!entry) return;
    const pc = entry.pc;

    try {
      if (msg.type === "offer" && msg.sdp) {
        if (entry.isOfferer || pc.signalingState !== "stable") {
          destroyPeer(peerId);
          const fresh = createPeer(peerId, false);
          if (!fresh) return;
          entry = fresh;
        }
        await entry.pc.setRemoteDescription(msg.sdp);
        for (const candidate of entry.pendingIce.splice(0)) {
          try { await entry.pc.addIceCandidate(candidate); } catch { /* noop */ }
        }
        const answer = await entry.pc.createAnswer();
        await entry.pc.setLocalDescription(answer);
        sendSignal({ to: peerId, type: "answer", sdp: entry.pc.localDescription! });
      } else if (msg.type === "answer" && msg.sdp) {
        if (entry.isOfferer && pc.signalingState === "have-local-offer") {
          await pc.setRemoteDescription(msg.sdp);
          for (const candidate of entry.pendingIce.splice(0)) {
            try { await pc.addIceCandidate(candidate); } catch { /* noop */ }
          }
        }
      } else if (msg.type === "ice") {
        try {
          if (msg.candidate) {
            if (pc.remoteDescription) await pc.addIceCandidate(msg.candidate);
            else entry.pendingIce.push(msg.candidate);
          }
        } catch (err) {
          console.warn("addIceCandidate failed", err);
        }
      }
    } catch (err) {
      console.error("signal handle error", err);
    }
  }, [myId, createPeer, destroyPeer, sendSignal]);

  // Subscribe to signaling channel
  useEffect(() => {
    if (!myId) return;
    const ch = supabase.channel(SIGNAL_CHANNEL, { config: { broadcast: { self: false } } });
    channelRef.current = ch;
    ch.on("broadcast", { event: "rtc" }, (payload) => {
      const msg = payload.payload as SignalMsg;
      void handleSignal(msg);
    });
    void ch.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        channelReadyRef.current = true;
        flushSignals();
        // announce ourselves to currently desired peers
        for (const p of desiredRef.current) {
          sendSignal({ to: p, type: "hello" });
        }
      } else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        channelReadyRef.current = false;
      }
    });
    return () => {
      // bye to all peers
      for (const peerId of Array.from(peersRef.current.keys())) {
        sendSignal({ to: peerId, type: "bye" });
        destroyPeer(peerId);
      }
      channelReadyRef.current = false;
      pendingSignalsRef.current = [];
      for (const timer of disconnectTimersRef.current.values()) window.clearTimeout(timer);
      disconnectTimersRef.current.clear();
      supabase.removeChannel(ch);
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId, flushSignals, sendSignal]);

  // Reconcile desired peers
  useEffect(() => {
    desiredRef.current = new Set(desiredPeers);
    if (!myId) return;

    // Connect to new peers
    for (const peerId of desiredPeers) {
      if (peerId === myId) continue;
      const pending = disconnectTimersRef.current.get(peerId);
      if (pending) {
        window.clearTimeout(pending);
        disconnectTimersRef.current.delete(peerId);
      }
      if (peersRef.current.has(peerId)) continue;
      // Send hello — and if our id wins, create offer immediately
      sendSignal({ to: peerId, type: "hello" });
      if (myId > peerId) createPeer(peerId, true);
    }

    // Disconnect from peers no longer desired
    for (const peerId of Array.from(peersRef.current.keys())) {
      if (!desiredPeers.includes(peerId)) {
        if (disconnectTimersRef.current.has(peerId)) continue;
        const timer = window.setTimeout(() => {
          disconnectTimersRef.current.delete(peerId);
          if (!desiredRef.current.has(peerId)) {
            sendSignal({ to: peerId, type: "bye" });
            destroyPeer(peerId);
          }
        }, 8000);
        disconnectTimersRef.current.set(peerId, timer);
      }
    }
  }, [desiredPeers, myId, createPeer, destroyPeer, sendSignal]);

  // Keep announcing presence while a nearby/in-room peer is desired. This
  // recovers from missed first offers when either browser joins a few seconds late.
  useEffect(() => {
    if (!myId) return;
    const timer = window.setInterval(() => {
      for (const peerId of desiredRef.current) {
        if (peerId === myId) continue;
        sendSignal({ to: peerId, type: "hello" });
        const entry = peersRef.current.get(peerId);
        if (!entry && myId > peerId) createPeer(peerId, true);
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [myId, createPeer, sendSignal]);

  // Speaking detection (simple: analyse remote audio levels)
  useEffect(() => {
    const ctxRef: { ctx?: AudioContext } = {};
    const analysers: { peerId: string; analyser: AnalyserNode; data: Uint8Array<ArrayBuffer> }[] = [];
    try {
      ctxRef.ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    } catch { /* noop */ }

    Object.entries(remoteStreams).forEach(([peerId, stream]) => {
      const audioTracks = stream.getAudioTracks();
      if (!audioTracks.length || !ctxRef.ctx) return;
      try {
        const src = ctxRef.ctx.createMediaStreamSource(new MediaStream([audioTracks[0]]));
        const analyser = ctxRef.ctx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);
        analysers.push({ peerId, analyser, data: new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount)) });
      } catch { /* noop */ }
    });

    if (!analysers.length) return;
    let raf = 0;
    const tick = () => {
      const next: Record<string, boolean> = {};
      for (const a of analysers) {
        a.analyser.getByteFrequencyData(a.data);
        let sum = 0;
        for (let i = 0; i < a.data.length; i++) sum += a.data[i];
        next[a.peerId] = sum / a.data.length > 12;
      }
      setSpeakingPeers((prev) => {
        const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
        for (const k of keys) if (prev[k] !== next[k]) return next;
        return prev;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      try { void ctxRef.ctx?.close(); } catch { /* noop */ }
    };
  }, [remoteStreams]);

  // Acquire local mic
  const enableMic = useCallback(async () => {
    if (audioTrackRef.current) {
      audioTrackRef.current.enabled = true;
      setMicOn(true);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const track = stream.getAudioTracks()[0];
      audioTrackRef.current = track;
      if (!localStreamRef.current) localStreamRef.current = new MediaStream();
      localStreamRef.current.addTrack(track);
      for (const entry of peersRef.current.values()) {
        if (entry.audioSender) await entry.audioSender.replaceTrack(track);
      }
      setMicOn(true);
    } catch (err) {
      console.error("mic access denied", err);
      throw err;
    }
  }, []);

  const disableMic = useCallback(() => {
    if (audioTrackRef.current) {
      audioTrackRef.current.enabled = false;
    }
    setMicOn(false);
  }, []);

  const toggleMic = useCallback(async () => {
    if (micOn) disableMic();
    else await enableMic();
  }, [micOn, enableMic, disableMic]);

  const refreshDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setVideoDevices(all.filter((d) => d.kind === "videoinput"));
    } catch { /* noop */ }
  }, []);

  const acquireCam = useCallback(async (deviceId?: string) => {
    const constraints: MediaStreamConstraints = {
      video: deviceId
        ? { deviceId: { exact: deviceId }, width: 320, height: 240 }
        : { width: 320, height: 240 },
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    const track = stream.getVideoTracks()[0];
    // Tear down any previous video track
    if (videoTrackRef.current) {
      try { videoTrackRef.current.stop(); } catch { /* noop */ }
      if (localStreamRef.current) {
        localStreamRef.current.getVideoTracks().forEach((t) => localStreamRef.current!.removeTrack(t));
      }
    }
    videoTrackRef.current = track;
    if (!localStreamRef.current) localStreamRef.current = new MediaStream();
    localStreamRef.current.addTrack(track);
    setLocalVideoStream(new MediaStream([track]));
    setSelectedVideoDeviceId(track.getSettings().deviceId ?? deviceId ?? null);
    for (const entry of peersRef.current.values()) {
      if (entry.videoSender) await entry.videoSender.replaceTrack(track);
    }
    // Now labels are available
    void refreshDevices();
  }, [refreshDevices]);

  const enableCam = useCallback(async () => {
    if (videoTrackRef.current) {
      videoTrackRef.current.enabled = true;
      setCamOn(true);
      return;
    }
    try {
      await acquireCam(selectedVideoDeviceId ?? undefined);
      setCamOn(true);
    } catch (err) {
      console.error("camera access denied", err);
      throw err;
    }
  }, [acquireCam, selectedVideoDeviceId]);

  const disableCam = useCallback(() => {
    if (videoTrackRef.current) {
      videoTrackRef.current.stop();
      videoTrackRef.current = null;
      for (const entry of peersRef.current.values()) {
        if (entry.videoSender) void entry.videoSender.replaceTrack(null);
      }
    }
    setLocalVideoStream(null);
    setCamOn(false);
  }, []);

  const toggleCam = useCallback(async () => {
    if (camOn) disableCam();
    else await enableCam();
  }, [camOn, enableCam, disableCam]);

  const setVideoDevice = useCallback(async (deviceId: string) => {
    setSelectedVideoDeviceId(deviceId);
    if (camOn) {
      try { await acquireCam(deviceId); } catch (err) { console.error(err); }
    }
  }, [camOn, acquireCam]);

  // ---------- Screen share ----------
  const stopScreenInternal = useCallback(() => {
    const track = screenTrackRef.current;
    if (track) {
      try { track.stop(); } catch { /* noop */ }
    }
    if (localScreenStream) {
      localScreenStream.getTracks().forEach((t) => { try { t.stop(); } catch { /* noop */ } });
    }
    screenTrackRef.current = null;
    for (const entry of peersRef.current.values()) {
      if (entry.screenSender) void entry.screenSender.replaceTrack(null);
    }
    setLocalScreenStream(null);
    setScreenOn(false);
  }, [localScreenStream]);

  const enableScreen = useCallback(async () => {
    try {
      const md = navigator.mediaDevices as MediaDevices & {
        getDisplayMedia?: (c?: DisplayMediaStreamOptions) => Promise<MediaStream>;
      };
      if (!md.getDisplayMedia) throw new Error("getDisplayMedia not supported");
      const stream = await md.getDisplayMedia({ video: true, audio: true });
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error("no screen track");
      screenTrackRef.current = track;
      setLocalScreenStream(stream);
      for (const entry of peersRef.current.values()) {
        if (entry.screenSender) await entry.screenSender.replaceTrack(track);
      }
      track.onended = () => { stopScreenInternal(); };
      setScreenOn(true);
    } catch (err) {
      console.error("screen share failed", err);
      throw err;
    }
  }, [stopScreenInternal]);

  const toggleScreen = useCallback(async () => {
    if (screenOn) stopScreenInternal();
    else await enableScreen();
  }, [screenOn, enableScreen, stopScreenInternal]);

  // Initial device list (labels are blank until permission granted)
  useEffect(() => {
    void refreshDevices();
    const handler = () => { void refreshDevices(); };
    navigator.mediaDevices?.addEventListener?.("devicechange", handler);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", handler);
  }, [refreshDevices]);

  return {
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
    localVideoStream,
    localScreenStream,
    videoDevices,
    selectedVideoDeviceId,
    setVideoDevice,
  };
}
