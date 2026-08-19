const DEFAULTS = {
  titleX: 99.85,
  titleY: 505.87,
  yearMinX: 189.74,
  yearY: 502.91,
  stackedYearY: 525,
  panelRight: 475.49,
  inlineGap: 12,
  borderGap: 8,
  borderMinX: 308.55,
};

function finiteWidth(value) {
  const width = Number(value);
  return Number.isFinite(width) && width > 0 ? width : 0;
}

export function detailHeaderLayout({ titleWidth, yearWidth, ...overrides }) {
  const geometry = { ...DEFAULTS, ...overrides };
  const naturalTitleWidth = finiteWidth(titleWidth);
  const naturalYearWidth = finiteWidth(yearWidth);
  const titleRight = geometry.titleX + naturalTitleWidth;
  const inlineYearX = Math.max(
    geometry.yearMinX,
    titleRight + geometry.inlineGap,
  );
  const inline = inlineYearX + naturalYearWidth <= geometry.panelRight;
  const yearX = inline ? inlineYearX : geometry.titleX;
  const yearY = inline ? geometry.yearY : geometry.stackedYearY;
  const headerRight = inline
    ? yearX + naturalYearWidth
    : Math.max(titleRight, yearX + naturalYearWidth);
  const borderStartX = Math.min(
    geometry.panelRight,
    Math.max(geometry.borderMinX, headerRight + geometry.borderGap),
  );

  return {
    titleX: geometry.titleX,
    titleY: geometry.titleY,
    yearX,
    yearY,
    borderStartX,
    stacked: !inline,
  };
}
