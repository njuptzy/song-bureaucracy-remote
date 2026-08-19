import assert from "node:assert/strict";
import test from "node:test";
import {
  MAJOR_EVENTS,
  STATIC_MAJOR_EVENT_TITLES,
  layoutMajorEventLabels,
  majorEventTooltip,
  normalizeMajorEvents,
} from "./major_events.js";

test("重大事件按真实起始年份排序并区分点与区间", () => {
  const events = normalizeMajorEvents(MAJOR_EVENTS, { yearMin: 960, yearMax: 1279 });
  assert.equal(events[0].title, "陈桥兵变");
  assert.equal(events.at(-1).title, "崖山海战");
  assert.deepEqual(
    events.find((event) => event.title === "庆历新政"),
    {
      ...MAJOR_EVENTS.find((event) => event.title === "庆历新政"),
      startYear: 1043,
      endYear: 1045,
      anchorYear: 1044.5,
    },
  );
});

test("澶渊之盟、平夏城之战和崖山海战使用校正后的名称与年份", () => {
  const events = normalizeMajorEvents(MAJOR_EVENTS);
  assert.equal(events.find((event) => event.title === "澶渊之盟")?.startYear, 1004);
  assert.equal(events.find((event) => event.title === "平夏城之战")?.startYear, 1096);
  assert.equal(events.find((event) => event.title === "崖山海战")?.startYear, 1279);
  assert.equal(events.some((event) => event.title === "渲渊之盟"), false);
  assert.equal(events.some((event) => event.title === "压山海战"), false);
});

test("元丰改制标示元丰五年新官制正式施行，不与熙宁变法重复画区间", () => {
  const event = normalizeMajorEvents(MAJOR_EVENTS)
    .find((item) => item.title === "元丰改制");
  assert.equal(event.kind, "point");
  assert.equal(event.startYear, 1082);
  assert.equal(event.endYear, 1082);
  assert.equal(event.anchorYear, 1082);
  assert.equal(event.originalTime, "元丰五年");
});

test("相邻重大事件保持真实横坐标并自动错层，文字不再相互覆盖", () => {
  const events = normalizeMajorEvents(MAJOR_EVENTS);
  const layouts = layoutMajorEventLabels(events, (year) => year * 4.14);
  const byTitle = new Map(layouts.map((layout) => [layout.event.title, layout]));

  assert.equal(byTitle.get("熙宁变法").row, 0);
  assert.equal(byTitle.get("元丰改制").row, 1);
  assert.equal(byTitle.get("平夏城之战").row, 0);
  for (const [index, left] of layouts.entries()) {
    for (const right of layouts.slice(index + 1)) {
      if (left.row !== right.row) continue;
      assert.equal(left.right + 4 <= right.left || right.right + 4 <= left.left, true);
    }
  }
});

test("来源或时间未核实的横山之战不进入真实事件数据", () => {
  assert.equal(MAJOR_EVENTS.some((event) => event.title === "横山之战"), false);
  assert.equal(STATIC_MAJOR_EVENT_TITLES.includes("横山之战"), true);
});

test("端平更化只绑定可靠起点，不伪造结束年份", () => {
  const event = normalizeMajorEvents(MAJOR_EVENTS)
    .find((item) => item.title === "端平更化");
  assert.equal(event.kind, "point");
  assert.equal(event.startYear, 1234);
  assert.equal(event.endYear, 1234);
  assert.equal(event.certainty, "start-only");
});

test("重大事件按时间轴范围过滤，工具提示保留纪年与史料来源", () => {
  const events = normalizeMajorEvents(MAJOR_EVENTS, { yearMin: 1100, yearMax: 1200 });
  assert.equal(events.some((event) => event.title === "陈桥兵变"), false);
  const treaty = events.find((event) => event.title === "绍兴和议");
  assert.match(majorEventTooltip(treaty), /绍兴十一年/);
  assert.match(majorEventTooltip(treaty), /《宋史》卷二十九/);
});
