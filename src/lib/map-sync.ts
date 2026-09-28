// RTC v2 Etapa 4 — Mapa determinístico e mapVersion.
//
// Fonte única e testável do mapa normalizado. Todo override (fetch inicial,
// aviso Realtime, cache restaurado, resultado de edição/salvamento) passa
// obrigatoriamente por normalizeMapOverrides() antes de chegar ao consumidor.
// `version` (map_overrides.version, incrementada no banco) é a autoridade:
// nunca diminui e respostas atrasadas de versões antigas são descartadas.

import type { ZoneId } from "./office-map";
import type { MapOverrides } from "./map-overrides";

export const MAP_GRID_COLS = 128;
export const MAP_GRID_ROWS = 80;

/** Converte qualquer valor bruto no MapOverrides canônico (grid 128×80), ou null se inválido. */
export function normalizeMapOverrides(raw: unknown): MapOverrides | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as MapOverrides;
  if (!o.cols || !o.rows || !Array.isArray(o.blocked)) return null;
  const zonesIn = Array.isArray(o.zones) ? o.zones : [];
  const size = MAP_GRID_COLS * MAP_GRID_ROWS;
  const blocked = new Array<number>(size).fill(0);
  const zones = new Array<ZoneId | null>(size).fill(null);
  for (let r = 0; r < MAP_GRID_ROWS; r++) {
    const sr = Math.min(o.rows - 1, Math.floor((r / MAP_GRID_ROWS) * o.rows));
    for (let c = 0; c < MAP_GRID_COLS; c++) {
      const sc = Math.min(o.cols - 1, Math.floor((c / MAP_GRID_COLS) * o.cols));
      const s = sr * o.cols + sc;
      const d = r * MAP_GRID_COLS + c;
      blocked[d] = o.blocked[s] === 1 ? 1 : 0;
      zones[d] = (zonesIn[s] as ZoneId | null | undefined) ?? null;
    }
  }
  return {
    ...o,
    cols: MAP_GRID_COLS,
    rows: MAP_GRID_ROWS,
    blocked,
    zones,
    customZones: o.customZones ?? [],
    zoneKinds: o.zoneKinds ?? {},
    spawnPoints: o.spawnPoints ?? {},
  };
}

export type MapSyncState = "LOADING" | "READY" | "SYNCING" | "ERROR";

export type CanonicalMapRow = { data: unknown; version: number } | null;

export type MapSnapshot = {
  state: MapSyncState;
  version: number;
  map: MapOverrides | null;
  error: string | null;
};

export type MapSyncDeps = {
  fetchCanonical: () => Promise<CanonicalMapRow>;
  onChange?: (s: MapSnapshot) => void;
  /** Tentativas extras quando o banco ainda devolve versão menor que a anunciada. */
  maxStaleRefetch?: number;
};

export class MapSyncController {
  private state: MapSyncState = "LOADING";
  private version = 0;
  private target = 0;
  private map: MapOverrides | null = null;
  private error: string | null = null;
  private inflight: Promise<void> | null = null;
  private rerun = false;

  constructor(private deps: MapSyncDeps) {}

  snapshot(): MapSnapshot {
    return { state: this.state, version: this.version, map: this.map, error: this.error };
  }

  /** Restaura cache local (sempre via normalizador). Não marca READY. */
  restoreCache(raw: unknown, version: number) {
    const map = normalizeMapOverrides(raw);
    if (!map || version < this.version) return;
    this.map = map;
    this.version = version;
    this.emit();
  }

  /** Carregamento inicial / retry: busca a versão canônica no banco. */
  load(): Promise<void> {
    if (this.state !== "READY") this.setState(this.map ? "SYNCING" : "LOADING");
    return this.run();
  }

  retry(): Promise<void> {
    return this.load();
  }

  /** Aviso "existe versão nova". Igual ou menor é ignorado. */
  notify(version: number): Promise<void> | void {
    if (!Number.isFinite(version) || version <= Math.max(this.version, this.target)) return;
    this.target = version;
    this.setState("SYNCING");
    return this.run();
  }

  /** Edição local ainda não salva: normaliza, mantém a versão atual. */
  applyLocalEdit(raw: unknown): MapOverrides | null {
    const map = normalizeMapOverrides(raw);
    if (!map) return null;
    this.map = map;
    this.emit();
    return map;
  }

  /** Resultado confirmado de um save (versão devolvida pelo banco). */
  applyConfirmed(raw: unknown, version: number) {
    if (version <= this.version) return;
    const map = normalizeMapOverrides(raw);
    if (!map) return;
    this.map = map;
    this.version = version;
    if (this.target < version) this.target = version;
    this.error = null;
    this.state = "READY";
    this.emit();
  }

  /** Linha removida no banco (reset do mapa). */
  applyCleared() {
    this.map = null;
    this.emit();
  }

  private run(): Promise<void> {
    if (this.inflight) {
      this.rerun = true;
      return this.inflight;
    }
    this.inflight = this.loop().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async loop() {
    let staleTries = 0;
    const maxStale = this.deps.maxStaleRefetch ?? 3;
    do {
      this.rerun = false;
      let row: CanonicalMapRow;
      try {
        row = await this.deps.fetchCanonical();
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e);
        this.setState("ERROR");
        return;
      }
      if (row) {
        const map = normalizeMapOverrides(row.data);
        // Nunca diminuir: resposta de versão antiga é descartada.
        if (map && row.version > this.version) {
          this.map = map;
          this.version = row.version;
        } else if (map && row.version === this.version && !this.map) {
          this.map = map;
        }
      } else if (this.version === 0) {
        this.map = null;
      }
      if (this.version < this.target) {
        if (++staleTries > maxStale) {
          this.error = `map_version_stale: carregado ${this.version}, esperado ${this.target}`;
          this.setState("ERROR");
          return;
        }
        this.rerun = true;
      }
    } while (this.rerun);
    this.error = null;
    this.state = "READY";
    this.emit();
  }

  private setState(s: MapSyncState) {
    this.state = s;
    this.emit();
  }

  private emit() {
    this.deps.onChange?.(this.snapshot());
  }
}
