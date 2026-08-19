import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInstitutionGroupNodes,
  groupInstitutionRootIds,
  institutionGroupId,
  otherInstitutionGroup,
} from "./central_groups.js";

const entityMap = new Map([
  [1, { id: 1, title: "中书门下", institution_group: "宰辅与决策中枢" }],
  [2, { id: 2, title: "尚书省", institution_group: "三省六部与馆阁" }],
  [3, { id: 3, title: "未判机构", institution_group: "" }],
]);

test("机构根节点按各大类的稳定分组排序，未判项明确进入其他组", () => {
  assert.deepEqual(
    groupInstitutionRootIds(
      [2, 3, 1],
      entityMap,
      "中央机构",
      ["宰辅与决策中枢", "三省六部与馆阁"]
    ),
    [
      { group: "宰辅与决策中枢", rootIds: [1] },
      { group: "三省六部与馆阁", rootIds: [2] },
      { group: otherInstitutionGroup("中央机构"), rootIds: [3] },
    ]
  );
});

test("每个机构大类的虚拟分组默认收起且一次只展开指定组", () => {
  const roadEntityMap = new Map([
    [10, { id: 10, title: "转运司", institution_group: "转运发运" }],
    [11, { id: 11, title: "提刑司", institution_group: "提点刑狱" }],
  ]);
  const nodes = buildInstitutionGroupNodes({
    rootIds: [10, 11],
    entityMap: roadEntityMap,
    category: "路级机构",
    groupNames: ["转运发运", "提点刑狱"],
    expandedGroupId: institutionGroupId("路级机构", "提点刑狱"),
    treeForRoot: (id) => ({ id, title: roadEntityMap.get(id).title }),
  });
  assert.equal(nodes[0].children.length, 0);
  assert.equal(nodes[0].hiddenCount, 1);
  assert.deepEqual(nodes[1].children, [{ id: 11, title: "提刑司" }]);
  assert.equal(nodes[1].hiddenCount, 0);
});

test("机构虚拟分组支持同时展开多个指定组", () => {
  const expandedGroupIds = [
    institutionGroupId("中央机构", "宰辅与决策中枢"),
    institutionGroupId("中央机构", "三省六部与馆阁"),
  ];
  const nodes = buildInstitutionGroupNodes({
    rootIds: [1, 2, 3],
    entityMap,
    category: "中央机构",
    groupNames: ["宰辅与决策中枢", "三省六部与馆阁"],
    expandedGroupIds,
    treeForRoot: (id) => ({ id, title: entityMap.get(id).title }),
  });
  assert.deepEqual(nodes[0].children, [{ id: 1, title: "中书门下" }]);
  assert.deepEqual(nodes[1].children, [{ id: 2, title: "尚书省" }]);
  assert.equal(nodes[2].children.length, 0);
});
