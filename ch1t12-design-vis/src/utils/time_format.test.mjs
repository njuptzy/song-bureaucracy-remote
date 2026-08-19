import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatStandardTime } from "./time_format.js";

describe("formatStandardTime", () => {
  it("精确到日：公元为主、原文为辅", () => {
    assert.equal(
      formatStandardTime({
        year_start: 994, year_end: 994, month: 12, day: 24,
        raw_time: "北宋淳化五年十二月二十四日",
      }),
      "公元994年12月24日（北宋淳化五年十二月二十四日）",
    );
  });

  it("只有年月：不拼日", () => {
    assert.equal(
      formatStandardTime({ year_start: 906, year_end: 906, month: 3, raw_time: "唐天祐三年三月" }),
      "公元906年3月（唐天祐三年三月）",
    );
  });

  it("闰月加闰字", () => {
    assert.equal(
      formatStandardTime({ yearStart: 1001, month: 11, is_leap_month: 1, rawTime: "咸平四年闰十一月" }),
      "公元1001年闰11月（咸平四年闰十一月）",
    );
  });

  it("只有年份：公元年加原文", () => {
    assert.equal(
      formatStandardTime({ year_start: 1003, year_end: 1003, raw_time: "北宋咸平六年" }),
      "公元1003年（北宋咸平六年）",
    );
  });

  it("年份区间：不拼月日", () => {
    assert.equal(
      formatStandardTime({ yearStart: 993, yearEnd: 994, rawTime: "淳化四年至五年" }),
      "公元993—994年（淳化四年至五年）",
    );
  });

  it("驼峰与蛇形字段等价", () => {
    assert.equal(
      formatStandardTime({ yearStart: 983, yearEnd: 983, rawTime: "太平兴国八年" }),
      "公元983年（太平兴国八年）",
    );
  });

  it("无年份回退原文；原文为未知或空缺时显示年代未明", () => {
    assert.equal(formatStandardTime({ raw_time: "宋初" }), "宋初");
    assert.equal(formatStandardTime({ raw_time: "未知" }), "年代未明");
    assert.equal(formatStandardTime({}), "年代未明");
  });

  it("无原文时只出标准化部分", () => {
    assert.equal(formatStandardTime({ year_start: 1082, year_end: 1082 }), "公元1082年");
  });

  it("月日编码为 0 视为缺失，不显示 0月0日", () => {
    assert.equal(
      formatStandardTime({ year_start: 960, year_end: 960, month: 0, day: 0, raw_time: "宋初" }),
      "公元960年（宋初）",
    );
    assert.equal(
      formatStandardTime({ year_start: 994, year_end: 994, month: 12, day: 0, raw_time: "淳化五年十二月" }),
      "公元994年12月（淳化五年十二月）",
    );
  });
});
