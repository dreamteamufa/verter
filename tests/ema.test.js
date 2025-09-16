// tests/ema.test.js — модульный формат (ESM)
import test from "node:test";
import assert from "node:assert/strict";

// простая EMA для проверки
function ema(values, period) {
  const k = 2 / (period + 1);
  let prev = values[0];
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
  }
  return prev.toFixed(6);
}

// тест на стабильность EMA(10)
test("EMA(10) стабильность", () => {
  const v = Array.from({ length: 50 }, (_, i) => 100 + i * 0.1);
  assert.ok(Math.abs(ema(v, 10) - 104.0) < 0.5);
});
