export function clampCompositionScroll(offset, maxScroll) {
  return Math.max(0, Math.min(Math.max(0, maxScroll), Number(offset) || 0));
}

export function compositionSliderGeometry({
  panelWidth,
  totalContentWidth,
  scrollOffset,
  maxScroll,
  minThumbWidth = 52,
}) {
  if (maxScroll <= 0 || totalContentWidth <= panelWidth) {
    return { enabled: false, thumbWidth: panelWidth, thumbTravel: 0, thumbOffset: 0 };
  }
  const thumbWidth = Math.max(minThumbWidth, panelWidth * panelWidth / totalContentWidth);
  const thumbTravel = Math.max(0, panelWidth - thumbWidth);
  const clampedOffset = clampCompositionScroll(scrollOffset, maxScroll);
  return {
    enabled: true,
    thumbWidth,
    thumbTravel,
    thumbOffset: clampedOffset / maxScroll * thumbTravel,
  };
}

export function compositionScrollAfterDrag({ currentOffset, deltaX, maxScroll, thumbTravel }) {
  if (maxScroll <= 0 || thumbTravel <= 0) return 0;
  return clampCompositionScroll(
    currentOffset + deltaX * maxScroll / thumbTravel,
    maxScroll
  );
}
