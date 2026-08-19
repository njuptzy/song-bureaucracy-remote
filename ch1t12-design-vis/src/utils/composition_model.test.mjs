import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCompositionModel,
  dedupeStaffEdges,
  officialKindOf,
  quotaLabel,
  staffTextOf,
} from "./composition_model.js";

const entities = [
  { id: 1, title: "尚书省", type: "机构" },
  { id: 2, title: "尚书省左司", type: "机构" },
  { id: 3, title: "尚书省吏部", type: "机构" },
  { id: 4, title: "尚书省户部", type: "机构" },
  { id: 5, title: "吏部尚书左选", type: "机构" },
  { id: 6, title: "司封司", type: "机构" },
  { id: 7, title: "司封案", type: "机构" },
  { id: 8, title: "共管库", type: "机构" },
  { id: 10, title: "郎中", type: "官职" },
  { id: 11, title: "令史", type: "官职" },
  { id: 12, title: "书令史", type: "官职" },
  { id: 13, title: "主事", type: "官职" },
];
const entityMap = new Map(entities.map((entity) => [entity.id, entity]));
const titleOf = (id) => entityMap.get(id)?.title ?? "";

const hierarchy = {
  1: [
    { id: 101, parent: 1, child: 2 },
    { id: 102, parent: 1, child: 4 },
    { id: 103, parent: 1, child: 3 },
  ],
  3: [
    { id: 301, parent: 3, child: 5 },
    { id: 302, parent: 3, child: 6 },
    { id: 303, parent: 3, child: 8 },
    { id: 304, parent: 3, child: 10 }, // 官职误作层级端点时必须排除
  ],
  4: [{ id: 401, parent: 4, child: 8 }],
  5: [{ id: 501, parent: 5, child: 7 }],
  7: [{ id: 701, parent: 7, child: 3 }], // 环路必须在当前路径终止
};
const childrenFor = (id) => hierarchy[id] || [];

const staff = {
  1: [{ official: 13, staff_quota: 6, staff_type: "吏" }],
  3: [
    { official: 10, staff_quota: 1, staff_type: "官" },
    { official: 11, staff_quota: 14, staff_type: "吏" },
    { official: 12, staff_quota: 35, staff_type: "吏" },
  ],
  5: [{ official: 10, staff_quota: 1, staff_type: "职事官" }],
};
const staffFor = (id) => staff[id] || [];

describe("quotaLabel", () => {
  it("规范常见员额", () => {
    assert.equal(quotaLabel(1), "一人");
    assert.equal(quotaLabel(10), "十人");
    assert.equal(quotaLabel(35), "35人");
    assert.equal(quotaLabel("二员"), "二员");
    assert.equal(quotaLabel("若干"), "若干人");
    assert.equal(quotaLabel(null), "");
  });
});

describe("officialKindOf", () => {
  it("只把数据库明确写出的类型映射到设计稿分类", () => {
    assert.equal(officialKindOf("差遣官"), "dispatch");
    assert.equal(officialKindOf("职事官"), "duty");
    assert.equal(officialKindOf("寄禄官"), "rank");
    assert.equal(officialKindOf("吏"), "clerk");
    assert.equal(officialKindOf("官"), "neutral");
  });
});

describe("staffTextOf", () => {
  it("官序列在前、吏序列在后并去重", () => {
    const { text, items } = staffTextOf(staff[3], entityMap, titleOf);
    assert.equal(text, "郎中一人，书令史35人，令史14人");
    assert.deepEqual(items.map((item) => item.kind), ["neutral", "clerk", "clerk"]);
  });
  it("同一官职多条边优先保留带员额的记录", () => {
    const edges = [
      { official: 10, staff_quota: null, staff_type: "官" },
      { official: 10, staff_quota: 1, staff_type: "官" },
      { official: 2, staff_quota: 1, staff_type: "官" },
    ];
    assert.equal(dedupeStaffEdges(edges, entityMap).length, 1);
    assert.equal(dedupeStaffEdges(edges, entityMap)[0].staff_quota, 1);
  });
});

describe("buildCompositionModel", () => {
  const model = buildCompositionModel({
    focusId: 1,
    entityMap,
    childrenFor,
    staffFor,
    titleOf,
  });

  it("焦点直属叶只进入附属列带", () => {
    assert.deepEqual(model.focusDirectLeaves.map((node) => node.id), [2]);
    assert.deepEqual(model.looseColumns.map((node) => node.id), [2]);
  });

  it("有下级的直属机构按画板吏户顺序成为部门块", () => {
    assert.deepEqual(model.sections.map((section) => section.id), [3, 4]);
  });

  it("孙节点只保留在直接父列内部，不展平到部门同层", () => {
    const section = model.sections[0];
    assert.deepEqual(section.columns.map((column) => column.id), [5, 6, 8]);
    assert.deepEqual(section.columns[0].children.map((child) => child.id), [7]);
    assert.equal(section.columns.some((column) => column.id === 7), false);
    assert.equal(section.columns[0].parentId, 3);
    assert.equal(section.columns[0].children[0].parentId, 5);
  });

  it("同一机构有两个明确父机构时保留两个路径实例", () => {
    const underLi = model.sections[0].columns.find((node) => node.id === 8);
    const underHu = model.sections[1].columns.find((node) => node.id === 8);
    assert.ok(underLi && underHu);
    assert.notEqual(underLi.pathKey, underHu.pathKey);
    assert.equal(underLi.parentId, 3);
    assert.equal(underHu.parentId, 4);
  });

  it("路径内环路终止且官职端点不进入机构树", () => {
    const section = model.sections[0];
    const grandchild = section.columns[0].children[0];
    assert.equal(grandchild.children.length, 0);
    assert.equal(section.columns.some((node) => node.id === 10), false);
  });

  it("编制只属于当前节点，不从子孙汇总", () => {
    assert.equal(model.sections[0].staffText, "郎中一人，书令史35人，令史14人");
    assert.equal(model.sections[0].columns[0].staffText, "郎中一人");
    assert.equal(model.sections[0].columns[0].children[0].staffText, "编制未载");
  });

  it("焦点不存在时返回 null", () => {
    assert.equal(buildCompositionModel({
      focusId: 99, entityMap, childrenFor, staffFor, titleOf,
    }), null);
  });
});
