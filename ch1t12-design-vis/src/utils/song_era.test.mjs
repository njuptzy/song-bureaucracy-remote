import assert from "node:assert/strict";
import test from "node:test";
import { formatSongYearLabel, songEraForYear } from "./song_era.js";

test("年号按宋代年份返回年末截面归属", () => {
  assert.equal(songEraForYear(960), "建隆");
  assert.equal(songEraForYear(1080), "元丰");
  assert.equal(songEraForYear(1127), "建炎");
  assert.equal(songEraForYear(1279), "祥兴");
});

test("层级中央标识使用年号（公元年）格式", () => {
  assert.equal(formatSongYearLabel(1080), "元丰（1080年）");
  assert.equal(formatSongYearLabel("invalid"), "年代未明");
});
