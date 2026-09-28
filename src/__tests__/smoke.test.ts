import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";
import { parseRtcEngine } from "@/lib/rtc/rtc-engine";

describe("ambiente de testes", () => {
  it("resolve o alias @/ para src/", () => {
    expect(typeof cn).toBe("function");
    expect(cn("a", undefined, "c")).toBe("a c");
    expect(typeof parseRtcEngine).toBe("function");
  });
});
