// 编制画板 4-02 的递归语义布局。
//
// 原稿不是卡片流，而是一个连续填满的机构总框：左侧为焦点机构标题与直属
// 编制，右侧每一块只表示焦点的直接下级；块内只排列该机构的直接孩子，
// 更深节点嵌套在自己的父列内部。每一行都重新分配列宽并填满可用区域，
// 因而不会出现“末行只有两列、右侧仍保留整块空白”的错误。

export const COMPOSITION_GEOMETRY = {
  outerPadding: 3,
  focusLaneMin: 58,
  focusLaneMax: 108,
  focusTitleFontSize: 32,
  focusTitleMinFontSize: 24,
  sectionTitleFontSize: 24,
  sectionTitleMinFontSize: 18,
  columnTitleFontSize: 16,
  columnTitleMinFontSize: 13,
  nestedTitleFontSize: 14,
  nestedTitleMinFontSize: 11,
  // 编制图保留原稿字号作为密集态基准；稀疏视图只提高“允许上限”，
  // 最终字号仍由每个文字格的实际宽高与全文长度求解。
  typographyMaxScale: 1.85,
  focusTypographyMaxScale: 1.2,
  sectionTypographyMaxScale: 1.35,
  columnTypographyMaxScale: 1.85,
  nestedTypographyMaxScale: 1.55,
  typographyMinScale: 0.75,
  // 原稿中的 x 是竖排文字基线，不是字形左边缘。焦点基线相对当前
  // inner rect 为 17.62px；部门和子机构分别约为 15.52px、11.8px。
  focusTitleXOffset: 17.62,
  sectionTitleXOffset: 15.52,
  columnTitleXOffset: 11.8,
  nestedTitleXOffset: 9.5,
  focusTitleYOffset: 7.1,
  sectionTitleYOffset: 7.2,
  columnTitleYOffset: 5,
  nestedTitleYOffset: 5,
  titleColGap: 1,
  // 编制说明是正文而不是脚注。密集态也从可读字号起算；窄格仍由
  // solveLabelTypography 按实际宽高回缩，稀疏态则封顶以免压过机构名。
  staffFontSize: 10,
  summaryStaffFontSize: 11,
  staffMaxFontSize: 13,
  staffColPitch: 12,
  summaryStaffColPitch: 13.2,
  focusStaffGap: 7,
  sectionStaffGap: 6,
  columnStaffGap: 8,
  staffBottomPadding: 5,
  textSidePadding: 3,
  sectionGapX: 3,
  sectionGapY: 3,
  columnGap: 2.2,
  nestedGap: 2,
  nestedColumnsPerRow: 5,
  nestedMinRowHeight: 24,
  sectionLabelMin: 40,
  sectionLabelMax: 72,
  branchLabelMin: 25,
  // 原稿典型直接机构格约 70×211.61，深层格约 60×106.17。
  // 面积只决定整图可放大的上限，不能替代局部全文适配。
  columnReferenceArea: 70 * 211.61,
  nestedReferenceArea: 60 * 106.17,
};

export function fitCompositionBlock(block, bounds, { maxScale = 2.4 } = {}) {
  if (!block || !bounds || block.width <= 0 || block.height <= 0) return null;
  const scale = Math.min(
    maxScale,
    bounds.width / block.width,
    bounds.height / block.height
  );
  const renderedWidth = block.width * scale;
  const renderedHeight = block.height * scale;
  return {
    scale,
    x: bounds.x + (bounds.width - renderedWidth) / 2,
    y: bounds.y + (bounds.height - renderedHeight) / 2,
    translateX: bounds.x + (bounds.width - renderedWidth) / 2 - block.x * scale,
    translateY: bounds.y + (bounds.height - renderedHeight) / 2 - block.y * scale,
    width: renderedWidth,
    height: renderedHeight,
  };
}

export function staffTextCols(staffText, _geometry = COMPOSITION_GEOMETRY, charsPerCol = 26) {
  if (!staffText) return 0;
  return Math.max(1, Math.ceil(String(staffText).length / charsPerCol));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function characters(value) {
  return Array.from(String(value || ""));
}

function isMissingStaffText(value) {
  return /^(?:编制|员额)?未载[。.]?$/.test(String(value || "").trim());
}

// 原稿没有“编制未载”占位，也不按官/吏类型拆成左右并列轨道。模型已经把
// 官职排成阅读顺序，这里保持该顺序合为一段，随后只按可用高度切列。
function continuousStaffText(source) {
  const pieces = (source.staffItems || [])
    .map((item) => String(item.text || "").trim())
    .filter(Boolean);
  if (pieces.length) return pieces.join("，");
  const fallback = String(source.staffText || "").trim();
  return source.staff?.length && fallback && !isMissingStaffText(fallback) ? fallback : "";
}

function textRole(kind, depth, geometry) {
  if (kind === "focus") {
    return {
      baseTitleFontSize: geometry.focusTitleFontSize,
      titleXOffset: geometry.focusTitleXOffset,
      titleYOffset: geometry.focusTitleYOffset,
      titleMinFontSize: geometry.focusTitleMinFontSize,
      staffFontSize: geometry.summaryStaffFontSize,
      staffGap: geometry.focusStaffGap,
      staffClass: "cls-30",
      maxScale: geometry.focusTypographyMaxScale,
      sparseTopPaddingRatio: 0.016,
      sparseTopPaddingMax: 14,
    };
  }
  if (kind === "section") {
    return {
      baseTitleFontSize: geometry.sectionTitleFontSize,
      titleXOffset: geometry.sectionTitleXOffset,
      titleYOffset: geometry.sectionTitleYOffset,
      titleMinFontSize: geometry.sectionTitleMinFontSize,
      staffFontSize: geometry.summaryStaffFontSize,
      staffGap: geometry.sectionStaffGap,
      staffClass: "cls-30",
      maxScale: geometry.sectionTypographyMaxScale,
      sparseTopPaddingRatio: 0.024,
      sparseTopPaddingMax: 18,
    };
  }
  const nested = depth > 1;
  return {
    baseTitleFontSize: nested
      ? geometry.nestedTitleFontSize
      : geometry.columnTitleFontSize,
    titleXOffset: nested ? geometry.nestedTitleXOffset : geometry.columnTitleXOffset,
    titleYOffset: nested ? geometry.nestedTitleYOffset : geometry.columnTitleYOffset,
    titleMinFontSize: nested
      ? geometry.nestedTitleMinFontSize
      : geometry.columnTitleMinFontSize,
    staffFontSize: geometry.staffFontSize,
    staffGap: geometry.columnStaffGap,
    staffClass: "cls-31",
    maxScale: nested
      ? geometry.nestedTypographyMaxScale
      : geometry.columnTypographyMaxScale,
    sparseTopPaddingRatio: nested ? 0.032 : 0.034,
    sparseTopPaddingMax: nested ? 21 : 24,
  };
}

function median(values) {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
}

function roleTargetScale(globalScale, role, geometry) {
  const globalMax = Math.max(1, geometry.typographyMaxScale);
  const progress = clamp((globalScale - 1) / (globalMax - 1 || 1), 0, 1);
  return 1 + (Math.max(1, role.maxScale) - 1) * progress;
}

function descendingValues(max, min, step) {
  if (max < min) return [];
  const result = [max];
  let next = Math.floor((max - 1e-9) / step) * step;
  while (next >= min - 1e-9) {
    if (Math.abs(next - result.at(-1)) > 1e-9) result.push(next);
    next -= step;
  }
  if (Math.abs(result.at(-1) - min) > 1e-9) result.push(min);
  return result;
}

function adaptiveRole(role, rect, typeScale, targetScale, globalProgress, geometry) {
  const scaleProgress = targetScale > 1
    ? clamp((typeScale - 1) / (targetScale - 1), 0, 1)
    : 0;
  const localGrowth = globalProgress * scaleProgress;
  const sparseTopPadding = clamp(
    rect.height * role.sparseTopPaddingRatio,
    role.titleYOffset,
    role.sparseTopPaddingMax,
  );
  const titleYOffset = role.titleYOffset
    + (sparseTopPadding - role.titleYOffset) * localGrowth;
  const compression = Math.min(1, typeScale);
  const growth = Math.max(0, typeScale - 1);
  const staffFontSize = Math.min(
    geometry.staffMaxFontSize,
    role.staffFontSize * typeScale,
  );
  return {
    ...role,
    titleYOffset: titleYOffset * compression,
    staffFontSize,
    staffTrackPitch: staffFontSize * 1.2,
    staffGap: role.staffGap * compression * (1 + growth * 0.5),
    sidePadding: geometry.textSidePadding * compression * Math.sqrt(Math.max(1, typeScale)),
    bottomPadding: geometry.staffBottomPadding * compression * Math.sqrt(Math.max(1, typeScale)),
    titleColGap: geometry.titleColGap * compression * Math.sqrt(Math.max(1, typeScale)),
  };
}

function horizontalTextMetrics({
  role,
  fontSize,
  titleCols,
  titlePitch,
  staffTrackCount,
  geometry,
}) {
  const staffHalfSpan = staffTrackCount
    ? (staffTrackCount - 1) * role.staffTrackPitch / 2 + role.staffFontSize / 2
    : 0;
  // 多列编制围绕标题基线居中，列数较多时只把整组向右平移到安全边距内。
  const titleXOffset = Math.max(
    role.titleXOffset,
    staffTrackCount ? role.sidePadding + staffHalfSpan : role.titleXOffset,
  );
  const titleRight = titleXOffset
    + Math.max(0, titleCols - 1) * titlePitch
    + fontSize / 2;
  const staffRight = staffTrackCount ? titleXOffset + staffHalfSpan : 0;
  return {
    titleXOffset,
    staffRightmostXOffset: titleXOffset
      + Math.max(0, staffTrackCount - 1) * role.staffTrackPitch / 2,
    requiredWidth: Math.max(titleRight, staffRight) + role.sidePadding,
  };
}

function staffTracksFor(staffChars, charsPerCol) {
  if (!staffChars.length || charsPerCol <= 0) return [];
  const tracks = [];
  for (let offset = 0; offset < staffChars.length; offset += charsPerCol) {
    tracks.push({
      text: staffChars.slice(offset, offset + charsPerCol).join(""),
      kind: "neutral",
      staffType: "",
      continuation: offset > 0,
    });
  }
  return tracks;
}

function typographyCandidate(source, {
  kind,
  rect,
  baseFontSize,
  geometry,
  depth,
  role,
  typeScale,
  targetScale,
  globalProgress,
  allowTruncation = false,
  allowEmptyStaff = false,
  preferBalanced = false,
}) {
  const dynamicRole = adaptiveRole(
    role,
    rect,
    typeScale,
    targetScale,
    globalProgress,
    geometry,
  );
  const titleChars = characters(source.title);
  const staffChars = characters(continuousStaffText(source));
  const maxTitleFontSize = baseFontSize * typeScale;
  const minTitleFontSize = Math.min(
    role.titleMinFontSize,
    maxTitleFontSize,
  );
  const fontSizes = descendingValues(maxTitleFontSize, minTitleFontSize, 0.5);
  const titleLength = Math.max(1, titleChars.length);
  let best = null;

  // 先保持更自然的单列标题，并在该列内作 0.5px 级回缩；只有最小字号
  // 仍放不下时才增加标题列，避免七字深层标题无谓拆成两列。
  for (let requestedCols = 1; requestedCols <= titleLength; requestedCols += 1) {
    for (const resolvedFontSize of fontSizes) {
      const titleCapacity = Math.max(1, Math.ceil(titleLength / requestedCols));
      const titleCols = Math.max(1, Math.ceil(titleLength / titleCapacity));
      const emergencyRole = allowTruncation
        ? {
          ...dynamicRole,
          sidePadding: Math.min(dynamicRole.sidePadding, rect.width * 0.08),
          titleColGap: Math.min(dynamicRole.titleColGap, rect.width * 0.04),
        }
        : dynamicRole;
      const titlePitch = resolvedFontSize + emergencyRole.titleColGap;
      const titleWidth = titleCols * resolvedFontSize
        + Math.max(0, titleCols - 1) * emergencyRole.titleColGap;
      const titleLines = Math.min(titleLength, titleCapacity);
      const titleScale = resolvedFontSize / baseFontSize;
      const naturalTitleX = role.titleXOffset
        * (typeScale < 1 ? typeScale : Math.max(1, titleScale));
      const titleXBase = allowTruncation
        ? Math.min(
          naturalTitleX,
          emergencyRole.sidePadding + resolvedFontSize / 2,
        )
        : naturalTitleX;
      const roleForMeasure = { ...emergencyRole, titleXOffset: titleXBase };
      const titleBottom = roleForMeasure.titleYOffset + titleLines * resolvedFontSize;
      const staffYOffset = titleBottom + (staffChars.length ? roleForMeasure.staffGap : 0);
      const availableStaffHeight = Math.max(
        0,
        rect.height - staffYOffset - roleForMeasure.bottomPadding,
      );
      const charsPerCol = Math.floor(availableStaffHeight / roleForMeasure.staffFontSize);
      const staffVerticalTruncated = staffChars.length > 0 && charsPerCol <= 0;
      if (staffVerticalTruncated && !allowTruncation) continue;
      if (staffVerticalTruncated && !allowEmptyStaff) continue;
      const allTracks = staffTracksFor(staffChars, charsPerCol);
      const fullHorizontal = horizontalTextMetrics({
        role: roleForMeasure,
        fontSize: resolvedFontSize,
        titleCols,
        titlePitch,
        staffTrackCount: allTracks.length,
        geometry,
      });
      const titleFitsVertically = titleBottom
        + (staffChars.length ? 0 : roleForMeasure.titleYOffset)
        <= rect.height + 1e-9;
      const fullFit = titleFitsVertically
        && fullHorizontal.requiredWidth <= rect.width + 1e-9;
      if (!fullFit && !allowTruncation) continue;

      let visibleTrackCount = allTracks.length;
      let horizontal = fullHorizontal;
      if (allowTruncation) {
        while (visibleTrackCount > 0 && horizontal.requiredWidth > rect.width + 1e-9) {
          visibleTrackCount -= 1;
          horizontal = horizontalTextMetrics({
            role: roleForMeasure,
            fontSize: resolvedFontSize,
            titleCols,
            titlePitch,
            staffTrackCount: visibleTrackCount,
            geometry,
          });
        }
        if (horizontal.requiredWidth > rect.width + 1e-9 || !titleFitsVertically) continue;
        if (staffChars.length && visibleTrackCount === 0 && !allowEmptyStaff) continue;
      }
      const staffTracks = allTracks.slice(0, visibleTrackCount).map((track) => ({ ...track }));
      const truncated = staffVerticalTruncated || visibleTrackCount < allTracks.length;
      if (truncated && staffTracks.length) {
        const last = staffTracks.at(-1);
        const lastChars = characters(last.text);
        last.text = `${lastChars.slice(0, Math.max(0, charsPerCol - 1)).join("")}…`;
      }
      const metrics = {
        fontSize: resolvedFontSize,
        typeScale,
        titleCapacity,
        titleCols,
        titleLines,
        titlePitch,
        titleWidth,
        titleXOffset: horizontal.titleXOffset,
        titleYOffset: roleForMeasure.titleYOffset,
        staffYOffset,
        staffTracks,
        staffTrackCount: allTracks.length,
        visibleStaffTrackCount: staffTracks.length,
        staffRightmostXOffset: horizontal.staffRightmostXOffset,
        staffTrackPitch: roleForMeasure.staffTrackPitch,
        staffFontSize: roleForMeasure.staffFontSize,
        staffGap: roleForMeasure.staffGap,
        staffBottomPadding: roleForMeasure.bottomPadding,
        staffMode: "below",
        staffClass: role.staffClass,
        fullRequiredWidth: fullHorizontal.requiredWidth,
        requiredWidth: horizontal.requiredWidth,
        charsPerStaffCol: charsPerCol,
        truncated,
      };
      if (!preferBalanced) return metrics;
      if (
        !best
        || metrics.fontSize > best.fontSize + 1e-9
        || (
          Math.abs(metrics.fontSize - best.fontSize) <= 1e-9
          && metrics.titleCols < best.titleCols
        )
      ) best = metrics;
    }
  }
  return best;
}

export function solveLabelTypography(source, {
  kind = "column",
  rect,
  fontSize = null,
  geometry = COMPOSITION_GEOMETRY,
  depth = source?.depth ?? 1,
  globalScale = 1,
} = {}) {
  if (!source || !rect || rect.width <= 0 || rect.height <= 0) return null;
  const role = textRole(kind, depth, geometry);
  const baseFontSize = fontSize || role.baseTitleFontSize;
  const targetScale = roleTargetScale(globalScale, role, geometry);
  const globalProgress = clamp(
    (globalScale - 1) / (Math.max(1, geometry.typographyMaxScale) - 1 || 1),
    0,
    1,
  );
  const minScale = Math.min(1, geometry.typographyMinScale);
  const typeScales = descendingValues(targetScale, minScale, 0.025);
  let best = null;
  let bestBalancedScale = -Infinity;
  for (const typeScale of typeScales) {
    if (globalScale > 1 && typeScale < bestBalancedScale - 1e-9) break;
    const candidate = typographyCandidate(source, {
      kind,
      rect,
      baseFontSize,
      geometry,
      depth,
      role,
      typeScale,
      targetScale,
      globalProgress,
      preferBalanced: globalScale > 1,
    });
    if (!candidate) continue;
    // 原稿密集态保留既有角色比例；进入自适应态后，以标题与编制两者中
    // 较小的相对尺度为主，防止“空间变大、编制变大、标题反而变小”。
    if (globalScale <= 1) return candidate;
    const titleScale = candidate.fontSize / baseFontSize;
    const balancedScale = Math.min(titleScale, candidate.typeScale);
    const bestTitleScale = best ? best.fontSize / baseFontSize : -Infinity;
    if (
      balancedScale > bestBalancedScale + 1e-9
      || (
        Math.abs(balancedScale - bestBalancedScale) <= 1e-9
        && (
          titleScale > bestTitleScale + 1e-9
          || (
            Math.abs(titleScale - bestTitleScale) <= 1e-9
            && candidate.typeScale > best.typeScale + 1e-9
          )
        )
      )
    ) {
      best = candidate;
      bestBalancedScale = balancedScale;
    }
  }
  if (best) return best;
  const emergencyMinFontSize = Math.max(
    Number.EPSILON,
    Math.min(1, rect.width * 0.5),
  );
  const emergencyRole = { ...role, titleMinFontSize: emergencyMinFontSize };
  const truncated = typographyCandidate(source, {
    kind,
    rect,
    baseFontSize,
    geometry,
    depth,
    role: emergencyRole,
    typeScale: minScale,
    targetScale,
    globalProgress: 0,
    allowTruncation: true,
  });
  if (truncated) return truncated;
  // 比格子还小的不可约极端状态也必须保住机构名；只有连一个省略号都
  // 没有空间时，才允许编制轨为空，并继续显式返回 truncated=true。
  const titleOnlyFallback = typographyCandidate(source, {
    kind,
    rect,
    baseFontSize,
    geometry,
    depth,
    role: emergencyRole,
    typeScale: minScale,
    targetScale,
    globalProgress: 0,
    allowTruncation: true,
    allowEmptyStaff: true,
  });
  if (titleOnlyFallback) return titleOnlyFallback;

  // 任意正尺寸格都必须返回有限坐标，避免 placedLabel 把缺失量传播为
  // translate(NaN NaN)。此路径只处理比 1px 字还窄的不可约数据密度。
  const titleChars = characters(source.title);
  const titleLength = Math.max(1, titleChars.length);
  const emergencyFontSize = Math.max(
    Number.EPSILON,
    Math.min(rect.width, rect.height / titleLength),
  );
  const hasStaff = characters(continuousStaffText(source)).length > 0;
  return {
    fontSize: emergencyFontSize,
    typeScale: emergencyFontSize / baseFontSize,
    titleCapacity: titleLength,
    titleCols: 1,
    titleLines: titleLength,
    titlePitch: emergencyFontSize,
    titleWidth: emergencyFontSize,
    titleXOffset: emergencyFontSize / 2,
    titleYOffset: 0,
    staffYOffset: titleLength * emergencyFontSize,
    staffTracks: [],
    staffTrackCount: 0,
    visibleStaffTrackCount: 0,
    staffRightmostXOffset: emergencyFontSize / 2,
    staffTrackPitch: Math.max(Number.EPSILON, emergencyFontSize * 1.2),
    staffFontSize: Math.max(Number.EPSILON, Math.min(role.staffFontSize, emergencyFontSize)),
    staffGap: 0,
    staffBottomPadding: 0,
    staffMode: "below",
    staffClass: role.staffClass,
    fullRequiredWidth: emergencyFontSize,
    requiredWidth: emergencyFontSize,
    charsPerStaffCol: 0,
    truncated: hasStaff,
  };
}

function labelMetrics(source, options) {
  return solveLabelTypography(source, {
    ...options,
    globalScale: options.globalScale ?? 1,
  });
}

function placedLabel(source, {
  kind,
  rect,
  labelRect = rect,
  fontSize,
  geometry,
  globalScale = 1,
  depth = source.depth ?? 0,
  children = [],
}) {
  const metrics = labelMetrics(source, {
    kind,
    rect: labelRect,
    fontSize,
    geometry,
    depth,
    globalScale,
  });
  const placed = {
    kind,
    ...source,
    depth,
    rect,
    labelRect,
    children,
    ...metrics,
  };
  if (kind === "focus") {
    const plateScale = metrics.fontSize / geometry.focusTitleFontSize;
    placed.titlePlateRect = {
      x: rect.x - geometry.outerPadding + 0.24,
      y: rect.y - geometry.outerPadding + 1.32,
      width: Math.min(
        40.67 * Math.max(1, plateScale),
        Math.max(0, rect.width + geometry.outerPadding - 1),
      ),
      height: Math.min(
        rect.height + geometry.outerPadding - 2,
        characters(source.title).length * metrics.fontSize
          + 14.81 * Math.max(1, plateScale)
      ),
    };
  }
  return placed;
}

function nodeWeight(node) {
  const own = 1
    + Math.min(1.2, String(node.title || "").length * 0.09)
    + Math.min(1.4, String(node.staffText || "").length * 0.012);
  if (!node.children?.length) return own;
  return own + node.children.reduce((sum, child) => sum + nodeWeight(child) * 0.28, 0);
}

function sectionWeight(section) {
  return 1.4 + (section.columns || []).reduce((sum, child) => sum + Math.sqrt(nodeWeight(child)), 0);
}

function preferredInternalRows(section) {
  const columns = section.columns || [];
  const demand = columns.reduce((sum, child) => sum + nodeWeight(child), 0);
  return columns.length >= 6 || demand >= 11 ? 2 : 1;
}

function allocateWidths(items, totalWidth, gap, weightOf) {
  if (!items.length) return [];
  const available = Math.max(0, totalWidth - gap * Math.max(0, items.length - 1));
  const weights = items.map((item) => Math.max(0.35, Math.sqrt(weightOf(item))));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  let used = 0;
  return items.map((item, index) => {
    const width = index === items.length - 1
      ? Math.max(0, available - used)
      : available * (weights[index] / totalWeight);
    used += width;
    return width;
  });
}

function balancedGroups(items, rowCount, weightOf) {
  if (!items.length) return [];
  const rows = Math.max(1, Math.min(rowCount, items.length));
  const total = items.reduce((sum, item) => sum + weightOf(item), 0);
  const target = total / rows;
  const result = [];
  let start = 0;
  let remainingRows = rows;
  while (remainingRows > 0) {
    if (remainingRows === 1) {
      result.push(items.slice(start));
      break;
    }
    const maxEnd = items.length - (remainingRows - 1);
    let bestEnd = start + 1;
    let weight = 0;
    let bestDistance = Infinity;
    for (let end = start + 1; end <= maxEnd; end += 1) {
      weight += weightOf(items[end - 1]);
      const distance = Math.abs(weight - target);
      if (distance <= bestDistance) {
        bestDistance = distance;
        bestEnd = end;
      } else if (weight > target) {
        break;
      }
    }
    result.push(items.slice(start, bestEnd));
    start = bestEnd;
    remainingRows -= 1;
  }
  return result;
}

export function nestedRowCountFor(children, childArea, geometry = COMPOSITION_GEOMETRY) {
  if (!children?.length || !childArea || childArea.height <= 0) return 1;
  const desiredRows = Math.ceil(children.length / geometry.nestedColumnsPerRow);
  const maxRowsByHeight = Math.max(1, Math.floor(
    (childArea.height + geometry.nestedGap)
      / (geometry.nestedMinRowHeight + geometry.nestedGap)
  ));
  return clamp(desiredRows, 1, Math.min(children.length, maxRowsByHeight));
}

function layoutBranch(node, rect, geometry, globalScale) {
  const depth = node.depth ?? 1;
  if (!node.children?.length) {
    return placedLabel(node, {
      kind: "column",
      rect,
      fontSize: depth > 1 ? geometry.nestedTitleFontSize : geometry.columnTitleFontSize,
      geometry,
      depth,
      globalScale,
    });
  }

  const baseFontSize = depth > 1
    ? geometry.nestedTitleFontSize
    : geometry.columnTitleFontSize;
  const probe = labelMetrics(node, {
    kind: "column",
    rect,
    fontSize: baseFontSize,
    geometry,
    depth,
    globalScale,
  });
  // 分支标题栏必须按真实文字轨数留宽；只按 staff_type 组数估宽会让贡院
  // 等长编制穿过父栏，压到右侧嵌套机构标题上。
  const desiredLane = Math.max(geometry.branchLabelMin, probe.fullRequiredWidth);
  const labelWidth = clamp(
    desiredLane,
    geometry.branchLabelMin,
    Math.max(geometry.branchLabelMin, rect.width * 0.42)
  );
  const labelRect = {
    x: rect.x,
    y: rect.y,
    width: Math.min(labelWidth, rect.width),
    height: rect.height,
  };
  const childArea = {
    x: labelRect.x + labelRect.width + geometry.nestedGap,
    y: rect.y,
    width: Math.max(0, rect.width - labelRect.width - geometry.nestedGap),
    height: rect.height,
  };
  const nestedRowCount = nestedRowCountFor(node.children, childArea, geometry);
  const groups = balancedGroups(node.children, nestedRowCount, nodeWeight);
  const rowHeight = groups.length
    ? (childArea.height - geometry.nestedGap * (groups.length - 1)) / groups.length
    : childArea.height;
  const children = [];
  groups.forEach((group, rowIndex) => {
    const widths = allocateWidths(group, childArea.width, geometry.nestedGap, nodeWeight);
    let x = childArea.x;
    group.forEach((child, index) => {
      const childRect = {
        x,
        y: childArea.y + rowIndex * (rowHeight + geometry.nestedGap),
        width: widths[index],
        height: rowHeight,
      };
      children.push(layoutBranch(child, childRect, geometry, globalScale));
      x += widths[index] + geometry.nestedGap;
    });
  });
  return placedLabel(node, {
    kind: "column",
    rect,
    labelRect,
    fontSize: baseFontSize,
    geometry,
    depth,
    children,
    globalScale,
  });
}

function layoutSection(block, rect, geometry, globalScale) {
  if (block.kind === "attachments") {
    const widths = allocateWidths(block.columns, rect.width, geometry.columnGap, nodeWeight);
    let x = rect.x;
    const items = block.columns.map((node, index) => {
      const item = layoutBranch({ ...node, depth: 1 }, {
        x,
        y: rect.y,
        width: widths[index],
        height: rect.height,
      }, geometry, globalScale);
      x += widths[index] + geometry.columnGap;
      return item;
    });
    return { ...block, rect, label: null, items };
  }

  const sectionProbe = labelMetrics(block.section, {
    kind: "section",
    rect,
    fontSize: geometry.sectionTitleFontSize,
    geometry,
    depth: 0,
    globalScale,
  });
  const labelWidth = clamp(
    Math.max(rect.width * 0.15, sectionProbe.fullRequiredWidth),
    geometry.sectionLabelMin,
    Math.min(geometry.sectionLabelMax, rect.width * 0.28)
  );
  const labelRect = { x: rect.x, y: rect.y, width: labelWidth, height: rect.height };
  const label = placedLabel(block.section, {
    kind: "section",
    rect: labelRect,
    fontSize: geometry.sectionTitleFontSize,
    geometry,
    depth: 0,
    globalScale,
  });
  const content = {
    x: labelRect.x + labelRect.width + geometry.columnGap,
    y: rect.y,
    width: Math.max(0, rect.width - labelRect.width - geometry.columnGap),
    height: rect.height,
  };
  const groups = balancedGroups(block.columns, block.internalRows, nodeWeight);
  const rowHeight = groups.length
    ? (content.height - geometry.columnGap * (groups.length - 1)) / groups.length
    : content.height;
  const items = [];
  groups.forEach((group, rowIndex) => {
    const widths = allocateWidths(group, content.width, geometry.columnGap, nodeWeight);
    let x = content.x;
    group.forEach((node, index) => {
      const nodeRect = {
        x,
        y: content.y + rowIndex * (rowHeight + geometry.columnGap),
        width: widths[index],
        height: rowHeight,
      };
      items.push(layoutBranch(node, nodeRect, geometry, globalScale));
      x += widths[index] + geometry.columnGap;
    });
  });
  return { ...block, rect, label, items };
}

function departmentRank(title) {
  const hints = ["吏部", "户部", "礼部", "工部", "兵部", "刑部"];
  const index = hints.findIndex((hint) => String(title).includes(hint));
  return index < 0 ? hints.length : index;
}

function genericOuterRows(blocks) {
  if (blocks.length <= 4) return [blocks];
  const rowCount = blocks.length <= 8 ? 2 : 3;
  return balancedGroups(blocks, rowCount, (block) => block.weight);
}

function outerRows(blocks) {
  const sectionBlocks = blocks.filter((block) => block.kind === "section");
  const attachment = blocks.find((block) => block.kind === "attachments");
  const six = ["吏部", "户部", "礼部", "工部", "兵部", "刑部"].map((hint) => (
    sectionBlocks.find((block) => String(block.section.title).includes(hint))
  ));
  if (six.every(Boolean)) {
    const used = new Set(six);
    const extra = sectionBlocks.filter((block) => !used.has(block));
    const rows = [six.slice(0, 4), [...six.slice(4), ...(attachment ? [attachment] : [])]];
    if (extra.length) rows.push(...genericOuterRows(extra));
    return rows.filter((row) => row.length);
  }
  return genericOuterRows(blocks);
}

function flattenItems(items) {
  const result = [];
  const visit = (item) => {
    result.push(item);
    for (const child of item.children || []) visit(child);
  };
  for (const item of items) visit(item);
  return result;
}

function layoutCompositionPass(model, {
  origin = { x: 503.48, y: 147.58 },
  maxWidth = 1309.84,
  maxHeight = 717.85,
  geometry = COMPOSITION_GEOMETRY,
  globalScale = 1,
} = {}) {
  if (!model) return null;
  const parentRect = { x: origin.x, y: origin.y, width: maxWidth, height: maxHeight };
  const inner = {
    x: parentRect.x + geometry.outerPadding,
    y: parentRect.y + geometry.outerPadding,
    width: parentRect.width - geometry.outerPadding * 2,
    height: parentRect.height - geometry.outerPadding * 2,
  };
  const focusSource = model.selfColumn || {
    id: model.focus.id,
    title: model.focus.title,
    staff: [],
    staffItems: [],
    staffText: "",
  };
  const focusProbe = labelMetrics(focusSource, {
    kind: "focus",
    rect: inner,
    fontSize: geometry.focusTitleFontSize,
    geometry,
    depth: -1,
    globalScale,
  });
  const focusLaneWidth = clamp(
    Math.max(geometry.focusLaneMin, focusProbe.fullRequiredWidth),
    geometry.focusLaneMin,
    geometry.focusLaneMax
  );
  const focusRect = { x: inner.x, y: inner.y, width: focusLaneWidth, height: inner.height };
  const focusLabel = placedLabel(focusSource, {
    kind: "focus",
    rect: focusRect,
    fontSize: geometry.focusTitleFontSize,
    geometry,
    depth: -1,
    globalScale,
  });

  const blocks = [...model.sections]
    .sort((a, b) => departmentRank(a.title) - departmentRank(b.title)
      || a.title.localeCompare(b.title, "zh"))
    .map((section) => ({
      kind: "section",
      id: section.id,
      section,
      columns: section.columns || section.children || [],
      internalRows: preferredInternalRows(section),
      weight: sectionWeight(section),
    }));
  if (model.focusDirectLeaves?.length) {
    blocks.push({
      kind: "attachments",
      id: `attachments:${model.focus.id}`,
      columns: model.focusDirectLeaves,
      internalRows: 1,
      weight: Math.max(1.2, model.focusDirectLeaves.reduce((sum, node) => sum + nodeWeight(node), 0) * 0.65),
    });
  }

  const grid = {
    x: focusRect.x + focusRect.width + geometry.sectionGapX,
    y: inner.y,
    width: Math.max(0, inner.width - focusRect.width - geometry.sectionGapX),
    height: inner.height,
  };
  const rows = outerRows(blocks);
  const rowUnits = rows.map((row) => (
    1 + Math.max(0, ...row.map((block) => block.internalRows - 1)) * 0.55
  ));
  const totalUnits = rowUnits.reduce((sum, unit) => sum + unit, 0) || 1;
  const availableHeight = grid.height - geometry.sectionGapY * Math.max(0, rows.length - 1);
  const placedBlocks = [];
  let y = grid.y;
  rows.forEach((row, rowIndex) => {
    const height = availableHeight * (rowUnits[rowIndex] / totalUnits);
    const widths = allocateWidths(row, grid.width, geometry.sectionGapX, (block) => block.weight);
    let x = grid.x;
    row.forEach((block, index) => {
      const rect = { x, y, width: widths[index], height };
      placedBlocks.push(layoutSection(block, rect, geometry, globalScale));
      x += widths[index] + geometry.sectionGapX;
    });
    y += height + geometry.sectionGapY;
  });

  const allItems = [focusLabel];
  for (const block of placedBlocks) {
    if (block.label) allItems.push(block.label);
    allItems.push(...flattenItems(block.items));
  }
  return {
    origin,
    geometry,
    focus: model.focus,
    parentRect,
    focusLabel,
    blocks: placedBlocks,
    items: allItems,
    bounds: parentRect,
    rowCount: rows.length,
    typographyScale: globalScale,
  };
}

export function compositionDensityScale(layoutOrItems, {
  geometry = COMPOSITION_GEOMETRY,
} = {}) {
  const allItems = Array.isArray(layoutOrItems)
    ? layoutOrItems
    : layoutOrItems?.items || [];
  const columns = allItems.filter((item) => (
    item.kind === "column"
      && item.labelRect?.width > 0
      && item.labelRect?.height > 0
  ));
  const candidates = columns.length
    ? columns
    : allItems.filter((item) => item.labelRect?.width > 0 && item.labelRect?.height > 0);
  if (!candidates.length) return 1;

  const count = candidates.length;
  const maxScale = Math.max(1, geometry.typographyMaxScale);
  const areaRatios = candidates.map((item) => {
    const referenceArea = item.depth > 1
      ? geometry.nestedReferenceArea
      : geometry.columnReferenceArea;
    return (item.labelRect.width * item.labelRect.height) / referenceArea;
  });
  const areaScale = clamp(
    Math.pow(Math.max(1, median(areaRatios)), 0.23),
    1,
    maxScale,
  );
  // 12 个及以上沿用原稿密集字号；4 个直接机构可使用完整稀疏上限。
  const countScale = count >= 12
    ? 1
    : clamp(1 + ((12 - count) / 8) * (maxScale - 1), 1, maxScale);
  return Math.round(Math.min(areaScale, countScale) * 1000) / 1000;
}

export function layoutComposition(model, options = {}) {
  if (!model) return null;
  const geometry = options.geometry || COMPOSITION_GEOMETRY;
  const denseLayout = layoutCompositionPass(model, {
    ...options,
    geometry,
    globalScale: 1,
  });
  const typographyScale = compositionDensityScale(denseLayout, { geometry });
  if (typographyScale <= 1) return denseLayout;
  return layoutCompositionPass(model, {
    ...options,
    geometry,
    globalScale: typographyScale,
  });
}
