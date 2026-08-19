import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSubordinateGroupNodes,
  subordinateGroupFor,
  subordinateGroupId,
} from "./subordinate_groups.js";

test("三司下属按职能进入稳定分类", () => {
  assert.equal(subordinateGroupFor("三司", "盐铁"), "三部与本司");
  assert.equal(subordinateGroupFor("三司", "三司都磨勘司"), "勾院与帐籍审核");
  assert.equal(subordinateGroupFor("三司", "布库"), "库藏与粮料");
  assert.equal(subordinateGroupFor("三司", "西染院"), "营造与场务");
  assert.equal(subordinateGroupFor("三司", "都提举市易司"), "财税贸易与专务");
  assert.equal(subordinateGroupFor("尚书省", "户部"), null);
});

test("三司虚拟分类默认收起且只展开指定分类", () => {
  const entityMap = new Map([
    [406, { id: 406, title: "三司" }],
    [407, { id: 407, title: "盐铁" }],
    [410, { id: 410, title: "三司都磨勘司" }],
    [3260, { id: 3260, title: "布库" }],
  ]);
  const expandedId = subordinateGroupId(406, "库藏与粮料");
  const groups = buildSubordinateGroupNodes({
    parent: entityMap.get(406),
    childIds: [407, 410, 3260],
    entityMap,
    expandedGroupIds: [expandedId],
    treeForChild: (id) => ({ id, title: entityMap.get(id).title }),
  });
  assert.deepEqual(
    groups.map(({ title, childCount, hiddenCount }) => ({ title, childCount, hiddenCount })),
    [
      { title: "三部与本司", childCount: 1, hiddenCount: 1 },
      { title: "勾院与帐籍审核", childCount: 1, hiddenCount: 1 },
      { title: "库藏与粮料", childCount: 1, hiddenCount: 0 },
    ]
  );
  assert.deepEqual(groups[2].children, [{ id: 3260, title: "布库" }]);
});
