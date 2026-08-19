import assert from "node:assert/strict";
import test from "node:test";

import { dictionaryEntryText } from "./dictionary_entry.js";

test("词条原文按辞典分栏顺序组合且不混入事件引文", () => {
  assert.equal(dictionaryEntryText({
    text: "官司名。",
    origin: "宋初沿置。",
    duty: "掌礼乐制度。",
    rank: "官品未定。",
    composition: "判院四人。",
    aliases: "简称礼院。",
    event: "不应进入词条原文",
    quotation: "不应进入词条原文",
  }), [
    "官司名。",
    "职源与沿革：宋初沿置。",
    "职掌：掌礼乐制度。",
    "品位：官品未定。",
    "编制：判院四人。",
    "简称与别名：简称礼院。",
  ].join("\n"));
});

test("没有匹配辞典内容时返回空文本", () => {
  assert.equal(dictionaryEntryText({}), "");
});
