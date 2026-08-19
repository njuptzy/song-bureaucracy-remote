function finiteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * 只接受服务端提供的年号记录，不从 SVG 文字或时间点原文猜测年号。
 * 服务端数据来自 vis/backend/normalize_times.py 的 ERA_YEARS。
 */
export function normalizeTimelineEras(eras) {
  if (!Array.isArray(eras)) return [];
  return eras
    .map((era) => ({
      name: String(era?.name ?? "").trim(),
      start: finiteNumber(era?.start),
      end: finiteNumber(era?.end),
      phase: String(era?.phase ?? "").trim(),
    }))
    .filter((era) => era.name && era.start != null && era.end != null && era.start <= era.end)
    .sort((left, right) => left.start - right.start || left.end - right.end || left.name.localeCompare(right.name, "zh-CN"));
}

export function normalizeTimelineEmperorReigns(reigns) {
  if (!Array.isArray(reigns)) return [];
  return reigns
    .map((reign) => ({
      name: String(reign?.name ?? "").trim(),
      personalName: String(reign?.personalName ?? reign?.personal_name ?? "").trim(),
      start: finiteNumber(reign?.start),
      end: finiteNumber(reign?.end),
      phase: String(reign?.phase ?? "").trim(),
    }))
    .filter((reign) => (
      reign.name && reign.start != null && reign.end != null && reign.start <= reign.end
    ))
    .sort((left, right) => (
      left.start - right.start || left.end - right.end || left.name.localeCompare(right.name, "zh-CN")
    ));
}

export function timelineEraForYear(year, eras) {
  const numericYear = finiteNumber(year);
  if (numericYear == null) return null;
  const matches = normalizeTimelineEras(eras)
    .filter((era) => numericYear >= era.start && numericYear <= era.end);
  return matches.at(-1) || null;
}

export function timelineEmperorForYear(year, reigns) {
  const numericYear = finiteNumber(year);
  if (numericYear == null) return null;
  const matches = normalizeTimelineEmperorReigns(reigns)
    .filter((reign) => numericYear >= reign.start && numericYear <= reign.end);
  return matches.at(-1) || null;
}

export function formatTimelineEmperor(year, reigns) {
  return timelineEmperorForYear(year, reigns)?.name || "帝王未明";
}

export function formatChineseRegnalYear(yearNumber) {
  const numericYear = finiteNumber(yearNumber);
  if (numericYear == null || numericYear < 1 || !Number.isInteger(numericYear)) return "";
  if (numericYear === 1) return "元年";

  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (numericYear < 10) return `${digits[numericYear]}年`;
  if (numericYear < 20) return `十${numericYear % 10 ? digits[numericYear % 10] : ""}年`;
  if (numericYear < 100) {
    const tens = Math.floor(numericYear / 10);
    const ones = numericYear % 10;
    return `${digits[tens]}十${ones ? digits[ones] : ""}年`;
  }
  return `${numericYear}年`;
}

export function formatTimelineRegnalYear(year, eras) {
  const numericYear = finiteNumber(year);
  const era = timelineEraForYear(numericYear, eras);
  if (numericYear == null || !era) return "年号未明";
  const ordinal = Math.round(numericYear) - era.start + 1;
  const regnalYear = formatChineseRegnalYear(ordinal);
  return regnalYear ? `${era.name}${regnalYear}` : "年号未明";
}

export function formatTimelineHeader(year, eras, reigns) {
  const numericYear = finiteNumber(year);
  if (numericYear == null) return "年代未明";
  const emperor = formatTimelineEmperor(numericYear, reigns);
  const regnalYear = formatTimelineRegnalYear(numericYear, eras);
  return `${emperor} ${regnalYear}（${Math.round(numericYear)}年）`;
}

export function formatTimelineSelectionHeader({
  selectionActive,
  range,
  rangeLabel,
  eras,
  reigns,
}) {
  const [start, end] = Array.isArray(range) ? range : [];
  if (selectionActive && start === end) {
    return formatTimelineHeader(start, eras, reigns);
  }
  return String(rangeLabel ?? "");
}

export function buildTimelineYearTicks(yearMin, yearMax, step = 10) {
  const min = Math.ceil(Number(yearMin));
  const max = Math.floor(Number(yearMax));
  const interval = Math.max(1, Math.floor(Number(step) || 10));
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return [];
  const ticks = new Set([min, max]);
  for (let year = Math.ceil(min / interval) * interval; year <= max; year += interval) {
    ticks.add(year);
  }
  return [...ticks].sort((left, right) => left - right);
}

/**
 * 为年号文字分配各自的真实时间段。
 *
 * 年号的起止竖线和时间段始终保留；文字是否显示只由起止年份跨度决定，
 * 不因年号字数改变阈值。达到阈值但文字过长时，在自己的时间格内截成省略号，
 * 这样短年号不会被硬挤到邻近年号上方。
 */
export function layoutTimelineEraLabels(eras, xOf, options = {}) {
  const minYears = Number(options.minYears) > 0 ? Number(options.minYears) : 4;
  const fontSize = Number(options.fontSize) > 0 ? Number(options.fontSize) : 10;
  const padding = Number.isFinite(Number(options.padding))
    ? Math.max(0, Number(options.padding))
    : 0;
  const records = normalizeTimelineEras(eras);
  const laidOut = records.map((era) => {
    const startX = Number(xOf(era.start));
    const endX = Number(xOf(era.end + 1));
    const validGeometry = Number.isFinite(startX) && Number.isFinite(endX);
    const safeStartX = validGeometry ? startX : 0;
    const safeEndX = validGeometry ? Math.max(startX, endX) : 0;
    const slotWidth = Math.max(0, safeEndX - safeStartX);
    // 阈值按起止年份的跨度计算：963—968 的跨度是 5 年。
    const spanYears = Math.max(0, era.end - era.start);
    return {
      ...era,
      startX: safeStartX,
      endX: safeEndX,
      slotWidth,
      spanYears,
      labelVisible: validGeometry && spanYears >= minYears,
      labelHiddenReason: validGeometry && spanYears >= minYears ? null : "short-range",
    };
  });

  for (let index = 0; index < laidOut.length; index += 1) {
    const item = laidOut[index];
    const nextStartX = laidOut[index + 1]?.startX ?? item.endX;
    const labelEndX = Math.min(item.endX, nextStartX);
    const labelSlotWidth = Math.max(0, labelEndX - item.startX - padding * 2);
    const maxCharacters = Math.floor(labelSlotWidth / fontSize);
    const codePoints = Array.from(item.name);
    let labelText = item.name;
    if (maxCharacters <= 0) {
      labelText = "";
    } else if (codePoints.length > maxCharacters) {
      labelText = maxCharacters === 1
        ? "…"
        : `${codePoints.slice(0, maxCharacters - 1).join("")}…`;
    }
    item.labelSlotStartX = item.startX + padding;
    item.labelSlotEndX = Math.max(item.labelSlotStartX, labelEndX - padding);
    item.labelSlotWidth = labelSlotWidth;
    item.labelText = labelText;
    item.labelWidth = labelText.length * fontSize;
    // 文字中心必须落在自己的时间格内，避免字形左伸到起始竖线之前，
    // 或右伸进相邻年号的时间格。这里使用估算文字宽度夹紧中心点；
    // 文字本身已经按同一格宽度截断，因此不会改变真实年份坐标。
    const labelCenterX = item.startX + Math.max(0, labelEndX - item.startX) / 2;
    const labelMinX = item.startX + item.labelWidth / 2;
    const labelMaxX = labelEndX - item.labelWidth / 2;
    item.labelX = labelMaxX >= labelMinX
      ? Math.max(labelMinX, Math.min(labelMaxX, labelCenterX))
      : labelCenterX;
    if (item.labelVisible && !labelText) {
      item.labelVisible = false;
      item.labelHiddenReason = "no-room";
    }
  }
  return laidOut;
}

/**
 * 在位区间的分隔线始终使用真实即位年份；名称只在自己的区间内显示。
 * 短区间使用省略号或留空，避免把名称推入相邻君主的区间。
 */
export function layoutTimelineEmperorLabels(reigns, xOf, options = {}) {
  const fontSize = Number(options.fontSize) > 0 ? Number(options.fontSize) : 14.26;
  const padding = Number.isFinite(Number(options.padding))
    ? Math.max(0, Number(options.padding))
    : 0;
  const records = normalizeTimelineEmperorReigns(reigns);

  return records.map((reign, index) => {
    const nextStart = records[index + 1]?.start;
    const boundaryYear = Number.isFinite(nextStart) && nextStart > reign.start
      ? nextStart
      : reign.end + 1;
    const startX = Number(xOf(reign.start));
    const endX = Number(xOf(boundaryYear));
    const validGeometry = Number.isFinite(startX) && Number.isFinite(endX) && endX >= startX;
    const safeStartX = validGeometry ? startX : 0;
    const safeEndX = validGeometry ? endX : 0;
    const labelSlotWidth = Math.max(0, safeEndX - safeStartX - padding * 2);
    const maxCharacters = Math.floor(labelSlotWidth / fontSize);
    const codePoints = Array.from(reign.name);
    let labelText = reign.name;
    if (maxCharacters <= 0) {
      labelText = "";
    } else if (codePoints.length > maxCharacters) {
      labelText = maxCharacters === 1
        ? "…"
        : `${codePoints.slice(0, maxCharacters - 1).join("")}…`;
    }
    return {
      ...reign,
      boundaryYear,
      startX: safeStartX,
      endX: safeEndX,
      slotWidth: Math.max(0, safeEndX - safeStartX),
      labelSlotWidth,
      labelText,
      labelVisible: validGeometry && Boolean(labelText),
      labelX: safeStartX + Math.max(0, safeEndX - safeStartX) / 2,
    };
  });
}
