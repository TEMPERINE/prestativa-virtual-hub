/**
 * Último microfone escolhido — preferência LOCAL ao navegador.
 *
 * Guarda só o deviceId (nunca "mic ligado"): novo login continua mic OFF.
 * Não vai ao banco nem sincroniza entre computadores. Nenhuma leitura aqui
 * pede permissão ou abre captura.
 */

export interface KeyValueStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export function micPreferenceKey(userId: string): string {
  return `prestativa-office:last-mic-device:${userId}`;
}

function defaultStore(): KeyValueStore | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadMicPreference(
  userId: string,
  store: KeyValueStore | null = defaultStore(),
): string | null {
  if (!store || !userId) return null;
  try {
    const v = store.getItem(micPreferenceKey(userId));
    return v && v !== "default" ? v : null;
  } catch {
    return null;
  }
}

export function saveMicPreference(
  userId: string,
  deviceId: string | null | undefined,
  store: KeyValueStore | null = defaultStore(),
): void {
  if (!store || !userId) return;
  try {
    if (deviceId && deviceId !== "default") store.setItem(micPreferenceKey(userId), deviceId);
    else store.removeItem(micPreferenceKey(userId));
  } catch {
    /* storage indisponível: preferência só em memória */
  }
}

/**
 * Após uma captura: a escolha do usuário NUNCA é sobrescrita pelo fallback
 * (headset desligado por um momento não apaga a preferência). Só sem
 * preferência salva o dispositivo que funcionou é exibido. Retorna o id efetivo.
 */
export function reconcileAcquiredMic(
  _userId: string,
  preferred: string | null,
  acquired: string | null | undefined,
  _store: KeyValueStore | null = defaultStore(),
): string | null {
  if (preferred) return preferred;
  return acquired && acquired !== "default" ? acquired : null;
}

// ===== Câmera: mesma regra (só deviceId, nunca "câmera ligada") =====
export function cameraPreferenceKey(userId: string): string {
  return `prestativa-office:last-cam-device:${userId}`;
}
export function loadCameraPreference(userId: string, store: KeyValueStore | null = defaultStore()): string | null {
  if (!store || !userId) return null;
  try {
    const v = store.getItem(cameraPreferenceKey(userId));
    return v && v !== "default" ? v : null;
  } catch {
    return null;
  }
}
export function saveCameraPreference(
  userId: string,
  deviceId: string | null | undefined,
  store: KeyValueStore | null = defaultStore(),
): void {
  if (!store || !userId) return;
  try {
    if (deviceId && deviceId !== "default") store.setItem(cameraPreferenceKey(userId), deviceId);
    else store.removeItem(cameraPreferenceKey(userId));
  } catch {
    /* ignore */
  }
}
