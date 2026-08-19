import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyEntityLifecycle,
  classifyEventType,
  classifyExistenceEffect,
} from "../../../shared/entity_lifecycle.js";

test("事件语义类型与存废影响分开记录", () => {
  assert.equal(classifyEventType("行新制，罢礼院"), "abolish");
  assert.equal(classifyEventType("改称太常寺"), "rename");
  assert.equal(classifyEventType("复称太常礼院"), "rename");
  assert.equal(classifyEventType("职事归太常寺"), "duty_transfer");
  assert.equal(classifyEventType("议复置而未果"), "record");
  assert.equal(classifyEventType("此后不复置"), "record");
  assert.equal(classifyEventType("议复置未果，后始置"), "establish");
});

test("生命周期判定可识别实体简称", () => {
  const entity = { title: "太常礼院", aliases: ["礼院"] };
  assert.equal(classifyEntityLifecycle("始置礼院", entity).effect, "activate");
  assert.equal(classifyEntityLifecycle("行新制，罢礼院", entity).effect, "deactivate");
});

test("数据库中的明确存废影响优先于文本推断", () => {
  assert.equal(classifyExistenceEffect({
    event: "始置礼院",
    lifecycle_effect: "preserve",
  }, { title: "太常礼院", aliases: ["礼院"] }), "preserve");
});
