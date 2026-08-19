import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSnapshotTransition,
  buildStructuralChangeIndex,
  changeSummaryForEntities,
  changeSummaryForEntity,
  changesForEntities,
  changesForEntity,
  resolveTransitionSelection,
} from "./transition_model.js";

function snapshot(ids, edges = []) {
  return {
    entityIds: new Set(ids),
    hierarchyEdges: edges,
    currentTimepointByEntity: new Map(),
  };
}

const baseData = {
  entities: [
    { id: 1, title: "甲司", type: "机构" },
    { id: 2, title: "乙司", type: "机构" },
    { id: 3, title: "丙司", type: "机构" },
    { id: 10, title: "旧上级", type: "机构" },
    { id: 11, title: "新上级", type: "机构" },
  ],
  timepoints: {
    1: [
      { id: 101, time: "熙宁二年", year_start: 1069, year_end: 1069, time_type: "exact", event: "置甲司", lifecycle_effect: "activate" },
      { id: 102, time: "元丰三年", year_start: 1080, year_end: 1080, time_type: "exact", event: "罢甲司", lifecycle_effect: "deactivate" },
      { id: 103, time: "元祐元年", year_start: 1086, year_end: 1086, time_type: "exact", event: "复置甲司", lifecycle_effect: "activate" },
    ],
    2: [{ id: 201, time: "元丰三年", year_start: 1080, year_end: 1080, time_type: "exact", event: "置乙司", lifecycle_effect: "activate" }],
    3: [{ id: 301, time: "元丰五年", year_start: 1082, year_end: 1082, time_type: "exact", event: "置丙司", lifecycle_effect: "activate" }],
    10: [{ id: 1001, time: "宋初", year_start: 960, year_end: 960, time_type: "exact", event: "旧上级", lifecycle_effect: "activate" }],
    11: [{ id: 1101, time: "元丰三年", year_start: 1080, year_end: 1080, time_type: "exact", event: "新上级", lifecycle_effect: "activate" }],
  },
  hierarchyEdges: [
    { id: 501, parent: 10, child: 1, states: [{ id: 501, subject_timepoint_id: 1001, object_timepoint_id: 101 }] },
    { id: 502, parent: 11, child: 1, states: [{ id: 502, effective_year: 1080, object_timepoint_id: 102 }] },
  ],
  changeRelations: [
    {
      id: 601,
      relation_type: "前后演变",
      classification_status: "unclassified",
      display_relation_type: "前后演变（未分类）",
      source: 1,
      target: 2,
      source_timepoint_id: 102,
      target_timepoint_id: 201,
      quotation: "甲司罢，以乙司承之。",
    },
  ],
  citations: {
    R601: [{ id: 1, citation: "《某书》卷一", quotation: "甲司罢，以乙司承之。" }],
    T103: [{ id: 2, citation: "《某书》卷二", quotation: "复置甲司。" }],
  },
};

test("结构变化索引区分新设、撤销、恢复、改隶和明确关系", () => {
  const index = buildStructuralChangeIndex(baseData);
  assert.deepEqual(
    changesForEntity(index, 1).map((change) => [change.eventYear, change.type]),
    [
      [1069, "create"],
      [1080, "unclassified"],
      [1080, "reparent"],
      [1080, "remove"],
      [1086, "restore"],
    ],
  );
  assert.equal(changesForEntity(index, 1)[1].citations[0].citation, "《某书》卷一");
  assert.equal(
    changesForEntity(index, 10).some((change) => (
      change.type === "reparent"
      && change.previousParentId === 10
      && change.nextParentId === 11
    )),
    true,
  );
  assert.equal(
    changesForEntity(index, 11).some((change) => (
      change.type === "reparent"
      && change.previousParentId === 10
      && change.nextParentId === 11
    )),
    true,
  );
});

test("同一年存在多个上级时不生成改隶记录", () => {
  const data = {
    entities: [
      { id: 1, title: "甲司", type: "机构" },
      { id: 2, title: "乙司", type: "机构" },
      { id: 3, title: "丙司", type: "机构" },
      { id: 4, title: "丁院", type: "机构" },
    ],
    timepoints: {
      1: [{ id: 101, year_start: 1000, year_end: 1000, time_type: "exact", event: "甲司统属丁院", lifecycle_effect: "preserve" }],
      2: [{ id: 201, year_start: 1050, year_end: 1050, time_type: "exact", event: "乙司统属丁院", lifecycle_effect: "preserve" }],
      3: [{ id: 301, year_start: 1050, year_end: 1050, time_type: "exact", event: "丙司统属丁院", lifecycle_effect: "preserve" }],
      4: [
        { id: 401, year_start: 1000, year_end: 1000, time_type: "exact", event: "隶甲司", lifecycle_effect: "preserve" },
        { id: 402, year_start: 1050, year_end: 1050, time_type: "exact", event: "同年有两项上下级记载", lifecycle_effect: "preserve" },
      ],
    },
    hierarchyEdges: [
      { id: 501, parent: 1, child: 4, states: [{ id: 501, subject_timepoint_id: 101, object_timepoint_id: 401 }] },
      { id: 502, parent: 2, child: 4, states: [{ id: 502, subject_timepoint_id: 201, object_timepoint_id: 402 }] },
      { id: 503, parent: 3, child: 4, states: [{ id: 503, subject_timepoint_id: 301, object_timepoint_id: 402 }] },
    ],
    changeRelations: [],
  };

  const index = buildStructuralChangeIndex(data);
  assert.equal(changesForEntity(index, 4).some((change) => change.type === "reparent"), false);
});

test("明确标记的改置和隶属变化进入节点结构变化索引", () => {
  const data = {
    entities: [{ id: 1, title: "甲司", type: "机构" }],
    timepoints: {
      1: [
        {
          id: 101,
          time: "熙宁三年",
          year_start: 1070,
          year_end: 1070,
          time_type: "exact",
          event: "由旧司改置",
          event_type: "reorganize",
          lifecycle_effect: "preserve",
        },
        {
          id: 102,
          time: "元丰五年",
          year_start: 1082,
          year_end: 1082,
          time_type: "exact",
          event: "下属乙所改隶于此",
          event_type: "affiliation_change",
          lifecycle_effect: "preserve",
        },
      ],
    },
    hierarchyEdges: [],
    changeRelations: [],
    citations: {},
  };
  const index = buildStructuralChangeIndex(data);
  assert.deepEqual(
    changesForEntity(index, 1).map((change) => [change.eventYear, change.type]),
    [[1070, "reorganize"], [1082, "reparent"]],
  );
  const summary = changeSummaryForEntity(index, 1, 1080);
  assert.deepEqual(summary.past, { year: 1070, distance: 10, count: 1 });
  assert.deepEqual(summary.future, { year: 1082, distance: 2, count: 1 });
});

test("层级边已记录的改隶时间点不会重复计为结构事件", () => {
  const data = {
    entities: [
      { id: 1, title: "甲司", type: "机构" },
      { id: 2, title: "乙司", type: "机构" },
      { id: 3, title: "丙所", type: "机构" },
    ],
    timepoints: {
      1: [{ id: 101, year_start: 1000, year_end: 1000, time_type: "exact", lifecycle_effect: "preserve" }],
      2: [{ id: 201, year_start: 1050, year_end: 1050, time_type: "exact", lifecycle_effect: "preserve" }],
      3: [
        { id: 301, year_start: 1000, year_end: 1000, time_type: "exact", lifecycle_effect: "preserve" },
        {
          id: 302,
          year_start: 1050,
          year_end: 1050,
          time_type: "exact",
          event: "改隶乙司",
          event_type: "affiliation_change",
          lifecycle_effect: "preserve",
        },
      ],
    },
    hierarchyEdges: [
      { id: 501, parent: 1, child: 3, states: [{ id: 501, subject_timepoint_id: 101, object_timepoint_id: 301 }] },
      { id: 502, parent: 2, child: 3, states: [{ id: 502, subject_timepoint_id: 201, object_timepoint_id: 302 }] },
    ],
    changeRelations: [],
    citations: {},
  };
  const changes = changesForEntity(buildStructuralChangeIndex(data), 3);
  assert.equal(changes.filter((change) => change.eventYear === 1050).length, 1);
  assert.equal(changes[0].type, "reparent");
});

test("变化提示返回最近过去、同年数量和最近未来", () => {
  const index = buildStructuralChangeIndex(baseData);
  const summary = changeSummaryForEntity(index, 1, 1080);
  assert.deepEqual(summary.past, { year: 1069, distance: 11, count: 1 });
  assert.deepEqual(summary.current, { year: 1080, distance: 0, count: 3 });
  assert.deepEqual(summary.future, { year: 1086, distance: 6, count: 1 });
});

test("虚拟组聚合时同一关系不会按两个成员重复计数", () => {
  const index = buildStructuralChangeIndex(baseData);
  const summary = changeSummaryForEntities(index, [1, 2], 1080);
  assert.equal(summary.current.count, 4);
});

test("虚拟组演变轨按时间排序且不会重复列出成员之间的同一关系", () => {
  const index = buildStructuralChangeIndex(baseData);
  const changes = changesForEntities(index, [1, 2]);
  assert.equal(changes.filter((change) => change.key === "explicit:relation:601").length, 1);
  assert.deepEqual(changes.map((change) => change.eventYear), [1069, 1080, 1080, 1080, 1080, 1086]);
});

test("年度快照变化优先保留显式演变并识别改隶", () => {
  const index = buildStructuralChangeIndex(baseData);
  const changes = buildSnapshotTransition({
    data: baseData,
    index,
    fromSnapshot: snapshot([1, 10], [{ parent: 10, child: 1 }]),
    toSnapshot: snapshot([2, 10, 11], [{ parent: 11, child: 2 }]),
    fromYear: 1069,
    toYear: 1080,
    focusEntityId: 1,
  });
  assert.equal(changes.some((change) => change.type === "unclassified"), true);
  assert.equal(changes.some((change) => change.type === "remove" && change.sourceIds[0] === 1), false);
  assert.equal(changes.some((change) => change.type === "create" && change.targetIds[0] === 2), false);
});

test("年度快照不为上下级未变的持续实体生成伪位置变化", () => {
  const changes = buildSnapshotTransition({
    data: baseData,
    fromSnapshot: snapshot([1, 3, 10], [
      { parent: 10, child: 1 },
      { parent: 10, child: 3 },
    ]),
    toSnapshot: snapshot([1, 3, 10, 11], [
      { parent: 11, child: 1 },
      { parent: 10, child: 3 },
    ]),
    fromYear: 1069,
    toYear: 1080,
  });
  assert.equal(changes.some((change) => change.type === "move"), false);
  assert.equal(changes.some((change) => (
    change.type === "reparent" && change.targetIds[0] === 1
  )), true);
  assert.equal(changes.some((change) => change.targetIds[0] === 3), false);
});

test("无来源的新设只标为目标位置出现", () => {
  const data = { ...baseData, changeRelations: [] };
  const changes = buildSnapshotTransition({
    data,
    fromSnapshot: snapshot([1]),
    toSnapshot: snapshot([1, 3]),
    fromYear: 1080,
    toYear: 1082,
  });
  const created = changes.find((change) => change.targetIds.includes(3));
  assert.equal(created.type, "create");
  assert.deepEqual(created.sourceIds, []);
});

test("明确一对一演变可跟随后继，多端点不自动选择", () => {
  const oneToOne = [{ type: "unclassified", sourceIds: [1], targetIds: [2] }];
  assert.deepEqual(resolveTransitionSelection({
    changes: oneToOne,
    currentEntityId: 1,
    targetSnapshot: snapshot([2]),
    fromYear: 1069,
    toYear: 1080,
  }).entityId, 2);

  const multi = [{ type: "unclassified", sourceIds: [1], targetIds: [2, 3] }];
  const result = resolveTransitionSelection({
    changes: multi,
    currentEntityId: 1,
    targetSnapshot: snapshot([2, 3]),
    fromYear: 1069,
    toYear: 1080,
  });
  assert.equal(result.entityId, 1);
  assert.equal(result.reason, "context-only");
});

test("同一实体仍存在时始终保持当前选择", () => {
  const result = resolveTransitionSelection({
    changes: [],
    currentEntityId: 1,
    targetSnapshot: snapshot([1]),
    fromYear: 1069,
    toYear: 1080,
  });
  assert.deepEqual(result, { entityId: 1, reason: "same-entity", change: null });
});
