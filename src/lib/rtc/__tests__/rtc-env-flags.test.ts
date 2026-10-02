import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getRtcEngine } from "@/lib/rtc/rtc-engine";
import { getRtcOnDemand } from "@/lib/rtc/rtc-demand-controller";

/**
 * Regressão: as flags VITE_RTC_ENGINE / VITE_RTC_ON_DEMAND precisam ser lidas
 * com acesso DIRETO (import.meta.env.X). Com optional chaining
 * (import.meta?.env?.X) o Vite não injeta o valor e a flag fica inerte,
 * caindo sempre no default — foi assim que o rollback para v1 e o
 * RTC On Demand ficaram mascarados.
 */

const ENV_KEYS = ["VITE_RTC_ENGINE", "VITE_RTC_ON_DEMAND"] as const;
const saved: Record<string, unknown> = {};

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (k in saved) {
      (import.meta.env as Record<string, unknown>)[k] = saved[k];
      delete saved[k];
    }
  }
});

function setEnv(key: (typeof ENV_KEYS)[number], value: unknown) {
  if (!(key in saved)) saved[key] = (import.meta.env as Record<string, unknown>)[key];
  (import.meta.env as Record<string, unknown>)[key] = value;
}

describe("leitura efetiva das flags de ambiente (regressão)", () => {
  it("getRtcEngine reflete import.meta.env.VITE_RTC_ENGINE", () => {
    setEnv("VITE_RTC_ENGINE", "v1");
    expect(getRtcEngine()).toBe("v1");
    setEnv("VITE_RTC_ENGINE", "v2");
    expect(getRtcEngine()).toBe("v2");
    setEnv("VITE_RTC_ENGINE", undefined);
    expect(getRtcEngine()).toBe("v2"); // default
  });

  it("getRtcOnDemand reflete import.meta.env.VITE_RTC_ON_DEMAND", () => {
    setEnv("VITE_RTC_ON_DEMAND", "private");
    expect(getRtcOnDemand()).toBe("private");
    setEnv("VITE_RTC_ON_DEMAND", "all");
    expect(getRtcOnDemand()).toBe("private"); // fallback explícito da Fase 1
    setEnv("VITE_RTC_ON_DEMAND", undefined);
    expect(getRtcOnDemand()).toBe("off"); // default
  });

  it("código-fonte não usa optional chaining na leitura das flags", () => {
    for (const file of ["rtc-engine.ts", "rtc-demand-controller.ts"]) {
      const src = readFileSync(resolve(__dirname, "..", file), "utf8");
      expect(src, `${file} não pode ler flag com import.meta?.env?`).not.toMatch(
        /import\.meta\?\.env\?/,
      );
    }
  });
});
