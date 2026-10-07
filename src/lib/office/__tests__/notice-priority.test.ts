import { expect, it } from "vitest";
import { selectOfficeNotices, type OfficeNoticeEntry } from "../notice-priority";

it("actions preempt information and precede celebration", () => {
  const entries: OfficeNoticeEntry[] = [
    { id: "info1", kind: "informational", sequence: 0 },
    { id: "info2", kind: "informational", sequence: 1 },
    { id: "bell", kind: "celebration", sequence: 2 },
    { id: "join", kind: "action", sequence: 3 },
  ];
  expect(selectOfficeNotices(entries)).toEqual(["join", "bell", "info1"]);
  expect(selectOfficeNotices(entries.filter((entry) => entry.id !== "join"))).toEqual(["bell", "info1", "info2"]);
});

it("never hides any action to enforce the approximate cap", () => {
  const entries: OfficeNoticeEntry[] = Array.from({ length: 5 }, (_, index) => ({ id: `action${index}`, kind: "action", sequence: index }));
  entries.push({ id: "info", kind: "informational", sequence: 6 });
  expect(selectOfficeNotices(entries)).toEqual(entries.slice(0, 5).map((entry) => entry.id));
});