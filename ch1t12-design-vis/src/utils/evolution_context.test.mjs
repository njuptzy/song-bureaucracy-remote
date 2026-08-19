import assert from "node:assert/strict";
import test from "node:test";
import {
  evolutionSelectionComparison,
  formatYearOffset,
  resolveHierarchyReturnContext,
  resolveHierarchyReturnContexts,
  staffEdgesForEvolutionTimepoint,
  yearOffset,
} from "./evolution_context.js";

test("入口年份距离使用带符号年份差", () => {
  assert.equal(formatYearOffset(1069, 1069), "同年");
  assert.equal(formatYearOffset(1069, 1080), "+11年");
  assert.equal(formatYearOffset(1069, 1058), "-11年");
  assert.equal(formatYearOffset(1069, null), "距入口年份未定");
  assert.equal(yearOffset(1069, 1080), 11);
});

test("选中事件返回入口距离", () => {
  const comparison = evolutionSelectionComparison({
    kind: "timepoint",
    item: { effectiveYear: 1080 },
  }, 1069);
  assert.deepEqual(comparison, {
    kind: "timepoint",
    year: 1080,
    offset: 11,
    label: "+11年",
  });
});

test("多端点关系分别保留来源和目标距离", () => {
  const comparison = evolutionSelectionComparison({
    kind: "relation",
    item: {
      sourcePoints: [{ entityId: 1, effectiveYear: 1069 }],
      targetPoints: [
        { entityId: 2, effectiveYear: 1080 },
        { entityId: 3, effectiveYear: null },
      ],
    },
  }, 1069);
  assert.deepEqual(comparison.endpoints.map(({ role, entityId, label }) => (
    [role, entityId, label]
  )), [
    ["source", 1, "同年"],
    ["target", 2, "+11年"],
    ["target", 3, "距入口年份未定"],
  ]);
});

test("机构和官职都能解析为当前层级中的机构路径", () => {
  const entities = [
    { id: 1, title: "上级", type: "机构", category: "中央机构" },
    { id: 2, title: "下属", type: "机构", category: "中央机构" },
    { id: 3, title: "官职", type: "官职" },
  ];
  const hierarchyEdges = [{ id: 10, parent: 1, child: 2 }];
  const staffEdges = [{ org: 2, official: 3 }];
  assert.deepEqual(
    resolveHierarchyReturnContext({
      entityId: 3,
      entities,
      hierarchyEdges,
      staffEdges,
      activeEntityIds: new Set([1, 2, 3]),
    }),
    {
      requestedEntityId: 3,
      institutionId: 2,
      institutionTitle: "下属",
      rootId: 1,
      path: [1, 2],
      active: true,
    },
  );
});

test("入口年份中机构不存续时返回 inactive 而不制造节点", () => {
  const context = resolveHierarchyReturnContext({
    entityId: 2,
    entities: [
      { id: 1, type: "机构" },
      { id: 2, type: "机构" },
    ],
    hierarchyEdges: [{ parent: 1, child: 2 }],
    activeEntityIds: new Set([1]),
  });
  assert.equal(context.active, false);
  assert.deepEqual(context.path, [1, 2]);
});

test("官职只从传入年份快照的编制关系解析机构", () => {
  const entities = [
    { id: 1, title: "甲机构", type: "机构" },
    { id: 2, title: "乙机构", type: "机构" },
    { id: 3, title: "官职", type: "官职" },
  ];
  assert.equal(resolveHierarchyReturnContext({
    entityId: 3,
    entities,
    staffEdges: [{ org: 2, official: 3 }],
  }).institutionId, 2);
  assert.equal(resolveHierarchyReturnContext({
    entityId: 3,
    entities,
    staffEdges: [],
  }), null);
});

test("官职同年有多个编制机构时完整返回而不擅自选择", () => {
  const contexts = resolveHierarchyReturnContexts({
    entityId: 3,
    entities: [
      { id: 1, title: "甲机构", type: "机构" },
      { id: 2, title: "乙机构", type: "机构" },
      { id: 3, title: "官职", type: "官职" },
    ],
    staffEdges: [
      { org: 1, official: 3 },
      { org: 2, official: 3 },
      { org: 2, official: 3 },
    ],
  });
  assert.deepEqual(
    contexts.map(({ institutionId, institutionTitle }) => [institutionId, institutionTitle]),
    [[1, "甲机构"], [2, "乙机构"]],
  );
  assert.equal(resolveHierarchyReturnContext({
    entityId: 3,
    entities: [
      { id: 1, title: "甲机构", type: "机构" },
      { id: 2, title: "乙机构", type: "机构" },
      { id: 3, title: "官职", type: "官职" },
    ],
    staffEdges: [{ org: 1, official: 3 }, { org: 2, official: 3 }],
  }), null);
});

test("官职时间点优先使用该点直接挂接且当年仍有效的编制", () => {
  const selected = staffEdgesForEvolutionTimepoint({
    officialId: 3,
    timepointId: 30,
    staffEdges: [
      { org: 1, official: 3, states: [{ object_timepoint_id: 30 }] },
      { org: 2, official: 3, states: [{ object_timepoint_id: 31 }] },
      { org: 4, official: 3, states: [{ object_timepoint_id: 30 }] },
    ],
    snapshotStaffEdges: [
      { org: 1, official: 3 },
      { org: 2, official: 3 },
    ],
  });
  assert.deepEqual(selected.map((edge) => edge.org), [1]);
});

test("官职时间点没有直接编制关系时回退到该年全部有效编制", () => {
  const selected = staffEdgesForEvolutionTimepoint({
    officialId: 3,
    timepointId: 30,
    staffEdges: [{ org: 1, official: 3, states: [{ object_timepoint_id: 31 }] }],
    snapshotStaffEdges: [
      { org: 1, official: 3 },
      { org: 2, official: 3 },
      { org: 4, official: 5 },
    ],
  });
  assert.deepEqual(selected.map((edge) => edge.org), [1, 2]);
});
