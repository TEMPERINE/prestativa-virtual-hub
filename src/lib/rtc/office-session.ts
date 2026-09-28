/**
 * RTC v2 — Etapa 3: ownership de sessão (1 usuário = 1 sessão ativa).
 *
 * Responsabilidade exclusiva: claim/release, generation, takeover e
 * revalidação após reconexão. NÃO toca LiveKit, mídia, Presence ou movimento.
 * Ainda não conectado ao produto.
 */

export type OfficeSessionStatus = "IDLE" | "CLAIMING" | "ACTIVE" | "REPLACED" | "ERROR";

export interface OfficeSessionState {
  status: OfficeSessionStatus;
  sessionId: string | null;
  generation: number | null;
  workspaceId: string | null;
  error: string | null;
}

export interface SessionReplacedEvent {
  sessionId: string;
  generation: number;
}

export interface CurrentSessionRow {
  sessionId: string;
  generation: number;
  active: boolean;
}

export interface TakeoverChannelHandlers {
  onReplaced: (event: SessionReplacedEvent) => void;
  /** Chamado quando o canal (re)conecta. `isReconnect` = já havia conectado antes. */
  onSubscribed: (isReconnect: boolean) => void;
}

export interface TakeoverChannel {
  broadcastReplaced: (event: SessionReplacedEvent) => Promise<void>;
  unsubscribe: () => Promise<void>;
}

/** Porta de infraestrutura — implementada com Supabase em produção, com fakes em teste. */
export interface OfficeSessionBackend {
  claim(sessionId: string, workspaceId: string): Promise<{ sessionId: string; generation: number }>;
  release(sessionId: string, generation: number): Promise<boolean>;
  fetchCurrent(): Promise<CurrentSessionRow | null>;
  openTakeoverChannel(userId: string, handlers: TakeoverChannelHandlers): TakeoverChannel;
}

export function generateSessionId(): string {
  return crypto.randomUUID();
}

const INITIAL: OfficeSessionState = {
  status: "IDLE",
  sessionId: null,
  generation: null,
  workspaceId: null,
  error: null,
};

export class OfficeSessionController {
  private state: OfficeSessionState = { ...INITIAL };
  private listeners = new Set<(s: OfficeSessionState) => void>();
  private channel: TakeoverChannel | null = null;
  private claimSeq = 0;

  constructor(
    private readonly backend: OfficeSessionBackend,
    private readonly newSessionId: () => string = generateSessionId,
  ) {}

  getState(): OfficeSessionState {
    return this.state;
  }

  subscribe(fn: (s: OfficeSessionState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<OfficeSessionState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  /** Abre uma sessão nova (novo sessionId a cada abertura real do Office). */
  async claim(userId: string, workspaceId: string): Promise<OfficeSessionState> {
    const seq = ++this.claimSeq;
    const sessionId = this.newSessionId();
    this.set({ status: "CLAIMING", sessionId, workspaceId, error: null });
    let result: { sessionId: string; generation: number };
    try {
      result = await this.backend.claim(sessionId, workspaceId);
    } catch (e) {
      if (seq === this.claimSeq) {
        this.set({ status: "ERROR", error: e instanceof Error ? e.message : String(e) });
      }
      return this.state;
    }
    // Uma claim mais nova já começou ou a sessão foi substituída: não regredir.
    if (seq !== this.claimSeq) return this.state;
    if (this.state.generation !== null && result.generation <= this.state.generation) {
      return this.state;
    }
    this.set({
      status: "ACTIVE",
      sessionId: result.sessionId,
      generation: result.generation,
      workspaceId,
      error: null,
    });
    await this.attachChannel(userId);
    if (this.channel && this.state.status === "ACTIVE") {
      try {
        await this.channel.broadcastReplaced({
          sessionId: result.sessionId,
          generation: result.generation,
        });
      } catch (e) {
        // Não fatal: sessões antigas também detectam via revalidação na reconexão.
        console.warn("[office-session] broadcast SESSION_REPLACED falhou", e);
      }
    }
    return this.state;
  }

  private async attachChannel(userId: string) {
    if (this.channel) await this.channel.unsubscribe();
    this.channel = this.backend.openTakeoverChannel(userId, {
      onReplaced: (ev) => this.handleReplaced(ev),
      onSubscribed: (isReconnect) => {
        if (isReconnect) void this.revalidate();
      },
    });
  }

  /** Autoridade = generation. sessionId sozinho nunca decide. */
  handleReplaced(ev: SessionReplacedEvent) {
    const current = this.state.generation;
    if (current === null) return;
    if (!(ev.generation > current)) return;
    this.set({ status: "REPLACED" });
  }

  /** Confere no banco se esta sessão ainda é a dona (cobre SESSION_REPLACED perdido). */
  async revalidate(): Promise<OfficeSessionState> {
    if (this.state.status !== "ACTIVE") return this.state;
    const { sessionId, generation } = this.state;
    let row: CurrentSessionRow | null;
    try {
      row = await this.backend.fetchCurrent();
    } catch (e) {
      console.warn("[office-session] revalidação falhou", e);
      return this.state;
    }
    if (this.state.status !== "ACTIVE") return this.state;
    const stillOwner =
      !!row && row.active && row.sessionId === sessionId && row.generation === generation;
    if (!stillOwner) this.set({ status: "REPLACED" });
    return this.state;
  }

  /** Encerramento controlado. Nunca reativa nem altera sessão mais nova. */
  async release(): Promise<void> {
    const { sessionId, generation, status } = this.state;
    this.claimSeq++;
    if (sessionId && generation !== null && status === "ACTIVE") {
      try {
        await this.backend.release(sessionId, generation);
      } catch (e) {
        console.warn("[office-session] release falhou; finalizando localmente", e);
      }
    }
    await this.dispose();
    if (this.state.status !== "REPLACED") this.set({ ...INITIAL });
  }

  async dispose(): Promise<void> {
    const ch = this.channel;
    this.channel = null;
    if (ch) await ch.unsubscribe();
  }
}
