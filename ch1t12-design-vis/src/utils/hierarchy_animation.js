export const HIERARCHY_HEADER_LAYOUT = Object.freeze({
  settingsY: 31,
  settingsHeight: 36,
  controlWidth: 126,
  controlGap: 18,
  // 顶部三个层级设置与下方“演变 / 层级 / 编制”三列共用中心线。
  spaceControlX: 1398.5,
  animationControlX: 1542.5,
  virtualNodeControlX: 1686.5,
  viewRowY: 80,
  evolutionViewX: 1398.5,
  evolutionViewLabelX: 1461.4,
  hierarchyViewLabelX: 1605.4,
  compositionViewLabelX: 1749.4,
});

export function hierarchyAnimationShouldRun({
  enabled,
  viewMode,
  hasSvg,
  reduceMotion = false,
} = {}) {
  return Boolean(enabled && viewMode === "hierarchy" && hasSvg && !reduceMotion);
}
