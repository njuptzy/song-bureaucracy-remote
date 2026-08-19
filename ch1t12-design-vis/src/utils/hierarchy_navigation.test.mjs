import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveHierarchyContext,
  resolveVisibleSelection,
} from "./hierarchy_navigation.js";

test("跨类别下级定位到当前截面的真实根机构及完整路径", () => {
  const entities = new Map([
    [1, { id: 1, title: "宣徽院", category: "中央机构" }],
    [2, { id: 2, title: "教坊", category: "内廷机构" }],
    [3, { id: 3, title: "法曲部", category: "中央机构" }],
  ]);
  const context = resolveHierarchyContext(3, [
    { id: 10, parent: 1, child: 2 },
    { id: 11, parent: 2, child: 3 },
  ], entities);
  assert.equal(context.root.id, 1);
  assert.deepEqual(context.path, [1, 2, 3]);
});

test("循环关系不会让上下文定位无限递归", () => {
  const entities = new Map([[1, { id: 1 }], [2, { id: 2 }]]);
  const context = resolveHierarchyContext(2, [
    { id: 1, parent: 1, child: 2 },
    { id: 2, parent: 2, child: 1 },
  ], entities);
  assert.deepEqual(new Set(context.path), new Set([1, 2]));
});

test("只有已选机构退出年份后才回退到当前类别的可见根机构", () => {
  const inactive = { id: 1, title: "旧机构" };
  const currentCategoryRoot = { id: 2, title: "当前类别根机构" };
  const unrelatedDefault = { id: 3, title: "尚书省" };
  assert.equal(
    resolveVisibleSelection(inactive, new Set([2, 3]), currentCategoryRoot),
    currentCategoryRoot
  );
  assert.equal(resolveVisibleSelection(null, null, currentCategoryRoot), null);
  assert.notEqual(
    resolveVisibleSelection(inactive, new Set([2, 3]), currentCategoryRoot),
    unrelatedDefault
  );
});

test("当前类别确实为空时不伪造其他类别的选中机构", () => {
  assert.equal(resolveVisibleSelection({ id: 1 }, new Set(), null), null);
  assert.equal(resolveVisibleSelection(null, null, null), null);
});
