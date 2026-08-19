import assert from "node:assert/strict";
import test from "node:test";

import {
  HIERARCHY_HEADER_LAYOUT,
  hierarchyAnimationShouldRun,
} from "./hierarchy_animation.js";

test("层级设置独立位于三个视图上方且彼此不重叠", () => {
  assert.ok(
    HIERARCHY_HEADER_LAYOUT.settingsY + HIERARCHY_HEADER_LAYOUT.settingsHeight
      < HIERARCHY_HEADER_LAYOUT.viewRowY,
  );
  assert.ok(
    HIERARCHY_HEADER_LAYOUT.spaceControlX + HIERARCHY_HEADER_LAYOUT.controlWidth
      + HIERARCHY_HEADER_LAYOUT.controlGap
      <= HIERARCHY_HEADER_LAYOUT.animationControlX,
  );
  assert.equal(
    HIERARCHY_HEADER_LAYOUT.animationControlX
      - HIERARCHY_HEADER_LAYOUT.spaceControlX,
    HIERARCHY_HEADER_LAYOUT.controlWidth + HIERARCHY_HEADER_LAYOUT.controlGap,
  );
  assert.equal(
    HIERARCHY_HEADER_LAYOUT.virtualNodeControlX
      - HIERARCHY_HEADER_LAYOUT.animationControlX,
    HIERARCHY_HEADER_LAYOUT.controlWidth + HIERARCHY_HEADER_LAYOUT.controlGap,
  );
  assert.equal(
    HIERARCHY_HEADER_LAYOUT.spaceControlX + HIERARCHY_HEADER_LAYOUT.controlWidth / 2,
    HIERARCHY_HEADER_LAYOUT.evolutionViewX
      + HIERARCHY_HEADER_LAYOUT.controlWidth / 2,
  );
});

test("层级动画只有显式开启且位于层级视图时运行", () => {
  assert.equal(hierarchyAnimationShouldRun({
    enabled: true, viewMode: "hierarchy", hasSvg: true,
  }), true);
  assert.equal(hierarchyAnimationShouldRun({
    enabled: false, viewMode: "hierarchy", hasSvg: true,
  }), false);
  assert.equal(hierarchyAnimationShouldRun({
    enabled: true, viewMode: "evolution", hasSvg: true,
  }), false);
  assert.equal(hierarchyAnimationShouldRun({
    enabled: true, viewMode: "hierarchy", hasSvg: false,
  }), false);
});

test("系统减少动态时始终使用即时切换", () => {
  assert.equal(hierarchyAnimationShouldRun({
    enabled: true,
    viewMode: "hierarchy",
    hasSvg: true,
    reduceMotion: true,
  }), false);
});
