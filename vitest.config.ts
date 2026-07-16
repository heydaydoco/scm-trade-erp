import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * 정합성 테스트 하네스 (SPEC §8 — "각 단계마다 정합성 테스트를 코드 전에 작성").
 *
 * 범위: I/O 없는 순수 로직만. DB 하네스(도커·Supabase CLI)는 P4.3 전 재평가.
 * DB 정합성은 scripts/checks.sql 검산 세트로 오너가 Run 한다.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
