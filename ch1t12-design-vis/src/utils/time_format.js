/**
 * 详情面板时间的统一标准化展示。
 *
 * 规则：公元纪年为主、原文纪年为辅——`公元994年12月24日（淳化五年十二月二十四日）`。
 * - year_start/year_end 不同 → 区间 `公元993—994年`（月日只属于端点，区间不拼月日）
 * - 有月/日字段才拼月日；闰月加"闰"字
 * - 无年份（undated/unresolved）→ 回退原文；"未知"或无原文 → "年代未明"
 * 字段同时兼容蛇形（year_start/raw_time）和驼峰（yearStart/rawTime）命名。
 */
export function formatStandardTime(input = {}) {
  const numeric = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  // 数据库里缺失的月日编码为 0，不是 null
  const positive = (value) => {
    const number = numeric(value);
    return number != null && number > 0 ? number : null;
  };
  const yearStart = numeric(input.yearStart ?? input.year_start ?? input.effectiveYear);
  const yearEnd = numeric(input.yearEnd ?? input.year_end) ?? yearStart;
  const raw = String(input.rawTime ?? input.raw_time ?? input.time ?? "").trim();

  if (yearStart == null) {
    return raw && raw !== "未知" ? raw : "年代未明";
  }

  let head;
  if (yearEnd != null && yearEnd > yearStart) {
    head = `公元${yearStart}—${yearEnd}年`;
  } else {
    head = `公元${yearStart}年`;
    const month = positive(input.month);
    const day = positive(input.day);
    if (month != null) {
      const leap = input.isLeapMonth ?? input.is_leap_month;
      head += `${leap ? "闰" : ""}${month}月`;
      if (day != null) head += `${day}日`;
    }
  }

  if (!raw || raw === "未知") return head;
  return `${head}（${raw}）`;
}
