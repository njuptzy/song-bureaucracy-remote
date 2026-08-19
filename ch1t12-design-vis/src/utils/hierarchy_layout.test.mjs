import assert from "node:assert/strict";
import test from "node:test";

import {
  anchorBranchToGroup,
  buildHierarchyEdgeIndex,
  fitRangeShift,
  focusPanToCenter,
  hierarchyNodeGap,
  horizontalRangesFit,
  isHorizontalWheelGesture,
  packHorizontalRanges,
  panFromScrollbarOffset,
  panScrollbarGeometry,
  pushOverlappingRanges,
  relativeAffineMatrix,
  subordinateGroupAncestorId,
  virtualBusRange,
  virtualBusY,
} from "./hierarchy_layout.js";

test("层级边按上级建立索引并缓存子树，避免每个节点扫描全部关系", () => {
  const edges = [
    { parent: 1, child: 2 },
    { parent: 1, child: 3 },
    { parent: 2, child: 4 },
    { parent: 4, child: 1 },
  ];
  const index = buildHierarchyEdgeIndex(edges);

  assert.deepEqual(index.childrenFor(1), edges.slice(0, 2));
  assert.deepEqual(index.childrenFor(99), []);
  assert.deepEqual(index.subtreeIds(1), [1, 2, 3, 4]);
  assert.equal(index.subtreeIds(1), index.subtreeIds(1));
});

test("展开的大机构锚定在所属制度组正下方", () => {
  const branchCenter = anchorBranchToGroup(620, 300, 650);
  assert.equal(branchCenter + 650 - 300, 620);
});

test("虚拟分组总线同时覆盖来源节点和全部目标节点", () => {
  assert.deepEqual(virtualBusRange(620, [970]), [620, 970]);
  assert.deepEqual(virtualBusRange(970, [620, 760]), [620, 970]);
});

test("公共总线和制度组子树总线使用不同高度", () => {
  const commonBusY = virtualBusY(100, 200, 0);
  const branchBusY = virtualBusY(200, 300, 1);
  assert.equal(commonBusY, 132);
  assert.equal(branchBusY, 250);
  assert.ok(commonBusY < branchBusY);
});

test("制度组总线位于父子节点之间，不压到首层节点顶部", () => {
  const busY = virtualBusY(57, 103, 1);
  assert.equal(busY, 80);
  assert.ok(busY - 57 >= 12);
  assert.ok(103 - busY >= 12);
});

test("下属虚拟组内保持紧凑，两个虚拟组之间保留独立边界", () => {
  const parent = { data: { id: 406 } };
  const groupA = {
    data: { id: "subordinate-group:406:a", isSubordinateGroup: true },
    parent,
  };
  const groupB = {
    data: { id: "subordinate-group:406:b", isSubordinateGroup: true },
    parent,
  };
  const childA1 = { data: { id: 1 }, parent: groupA };
  const childA2 = { data: { id: 2 }, parent: groupA };
  const childB = { data: { id: 3 }, parent: groupB };

  assert.equal(subordinateGroupAncestorId(childA1), groupA.data.id);
  assert.equal(hierarchyNodeGap(childA1, childA2), 18);
  assert.equal(hierarchyNodeGap(childA2, childB), 64);
  assert.equal(hierarchyNodeGap(groupA, groupB), 64);
});

test("没有下属虚拟组时沿用原有不同父节点间距", () => {
  const leftParent = { data: { id: "left" } };
  const rightParent = { data: { id: "right" } };
  assert.equal(hierarchyNodeGap(
    { data: { id: 1 }, parent: leftParent },
    { data: { id: 2 }, parent: rightParent },
  ), 30);
});

test("下级子树利用可用宽度，不在左侧裁断后留下右侧空白", () => {
  assert.equal(fitRangeShift(380, 1280, 500, 1810), 120);
  assert.equal(fitRangeShift(620, 1920, 500, 1810), -110);
  assert.equal(fitRangeShift(620, 1280, 500, 1810), 0);
});

test("左右分类分支互不重叠且位于视口内时可同时展示", () => {
  assert.equal(horizontalRangesFit([
    { left: 520, right: 760 },
    { left: 1460, right: 1780 },
  ], 500, 1830), true);
  assert.equal(horizontalRangesFit([
    { left: 520, right: 960 },
    { left: 940, right: 1320 },
  ], 500, 1830), false);
  assert.equal(horizontalRangesFit([
    { left: 420, right: 760 },
  ], 500, 1830), false);
});

test("多个展开分支按原顺序排开且保留完整宽度", () => {
  const packed = packHorizontalRanges([
    { id: "left", left: 420, right: 1220 },
    { id: "right", left: 900, right: 1700 },
  ], 24);
  assert.equal(packed[0].right - packed[0].left, 800);
  assert.equal(packed[1].right - packed[1].left, 800);
  assert.equal(packed[1].left - packed[0].right, 24);
  assert.equal(packed[1].right - packed[0].left, 1624);
});

test("重叠范围向同一方向整体平移，后续范围保持相对位置", () => {
  const shifted = pushOverlappingRanges([
    { id: "left", left: 0, right: 100 },
    { id: "middle", left: 80, right: 180 },
    { id: "right", left: 220, right: 320 },
  ], 24);
  assert.deepEqual(shifted.map(({ id, left, right, offset }) => ({ id, left, right, offset })), [
    { id: "left", left: 0, right: 100, offset: 0 },
    { id: "middle", left: 124, right: 224, offset: 44 },
    { id: "right", left: 264, right: 364, offset: 44 },
  ]);
  assert.equal(shifted[2].left - shifted[1].left, 140);
});

test("机构树溢出时滚动条覆盖完整平移范围", () => {
  const left = panScrollbarGeometry({
    viewportSize: 1000,
    contentSize: 2000,
    minPan: -1000,
    maxPan: 0,
    currentPan: 0,
  });
  const right = panScrollbarGeometry({
    viewportSize: 1000,
    contentSize: 2000,
    minPan: -1000,
    maxPan: 0,
    currentPan: -1000,
  });
  assert.equal(left.enabled, true);
  assert.equal(left.thumbSize, 500);
  assert.equal(left.thumbOffset, 0);
  assert.equal(right.thumbOffset, right.thumbTravel);
  assert.equal(panFromScrollbarOffset(right.thumbTravel, right.thumbTravel, -1000, 0), -1000);
});

test("点击节点时把目标中心带入视口并尊重整体平移边界", () => {
  assert.equal(focusPanToCenter(1400, 1165, -900, 0), -235);
  assert.equal(focusPanToCenter(1900, 1165, -900, 0), -735);
  assert.equal(focusPanToCenter(400, 1165, -900, 0), 0);
});

test("识别横向触控板手势但不拦截缩放手势", () => {
  assert.equal(isHorizontalWheelGesture({ deltaX: -42, deltaY: 3 }), true);
  assert.equal(isHorizontalWheelGesture({ deltaX: 0, deltaY: -42, shiftKey: true }), true);
  assert.equal(isHorizontalWheelGesture({ deltaX: 3, deltaY: -42 }), false);
  assert.equal(isHorizontalWheelGesture({ deltaX: -42, deltaY: 3, ctrlKey: true }), false);
});

test("过渡节点矩阵移除根 SVG 已包含的缩放与居中偏移", () => {
  const rootMatrix = { a: 0.5, b: 0, c: 0, d: 0.5, e: 100, f: 50 };
  const elementMatrix = { a: 0.5, b: 0, c: 0, d: 0.5, e: 250, f: 150 };

  assert.deepEqual(relativeAffineMatrix(rootMatrix, elementMatrix), {
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    e: 300,
    f: 200,
  });
});

test("根 SVG 为单位矩阵时保留节点原始变换", () => {
  const matrix = { a: 1, b: 0, c: 0, d: 1, e: 42, f: -18 };
  assert.deepEqual(relativeAffineMatrix(
    { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    matrix,
  ), matrix);
});
