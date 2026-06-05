// Unlocks browser autoplay for <audio> elements created later (remote peer audio).
// Must be invoked from a real user gesture (click / keydown / touchstart).
// Idempotent — calling it multiple times is safe.

let unlocked = false;
let unlockPromise: Promise<void> | null = null;

export function unlockAudioPlayback(): Promise<void> {
  if (unlocked) return Promise.resolve();
  if (unlockPromise) return unlockPromise;
  unlockPromise = (async () => {
    try {
      // 1) Resume a shared AudioContext (unlocks Web Audio nodes used for VU meters).
      const Ctx = (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
      if (Ctx) {
        const ctx = new Ctx();
        if (ctx.state === "suspended") {
          try { await ctx.resume(); } catch { /* noop */ }
        }
        // Play a silent buffer to fully unlock playback on iOS/Safari.
        try {
          const buffer = ctx.createBuffer(1, 1, 22050);
          const src = ctx.createBufferSource();
          src.buffer = buffer;
          src.connect(ctx.destination);
          src.start(0);
        } catch { /* noop */ }
      }
      // 2) Play a silent <audio> to satisfy <audio>-based autoplay policy.
      const a = document.createElement("audio");
      a.setAttribute("playsinline", "");
      a.muted = false;
      a.volume = 0;
      // 1-frame silent wav
      a.src =
        "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
      try { await a.play(); } catch { /* still ok — context resume is the main path */ }
      a.pause();
      unlocked = true;
    } finally {
      unlockPromise = null;
    }
  })();
  return unlockPromise;
}

export function isAudioUnlocked() {
  return unlocked;
}

// Install one-shot listeners that unlock on the first real user gesture
// in the page. Call this once on mount.
export function installAudioUnlockListeners() {
  if (typeof window === "undefined") return () => {};
  if (unlocked) return () => {};
  const handler = () => {
    void unlockAudioPlayback();
  };
  const opts = { once: true, capture: true } as AddEventListenerOptions;
  window.addEventListener("pointerdown", handler, opts);
  window.addEventListener("keydown", handler, opts);
  window.addEventListener("touchstart", handler, opts);
  return () => {
    window.removeEventListener("pointerdown", handler, opts);
    window.removeEventListener("keydown", handler, opts);
    window.removeEventListener("touchstart", handler, opts);
  };
}
