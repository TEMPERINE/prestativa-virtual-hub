import type { MediaContext } from "./media-context";

/** Nome canônico da Room LiveKit (único ponto; usado pelo RoomManager e pelo token v2). */
export function roomNameFor(workspaceId: string, ctx: MediaContext): string | null {
  if (ctx.kind === "OFFLINE") return null;
  return `prestativa-office:${workspaceId}:${ctx.kind === "LOBBY" ? "lobby" : ctx.zoneId}`;
}
