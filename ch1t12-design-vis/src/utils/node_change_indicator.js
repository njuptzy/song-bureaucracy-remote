export const NODE_CHANGE_INDICATOR_GEOMETRY = Object.freeze({
  gap: 4,
  radius: 9.5,
});

export function nodeChangeIndicatorItems(summary) {
  return [
    summary?.past ? {
      kind: "past",
      label: `-${summary.past.distance}`,
      title: `最近过去结构变化：${summary.past.year}年（距今${summary.past.distance}年）`,
    } : null,
    summary?.future ? {
      kind: "future",
      label: `+${summary.future.distance}`,
      title: `最近未来结构变化：${summary.future.year}年（${summary.future.distance}年后）`,
    } : null,
  ].filter(Boolean);
}

export function nodeChangeIndicatorLayout(items) {
  const { gap, radius } = NODE_CHANGE_INDICATOR_GEOMETRY;
  const slotCenterX = {
    past: radius,
    future: radius * 2 + gap + radius,
  };
  const positionedItems = (items || []).map((item) => ({
    ...item,
    centerX: slotCenterX[item.kind] ?? radius,
    radius,
  }));
  return {
    width: positionedItems.length ? radius * 4 + gap : 0,
    height: radius * 2,
    centerY: radius,
    items: positionedItems.map((item) => ({
      ...item,
      centerY: radius,
    })),
  };
}

export function nodeChangeIndicatorAriaLabel(title, summary, isVirtual = false) {
  const parts = [];
  if (summary?.past) {
    parts.push(`最近过去结构变化在${summary.past.year}年，相距${summary.past.distance}年`);
  }
  if (summary?.future) {
    parts.push(`最近未来结构变化在${summary.future.year}年，相距${summary.future.distance}年`);
  }
  return `${title}${isVirtual ? "组内" : ""}前后结构变化：${parts.join("；")}`;
}
