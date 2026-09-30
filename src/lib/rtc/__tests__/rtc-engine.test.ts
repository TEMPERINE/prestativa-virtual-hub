import { describe, expect, it } from "vitest";
import { DEFAULT_RTC_ENGINE, getRtcEngine, parseRtcEngine } from "@/lib/rtc/rtc-engine";

describe("feature flag VITE_RTC_ENGINE", () => {
  it("aceita v1 e v2", () => {
    expect(parseRtcEngine("v1")).toBe("v1");
    expect(parseRtcEngine("v2")).toBe("v2");
    expect(parseRtcEngine("  V1 ")).toBe("v1");
    expect(parseRtcEngine("V2")).toBe("v2");
  });
  it("padrão é v2 (ausente ou inválido)", () => {
    expect(DEFAULT_RTC_ENGINE).toBe("v2");
    expect(parseRtcEngine(undefined)).toBe("v2");
    expect(parseRtcEngine("")).toBe("v2");
    expect(parseRtcEngine("xyz")).toBe("v2");
  });
  it("getRtcEngine retorna valor válido", () => {
    expect(["v1", "v2"]).toContain(getRtcEngine());
  });
});
