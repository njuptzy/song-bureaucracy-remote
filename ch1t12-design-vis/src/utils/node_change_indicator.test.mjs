import assert from "node:assert/strict";
import test from "node:test";

import {
  nodeChangeIndicatorAriaLabel,
  nodeChangeIndicatorItems,
  nodeChangeIndicatorLayout,
} from "./node_change_indicator.js";

test("节点变化标记只保留过去和未来，不显示同年数量", () => {
  const summary = {
    past: { year: 1070, distance: 10 },
    current: { year: 1080, count: 3 },
    future: { year: 1095, distance: 15 },
  };
  assert.deepEqual(nodeChangeIndicatorItems(summary).map(({ kind, label }) => ({ kind, label })), [
    { kind: "past", label: "-10" },
    { kind: "future", label: "+15" },
  ]);
  assert.equal(nodeChangeIndicatorItems({ current: summary.current }).length, 0);
  assert.equal(
    nodeChangeIndicatorAriaLabel("三司", summary),
    "三司前后结构变化：最近过去结构变化在1070年，相距10年；最近未来结构变化在1095年，相距15年",
  );
  assert.equal(
    nodeChangeIndicatorItems(summary)[0].title,
    "最近过去结构变化：1070年（距今10年）",
  );
});

test("左右标记使用统一尺寸圆气泡并保持可读字号空间", () => {
  const layout = nodeChangeIndicatorLayout([
    { kind: "past", label: "-2" },
    { kind: "future", label: "+120" },
  ]);
  assert.equal(layout.items[0].radius, 9.5);
  assert.equal(layout.items[1].radius, layout.items[0].radius);
  assert.equal(
    layout.items[1].centerX - layout.items[1].radius
      - (layout.items[0].centerX + layout.items[0].radius),
    4,
  );
  assert.equal(layout.height, 19);
  assert.equal(layout.items[0].centerY, layout.items[1].centerY);
  assert.equal(layout.width, layout.items[1].centerX + layout.items[1].radius);
});
