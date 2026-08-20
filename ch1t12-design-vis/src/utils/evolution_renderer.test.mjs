import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evolutionEventIconSize,
  evolutionLaneTitleMetrics,
} from "../renderers/evolution_renderer.js";

describe("evolutionEventIconSize", () => {
  it("主图未选中事件与图例使用同一尺寸", () => {
    assert.equal(evolutionEventIconSize("record"), 4.2);
    assert.equal(evolutionEventIconSize("establish"), 7.2);
    assert.equal(evolutionEventIconSize("abolish"), 7.2);
    assert.equal(evolutionEventIconSize("affiliation_change"), 7);
  });

  it("选中态只在图例基准上增加一级强调", () => {
    assert.equal(evolutionEventIconSize("record", true), 5.2);
    assert.equal(evolutionEventIconSize("establish", true), 8.2);
    assert.equal(evolutionEventIconSize("affiliation_change", true), 8);
  });
});

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
