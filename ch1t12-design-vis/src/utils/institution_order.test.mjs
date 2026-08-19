import assert from "node:assert/strict";
import test from "node:test";

import {
  compareInstitutionIdsBySourceOrder,
  compareInstitutionsBySourceOrder,
} from "./institution_order.js";

test("机构按辞典条目出现顺序升序排列", () => {
  const entities = [
    { id: 1, title: "甲司", source_order: 80 },
    { id: 2, title: "乙司", source_order: 12 },
    { id: 3, title: "丙司", source_order: 41 },
  ];
  assert.deepEqual(
    entities.sort(compareInstitutionsBySourceOrder).map((entity) => entity.id),
    [2, 3, 1],
  );
});

test("缺少辞典顺序的机构排在有来源顺序的机构之后", () => {
  const entities = [
    { id: 1, title: "同名司", source_order: null },
    { id: 2, title: "乙司", source_order: 20 },
    { id: 3, title: "同名司" },
  ];
  assert.deepEqual(
    entities.sort(compareInstitutionsBySourceOrder).map((entity) => entity.id),
    [2, 1, 3],
  );
});

test("同序时依次用中文名称和实体 ID 稳定兜底", () => {
  const entities = [
    { id: 9, title: "乙司", source_order: 20 },
    { id: 8, title: "甲司", source_order: 20 },
    { id: 3, title: "甲司", source_order: 20 },
  ];
  assert.deepEqual(
    entities.sort(compareInstitutionsBySourceOrder).map((entity) => entity.id),
    [3, 8, 9],
  );
});

test("实体 ID 比较器与实体比较器使用同一排序规则", () => {
  const entityMap = new Map([
    [1, { id: 1, title: "甲司", source_order: 90 }],
    [2, { id: 2, title: "乙司", source_order: 10 }],
  ]);
  assert.deepEqual(
    [1, 2].sort((first, second) => (
      compareInstitutionIdsBySourceOrder(entityMap, first, second)
    )),
    [2, 1],
  );
});
