import assert from "node:assert/strict";
import test from "node:test";

import {
  evolutionLaneIdentityLayout,
  evolutionLaneIdentityTemplate,
  eventStemGeometry,
  laneAnomalySummary,
  relationLabelOverride,
  relationPath,
  relationRouteOptions,
  selectedEvolutionActionOptions,
} from "./evolution_renderer.js";

test("选中演变事件时在主视图提供年份跳转和层级入口", () => {
  const actions = selectedEvolutionActionOptions(
    { kind: "timepoint", item: { effectiveYear: 1080 } },
    1069,
    { targets: [{ entityId: 123, year: 1080, title: "三司" }] },
  );
  assert.deepEqual(actions, [
    { kind: "year", year: 1080, label: "前往1080年" },
    { kind: "hierarchy", year: 1080, entityId: 123, label: "在1080年打开层级" },
  ]);
});

test("官职时间点没有明确编制机构时显示原因而不生成错误入口", () => {
  const actions = selectedEvolutionActionOptions(
    { kind: "timepoint", item: { effectiveYear: 1080 } },
    1069,
    { targets: [], message: "1080年没有明确编制机构" },
  );
  assert.deepEqual(actions, [
    { kind: "year", year: 1080, label: "前往1080年" },
    { kind: "status", label: "1080年没有明确编制机构" },
  ]);
});

test("选中多端点关系时保留来源和目标的独立年份按钮", () => {
  const actions = selectedEvolutionActionOptions(
    {
      kind: "relation",
      item: {
        sourcePoints: [{ entityId: 1, timepointId: 11, effectiveYear: 1069 }],
        targetPoints: [
          { entityId: 2, timepointId: 21, effectiveYear: 1080 },
          { entityId: 3, timepointId: 31, effectiveYear: 1080 },
        ],
      },
    },
    1069,
    { targets: [{ entityId: 1, year: 1069, title: "三司" }] },
  );
  assert.deepEqual(actions, [
    { kind: "year", year: 1069, label: "前往来源1069年" },
    { kind: "year", year: 1080, label: "前往目标1080年" },
    { kind: "hierarchy", year: 1069, entityId: 1, label: "在1069年打开层级" },
  ]);
});

test("演变轨道机构图标直接复用原设计 SVG 的尚书省 polygon", () => {
  assert.deepEqual(evolutionLaneIdentityTemplate("机构"), {
    bounds: { x: 747.3, y: 160.96, width: 33.22, height: 126.85 },
    points: "776.76 162.84 776.76 160.96 768.66 160.96 759.16 160.96 751.06 160.96 751.06 162.84 751.05 164.72 749.18 164.72 747.3 164.72 747.3 287.81 780.52 287.81 780.52 164.72 778.64 164.72 776.76 164.72 776.76 162.84",
    strokeWidth: 2,
  });
});

test("演变轨道官职图标直接复用原设计 SVG 的官职框和帽形 polygon", () => {
  assert.deepEqual(evolutionLaneIdentityTemplate("官职"), {
    bounds: { x: 794.72, y: 168.45, width: 15.42, height: 110.6 },
    body: { x: 794.72, y: 177.46, width: 15.42, height: 101.59 },
    capPoints: "796.71 169.86 798.15 168.45 807.28 168.45 808.73 169.86 808.73 175.37 796.71 175.37 796.71 169.86",
    bodyStrokeWidth: 0.51,
    capStrokeWidth: 0.84,
  });
});

test("机构牌和官职牌使用同一条竖直中心轴", () => {
  const institution = evolutionLaneIdentityLayout("机构", 102, 520, 112);
  const official = evolutionLaneIdentityLayout("官职", 102, 520, 112);

  assert.equal(institution.centerX, official.centerX);
  assert.equal(institution.x + institution.width / 2, institution.centerX);
  assert.equal(official.x + official.width / 2, official.centerX);
});

function endpoint(x, y, iconType = "record") {
  return { x, y, timepointId: `${x}:${y}`, iconType };
}

function cubicPoint(path, t) {
  const values = path.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const inverse = 1 - t;
  return {
    x: inverse ** 3 * values[0]
      + 3 * inverse ** 2 * t * values[2]
      + 3 * inverse * t ** 2 * values[4]
      + t ** 3 * values[6],
    y: inverse ** 3 * values[1]
      + 3 * inverse ** 2 * t * values[3]
      + 3 * inverse * t ** 2 * values[5]
      + t ** 3 * values[7],
  };
}

test("关系箭头停在时间点图形外缘而不是中心", () => {
  const path = relationPath(endpoint(100, 100), endpoint(200, 100, "abolish"));
  const numbers = path.match(/-?\d+(?:\.\d+)?/g).map(Number);

  assert.equal(numbers[0], 103.1);
  assert.equal(numbers.at(-2), 194.2);
  assert.equal(numbers.at(-1), 100);
  assert.equal(numbers.at(-3), 100);
});

test("跨轨关系箭头沿目标图标中心线进入而不是指向轨道线", () => {
  const path = relationPath(endpoint(100, 160), endpoint(100, 80, "abolish"));
  const numbers = path.match(/-?\d+(?:\.\d+)?/g).map(Number);

  assert.equal(numbers[1], 156.9);
  assert.equal(numbers.at(-2), 100);
  assert.equal(numbers.at(-1), 85.8);
  assert.equal(numbers.at(-3), 103.4);
  assert.equal(numbers.at(-4), 100);
});

test("普通圆点端精确接到空心圆外沿，不重叠也不留断口", () => {
  const path = relationPath(endpoint(100, 100), endpoint(160, 150));
  const numbers = path.match(/-?\d+(?:\.\d+)?/g).map(Number);

  assert.ok(Math.abs(Math.hypot(numbers[0] - 100, numbers[1] - 100) - 3.1) < 1e-9);
  assert.ok(Math.abs(Math.hypot(numbers.at(-2) - 160, numbers.at(-1) - 150) - 3.1) < 1e-9);
});

test("同年错层事件的回指线独立于事件图标计算，供底层先行绘制", () => {
  assert.deepEqual(eventStemGeometry({
    id: 11,
    displaced: true,
    baseX: 200,
    baseY: 140,
    displayX: 200,
    y: 102,
  }), {
    x1: 200,
    y1: 140,
    x2: 200,
    y2: 102,
    anchorX: 200,
    anchorY: 140,
  });
  assert.equal(eventStemGeometry({
    displaced: false,
    baseX: 200,
    baseY: 140,
    displayX: 200,
    y: 140,
  }), null);
});

test("时间链异常图标旁显示具体说明，窄空间退化为短标签", () => {
  const anomalies = [{ type: "nonreciprocal_chain_link" }];
  assert.equal(laneAnomalySummary(anomalies), "前后指针不一致");
  assert.equal(laneAnomalySummary(anomalies, 2), "异常");
  assert.equal(laneAnomalySummary([
    { type: "branching_timeline" },
    { type: "timeline_cycle" },
  ]), "时间链异常×2");
});

test("太常寺至宗正寺的目标曲线加深弯曲并绕开上方圆点", () => {
  const relation = { id: 4010 };
  const source = {
    x: 1165.2918996865203,
    y: 300,
    timepointId: 4325,
    iconType: "abolish",
  };
  const target = {
    x: 1183.3467836990594,
    y: 784,
    timepointId: 4774,
    iconType: "establish",
  };
  const obstacle = { x: 1183.3467836990594, y: 772 };
  const baseline = relationPath(source, target);
  const routed = relationPath(source, target, relationRouteOptions(relation, source, target));
  const minimumDistance = Math.min(...Array.from({ length: 401 }, (_, index) => {
    const point = cubicPoint(routed, index / 400);
    return Math.hypot(point.x - obstacle.x, point.y - obstacle.y);
  }));

  assert.notEqual(routed, baseline);
  assert.ok(minimumDistance > 5);
  assert.deepEqual(
    relationRouteOptions({ id: 9999 }, source, target),
    {},
  );
});

test("成对前后演变标签分别贴在两条曲线中段外侧", () => {
  const incomingSource = {
    x: 1165.2918996865203,
    y: 784,
    timepointId: 4773,
    iconType: "record",
  };
  const incomingTarget = {
    x: 1165.2918996865203,
    y: 300,
    timepointId: 4325,
    iconType: "abolish",
  };
  const outgoingTarget = {
    x: 1183.3467836990594,
    y: 784,
    timepointId: 4774,
    iconType: "establish",
  };
  const incoming = relationLabelOverride(
    { id: 4009 },
    incomingSource,
    incomingTarget,
  );
  const outgoing = relationLabelOverride(
    { id: 4010 },
    incomingTarget,
    outgoingTarget,
  );

  assert.ok(incoming.x > 1200);
  assert.ok(outgoing.x < 1130);
  assert.ok(incoming.x - outgoing.x > 90);
  assert.equal(relationLabelOverride({ id: 9999 }, incomingSource, incomingTarget), null);
});
