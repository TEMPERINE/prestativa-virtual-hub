import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, it } from "vitest";
import { createJoinInviteCenter } from "../join-invitations";

// Execute the actual Office handlers without mounting media, Supabase, or the map.
// Geometry and network are host boundaries; the popup/action wiring is real source.
const source = ts.createSourceFile("OfficeScene.tsx", readFileSync("src/components/office/OfficeScene.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function handler(name: string, env: Record<string, unknown>) {
  let found: ts.Node | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer && ts.isCallExpression(node.initializer)) found = node.initializer.arguments[0];
    if (name === "showPopup" && ts.isPropertyAssignment(node) && node.name.getText(source) === name && node.initializer.getText(source).includes("acceptJoinRef")) found = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!found) throw new Error(`Office handler ${name} not found`);
  return runInNewContext(ts.transpile(`var action = ${found.getText(source)}; action;`, { target: ts.ScriptTarget.ES2020 }), env);
}

function setup() {
  let position = { x: 50, y: 60 };
  const broadcasts: Array<{ event: string }> = [];
  let popup: { action: { onClick(): void }; cancel: { onClick(): void } };
  const env = {
    leadChannelRef: { current: { send: (event: { event: string }) => broadcasts.push(event) } },
    meIdRef: { current: "me" }, positionsRef: { current: { me: position } },
    profilesRef: { current: { ana: { display_name: "Ana" } } },
    callZoneAt: () => "meeting-zone",
    nearbyWalkablePoint: (point: typeof position) => point,
    teleportToPoint: (point: typeof position) => { position = point; },
  };
  const accept = handler("acceptJoin", env);
  const decline = handler("declineJoin", env);
  const centerRef: { current: ReturnType<typeof createJoinInviteCenter> | null } = { current: null };
  const show = handler("showPopup", { joinCenterRef: centerRef, acceptJoinRef: { current: accept }, declineJoinRef: { current: decline }, toast: (_title: string, options: typeof popup) => { popup = options; } });
  const center = createJoinInviteCenter({ service: () => null, isBackground: () => false, showPopup: show, playSound: () => {} });
  centerRef.current = center;
  center.receive({ fromUid: "ana", fromName: "Ana", fromPos: { x: 10, y: 20 }, at: Date.now() });
  return { center, popup: () => popup!, position: () => position, broadcasts };
}

it("receiving or revealing invite never teleports; Accept is the only movement action", () => {
  const s = setup(); s.center.restore("ana");
  expect(s.position()).toEqual({ x: 50, y: 60 }); expect(s.broadcasts).toEqual([]);
  s.popup().action.onClick();
  expect(s.position()).toEqual({ x: 10, y: 20 });
  expect(s.broadcasts.map(e => e.event)).toEqual(["join-accept"]);
  expect(s.center.getPending("ana")).toBeNull();
});

it("Refuse sends decline and resolves pending invite without moving avatar", () => {
  const s = setup(); s.popup().cancel.onClick();
  expect(s.position()).toEqual({ x: 50, y: 60 });
  expect(s.broadcasts.map(e => e.event)).toEqual(["join-decline"]);
  expect(s.center.getPending("ana")).toBeNull();
});
