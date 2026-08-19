import assert from "node:assert/strict";
import test from "node:test";

import {
  evolutionComparisonAfterAdd,
  evolutionSelectionAnchors,
  evolutionSelectionFocus,
  timelineSelectionForEvolutionItem,
} from "./evolution_selection.js";

test("添加对象会保留当前实体并直接进入对比模式", () => {
  assert.deepEqual(evolutionComparisonAfterAdd([174], 201), {
    mode: "compare",
    entityIds: [174, 201],
    activeEntityId: 201,
  });
});

test("对比对象去重并始终限制为四个", () => {
  assert.deepEqual(evolutionComparisonAfterAdd([1, 2, 2, 3, 4], 5), {
    mode: "compare",
    entityIds: [1, 2, 3, 5],
    activeEntityId: 5,
  });
});

test("时间点选择联动到单年快照", () => {
  assert.deepEqual(
    timelineSelectionForEvolutionItem("timepoint", 1080, [960, 1279]),
    { active: true, range: [1080, 1080] },
  );
});

test("前后演变关系不把两个端点误作连续时间范围", () => {
  assert.deepEqual(
    timelineSelectionForEvolutionItem("relation", 1115, [960, 1279]),
    { active: false, range: [960, 1279] },
  );
});

test("关系端点分别连接真实年份，同年端点只保留一条定位线", () => {
  assert.deepEqual(evolutionSelectionAnchors({
    kind: "relation",
    item: {
      sourcePoints: [
        { effectiveYear: 1115, baseX: 300, y: 420 },
        { effectiveYear: 1115, baseX: 300, y: 510 },
      ],
      targetPoints: [{ effectiveYear: 1121, baseX: 340, y: 620 }],
    },
  }), [
    { year: 1115, x: 300, y: 510 },
    { year: 1121, x: 340, y: 620 },
  ]);
});

test("时间点使用真实年份锚点而不是避让后的显示位置", () => {
  assert.deepEqual(evolutionSelectionAnchors({
    kind: "timepoint",
    item: {
      effectiveYear: 1080,
      baseX: 260,
      baseY: 400,
      displayX: 272,
      y: 412,
    },
  }), [{ year: 1080, x: 260, y: 400 }]);
});

test("点击关系时只保留该关系的真实端点作为聚焦上下文", () => {
  assert.deepEqual(evolutionSelectionFocus({
    kind: "relation",
    id: 7,
    item: {
      sourcePoints: [{ timepointId: 11 }, { timepointId: 11 }],
      targetPoints: [{ timepointId: 21 }],
    },
  }), {
    active: true,
    relationId: 7,
    timepointIds: [11, 21],
  });
});

test("点击时间点时聚焦范围只包含该点", () => {
  assert.deepEqual(evolutionSelectionFocus({
    kind: "timepoint",
    id: 31,
    item: { id: 31 },
  }), {
    active: true,
    relationId: null,
    timepointIds: [31],
  });
});

test("派生的层级变化事件使用字符串 ID 时仍保持自身高亮", () => {
  assert.deepEqual(evolutionSelectionFocus({
    kind: "timepoint",
    id: "hierarchy:reparent:3:1050:1:2:subject",
    item: { id: "hierarchy:reparent:3:1050:1:2:subject" },
  }), {
    active: true,
    relationId: null,
    timepointIds: ["hierarchy:reparent:3:1050:1:2:subject"],
  });
});
