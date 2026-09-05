import assert from "node:assert/strict";
import test from "node:test";
import {
  estimateResponseMinutes,
  responseDurationLabel,
  type RequestResponseStatistics,
} from "../lib/request-estimate.ts";

const typical: RequestResponseStatistics = {
  sampleSize: 20,
  averageMinutes: 52,
  medianMinutes: 45,
  percentile85Minutes: 75,
  standardDeviationMinutes: 20,
  meanDeviationMinutes: 16,
};

test("só estima com uma amostra minimamente confiável", () => {
  assert.equal(estimateResponseMinutes({ ...typical, sampleSize: 4 }), null);
});

test("combina tendência central e dispersão em um prazo conservador", () => {
  assert.equal(estimateResponseMinutes(typical), 75);
  assert.equal(responseDurationLabel(75), "1h15");
});

test("limita valores atípicos a sete dias", () => {
  assert.equal(
    estimateResponseMinutes({
      ...typical,
      averageMinutes: 50_000,
      percentile85Minutes: 50_000,
    }),
    10_080,
  );
  assert.equal(responseDurationLabel(10_080), "168 horas");
});
