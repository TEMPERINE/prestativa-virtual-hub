// Versão atual do app. Atualize a cada release publicada.
// Convenção: SemVer + canal (-beta, -rc, ou vazio para estável).
// Sempre atualize CHANGELOG.md junto.

export type AppChannel = "beta" | "rc" | "stable";

export const APP_VERSION = "1.0.0";
export const APP_CHANNEL: AppChannel = "stable";

export const APP_VERSION_LABEL: string =
  (APP_CHANNEL as AppChannel) === "stable"
    ? `v${APP_VERSION}`
    : `v${APP_VERSION}-${APP_CHANNEL}`;

export const APP_NAME = "Prestativa Virtual Office";
