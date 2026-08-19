import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evolutionLaneTitleMetrics } from "../renderers/evolution_renderer.js";

describe("evolutionLaneTitleMetrics", () => {
  it("14px 竖排实体名逐字分开且仍限制在签条高度内", () => {
    const metrics = evolutionLaneTitleMetrics(100, 198);

    assert.equal(metrics.pitch, 16);
    assert.equal(metrics.maxChars, 6);
    assert.ok(metrics.pitch > 14);
    assert.ok((5 - 1) * metrics.pitch < 98);
  });

  it("短签条减少可见字数而不压缩字距", () => {
    assert.deepEqual(evolutionLaneTitleMetrics(100, 140), { pitch: 16, maxChars: 3 });
  });
});
