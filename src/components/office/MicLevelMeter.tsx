import { useEffect, useRef, useState } from "react";
import { MicLevelMeter as Meter, type MeterAnalyser } from "@/lib/rtc/mic-level-meter";

/** Medidor visual da LocalAudioTrack (RTC v2). Nunca controla o microfone. */
export function MicLevelMeter({ track, trackKey }: { track: unknown | null; trackKey: string | null }) {
  const [level, setLevel] = useState(0);
  const meterRef = useRef<Meter | null>(null);
  const [factory, setFactory] = useState<((t: unknown) => MeterAnalyser) | null>(null);

  useEffect(() => {
    let alive = true;
    import("livekit-client")
      .then((lk) => {
        if (!alive) return;
        setFactory(
          () => (t: unknown) =>
            lk.createAudioAnalyser(t as never, { cloneTrack: false, smoothingTimeConstant: 0.6 }),
        );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!factory) return;
    const m = new Meter({ createAnalyser: factory, onLevel: setLevel });
    meterRef.current = m;
    return () => {
      m.dispose();
      meterRef.current = null;
      setLevel(0);
    };
  }, [factory]);

  useEffect(() => {
    meterRef.current?.setTrack(track, trackKey);
  }, [track, trackKey, factory]);

  const active = !!track;
  // Escala perceptual: fala comum fica ~0.05–0.3 de RMS.
  const scaled = Math.min(1, Math.sqrt(level) * 1.6);
  const bars = 4;
  return (
    <div
      className="flex items-end gap-[2px] h-3.5 mx-1"
      aria-label={active ? `Nível do microfone ${Math.round(scaled * 100)}%` : "Microfone desligado"}
      title={active ? "Entrada do seu microfone" : "Microfone desligado"}
    >
      {Array.from({ length: bars }, (_, i) => {
        const on = active && scaled > (i + 0.5) / (bars + 0.5);
        return (
          <span
            key={i}
            className={`w-[3px] rounded-sm transition-colors ${on ? "bg-primary" : "bg-muted-foreground/30"}`}
            style={{ height: `${40 + i * 20}%` }}
          />
        );
      })}
    </div>
  );
}
