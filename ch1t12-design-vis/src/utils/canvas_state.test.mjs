import assert from "node:assert/strict";
import test from "node:test";

import {
  CANVAS_STATE_STORAGE_KEY,
  readCanvasState,
  sanitizeCanvasState,
  writeCanvasState,
} from "./canvas_state.js";

function memoryStorage(initialValue = null) {
  let value = initialValue;
  return {
    getItem(key) {
      assert.equal(key, CANVAS_STATE_STORAGE_KEY);
      return value;
    },
    setItem(key, nextValue) {
      assert.equal(key, CANVAS_STATE_STORAGE_KEY);
      value = nextValue;
    },
  };
}

test("保存并恢复当前视图、机构和时间状态", () => {
  const storage = memoryStorage();
  const state = {
    viewMode: "evolution",
    evolutionMode: "compare",
    evolutionEntityIds: [174, 201],
    selectedEvolutionItem: { kind: "timepoint", id: 91, item: { ignored: true } },
    evolutionLanePage: 2,
    selectedRange: [1080, 1090],
    timelineSelectionActive: true,
    selectedId: 174,
    compositionFocusId: 174,
    selectedCategory: "中央机构",
    spaceAwareExpansion: false,
    showVirtualNodes: false,
    hierarchyAnimationEnabled: true,
  };

  assert.equal(writeCanvasState(state, storage), true);
  assert.deepEqual(readCanvasState(storage), {
    viewMode: "evolution",
    evolutionMode: "compare",
    evolutionEntityIds: [174, 201],
    selectedEvolutionItem: { kind: "timepoint", id: 91 },
    evolutionLanePage: 2,
    selectedRange: [1080, 1090],
    timelineSelectionActive: true,
    selectedId: 174,
    compositionFocusId: 174,
    selectedCategory: "中央机构",
    spaceAwareExpansion: false,
    showVirtualNodes: false,
  });
});

test("损坏、过期或不可访问的本地状态不会阻断页面加载", () => {
  assert.equal(readCanvasState(memoryStorage("not json")), null);
  assert.equal(readCanvasState(memoryStorage(JSON.stringify({ version: 0, state: {} }))), null);
  assert.equal(readCanvasState({ getItem() { throw new Error("blocked"); } }), null);
  assert.equal(writeCanvasState({ viewMode: "hierarchy" }, {
    setItem() { throw new Error("full"); },
  }), false);
});

test("恢复关系选择时不恢复旧版误生成的时间范围框选", () => {
  assert.deepEqual(sanitizeCanvasState({
    selectedEvolutionItem: { kind: "relation", id: 91 },
    selectedRange: [1115, 1121],
    timelineSelectionActive: true,
  }), {
    selectedEvolutionItem: { kind: "relation", id: 91 },
    selectedRange: [1115, 1121],
    timelineSelectionActive: false,
  });
});

test("恢复前会过滤未知字段并规范非法取值", () => {
  assert.deepEqual(sanitizeCanvasState({
    viewMode: "unknown",
    evolutionMode: "compare",
    evolutionEntityIds: [1, 1, Number.NaN, 2, 3, 4, 5],
    evolutionLanePage: -4.8,
    selectedRange: [1090, 1080],
    timelineSelectionActive: "true",
    selectedId: "174",
    compositionFocusId: 174,
    selectedCategory: "  地方机构  ",
    showVirtualNodes: "false",
    extra: "ignored",
  }), {
    evolutionMode: "compare",
    evolutionEntityIds: [1, 2, 3, 4],
    evolutionLanePage: 1,
    selectedRange: [1080, 1090],
    compositionFocusId: 174,
    selectedCategory: "地方机构",
  });
});

test("已移除的时间线树与对照视图不会从旧状态恢复", () => {
  assert.deepEqual(sanitizeCanvasState({
    viewMode: "comparison",
    comparisonReturnView: "timetree",
    comparisonHierarchyState: { viewMode: "hierarchy", selectedId: 174 },
  }), null);
  assert.deepEqual(sanitizeCanvasState({
    viewMode: "timetree",
    selectedId: 174,
  }), {
    selectedId: 174,
  });
});
