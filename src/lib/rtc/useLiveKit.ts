/**
 * Fachada useLiveKit (RTC v2, Etapa 12).
 *
 * A implementação é escolhida UMA vez, no carregamento do módulo, a partir de
 * VITE_RTC_ENGINE (ausente/inválido = v1). Em cada execução só um hook é
 * chamado — nunca v1 e v2 juntos — respeitando as Rules of Hooks.
 */
import { getRtcEngine, type RtcEngine } from "./rtc-engine";
import { useLiveKitV1 } from "./useLiveKit-v1";
import { useLiveKitV2, type RtcV2HookConfig, type RtcV2Controls } from "./useLiveKit-v2";
import type { RtcMeshState } from "./useLiveKit-v1";

export type { RtcMeshState, RtcConnectionStatus } from "./useLiveKit-v1";
export type { RtcV2HookConfig, RtcV2Controls } from "./useLiveKit-v2";

export type LiveKitState = RtcMeshState & { v2: RtcV2Controls | null };

type Hook = (
  myId: string | null,
  roomKey: string | null,
  videoVisibleIds?: ReadonlySet<string> | null,
  v2Config?: RtcV2HookConfig | null,
) => LiveKitState;

export function selectLiveKitHook(engine: RtcEngine): Hook {
  if (engine === "v2") return useLiveKitV2;
  const v1: Hook = (myId, roomKey, videoVisibleIds) => ({
    // eslint-disable-next-line react-hooks/rules-of-hooks -- escolha estável por execução
    ...useLiveKitV1(myId, roomKey, videoVisibleIds),
    v2: null,
  });
  return v1;
}

export const ACTIVE_RTC_ENGINE: RtcEngine = getRtcEngine();

/** Hook público. v1 ignora v2Config; v2 ignora roomKey/videoVisibleIds. */
export const useLiveKit: Hook = selectLiveKitHook(ACTIVE_RTC_ENGINE);
