import { describe, expect, it } from "vitest";
import {
  DEFAULT_RTC_ENGINE,
  getRtcEngine,
  parseRtcEngine,
} from "@/lib/rtc/rtc-engine";

describe("feature flag VITE_RTC_ENGINE", () => {
  it('deve aceitar "v1" como valor valido', () => {
    expect(parseRtcEngine("v1")).toBe("v1");
  });

  it('deve aceitar "v2" como valor valido', () => {
    expect(parseRtcEngine("v2")).toBe("v2");
  });

  it("deve retornar v1 quando a variavel esta ausente", () => {
    expect(parseRtcEngine(undefined)).toBe("v1");
    expect(parseRtcEngine(null)).toBe("v1");
    expect(parseRtcEngine("")).toBe("v1");
    expect(DEFAULT_RTC_ENGINE).toBe("v1");
  });

  it("deve retornar v1 quando o valor e invalido", () => {
    expect(parseRtcEngine("v3")).toBe("v1");
    expect(parseRtcEngine("livekit")).toBe("v1");
    expect(parseRtcEngine("true")).toBe("v1");
    expect(parseRtcEngine("  V2  ".slice(0, 0) + "xyz")).toBe("v1");
  });

  it("deve aceitar valores com espacos e maiusculas/minusculas", () => {
    expect(parseRtcEngine("  v2  ")).toBe("v2");
    expect(parseRtcEngine("V2")).toBe("v2");
    expect(parseRtcEngine("V1")).toBe("v1");
  });

  it("getRtcEngine deve retornar sempre um valor valido com fallback seguro", () => {
    const engine = getRtcEngine();
    expect(["v1", "v2"]).toContain(engine);
  });
});
