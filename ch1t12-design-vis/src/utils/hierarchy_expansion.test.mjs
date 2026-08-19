import assert from "node:assert/strict";
import test from "node:test";

import {
  collapseInstitutionGroups,
  compositionDetailButtonVisible,
  compositionViewButtonVisible,
  expansionAfterLayout,
  expansionAnchorId,
  hierarchyPathAfterInstitutionGroupToggle,
  institutionGroupsAfterLayout,
  mergeExpansionPaths,
  removeExpandedSubtree,
  toggleInstitutionGroupIds,
} from "./hierarchy_expansion.js";

test("右上角编制按钮保留原有就地展开逻辑", () => {
  assert.equal(compositionDetailButtonVisible({
    isVirtual: false, isExpanded: true, isSelected: false, isDetailOpen: false,
  }), true);
  assert.equal(compositionDetailButtonVisible({
    isVirtual: false, isExpanded: false, isSelected: true, isDetailOpen: false,
  }), true);
  assert.equal(compositionDetailButtonVisible({
    isVirtual: false, isExpanded: false, isSelected: false, isDetailOpen: false,
  }), false);
  assert.equal(compositionDetailButtonVisible({
    isVirtual: true, isExpanded: true, isSelected: true, isDetailOpen: false,
  }), false);
  assert.equal(compositionDetailButtonVisible({
    isVirtual: false, isExpanded: true, isSelected: true, isDetailOpen: true,
  }), false);
});

test("右下角编制视图入口只显示在当前选中的具体机构上", () => {
  assert.equal(compositionViewButtonVisible({
    isVirtual: false, isSelected: true,
  }), true);
  assert.equal(compositionViewButtonVisible({
    isVirtual: false, isSelected: false,
  }), false);
  assert.equal(compositionViewButtonVisible({
    isVirtual: true, isSelected: true,
  }), false);
});

test("旧模式始终只保留刚点击节点的展开路径", () => {
  assert.deepEqual(mergeExpansionPaths([1, 2], [1, 3], false), [1, 3]);
});

test("空间展开模式合并两条分支且不重复共同祖先", () => {
  assert.deepEqual(mergeExpansionPaths([1, 2], [1, 3], true), [1, 2, 3]);
});

test("收起节点时只移除该节点及其已展开后代", () => {
  assert.deepEqual(removeExpandedSubtree([1, 2, 4, 3], [2, 4]), [1, 3]);
});

test("空间展开即使超出画布也保留全部已展开分支", () => {
  assert.deepEqual(expansionAfterLayout({
    candidateIds: [1, 2, 3],
    fallbackPath: [1, 3],
    spaceAware: true,
    layoutFits: false,
  }), [1, 2, 3]);
  assert.deepEqual(expansionAfterLayout({
    candidateIds: [1, 3],
    fallbackPath: [1, 3],
    spaceAware: true,
    layoutFits: false,
  }), [1, 3]);
});

test("组合布局在画布内时同时保留两个分支", () => {
  assert.deepEqual(expansionAfterLayout({
    candidateIds: [1, 2, 3],
    fallbackPath: [1, 3],
    spaceAware: true,
    layoutFits: true,
  }), [1, 2, 3]);
});

test("空间展开按全部分支整体居中，不再锚定第一个节点", () => {
  assert.equal(expansionAnchorId([1, 2], false), 1);
  assert.equal(expansionAnchorId([1, 2], true), null);
});

test("旧模式的顶部虚拟分类仍然只展开新点击项", () => {
  assert.deepEqual(toggleInstitutionGroupIds(["left"], "right", false), ["right"]);
});

test("空间模式允许同时展开左右两个虚拟分类", () => {
  assert.deepEqual(toggleInstitutionGroupIds(["left"], "right", true), ["left", "right"]);
});

test("空间模式打开新制度组时保留此前实体展开路径", () => {
  assert.deepEqual(hierarchyPathAfterInstitutionGroupToggle([1, 2, 3], true), [1, 2, 3]);
  assert.deepEqual(hierarchyPathAfterInstitutionGroupToggle([1, 2, 3], false), []);
});

test("三司虚拟分类在普通模式只保留新点击项，空间模式才允许并列展开", () => {
  const accounting = "subordinate-group:406:勾院与帐籍审核";
  const storage = "subordinate-group:406:库藏与粮料";
  assert.deepEqual(toggleInstitutionGroupIds([accounting], storage, false), [storage]);
  assert.deepEqual(toggleInstitutionGroupIds([accounting], storage, true), [accounting, storage]);
});

test("多个虚拟分类放不下时仍全部保留", () => {
  assert.deepEqual(institutionGroupsAfterLayout({
    candidateIds: ["left", "right"],
    clickedId: "right",
    spaceAware: true,
    layoutFits: false,
  }), ["left", "right"]);
  assert.deepEqual(institutionGroupsAfterLayout({
    candidateIds: ["right"],
    clickedId: "right",
    spaceAware: true,
    layoutFits: false,
  }), ["right"]);
});

test("三司多个分类在空间模式下排不进画布时仍全部保留", () => {
  const accounting = "subordinate-group:406:勾院与帐籍审核";
  const storage = "subordinate-group:406:库藏与粮料";
  assert.deepEqual(institutionGroupsAfterLayout({
    candidateIds: [accounting, storage],
    clickedId: storage,
    spaceAware: true,
    layoutFits: false,
  }), [accounting, storage]);
});

test("关闭空间模式后只保留最近展开的虚拟分类", () => {
  assert.deepEqual(collapseInstitutionGroups(["left", "right"], "right"), ["right"]);
});
