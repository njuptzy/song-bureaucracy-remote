import assert from "node:assert/strict";
import test from "node:test";

import {
  clampCompositionScroll,
  compositionScrollAfterDrag,
  compositionSliderGeometry,
} from "./composition_scroll.js";

test("编制未溢出时不显示伪滑块", () => {
  assert.deepEqual(compositionSliderGeometry({
    panelWidth: 180,
    totalContentWidth: 180,
    scrollOffset: 0,
    maxScroll: 0,
  }), {
    enabled: false,
    thumbWidth: 180,
    thumbTravel: 0,
    thumbOffset: 0,
  });
});

test("编制溢出时拖动滑块会映射到完整内容范围", () => {
  const geometry = compositionSliderGeometry({
    panelWidth: 330,
    totalContentWidth: 660,
    scrollOffset: 0,
    maxScroll: 330,
  });
  assert.equal(geometry.enabled, true);
  assert.equal(geometry.thumbWidth, 165);
  assert.equal(geometry.thumbTravel, 165);
  assert.equal(compositionScrollAfterDrag({
    currentOffset: 0,
    deltaX: 82.5,
    maxScroll: 330,
    thumbTravel: geometry.thumbTravel,
  }), 165);
  assert.equal(clampCompositionScroll(999, 330), 330);
});
