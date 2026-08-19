import test from "node:test";
import assert from "node:assert/strict";
import { applyRevisionPreview } from "./revision_patch.js";
import { buildEvolutionModel } from "./evolution_model.js";

const base = {
  entities: [
    { id: 1, title: "甲司", type: "机构" },
    { id: 2, title: "乙司", type: "机构" },
    { id: 3, title: "丙司", type: "机构" },
  ],
  timepoints: {
    1: [{ id: 10, time: "1000年", year_start: 1000, year_end: 1000 }],
    2: [{ id: 20, time: "1010年", year_start: 1010, year_end: 1010 }],
    3: [{ id: 30, time: "1020年", year_start: 1020, year_end: 1020 }],
  },
  preSongTimepoints: {},
  changeRelations: [{
    id: 100, relation_type: "前后演变", source: 1, target: 2,
    source_timepoint_id: 10, target_timepoint_id: 20,
  }],
  evolutionEdges: [{ id: 100, source: 1, target: 2, states: [] }],
  citations: { T10: [{ id: 1000, citation: "出处", quotation: "原文" }] },
};

test("增量补丁只复制受影响时间点桶并保留原位置虚影", () => {
  const preview = {
    patch: {
      timepoints: { upsert: [{ id: 10, entity_id: 1, time: "1005年", year_start: 1005, year_end: 1005 }], delete: [] },
      relationships: { upsert: [], delete: [] },
      citations: { upsert: [], delete: [] },
    },
    differences: [{
      action: "update", target_table: "Timepoints", target_id: 10, automatic: false,
      before: { ...base.timepoints[1][0], entity_id: 1 },
      after: { ...base.timepoints[1][0], entity_id: 1, time: "1005年" },
    }],
    affected_entity_ids: [1],
  };
  const result = applyRevisionPreview(base, preview);
  assert.notEqual(result.timepoints, base.timepoints);
  assert.equal(result.timepoints[2], base.timepoints[2]);
  assert.equal(result.timepoints[1].find((row) => row.id === 10)._revision_status, "modified");
  assert.equal(result.timepoints[1].find((row) => row.id === "before:10")._revision_status, "before");
  assert.equal(base.timepoints[1].length, 1);
});

test("删除关系保留淡化虚影，新增关系绑定补丁后的端点实体", () => {
  const preview = {
    patch: {
      timepoints: { upsert: [], delete: [] },
      relationships: {
        upsert: [{ id: "tmp:r", subject_id: 20, object_id: 30, relation_type: "前后演变", quotation: "乙改丙" }],
        delete: [100],
      },
      citations: { upsert: [], delete: [] },
    },
    differences: [
      { action: "delete", target_table: "Relationships", target_id: 100, automatic: false, before: { id: 100, subject_id: 10, object_id: 20, relation_type: "前后演变" } },
      { action: "insert", target_table: "Relationships", target_id: "tmp:r", automatic: false, before: null, after: { id: "tmp:r", subject_id: 20, object_id: 30, relation_type: "前后演变" } },
    ],
  };
  const result = applyRevisionPreview(base, preview);
  const deleted = result.changeRelations.find((row) => row.id === "deleted:100");
  const added = result.changeRelations.find((row) => row.id === "tmp:r");
  assert.equal(deleted._revision_status, "deleted");
  assert.equal(added._revision_status, "added");
  assert.deepEqual([added.source, added.target], [2, 3]);
});

test("引用补丁按目标键增量合并", () => {
  const result = applyRevisionPreview(base, {
    patch: {
      timepoints: { upsert: [], delete: [] },
      relationships: { upsert: [], delete: [] },
      citations: {
        upsert: [{ id: "tmp:c", target_table: "Timepoints", target_id: 10, citation: "新出处", quotation: "新引文" }],
        delete: [1000],
      },
    },
    differences: [],
  });
  assert.equal(result.citations.T10.length, 1);
  assert.equal(result.citations.T10[0].citation, "新出处");
});

test("删除虚影仍可显示但不再终止实体生命周期", () => {
  const data = {
    entities: [{ id: 1, title: "甲司", type: "机构" }],
    timepoints: {
      1: [
        { id: 1, entity_id: 1, time: "1000年", year_start: 1000, year_end: 1000, time_type: "exact", event: "初置甲司", lifecycle_effect: "activate" },
        { id: "deleted:2", entity_id: 1, time: "1010年", year_start: 1010, year_end: 1010, time_type: "exact", event: "罢甲司", lifecycle_effect: "deactivate", _revision_status: "deleted" },
      ],
    },
    changeRelations: [],
  };
  const model = buildEvolutionModel(data, [1], { yearMin: 990, yearMax: 1030 });
  assert.equal(model.lanes[0].events.find((event) => event.id === "deleted:2").revisionStatus, "deleted");
  assert.equal(model.lanes[0].segments[0].endYear, 1030);
  assert.equal(model.lanes[0].segments[0].openEnd, true);
});
