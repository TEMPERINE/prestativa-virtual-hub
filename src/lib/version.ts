// Versão atual do app. Atualize a cada release publicada.
// Convenção: SemVer + canal (-beta, -rc, ou vazio para estável).
// Sempre atualize CHANGELOG.md junto.

export const APP_VERSION = "0.1.0";
export const APP_CHANNEL: "beta" | "rc" | "stable" = "beta";

export const APP_VERSION_LABEL =
  APP_CHANNEL === "stable" ? `v${APP_VERSION}` : `v${APP_VERSION}-${APP_CHANNEL}`;

export const APP_NAME = "Prestativa Virtual Office";
