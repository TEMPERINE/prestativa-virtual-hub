// RTC v2 — medidor visual de entrada do microfone (Etapa 14B diagnóstico).
//
// SOMENTE VISUAL. Lê o volume da LocalAudioTrack atual via analyser e reporta
// um nível 0..1. Nunca liga/desliga mic, troca device, reinicia/publica track
// ou toca na Room. Volume 0 pode ser apenas silêncio: nenhuma lógica automática.

export interface MeterAnalyser {
  calculateVolume(): number;
  cleanup(): unknown;
}

export interface MicLevelMeterDeps {
  /** Ex.: (t) => createAudioAnalyser(t, { cloneTrack: false }) do livekit-client. */
  createAnalyser: (track: unknown) => MeterAnalyser;
  onLevel: (level: number) => void;
  raf?: (fn: () => void) => unknown;
  caf?: (h: unknown) => void;
}

export class MicLevelMeter {
  private analyser: MeterAnalyser | null = null;
  private key: string | null = null;
  private handle: unknown = null;
  private disposed = false;
  private last = -1;
  private readonly raf: (fn: () => void) => unknown;
  private readonly caf: (h: unknown) => void;

  constructor(private readonly deps: MicLevelMeterDeps) {
    this.raf = deps.raf ?? ((fn) => requestAnimationFrame(fn));
    this.caf = deps.caf ?? ((h) => cancelAnimationFrame(h as number));
  }

  /**
   * Vincula à track atual. `key` deve mudar quando a MediaStreamTrack mudar
   * (troca de device/restart), mesmo que o objeto LiveKit seja o mesmo.
   * `null` = mic OFF → nível 0, sem analyser.
   */
  setTrack(track: unknown | null, key: string | null): void {
    if (this.disposed) return;
    const k = track ? key : null;
    if (k === null && this.key === null) {
      this.report(0);
      return;
    }
    if (k === this.key && this.analyser) return;
    this.unbind();
    this.key = k;
    if (!track) {
      this.report(0);
      return;
    }
    try {
      this.analyser = this.deps.createAnalyser(track);
    } catch {
      this.analyser = null; // falha do analyser nunca afeta o RTC
      this.report(0);
      return;
    }
    this.loop();
  }

  dispose(): void {
    if (this.disposed) return;
    this.unbind();
    this.disposed = true;
  }

  private loop = (): void => {
    if (this.disposed || !this.analyser) return;
    let v = 0;
    try {
      v = this.analyser.calculateVolume();
    } catch {
      v = 0;
    }
    this.report(Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);
    this.handle = this.raf(this.loop);
  };

  private report(level: number): void {
    // Arredonda para evitar re-render a cada frame sem mudança visível.
    const q = Math.round(level * 50) / 50;
    if (q === this.last) return;
    this.last = q;
    try {
      this.deps.onLevel(q);
    } catch {
      /* noop */
    }
  }

  private unbind(): void {
    if (this.handle != null) this.caf(this.handle);
    this.handle = null;
    const a = this.analyser;
    this.analyser = null;
    if (a) {
      try {
        const r = a.cleanup();
        if (r && typeof (r as Promise<unknown>).catch === "function")
          (r as Promise<unknown>).catch(() => {});
      } catch {
        /* noop */
      }
    }
  }
}
