import { compactRelationLabel } from "../utils/evolution_layout.js";
import {
  evolutionSelectionAnchors,
  evolutionSelectionFocus,
} from "../utils/evolution_selection.js";
import {
  evolutionSelectionComparison,
} from "../utils/evolution_context.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const XHTML_NS = "http://www.w3.org/1999/xhtml";

const COLORS = {
  ink: "#351704",
  line: "#563905",
  olive: "#918069",
  oliveFill: "#a5a68d",
  selected: "#866d6d",
  paper: "#f5f3ec",
  abolish: "#a0432e",
};

export function evolutionEventIconSize(iconType, selected = false) {
  const emphasis = selected ? 1 : 0;
  if (iconType === "affiliation_change") return 7 + emphasis;
  if (iconType === "establish" || iconType === "abolish") return 7.2 + emphasis;
  return 4.2 + emphasis;
}

/**
 * Single visual weight for every evolution relation stroke — single relations
 * and fan branches alike. Unselected lines stay very light (0.35) so they
 * never compete with lanes and event marks; only selection makes a line
 * bolder and fully opaque. Never introduce per-geometry fade/width
 * differences: they read as an unintended data encoding.
 */
const RELATION_STROKE = {
  width: 1.1,
  opacity: 0.35,
  selectedWidth: 1.7,
  selectedOpacity: 1,
};

// Extracted verbatim from the original 4-01 design SVG. Keep these source
// coordinates intact: evolution lane identities must reuse the design assets,
// not approximate their silhouettes with newly drawn paths.
const LANE_IDENTITY_TEMPLATES = Object.freeze({
  institution: Object.freeze({
    bounds: Object.freeze({ x: 747.3, y: 160.96, width: 33.22, height: 126.85 }),
    points: "776.76 162.84 776.76 160.96 768.66 160.96 759.16 160.96 751.06 160.96 751.06 162.84 751.05 164.72 749.18 164.72 747.3 164.72 747.3 287.81 780.52 287.81 780.52 164.72 778.64 164.72 776.76 164.72 776.76 162.84",
    strokeWidth: 2,
  }),
  official: Object.freeze({
    bounds: Object.freeze({ x: 794.72, y: 168.45, width: 15.42, height: 110.6 }),
    body: Object.freeze({ x: 794.72, y: 177.46, width: 15.42, height: 101.59 }),
    capPoints: "796.71 169.86 798.15 168.45 807.28 168.45 808.73 169.86 808.73 175.37 796.71 175.37 796.71 169.86",
    bodyStrokeWidth: 0.51,
    capStrokeWidth: 0.84,
  }),
});

export const EVOLUTION_SELECTOR_SLOT_STEP = 52;

export function evolutionLaneIdentityTemplate(entityType) {
  return entityType === "官职"
    ? LANE_IDENTITY_TEMPLATES.official
    : LANE_IDENTITY_TEMPLATES.institution;
}

export function evolutionLaneIdentityLayout(entityType, height, labelX, labelMaxWidth) {
  const template = evolutionLaneIdentityTemplate(entityType);
  const scale = height / template.bounds.height;
  const width = template.bounds.width * scale;
  const institution = LANE_IDENTITY_TEMPLATES.institution;
  const institutionWidth = institution.bounds.width * (height / institution.bounds.height);
  const centerX = labelX + Math.max(
    institutionWidth / 2,
    labelMaxWidth - 8 - institutionWidth / 2,
  );
  return {
    scale,
    width,
    centerX,
    x: centerX - width / 2,
  };
}

export function evolutionIdentityGlyphMetrics(entityType, height, centerX, y = 0) {
  const template = evolutionLaneIdentityTemplate(entityType);
  const scale = height / template.bounds.height;
  const width = template.bounds.width * scale;
  const x = centerX - width / 2;
  const bodyTop = entityType === "官职"
    ? y + (template.body.y - template.bounds.y) * scale
    : y + 5 * scale;
  const bodyBottom = entityType === "官职"
    ? y + (template.body.y + template.body.height - template.bounds.y) * scale
    : y + height;
  return {
    template,
    scale,
    width,
    x,
    y,
    centerX,
    bodyTop,
    bodyBottom,
  };
}

function svgElement(tag, attrs = {}) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value != null) element.setAttribute(name, String(value));
  }
  return element;
}

function appendIdentityGlyph(parent, entityType, {
  height,
  centerX,
  y,
  selected,
  dashed = false,
  widthOverride = null,
}) {
  const metrics = evolutionIdentityGlyphMetrics(entityType, height, centerX, y);
  const { template, scale, x } = metrics;
  const glyphWidth = Number.isFinite(widthOverride) ? widthOverride : metrics.width;
  const glyphX = centerX - glyphWidth / 2;
  const sourceTransform = Number.isFinite(widthOverride)
    ? `translate(${glyphX} ${y}) scale(${glyphWidth / template.bounds.width} ${scale}) translate(${-template.bounds.x} ${-template.bounds.y})`
    : `translate(${x} ${y}) scale(${scale}) translate(${-template.bounds.x} ${-template.bounds.y})`;
  if (entityType === "官职") {
    parent.appendChild(svgElement("rect", {
      ...template.body,
      transform: sourceTransform,
      fill: dashed ? "none" : COLORS.ink,
      "fill-opacity": dashed ? 0 : (selected ? 0.17 : 0.1),
      stroke: dashed ? COLORS.olive : (selected ? COLORS.selected : COLORS.olive),
      "stroke-width": dashed
        ? 0.85
        : (selected ? template.bodyStrokeWidth * 1.8 : template.bodyStrokeWidth),
      ...(dashed ? { "stroke-dasharray": "3 3", "vector-effect": "non-scaling-stroke" } : {}),
      "pointer-events": "none",
    }));
    parent.appendChild(svgElement("polygon", {
      points: template.capPoints,
      transform: sourceTransform,
      fill: dashed ? "none" : "#878089",
      "fill-opacity": dashed ? 0 : (selected ? 0.82 : 0.6),
      stroke: dashed ? COLORS.olive : (selected ? COLORS.selected : COLORS.line),
      "stroke-width": dashed
        ? 0.85
        : (selected ? template.capStrokeWidth * 1.45 : template.capStrokeWidth),
      ...(dashed ? { "stroke-dasharray": "3 3", "vector-effect": "non-scaling-stroke" } : {}),
      "pointer-events": "none",
    }));
  } else {
    parent.appendChild(svgElement("polygon", {
      points: template.points,
      transform: sourceTransform,
      fill: dashed ? "none" : (selected ? COLORS.ink : "none"),
      "fill-opacity": dashed ? 0 : (selected ? 0.12 : 0),
      stroke: dashed ? COLORS.olive : (selected ? COLORS.selected : COLORS.line),
      "stroke-width": dashed ? 0.85 : (selected ? template.strokeWidth * 1.35 : template.strokeWidth),
      ...(dashed ? { "stroke-dasharray": "3 3", "vector-effect": "non-scaling-stroke" } : {}),
      "pointer-events": "none",
    }));
  }
  return { ...metrics, x: glyphX, width: glyphWidth };
}

function appendText(parent, text, attrs = {}) {
  const element = svgElement("text", attrs);
  element.textContent = text;
  parent.appendChild(element);
  return element;
}

function appendVerticalText(parent, text, attrs = {}, options = {}) {
  const { maxChars = 8, pitch = 11 } = options;
  const x = Number(attrs.x || 0);
  const startY = Number(attrs.y || 0);
  const element = svgElement("text", attrs);
  Array.from(shortened(text, maxChars)).forEach((character, index) => {
    const tspan = svgElement("tspan", {
      x,
      y: startY + index * pitch,
      "text-anchor": "middle",
    });
    tspan.textContent = character;
    element.appendChild(tspan);
  });
  parent.appendChild(element);
  return element;
}

export function evolutionLaneTitleMetrics(bodyTop, bodyBottom, fontSize = 14) {
  const availableHeight = Math.max(0, bodyBottom - bodyTop);
  // 每个汉字至少占据自身字号并保留少量呼吸空间，避免字号放大后
  // 仍被旧的 10.5px 步进压叠在一起。
  const pitch = fontSize + 2;
  return {
    pitch,
    maxChars: Math.max(2, Math.floor(Math.max(0, availableHeight - 8) / pitch) + 1),
  };
}

function makeInteractive(element, label, activate) {
  element.setAttribute("role", "button");
  element.setAttribute("tabindex", "0");
  element.setAttribute("aria-label", label);
  element.style.pointerEvents = "all";
  element.style.cursor = "pointer";
  element.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    activate(event);
  });
  element.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    activate(event);
  });
}

function addTitle(element, text) {
  const title = svgElement("title");
  title.textContent = text;
  element.appendChild(title);
}

function shortened(text, limit = 8) {
  const value = String(text || "").replace(/\s+/g, "").trim();
  if (value.length <= limit) return value || "未载事件";
  return `${value.slice(0, Math.max(1, limit - 1))}…`;
}

function eventDescription(event) {
  return [event.rawTime || event.time || "时间未明", event.event || event.quotation || "未载事件"]
    .filter(Boolean)
    .join("：");
}

function selectedKey(item) {
  if (!item) return "";
  return `${item.kind}:${item.id}`;
}

function ensureDefs(svg) {
  svg.querySelectorAll("[data-evolution-def]").forEach((element) => element.remove());
  let defs = svg.querySelector("defs");
  if (!defs) {
    defs = svgElement("defs");
    svg.insertBefore(defs, svg.firstChild);
  }

  const clip = svgElement("clipPath", {
    id: "evolution-content-clip",
    clipPathUnits: "userSpaceOnUse",
    "data-evolution-def": "clip",
  });
  clip.appendChild(svgElement("rect", { x: 503, y: 128, width: 1311, height: 738 }));

  const arrow = svgElement("marker", {
    id: "evolution-relation-arrow",
    markerWidth: 6,
    markerHeight: 6,
    refX: 5.5,
    refY: 3,
    orient: "auto",
    markerUnits: "userSpaceOnUse",
    "data-evolution-def": "marker",
  });
  arrow.appendChild(svgElement("path", {
    d: "M0.5 0.5L5.5 3L0.5 5.5",
    fill: "none",
    stroke: COLORS.line,
    "stroke-width": 1,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  }));
  defs.append(clip, arrow);
}

function renderModeChoice(parent, { x, label, active, onActivate }) {
  const group = svgElement("g", { class: `evolution-mode-choice${active ? " is-active" : ""}` });
  group.appendChild(svgElement("rect", {
    x, y: 338, width: 11, height: 11,
    fill: active ? COLORS.line : "none",
    stroke: COLORS.line,
    "stroke-width": 0.8,
  }));
  appendText(group, label, { x: x + 20, y: 348.5, class: "evolution-selector-copy" });
  makeInteractive(group, `切换到${label}演变模式`, onActivate);
  parent.appendChild(group);
}

function selectorNode(parent, entity, index, selected, removable, handlers) {
  const x = 83 + index * EVOLUTION_SELECTOR_SLOT_STEP;
  const y = 367;
  const width = 46;
  const height = 92;
  const group = svgElement("g", {
    class: `evolution-selector-node evolution-selector-node--${entity.type === "官职" ? "official" : "institution"}${selected ? " is-selected" : ""}`,
    transform: `translate(${x} ${y})`,
    "data-entity-id": entity.id,
    "data-entity-type": entity.type,
  });
  group.appendChild(svgElement("rect", {
    x: 0,
    y: 0,
    width,
    height,
    fill: "transparent",
    "pointer-events": "all",
  }));
  const glyph = appendIdentityGlyph(group, entity.type, {
    height,
    centerX: width / 2,
    y: 0,
    selected,
  });
  const displayTitle = shortened(entity.title, 6);
  const textPitch = 12.5;
  const textHeight = Math.max(0, (Array.from(displayTitle).length - 1) * textPitch);
  appendVerticalText(group, displayTitle, {
    x: glyph.centerX,
    y: glyph.bodyTop + (glyph.bodyBottom - glyph.bodyTop - textHeight) / 2,
    class: "evolution-selector-node-label",
    "text-anchor": "middle",
  }, {
    maxChars: 6,
    pitch: textPitch,
  });
  addTitle(group, `${entity.title}（${entity.type}）`);
  makeInteractive(group, `选择${entity.title}`, () => handlers.onSelectEntity?.(entity.id));

  if (removable) {
    const remove = svgElement("g", {
      class: "evolution-selector-remove",
      transform: `translate(${width - 7} 7)`,
    });
    remove.appendChild(svgElement("circle", {
      cx: 0, cy: 0, r: 7, fill: COLORS.paper, stroke: COLORS.line, "stroke-width": 0.7,
    }));
    remove.appendChild(svgElement("path", {
      d: "M-2.5-2.5L2.5 2.5M2.5-2.5L-2.5 2.5",
      fill: "none", stroke: COLORS.line, "stroke-width": 0.9,
    }));
    makeInteractive(remove, `移除${entity.title}`, () => handlers.onRemoveEntity?.(entity.id));
    group.appendChild(remove);
  }
  parent.appendChild(group);
}

function renderAddNode(parent, index, onActivate) {
  const x = 83 + index * EVOLUTION_SELECTOR_SLOT_STEP;
  const group = svgElement("g", {
    class: "evolution-selector-add",
    transform: `translate(${x} 367)`,
  });
  appendIdentityGlyph(group, "机构", {
    height: 92,
    centerX: 23,
    y: 0,
    selected: false,
    dashed: true,
    widthOverride: 46,
  });
  group.appendChild(svgElement("path", {
    d: "M17 38H29M23 32V44",
    fill: "none",
    stroke: COLORS.line,
    "stroke-width": 1.2,
    "stroke-linecap": "round",
  }));
  appendText(group, "添加", {
    x: 23, y: 61, class: "evolution-selector-count", "text-anchor": "middle",
  });
  makeInteractive(group, "添加并进入演变对比", onActivate);
  parent.appendChild(group);
}

function searchMatches(entities, query, selectedIds) {
  const normalized = String(query || "").trim().toLocaleLowerCase("zh-CN");
  return [...entities]
    .filter((entity) => !selectedIds.includes(entity.id))
    .filter((entity) => !normalized || entity.title.toLocaleLowerCase("zh-CN").includes(normalized))
    .sort((a, b) => {
      const aStarts = normalized && a.title.toLocaleLowerCase("zh-CN").startsWith(normalized) ? 0 : 1;
      const bStarts = normalized && b.title.toLocaleLowerCase("zh-CN").startsWith(normalized) ? 0 : 1;
      return aStarts - bStarts || a.title.localeCompare(b.title, "zh");
    })
    .slice(0, 7);
}

function renderSearchPanel(parent, entities, selectedIds, handlers) {
  const foreignObject = svgElement("foreignObject", {
    class: "evolution-search-panel",
    x: 78,
    y: 322,
    width: 391,
    height: 151,
  });
  foreignObject.style.pointerEvents = "all";
  const panel = document.createElementNS(XHTML_NS, "div");
  panel.className = "evolution-search-surface";
  const row = document.createElementNS(XHTML_NS, "div");
  row.className = "evolution-search-row";
  const input = document.createElementNS(XHTML_NS, "input");
  input.className = "evolution-search-input";
  input.type = "search";
  input.placeholder = "搜索机构或官职";
  input.setAttribute("aria-label", "搜索机构或官职");
  const close = document.createElementNS(XHTML_NS, "button");
  close.className = "evolution-search-close";
  close.type = "button";
  close.setAttribute("aria-label", "关闭搜索");
  close.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13"/></svg>';
  close.addEventListener("click", () => handlers.onSearchOpenChange?.(false));
  row.append(input, close);
  const results = document.createElementNS(XHTML_NS, "div");
  results.className = "evolution-search-results";
  panel.append(row, results);
  foreignObject.appendChild(panel);
  parent.appendChild(foreignObject);

  const drawResults = () => {
    results.replaceChildren();
    const matches = searchMatches(entities, input.value, selectedIds);
    if (!matches.length) {
      const empty = document.createElementNS(XHTML_NS, "p");
      empty.className = "evolution-search-empty";
      empty.textContent = "没有匹配的机构或官职";
      results.appendChild(empty);
      return;
    }
    for (const entity of matches) {
      const button = document.createElementNS(XHTML_NS, "button");
      button.type = "button";
      button.className = "evolution-search-result";
      const title = document.createElementNS(XHTML_NS, "span");
      title.textContent = entity.title;
      const type = document.createElementNS(XHTML_NS, "small");
      type.textContent = entity.type;
      button.append(title, type);
      button.addEventListener("click", () => handlers.onAddEntity?.(entity.id));
      results.appendChild(button);
    }
  };
  input.addEventListener("input", drawResults);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") handlers.onSearchOpenChange?.(false);
  });
  drawResults();
  queueMicrotask(() => input.focus());
}

function renderSelector(layer, options) {
  const group = svgElement("g", { class: "evolution-selector-layer" });
  appendText(group, "演变对象", { x: 82, y: 307, class: "evolution-section-heading" });
  group.appendChild(svgElement("line", {
    x1: 82, y1: 319, x2: 475, y2: 319, stroke: COLORS.line, "stroke-width": 0.82,
  }));
  renderModeChoice(group, {
    x: 83,
    label: "单体",
    active: options.mode === "single",
    onActivate: () => options.handlers.onModeChange?.("single"),
  });
  renderModeChoice(group, {
    x: 176,
    label: "对比",
    active: options.mode === "compare",
    onActivate: () => options.handlers.onModeChange?.("compare"),
  });
  appendText(group, `${options.focusEntities.length} / 4`, {
    x: 475, y: 348.5, class: "evolution-selector-count", "text-anchor": "end",
  });
  options.focusEntities.forEach((entity, index) => selectorNode(
    group,
    entity,
    index,
    entity.id === options.activeEntityId,
    options.mode === "compare" && options.focusEntities.length > 1,
    options.handlers,
  ));
  if (options.focusEntities.length < 4) {
    renderAddNode(group, options.focusEntities.length, () => options.handlers.onSearchOpenChange?.(true));
  }
  if (options.searchOpen) {
    renderSearchPanel(group, options.entities, options.focusEntities.map((entity) => entity.id), options.handlers);
  }
  layer.appendChild(group);
}

function renderAxis(parent, layout, selectedRange, selectionActive, selectedItem, entryContext) {
  const { plotBounds, yearScale } = layout;
  const axisY = plotBounds.y - 25;
  parent.appendChild(svgElement("line", {
    x1: plotBounds.x, y1: axisY, x2: plotBounds.right, y2: axisY,
    stroke: COLORS.olive, "stroke-width": 0.7,
  }));
  const [yearMin, yearMax] = yearScale.domain;
  const ticks = [yearMin, ...[1000, 1050, 1100, 1150, 1200, 1250].filter(
    (year) => year > yearMin && year < yearMax
  ), yearMax];
  const scale = (year) => yearScale.range[0]
    + (year - yearMin) / Math.max(1, yearMax - yearMin)
      * (yearScale.range[1] - yearScale.range[0]);
  for (const year of ticks) {
    const x = scale(year);
    parent.appendChild(svgElement("line", {
      x1: x, y1: axisY - 6, x2: x, y2: axisY + 6,
      stroke: COLORS.line, "stroke-width": 0.65,
    }));
    appendText(parent, String(year), {
      x, y: axisY - 11, class: "evolution-axis-label", "text-anchor": "middle",
    });
  }
  const entryYear = Number(entryContext?.entryYear);
  if (Number.isFinite(entryYear)) {
    const entryX = scale(entryYear);
    parent.appendChild(svgElement("line", {
      class: "evolution-entry-year",
      x1: entryX,
      y1: plotBounds.y - 14,
      x2: entryX,
      y2: plotBounds.bottom + 14,
      stroke: COLORS.olive,
      "stroke-width": 1.1,
      "stroke-dasharray": "5 3",
      "pointer-events": "none",
    }));
    appendText(parent, `入口 ${entryYear}年`, {
      x: entryX + 5,
      y: axisY + 30,
      class: "evolution-entry-year-label",
      "text-anchor": "start",
      "pointer-events": "none",
    });
  }
  const anchors = evolutionSelectionAnchors(selectedItem);
  const anchorYears = new Set(anchors.map((anchor) => anchor.year));
  if (selectionActive && selectedRange?.length) {
    const startYear = selectedRange[0];
    const endYear = selectedRange[1] ?? startYear;
    const start = scale(startYear);
    const end = scale(endYear);
    if (Math.abs(end - start) > 1) {
      parent.appendChild(svgElement("rect", {
        class: "evolution-current-range",
        x: Math.min(start, end),
        y: plotBounds.y - 10,
        width: Math.max(1, Math.abs(end - start)),
        height: plotBounds.height + 20,
        fill: COLORS.selected,
        "fill-opacity": 0.055,
        "pointer-events": "none",
      }));
    }
    for (const year of new Set([startYear, endYear])) {
      if (anchorYears.has(year)) continue;
      const x = scale(year);
      parent.appendChild(svgElement("line", {
        class: "evolution-current-year",
        x1: x, y1: plotBounds.y - 11, x2: x, y2: plotBounds.bottom + 11,
        stroke: COLORS.selected, "stroke-width": 0.9, "stroke-dasharray": "3 3",
        "pointer-events": "none",
      }));
    }
  }

  anchors.forEach((anchor, index) => {
    const previous = anchors[index - 1];
    const next = anchors[index + 1];
    const closePrevious = previous && anchor.x - previous.x < 48;
    const closeNext = next && next.x - anchor.x < 48;
    const textAnchor = closeNext && !closePrevious ? "end"
      : closePrevious ? "start"
        : "middle";
    const labelX = textAnchor === "end" ? anchor.x - 5
      : textAnchor === "start" ? anchor.x + 5
        : anchor.x;
    parent.appendChild(svgElement("line", {
      class: "evolution-selected-year-guide",
      x1: anchor.x,
      y1: axisY + 1,
      x2: anchor.x,
      y2: anchor.y,
      stroke: COLORS.selected,
      "stroke-width": 0.9,
      "stroke-dasharray": "3 3",
      "pointer-events": "none",
    }));
    appendText(parent, `${anchor.year}年`, {
      x: labelX,
      y: axisY + 16,
      class: "evolution-selected-year-label",
      "text-anchor": textAnchor,
      "pointer-events": "none",
    });
  });
}

function renderEvolutionLegend(parent, layout) {
  const plot = layout?.plotBounds;
  if (!plot || plot.width < 260) return;
  const group = svgElement("g", { class: "evolution-legend" });
  // The legend shares the title band with the view heading; the year axis
  // immediately above keeps the top edge busy, so the legend must sit below it
  // and left of the lane pager to avoid colliding with either.
  const x = Math.max(plot.x + 160, plot.right - 1100);
  const rowY = 185;
  appendText(group, "图例", {
    x,
    y: rowY + 3,
    class: "evolution-legend-title",
  });

  const item = (itemX, label, draw) => {
    const sample = svgElement("g", { class: "evolution-legend-item" });
    draw(sample, itemX);
    appendText(sample, label, {
      x: itemX + 16,
      y: rowY + 3,
      class: "evolution-legend-label",
    });
    group.appendChild(sample);
  };
  item(x + 40, "普通记载", (sample, itemX) => {
    sample.appendChild(svgElement("circle", {
      cx: itemX,
      cy: rowY,
      r: evolutionEventIconSize("record"),
      fill: COLORS.paper,
      stroke: COLORS.line,
      "stroke-width": 0.9,
    }));
  });
  item(x + 120, "建置", (sample, itemX) => {
    const size = evolutionEventIconSize("establish");
    sample.appendChild(svgElement("path", {
      d: `M${itemX} ${rowY - size}L${itemX + size} ${rowY + size * (5 / 6.2)}H${itemX - size}Z`,
      fill: COLORS.line,
      stroke: COLORS.line,
      "stroke-width": 1,
      "stroke-linejoin": "round",
    }));
  });
  item(x + 174, "罢置", (sample, itemX) => {
    const size = evolutionEventIconSize("abolish");
    sample.appendChild(svgElement("path", {
      d: `M${itemX} ${rowY + size}L${itemX + size} ${rowY - size * (5 / 6.2)}H${itemX - size}Z`,
      fill: COLORS.abolish,
      stroke: COLORS.abolish,
      "stroke-width": 1,
      "stroke-linejoin": "round",
    }));
  });
  item(x + 228, "改隶事件", (sample, itemX) => {
    const size = evolutionEventIconSize("affiliation_change");
    sample.appendChild(svgElement("path", {
      d: `M${itemX} ${rowY - size}L${itemX + size} ${rowY}L${itemX} ${rowY + size}L${itemX - size} ${rowY}Z`,
      fill: COLORS.paper,
      stroke: COLORS.selected,
      "stroke-width": 1.1,
    }));
  });
  item(x + 308, "时间范围", (sample, itemX) => {
    sample.appendChild(svgElement("path", {
      d: `M${itemX - 6} ${rowY + 3}V${rowY - 4}H${itemX + 6}V${rowY + 3}`,
      fill: "none",
      stroke: COLORS.olive,
      "stroke-width": 0.9,
    }));
  });
  item(x + 388, "模糊纪年区间", (sample, itemX) => {
    sample.appendChild(svgElement("line", {
      x1: itemX - 7, y1: rowY + 2, x2: itemX + 7, y2: rowY + 2,
      stroke: COLORS.olive,
      "stroke-width": 1.1,
      "stroke-dasharray": "3 2",
    }));
    sample.appendChild(svgElement("path", {
      d: `M${itemX - 7} ${rowY - 1.5}V${rowY + 2}M${itemX + 7} ${rowY - 1.5}V${rowY + 2}`,
      fill: "none",
      stroke: COLORS.olive,
      "stroke-width": 1.1,
    }));
  });
  item(x + 494, "演变关系", (sample, itemX) => {
    sample.appendChild(svgElement("line", {
      x1: itemX - 7,
      y1: rowY,
      x2: itemX + 6,
      y2: rowY,
      stroke: COLORS.line,
      "stroke-width": 0.95,
      "marker-end": "url(#evolution-relation-arrow)",
    }));
  });
  item(x + 574, "存续段", (sample, itemX) => {
    sample.appendChild(svgElement("line", {
      x1: itemX - 7,
      y1: rowY,
      x2: itemX + 7,
      y2: rowY,
      stroke: COLORS.line,
      "stroke-width": 2,
    }));
  });
  item(x + 641, "密集点错层回指年份", (sample, itemX) => {
    sample.appendChild(svgElement("line", {
      x1: itemX - 7,
      y1: rowY + 3,
      x2: itemX + 5,
      y2: rowY - 3,
      stroke: COLORS.olive,
      "stroke-width": 0.7,
    }));
    sample.appendChild(svgElement("circle", {
      cx: itemX - 7,
      cy: rowY + 3,
      r: 1.4,
      fill: COLORS.line,
    }));
  });
  addTitle(group, "时间轴符号说明");
  parent.appendChild(group);
}

const LANE_ANOMALY_LABELS = new Map([
  ["dangling_chain_link", "链指针缺失"],
  ["nonreciprocal_chain_link", "前后指针不一致"],
  ["chronology_direction_conflict", "链方向逆序"],
  ["branching_timeline", "时间链分叉"],
  ["merging_timeline", "时间链汇合"],
  ["timeline_cycle", "时间链循环"],
]);

export function laneAnomalySummary(anomalies, maxChars = Number.POSITIVE_INFINITY) {
  const items = Array.isArray(anomalies) ? anomalies : [];
  if (!items.length) return "";
  const descriptions = [...new Set(items.map(
    (item) => LANE_ANOMALY_LABELS.get(item?.type) || "时间链异常"
  ))];
  const full = descriptions.length === 1
    ? descriptions[0]
    : `时间链异常×${items.length}`;
  if (full.length <= maxChars) return full;
  const compact = items.length > 1 ? `异常×${items.length}` : "异常";
  return compact.length <= maxChars ? compact : "!";
}

function renderLaneLabel(parent, lane, selected, onSelectEntity, lanePitch) {
  const height = Math.max(42, Math.min(102, lanePitch ? lanePitch - 12 : 102));
  const laneLayout = evolutionLaneIdentityLayout(
    lane.type,
    height,
    lane.labelX,
    lane.labelMaxWidth,
  );
  const { width, x } = laneLayout;
  const y = lane.y - height / 2;
  const group = svgElement("g", {
    class: `evolution-lane-label evolution-lane-label--${lane.type === "官职" ? "official" : "institution"}${selected ? " is-selected" : ""}`,
    "data-entity-id": lane.entityId,
    "data-entity-type": lane.type,
  });

  const glyph = appendIdentityGlyph(group, lane.type, {
    height,
    centerX: laneLayout.centerX,
    y,
    selected,
  });
  const { bodyTop, bodyBottom } = glyph;
  const { pitch: textPitch, maxChars } = evolutionLaneTitleMetrics(
    bodyTop, bodyBottom,
  );
  const displayTitle = shortened(lane.title, maxChars);
  const textHeight = Math.max(0, (Array.from(displayTitle).length - 1) * textPitch);
  appendVerticalText(group, displayTitle, {
    x: x + width / 2,
    y: bodyTop + (bodyBottom - bodyTop - textHeight) / 2,
    class: "evolution-lane-title",
    "text-anchor": "middle",
  }, {
    maxChars,
    pitch: textPitch,
  });

  group.appendChild(svgElement("rect", {
    x: x - 3, y: y - 2, width: width + 6, height: height + 4,
    fill: "transparent", "pointer-events": "all",
  }));
  if (lane.anomalies?.length) {
    const alert = svgElement("g", { class: "evolution-lane-anomaly" });
    // 异常说明使用签条左侧留白，与右侧竖排机构名并列，避免覆盖首字。
    const iconX = lane.labelX + 6;
    const iconY = y + 8;
    const textX = iconX + 7;
    const availableTextWidth = Math.max(0, x - textX - 3);
    const summary = laneAnomalySummary(
      lane.anomalies,
      Math.max(1, Math.floor(availableTextWidth / 8.2)),
    );
    alert.appendChild(svgElement("path", {
      d: `M${iconX} ${iconY - 6}L${iconX + 6} ${iconY + 5}H${iconX - 6}Z`,
      fill: COLORS.paper, stroke: COLORS.selected, "stroke-width": 0.8,
    }));
    alert.appendChild(svgElement("path", {
      d: `M${iconX} ${iconY - 2.5}V${iconY + 1.5}M${iconX} ${iconY + 3.5}V${iconY + 4}`,
      stroke: COLORS.selected, "stroke-width": 1,
    }));
    appendText(alert, summary, {
      x: textX,
      y: iconY,
      class: "evolution-lane-anomaly-label",
      "dominant-baseline": "central",
    });
    const descriptions = [...new Set(lane.anomalies.map(
      (item) => LANE_ANOMALY_LABELS.get(item?.type) || "时间链异常"
    ))];
    addTitle(alert, `${lane.anomalies.length} 项时间链异常：${descriptions.join("；")}`);
    group.appendChild(alert);
  }
  addTitle(group, `${lane.title}（${lane.type}）`);
  makeInteractive(group, `选择${lane.title}`, () => onSelectEntity?.(lane.entityId));
  parent.appendChild(group);
}

export function eventStemGeometry(event) {
  const x = event.displayX;
  const y = event.y;
  const baseY = event.baseY ?? y;
  if (!event.displaced || !Number.isFinite(event.baseX)) return null;
  // 位移量太小（anchor 几乎落在圆点里）时不画回指茎和定位点：
  // 圆点自身已经在真实年份上，再叠一粒小芯只会读出"◎"的假复合标记。
  const displacement = Math.hypot(x - event.baseX, y - baseY);
  if (displacement <= 4) return null;
  return {
    x1: event.baseX,
    y1: baseY,
    x2: x,
    y2: y,
    anchorX: event.baseX,
    anchorY: baseY,
  };
}

function renderEventStem(parent, event, dimmed) {
  const geometry = eventStemGeometry(event);
  if (!geometry) return;
  const group = svgElement("g", {
    class: `evolution-event-stem-group${dimmed ? " is-dimmed" : ""}`,
    "data-stem-timepoint-id": event.id,
  });
  group.appendChild(svgElement("line", {
    class: "evolution-event-stem",
    x1: geometry.x1,
    y1: geometry.y1,
    x2: geometry.x2,
    y2: geometry.y2,
    stroke: COLORS.olive,
    "stroke-width": 0.65,
    "stroke-opacity": 0.74,
  }));
  group.appendChild(svgElement("circle", {
    class: "evolution-event-anchor",
    cx: geometry.anchorX,
    cy: geometry.anchorY,
    r: 1.65,
    fill: COLORS.line,
  }));
  parent.appendChild(group);
}

function renderEventMark(parent, event, selected, dimmed, handlers) {
  const revisionClass = event.revisionStatus ? ` is-revision-${event.revisionStatus}` : "";
  const iconType = event.iconType || "record";
  const group = svgElement("g", {
    class: `evolution-event evolution-event-${iconType}`
      + `${selected ? " is-selected" : ""}${dimmed ? " is-dimmed" : ""}${revisionClass}`,
    "data-timepoint-id": event.id,
  });
  const x = event.displayX;
  const y = event.y;
  if (event.timeType === "bounded" && event.yearStart != null && event.yearEnd != null) {
    let startX = Math.min(event.rangeStartX ?? event.baseX, event.rangeEndX ?? event.baseX);
    let endX = Math.max(event.rangeStartX ?? event.baseX, event.rangeEndX ?? event.baseX);
    const degenerate = Math.abs(endX - startX) < 1;
    if (!degenerate && endX - startX < 8) {
      // 极窄区间的最小可读宽度：虚线短于 8px 时以记载点为中心撑开，
      // 否则两端刻度重叠、虚线不可见，退化成圆点下方一根孤线。
      startX = event.baseX - 4;
      endX = event.baseX + 4;
    }
    // 起止同年（"宋初"类锚定到单年）：模糊性由原文纪年表达，塌陷的区间
    // 装饰只会留下孤立刻度，不画。
    if (!degenerate) {
      // The icon represents the whole fuzzy interval, not its upper bound.
      // Keep the bracket detached and point its centre back to a displaced icon.
      const spanY = y + 16;
      const middleX = (startX + endX) / 2;
      group.appendChild(svgElement("line", {
        class: "evolution-event-bounded-span",
        x1: startX, y1: spanY, x2: endX, y2: spanY,
        stroke: COLORS.olive,
        "stroke-width": 1.1,
        "stroke-dasharray": "3 2",
      }));
      group.appendChild(svgElement("path", {
        class: "evolution-event-bounded-span",
        d: `M${startX} ${y + 9.5}V${spanY}M${endX} ${y + 9.5}V${spanY}`,
        fill: "none",
        stroke: COLORS.olive,
        "stroke-width": 1.1,
      }));
      group.appendChild(svgElement("line", {
        class: "evolution-event-range-link",
        x1: x, y1: y + 8.8, x2: middleX, y2: spanY - 2,
        stroke: COLORS.olive,
        "stroke-width": 0.65,
        "stroke-opacity": 0.78,
        "pointer-events": "none",
      }));
      group.appendChild(svgElement("rect", {
        x: Math.min(startX, endX), y: y + 9,
        width: Math.max(3, Math.abs(endX - startX)), height: 7,
        fill: "transparent", "pointer-events": "all",
      }));
    }
  }
  if (event.timeType === "range" && event.yearStart != null && event.yearEnd != null) {
    const startX = event.rangeStartX ?? event.baseX;
    const endX = event.rangeEndX ?? event.baseX;
    group.appendChild(svgElement("path", {
      d: `M${startX} ${y - 17}V${y - 26}H${endX}V${y - 17}`,
      fill: "none", stroke: COLORS.olive, "stroke-width": 0.8,
    }));
    // The mark describes the complete period, so its leader points to the
    // bracket midpoint and leaves a visible gap at both ends.
    const middleX = (startX + endX) / 2;
    group.appendChild(svgElement("line", {
      class: "evolution-event-range-link",
      x1: x, y1: y - 8.8, x2: middleX, y2: y - 15.5,
      stroke: COLORS.olive, "stroke-width": 0.65, "stroke-opacity": 0.85,
      "pointer-events": "none",
    }));
  }
  const iconSize = evolutionEventIconSize(iconType, selected);
  if (iconType === "affiliation_change") {
    const size = iconSize;
    group.appendChild(svgElement("path", {
      d: `M${x} ${y - size}L${x + size} ${y}L${x} ${y + size}L${x - size} ${y}Z`,
      fill: selected ? COLORS.selected : COLORS.paper,
      stroke: COLORS.selected,
      "stroke-width": selected ? 1.25 : 1.1,
      "stroke-linejoin": "round",
    }));
  } else if (iconType === "establish" || iconType === "abolish") {
    // 建置/罢置用一对镜像实心三角形：建置 = 墨色正立三角（立起来），
    // 罢置 = 赭红倒三角（裁撤）；选中只换颜色和尺寸，不改变形状。
    const up = iconType === "establish";
    const size = iconSize;
    const apexY = up ? y - size : y + size;
    const baseY = up ? y + size * (5 / 6.2) : y - size * (5 / 6.2);
    const color = selected ? COLORS.selected : (up ? COLORS.line : COLORS.abolish);
    group.appendChild(svgElement("path", {
      d: `M${x} ${apexY}L${x + size} ${baseY}H${x - size}Z`,
      fill: color,
      stroke: color,
      "stroke-width": selected ? 1.25 : 1,
      "stroke-linejoin": "round",
    }));
  } else {
    group.appendChild(svgElement("circle", {
      cx: x, cy: y, r: iconSize,
      fill: selected ? COLORS.selected : COLORS.paper,
      stroke: selected ? COLORS.selected : COLORS.line,
      "stroke-width": selected ? 1.2 : 1,
    }));
  }

  // Selection feedback stays on the mark itself; details live in the left
  // panel, with no additional on-canvas callout.
  group.appendChild(svgElement("circle", {
    cx: x, cy: y, r: Math.max(event.displaced ? 9 : 10, iconSize + 3),
    fill: "transparent", "pointer-events": "all",
  }));
  addTitle(group, eventDescription(event));
  makeInteractive(group, `查看${eventDescription(event)}`, () => handlers.onSelectEvent?.(event));
  parent.appendChild(group);
}

function cross(first, second) {
  return first.x * second.y - first.y * second.x;
}

function rayPolygonDistance(direction, vertices) {
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < vertices.length; index += 1) {
    const start = vertices[index];
    const end = vertices[(index + 1) % vertices.length];
    const edge = { x: end.x - start.x, y: end.y - start.y };
    const denominator = cross(direction, edge);
    if (Math.abs(denominator) < 1e-9) continue;
    const distance = cross(start, edge) / denominator;
    const segmentPosition = cross(start, direction) / denominator;
    if (distance >= 0 && segmentPosition >= -1e-9 && segmentPosition <= 1 + 1e-9) {
      nearest = Math.min(nearest, distance);
    }
  }
  return Number.isFinite(nearest) ? nearest : 0;
}

/**
 * Distance from an event centre to the visible outer edge in a given
 * direction. The enlarged diamond and triangle marks do not have a constant
 * radius, so a fixed inset makes diagonal relations stop too early or too
 * late. This uses the actual glyph outlines used by renderEventMark and adds
 * half of the corresponding stroke width.
 */
export function evolutionEndpointClearance(point, toward, arrowhead = false) {
  if (point?.timepointId == null) return 0;
  const deltaX = Number(toward?.x) - Number(point.x);
  const deltaY = Number(toward?.y) - Number(point.y);
  const length = Math.hypot(deltaX, deltaY);
  if (!length) return 0;
  const direction = { x: deltaX / length, y: deltaY / length };
  const size = evolutionEventIconSize(point.iconType || "record");
  let distance;
  let strokeWidth;
  if (point.iconType === "affiliation_change") {
    distance = rayPolygonDistance(direction, [
      { x: 0, y: -size },
      { x: size, y: 0 },
      { x: 0, y: size },
      { x: -size, y: 0 },
    ]);
    strokeWidth = 1.1;
  } else if (["establish", "abolish"].includes(point.iconType)) {
    const up = point.iconType === "establish";
    const apexY = up ? -size : size;
    const baseY = up ? size * (5 / 6.2) : -size * (5 / 6.2);
    distance = rayPolygonDistance(direction, [
      { x: 0, y: apexY },
      { x: size, y: baseY },
      { x: -size, y: baseY },
    ]);
    strokeWidth = 1;
  } else {
    distance = size;
    strokeWidth = 1;
  }
  // Selected marks render after relations and mask the covered part. Do not
  // reserve their extra emphasis radius here, or every unselected line gets a
  // visible gap around the event glyph.
  return Math.max(0, distance + strokeWidth / 2);
}

function insetPoint(point, toward, distance) {
  const deltaX = toward.x - point.x;
  const deltaY = toward.y - point.y;
  const length = Math.hypot(deltaX, deltaY);
  if (!length || !distance) return { ...point };
  const inset = Math.min(distance, Math.max(0, length / 2 - 1));
  return {
    ...point,
    x: point.x + deltaX / length * inset,
    y: point.y + deltaY / length * inset,
  };
}

export function relationRouteOptions(relation, source, target) {
  // ch1t12: 太常寺 1129-04 (#4325) → 宗正寺 1135 (#4774).
  // Its default final tangent crosses the displaced record point #7547 that
  // sits immediately above the target triangle. Pull only this curve's final
  // control point left; every other relation keeps the shared geometry.
  if (Number(relation?.id) === 4010
    && Number(source?.timepointId) === 4325
    && Number(target?.timepointId) === 4774) {
    return { targetControlOffsetX: -96 };
  }
  return {};
}

export function relationPath(source, target, options = {}) {
  // Relations terminate outside the event glyph. Drawing to its center makes
  // the event triangle cover the real marker and read as an oversized arrow.
  const start = insetPoint(
    source,
    target,
    evolutionEndpointClearance(source, target),
  );
  const end = insetPoint(
    target,
    source,
    evolutionEndpointClearance(target, source, true),
  );
  const deltaY = end.y - start.y;
  if (Math.abs(deltaY) < 1) {
    const lift = start.y > 470 ? -28 : 28;
    const deltaX = end.x - start.x;
    const direction = Math.sign(deltaX || 1);
    const span = Math.abs(deltaX);
    const sourceControlX = start.x + direction * Math.min(34, span * 0.34);
    const targetControlX = end.x - direction * Math.min(22, span * 0.22);
    // Keep the final control point on the endpoint centreline. The marker's
    // tangent therefore points at the target glyph, not at the lane beside it.
    return `M${start.x} ${start.y}C${sourceControlX} ${start.y + lift} ${targetControlX} ${end.y} ${end.x} ${end.y}`;
  }
  // Keep cross-lane jumps tight: a wide bend sweeps across empty canvas and
  // reads as a stray arc when the jump spans several lanes.
  const bend = Math.max(18, Math.min(56, Math.abs(deltaY) * 0.26));
  const direction = Math.sign(end.x - start.x || 1);
  const sourceControlX = start.x + direction * bend;
  const centerDeltaX = target.x - source.x;
  const centerDeltaY = target.y - source.y;
  const centerLength = Math.hypot(centerDeltaX, centerDeltaY) || 1;
  const approach = Math.min(bend, Math.max(8, centerLength * 0.22));
  const targetControlX = end.x - centerDeltaX / centerLength * approach
    + (options.targetControlOffsetX || 0);
  const targetControlY = end.y - centerDeltaY / centerLength * approach;
  // The last bezier tangent is collinear with target centre -> glyph edge.
  // This matters for vertically aligned events: a horizontal tangent used to
  // make the arrow appear to point at the timeline rather than the icon.
  return `M${start.x} ${start.y}C${sourceControlX} ${start.y} ${targetControlX} ${targetControlY} ${end.x} ${end.y}`;
}

function cubicMidpoint(path) {
  const values = path.match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
  if (values.length < 8) return null;
  return {
    x: (values[0] + 3 * values[2] + 3 * values[4] + values[6]) / 8,
    y: (values[1] + 3 * values[3] + 3 * values[5] + values[7]) / 8,
  };
}

export function relationLabelOverride(relation, source, target) {
  const relationId = Number(relation?.id);
  const isIncoming = relationId === 4009
    && Number(source?.timepointId) === 4773
    && Number(target?.timepointId) === 4325;
  const isOutgoing = relationId === 4010
    && Number(source?.timepointId) === 4325
    && Number(target?.timepointId) === 4774;
  if (!isIncoming && !isOutgoing) return null;
  const path = relationPath(source, target, relationRouteOptions(relation, source, target));
  const midpoint = cubicMidpoint(path);
  if (!midpoint) return null;
  return {
    x: midpoint.x + (isIncoming ? 42 : -42),
    y: midpoint.y + 4,
  };
}

function renderRelation(parent, relation, selected, dimmed, handlers, suppressLabel = false) {
  if (!relation.drawable) return;
  const sources = relation.sourcePoints.filter((point) => point.x != null);
  const targets = relation.targetPoints.filter((point) => point.x != null);
  if (!sources.length || !targets.length) return;
  const group = svgElement("g", {
    class: `evolution-relation${selected ? " is-selected" : ""}${dimmed ? " is-dimmed" : ""}`
      + `${relation.revisionStatus ? ` is-revision-${relation.revisionStatus}` : ""}`,
    "data-relation-id": relation.id,
  });
  for (const source of sources) {
    for (const target of targets) {
      const routeOptions = relationRouteOptions(relation, source, target);
      group.appendChild(svgElement("path", {
        d: relationPath(source, target, routeOptions),
        fill: "none",
        stroke: selected ? COLORS.selected : COLORS.line,
        "stroke-width": selected ? RELATION_STROKE.selectedWidth : RELATION_STROKE.width,
        "stroke-opacity": selected ? RELATION_STROKE.selectedOpacity : RELATION_STROKE.opacity,
        "marker-end": "url(#evolution-relation-arrow)",
      }));
    }
  }
  if (!suppressLabel && relation.labelVisible !== false) {
    const source = sources[0];
    const target = targets[0];
    const labelOverride = relationLabelOverride(relation, source, target);
    const labelX = labelOverride?.x ?? relation.labelX ?? (source.x + target.x) / 2;
    const labelY = labelOverride?.y ?? relation.labelY ?? (source.y + target.y) / 2 - 7;
    const leader = labelOverride ? null : relation.leader;
    if (leader && Math.hypot(leader.x2 - leader.x1, leader.y2 - leader.y1) > 4) {
      group.appendChild(svgElement("line", {
        x1: leader.x1,
        y1: leader.y1,
        x2: leader.x2,
        y2: leader.y2,
        class: "evolution-relation-label-leader",
        stroke: COLORS.olive,
        "stroke-width": 0.7,
        "stroke-dasharray": "2 2",
        "pointer-events": "none",
      }));
    }
    appendText(group, compactRelationLabel(relation.label), {
      x: labelX,
      y: labelY,
      class: "evolution-relation-label",
      "text-anchor": "middle",
    });
  } else if (!suppressLabel && relation.labelOverflow) {
    const source = sources[0];
    const target = targets[0];
    const x = relation.labelAnchorX ?? (source.x + target.x) / 2;
    const y = relation.labelAnchorY ?? (source.y + target.y) / 2;
    group.appendChild(svgElement("circle", {
      class: "evolution-relation-overflow-marker",
      cx: x,
      cy: y,
      r: 3.2,
      fill: COLORS.paper,
      stroke: COLORS.olive,
      "stroke-width": 0.8,
    }));
    appendText(group, "…", {
      x,
      y: y + 3.2,
      class: "evolution-relation-overflow-glyph",
      "text-anchor": "middle",
    });
  }
  const all = [...sources, ...targets];
  const hitRouteOptions = relationRouteOptions(relation, sources[0], targets[0]);
  const hit = svgElement("path", {
    d: relationPath(sources[0], targets[0], hitRouteOptions),
    fill: "none",
    stroke: "transparent",
    "stroke-width": 14,
    "pointer-events": "stroke",
  });
  group.appendChild(hit);
  addTitle(group, `${relation.label}：${all.map((point) => point.rawTime || point.effectiveYear || "年代未明").join(" → ")}`);
  makeInteractive(group, `查看关系${relation.label}`, () => handlers.onSelectRelation?.(relation));
  parent.appendChild(group);
}

function renderRelationGroup(parent, relationGroup, selectedRelationKey, focusActive, handlers) {
  if (!relationGroup.drawable) return;
  if (relationGroup.renderMode === "individual" || relationGroup.junctionX == null) {
    relationGroup.relations.forEach((relation) => {
      const selected = `relation:${relation.id}` === selectedRelationKey;
      renderRelation(parent, relation, selected, focusActive && !selected, handlers);
    });
    return;
  }
  const selected = relationGroup.relations.some((relation) => (
    `relation:${relation.id}` === selectedRelationKey
  ));
  const group = svgElement("g", {
    class: `evolution-relation-group${selected ? " is-selected" : ""}`
      + `${focusActive && !selected ? " is-dimmed" : ""}`,
    "data-relation-group-id": relationGroup.groupId,
  });
  const points = [...relationGroup.sourcePoints, ...relationGroup.targetPoints]
    .filter((point) => point.x != null);
  const centerY = points.length
    ? points.reduce((sum, point) => sum + point.y, 0) / points.length
    : 0;
  const junctionX = relationGroup.junctionX;
  const junction = { x: junctionX, y: centerY };
  const strokeColor = selected ? COLORS.selected : COLORS.line;
  const strokeWidth = selected ? RELATION_STROKE.selectedWidth : RELATION_STROKE.width;
  const strokeOpacity = selected ? RELATION_STROKE.selectedOpacity : RELATION_STROKE.opacity;
  for (const source of relationGroup.sourcePoints.filter((point) => point.x != null)) {
    group.appendChild(svgElement("path", {
      d: relationPath(source, junction), fill: "none", stroke: strokeColor,
      "stroke-width": strokeWidth, "stroke-opacity": strokeOpacity,
    }));
  }
  for (const target of relationGroup.targetPoints.filter((point) => point.x != null)) {
    group.appendChild(svgElement("path", {
      d: relationPath(junction, target), fill: "none", stroke: strokeColor,
      "stroke-width": strokeWidth, "stroke-opacity": strokeOpacity,
      "marker-end": "url(#evolution-relation-arrow)",
    }));
  }
  group.appendChild(svgElement("rect", {
    x: junctionX - 5, y: centerY - 5, width: 10, height: 10,
    fill: COLORS.paper, stroke: COLORS.line, "stroke-width": 1,
  }));
  if (relationGroup.labelVisible !== false) {
    const leader = relationGroup.leader;
    if (leader && Math.hypot(leader.x2 - leader.x1, leader.y2 - leader.y1) > 4) {
      group.appendChild(svgElement("line", {
        x1: leader.x1,
        y1: leader.y1,
        x2: leader.x2,
        y2: leader.y2,
        class: "evolution-relation-label-leader",
        stroke: COLORS.olive,
        "stroke-width": 0.7,
        "stroke-dasharray": "2 2",
        "pointer-events": "none",
      }));
    }
    const hasLayout = Number.isFinite(relationGroup.labelX)
      && Number.isFinite(relationGroup.labelY);
    appendText(group, compactRelationLabel(relationGroup.label), {
      x: hasLayout ? relationGroup.labelX : junctionX + 11,
      y: hasLayout ? relationGroup.labelY : centerY - 8,
      class: "evolution-relation-label",
      "text-anchor": hasLayout ? "middle" : "start",
    });
  } else if (relationGroup.labelOverflow) {
    group.appendChild(svgElement("circle", {
      class: "evolution-relation-overflow-marker",
      cx: junctionX,
      cy: centerY,
      r: 3.2,
      fill: COLORS.paper,
      stroke: COLORS.olive,
      "stroke-width": 0.8,
    }));
    appendText(group, "…", {
      x: junctionX,
      y: centerY + 3.2,
      class: "evolution-relation-overflow-glyph",
      "text-anchor": "middle",
    });
  }
  relationGroup.relations.forEach((relation) => {
    if (`relation:${relation.id}` === selectedRelationKey) {
      group.classList.add("is-selected");
    }
  });
  makeInteractive(group, `查看事件组${relationGroup.label}`, () => {
    const relation = relationGroup.relations[0];
    if (relation) handlers.onSelectRelation?.(relation);
  });
  parent.appendChild(group);
}

function renderOffAxis(parent, layout, selectedItem, selectionFocus, handlers) {
  const bounds = layout.offAxisBounds;
  if (!bounds) return;
  // A faint wash ties the floating undated/unresolved marks into a visible zone.
  parent.appendChild(svgElement("rect", {
    x: bounds.x + 6,
    y: bounds.y - 16,
    width: bounds.width - 12,
    height: bounds.height + 24,
    rx: 5,
    fill: COLORS.olive,
    "fill-opacity": 0.055,
    stroke: COLORS.olive,
    "stroke-width": 0.55,
    "stroke-opacity": 0.32,
    "stroke-dasharray": "2 4",
    "pointer-events": "none",
  }));
  parent.appendChild(svgElement("line", {
    x1: bounds.x, y1: bounds.y - 4, x2: bounds.x, y2: bounds.bottom + 4,
    stroke: COLORS.olive, "stroke-width": 0.65, "stroke-dasharray": "3 3",
  }));
  for (const bucket of ["undated", "unresolved"]) {
    const column = layout.offAxis.columns?.[bucket];
    if (!column) continue;
    appendText(parent, column.label, {
      x: column.x, y: bounds.y - 10, class: "evolution-offaxis-heading", "text-anchor": "middle",
    });
    for (const event of layout.offAxis[bucket] || []) {
      const isSelected = selectedKey(selectedItem) === `timepoint:${event.id}`;
      const dimmed = selectionFocus.active && !selectionFocus.timepointIds.has(event.id);
      const group = svgElement("g", {
        class: `evolution-offaxis-event${isSelected ? " is-selected" : ""}`
          + `${dimmed ? " is-dimmed" : ""}`,
      });
      // 与主车道普通记载圆点保持同一视觉尺寸。
      group.appendChild(svgElement("circle", {
        cx: event.x, cy: event.y, r: evolutionEventIconSize("record", isSelected),
        fill: isSelected ? COLORS.selected : COLORS.paper,
        stroke: bucket === "unresolved" ? COLORS.selected : COLORS.line,
        "stroke-width": 1,
      }));
      group.appendChild(svgElement("circle", {
        cx: event.x, cy: event.y, r: 10, fill: "transparent", "pointer-events": "all",
      }));
      addTitle(group, eventDescription(event));
      makeInteractive(group, `查看${column.label}事件`, () => handlers.onSelectEvent?.(event));
      parent.appendChild(group);
    }
  }
}

/**
 * Fan rendering: relations that share one exact endpoint (laid out in
 * `layout.fanGroups`) render as a genuine fork — one emphasized hub mark with
 * one graduated bezier branch per relation, so a 1→N split / N→1 merge reads
 * as branching instead of a single ambiguous vertical line. Every branch
 * still lands exactly on its endpoint's true year; only the curve's mid-body
 * bows sideways to keep the branches separated. Splits bow rightward (opening
 * toward the future), merges bow leftward (closing in from the past), so an
 * adjacent split/merge pair weaves far less.
 */
function renderFanGroup(parent, fan, selectedRelationKey, focusActive, handlers) {
  const selected = fan.relations.some((relation) => (
    `relation:${relation.id}` === selectedRelationKey
  ));
  const group = svgElement("g", {
    class: `evolution-fan-group${selected ? " is-selected" : ""}`
      + `${focusActive && !selected ? " is-dimmed" : ""}`,
    "data-fan-key": fan.key,
  });
  const color = selected ? COLORS.selected : COLORS.line;
  const width = selected ? RELATION_STROKE.selectedWidth : RELATION_STROKE.width;
  const opacity = selected ? RELATION_STROKE.selectedOpacity : RELATION_STROKE.opacity;
  const hub = fan.hub;
  const trunkX = hub.x;
  const farY = fan.spokes.reduce((best, point) => (
    Math.abs(point.y - hub.y) > Math.abs(best - hub.y) ? point.y : best
  ), hub.y);
  const travel = Math.sign(farY - hub.y) || 1;

  // Branch path between two points: cubic bezier whose control points are
  // pushed `bow` pixels sideways so parallel branches stay visually separate.
  const branchPath = (from, to, bow) => {
    const dy = to.y - from.y;
    return `M${from.x} ${from.y}`
      + ` C ${from.x + bow} ${from.y + dy * 0.42},`
      + ` ${to.x + bow} ${to.y - dy * 0.42},`
      + ` ${to.x} ${to.y}`;
  };

  // Nearest lane gets the smallest bow so branches form a nested fan.
  // Splits bow right (toward the future), merges bow left (from the past).
  const bowSign = fan.direction === "out" ? 1 : -1;
  const spokes = [...fan.spokes].sort((a, b) => (
    Math.abs(a.y - hub.y) - Math.abs(b.y - hub.y)
  ));
  spokes.forEach((spoke, index) => {
    const bow = bowSign * (7 + index * 5);
    const sameColumn = Math.abs(spoke.x - trunkX) < 1;
    if (fan.direction === "out") {
      // Split: branch leaves the hub and ends with an arrowhead on each
      // target event mark — N arrowheads make the 1→N reading explicit.
      const target = insetPoint(
        spoke,
        hub,
        evolutionEndpointClearance(spoke, hub, true),
      );
      const d = sameColumn
        ? branchPath(hub, target, bow)
        : `M${trunkX} ${target.y}L${target.x} ${target.y}`;
      group.appendChild(svgElement("path", {
        d, fill: "none", stroke: color, "stroke-width": width,
        "stroke-opacity": opacity, "marker-end": "url(#evolution-relation-arrow)",
        "pointer-events": "none",
      }));
      if (sameColumn) {
        group.appendChild(svgElement("path", {
          d, fill: "none", stroke: "transparent", "stroke-width": 10,
          "pointer-events": "stroke",
        }));
      }
    } else {
      // Merge: one branch per source lane converging into the hub.
      const source = insetPoint(
        spoke,
        hub,
        evolutionEndpointClearance(spoke, hub),
      );
      const d = sameColumn
        ? branchPath(source, hub, bow)
        : `M${source.x} ${source.y}L${trunkX} ${source.y}`;
      group.appendChild(svgElement("path", {
        d, fill: "none", stroke: color, "stroke-width": width,
        "stroke-opacity": opacity, "pointer-events": "none",
      }));
      if (sameColumn) {
        group.appendChild(svgElement("path", {
          d, fill: "none", stroke: "transparent", "stroke-width": 10,
          "pointer-events": "stroke",
        }));
      }
    }
  });

  // Hub anchor: filled knot marking the single shared endpoint everything
  // splits from / merges into.
  group.appendChild(svgElement("circle", {
    class: "evolution-fan-hub",
    cx: trunkX, cy: hub.y, r: selected ? 3.1 : 2.5,
    fill: color, "fill-opacity": Math.min(1, opacity + 0.2),
    "pointer-events": "none",
  }));

  if (fan.direction === "in") {
    // Fan-in converges into the hub: single arrowhead at the shared target.
    const approach = { x: trunkX, y: hub.y + travel * 16 };
    const target = insetPoint(
      hub,
      approach,
      evolutionEndpointClearance(hub, approach, true),
    );
    group.appendChild(svgElement("path", {
      d: `M${approach.x} ${approach.y}L${target.x} ${target.y}`,
      fill: "none", stroke: color, "stroke-width": width,
      "stroke-opacity": opacity, "marker-end": "url(#evolution-relation-arrow)",
      "pointer-events": "none",
    }));
  }

  if (fan.labelVisible !== false) {
    const leader = fan.leader;
    if (leader && Math.hypot(leader.x2 - leader.x1, leader.y2 - leader.y1) > 4) {
      group.appendChild(svgElement("line", {
        x1: leader.x1, y1: leader.y1, x2: leader.x2, y2: leader.y2,
        class: "evolution-relation-label-leader",
        stroke: COLORS.olive, "stroke-width": 0.7, "stroke-dasharray": "2 2",
        "pointer-events": "none",
      }));
    }
    appendText(group, compactRelationLabel(fan.label), {
      x: Number.isFinite(fan.labelX) ? fan.labelX : trunkX,
      y: Number.isFinite(fan.labelY) ? fan.labelY : (fan.top + fan.bottom) / 2 - 7,
      class: "evolution-relation-label",
      "text-anchor": "middle",
    });
  } else if (fan.labelOverflow) {
    const x = fan.labelAnchorX ?? trunkX;
    const y = fan.labelAnchorY ?? (fan.top + fan.bottom) / 2;
    group.appendChild(svgElement("circle", {
      class: "evolution-relation-overflow-marker",
      cx: x, cy: y, r: 3.2,
      fill: COLORS.paper, stroke: COLORS.olive, "stroke-width": 0.8,
    }));
    appendText(group, "…", {
      x, y: y + 3.2,
      class: "evolution-relation-overflow-glyph", "text-anchor": "middle",
    });
  }

  group.appendChild(svgElement("line", {
    x1: trunkX, y1: Math.min(hub.y, farY), x2: trunkX, y2: Math.max(hub.y, farY),
    stroke: "transparent", "stroke-width": 14, "pointer-events": "stroke",
  }));
  const endpointText = (point) => point.rawTime || point.effectiveYear || "年代未明";
  addTitle(group, `${compactRelationLabel(fan.label)} ×${fan.relations.length}：${fan.relations.map((relation) => {
    const source = relation.sourcePoints.find((point) => point.x != null);
    const target = relation.targetPoints.find((point) => point.x != null);
    return `${endpointText(source || {})} → ${endpointText(target || {})}`;
  }).join("；")}`);
  makeInteractive(group, `查看关系组${compactRelationLabel(fan.label)}`, () => {
    const relation = fan.relations[0];
    if (relation) handlers.onSelectRelation?.(relation);
  });
  parent.appendChild(group);
}

function renderLanePagerButton(parent, { x, direction, disabled, onActivate }) {
  const label = direction < 0 ? "上一组关联轨道" : "下一组关联轨道";
  const group = svgElement("g", {
    class: `evolution-lane-pager-button${disabled ? " is-disabled" : ""}`,
    transform: `translate(${x} 169)`,
    "aria-disabled": String(disabled),
  });
  group.appendChild(svgElement("rect", {
    x: 0,
    y: 0,
    width: 22,
    height: 22,
    rx: 2,
    fill: "none",
    stroke: COLORS.line,
    "stroke-width": 0.75,
    "stroke-opacity": disabled ? 0.28 : 0.68,
  }));
  group.appendChild(svgElement("path", {
    d: direction < 0 ? "M13.5 6.5L9 11L13.5 15.5" : "M8.5 6.5L13 11L8.5 15.5",
    fill: "none",
    stroke: COLORS.line,
    "stroke-width": 1.1,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    opacity: disabled ? 0.28 : 1,
  }));
  addTitle(group, label);
  if (!disabled) makeInteractive(group, label, onActivate);
  parent.appendChild(group);
}

function renderLanePager(parent, laneWindow, handlers) {
  if (!laneWindow || laneWindow.pageCount <= 1) return;
  const group = svgElement("g", { class: "evolution-lane-pager" });
  renderLanePagerButton(group, {
    x: 1492,
    direction: -1,
    disabled: laneWindow.page <= 1,
    onActivate: () => handlers.onLanePageChange?.(laneWindow.page - 1),
  });
  appendText(group, `关联 ${laneWindow.page}/${laneWindow.pageCount}`, {
    x: 1550,
    y: 184,
    class: "evolution-lane-pager-label",
    "text-anchor": "middle",
  });
  renderLanePagerButton(group, {
    x: 1586,
    direction: 1,
    disabled: laneWindow.page >= laneWindow.pageCount,
    onActivate: () => handlers.onLanePageChange?.(laneWindow.page + 1),
  });
  addTitle(
    group,
    `当前显示 ${laneWindow.visibleLanes} 条，共 ${laneWindow.totalLanes} 条轨道`,
  );
  parent.appendChild(group);
}

/**
 * Return the actions that belong to the currently selected evolution item.
 * These are deliberately kept outside the evidence/detail panel: selecting
 * an event should expose the next navigation step without requiring a second
 * scroll interaction.
 */
export function selectedEvolutionActionOptions(
  selectedItem,
  entryYear,
  hierarchyResolution = null,
) {
  if (!selectedItem) return [];
  const comparison = evolutionSelectionComparison(selectedItem, entryYear);
  const actions = [];
  if (comparison?.kind === "timepoint" && comparison.year != null) {
    actions.push({
      kind: "year",
      year: comparison.year,
      label: `前往${comparison.year}年`,
    });
  } else if (comparison?.kind === "relation") {
    const seen = new Set();
    for (const endpoint of comparison.endpoints) {
      if (endpoint.year == null) continue;
      const key = `${endpoint.role}:${endpoint.year}`;
      if (seen.has(key)) continue;
      seen.add(key);
      actions.push({
        kind: "year",
        year: endpoint.year,
        label: `前往${endpoint.role === "source" ? "来源" : "目标"}${endpoint.year}年`,
      });
    }
  }
  for (const target of hierarchyResolution?.targets || []) {
    if (target?.entityId == null || !Number.isFinite(Number(target.year))) continue;
    actions.push({
      kind: "hierarchy",
      year: Number(target.year),
      entityId: target.entityId,
      label: (hierarchyResolution.targets || []).length > 1 && target.title
        ? `打开${target.title}`
        : `在${target.year}年打开层级`,
    });
  }
  if (hierarchyResolution?.message) {
    actions.push({
      kind: "status",
      label: hierarchyResolution.message,
    });
  }
  return actions;
}

function renderSelectedActions(parent, options) {
  const actions = selectedEvolutionActionOptions(
    options.selectedItem,
    options.entryContext?.entryYear,
    options.hierarchyResolution,
  );
  if (!actions.length) return;

  const group = svgElement("g", { class: "evolution-selection-actions" });
  const gap = 6;
  const buttonHeight = 21;
  const widths = actions.map((action) => Math.max(92, Array.from(action.label).length * 8.2 + 18));
  const totalWidth = widths.reduce((sum, width) => sum + width, 0) + gap * (widths.length - 1);
  const plot = options.layout?.plotBounds;
  const left = plot
    ? Math.max(plot.x + 260, plot.right - 990)
    : 808;
  const right = plot?.right ?? 1770;
  const headingWidth = 72;
  const minButtonX = left + headingWidth;
  // Keep the actions in the same horizontal zone as the legend, but one row
  // above it. This leaves the title, entry context, and time axis as separate
  // reading bands and also remains stable inside the comparison child SVG.
  let x = Math.max(minButtonX, right - totalWidth);
  appendText(group, "选中操作", {
    x: left,
    y: 166.2,
    class: "evolution-selection-actions-heading",
  });
  actions.forEach((action, index) => {
    const width = widths[index];
    const button = svgElement("g", {
      class: action.kind === "status"
        ? "evolution-selection-status"
        : "evolution-selection-action",
      ...(action.kind === "status" ? {} : {
        role: "button",
        tabindex: "0",
        "aria-label": action.label,
      }),
    });
    if (action.kind !== "status") {
      button.appendChild(svgElement("rect", {
        x,
        y: 152,
        width,
        height: buttonHeight,
        rx: 2.5,
        class: "evolution-selection-action-surface",
      }));
    }
    appendText(button, action.label, {
      x: x + width / 2,
      y: 166.2,
      class: action.kind === "status"
        ? "evolution-selection-status-label"
        : "evolution-selection-action-label",
      "text-anchor": "middle",
    });
    if (action.kind !== "status") {
      addTitle(button, action.kind === "year"
        ? `只移动当前年份线到${action.year}年，不改变入口年份`
        : `在${action.year}年打开该机构的最小层级结构`);
      makeInteractive(button, action.label, () => {
        if (action.kind === "year") options.handlers.onCommitYear?.(action.year);
        else options.handlers.onOpenHierarchy?.(action.entityId, action.year);
      });
    }
    group.appendChild(button);
    x += width + gap;
  });
  parent.appendChild(group);
}

function renderMain(layer, layout, options) {
  const group = svgElement("g", {
    class: "evolution-main-layer",
    "clip-path": "url(#evolution-content-clip)",
  });
  const primaryFocus = options.focusEntities[0];
  const title = options.mode === "compare"
    ? "机构与官职演变对比"
    : `${shortened(primaryFocus?.title || "实体", 18)}演变`;
  appendText(group, title, { x: 535, y: 188, class: "evolution-view-heading" });
  appendText(group, options.mode === "compare"
    ? "共同时间尺度"
    : `${primaryFocus?.type || "实体"} · 单体及直接关联`, {
    x: 1770,
    y: 188,
    class: "evolution-view-subheading",
    "text-anchor": "end",
  });
  const entryYear = Number(options.entryContext?.entryYear);
  const comparison = evolutionSelectionComparison(
    options.selectedItem,
    entryYear,
  );
  let entryCopy = Number.isFinite(entryYear) ? `入口：${entryYear}年` : "入口年份未记录";
  if (comparison?.kind === "timepoint" && Number.isFinite(comparison.year)) {
    entryCopy += ` · 当前事件：${comparison.year}年（${comparison.label}）`;
  } else if (comparison?.kind === "relation") {
    entryCopy += " · 当前关系已选中";
  }
  appendText(group, entryCopy, {
    x: 535,
    y: 211,
    class: "evolution-entry-context",
  });
  renderLanePager(group, layout.laneWindow, options.handlers);
  group.appendChild(svgElement("line", {
    x1: 535, y1: 198, x2: 1770, y2: 198, stroke: COLORS.line, "stroke-width": 0.72,
  }));
  if (!layout.lanes.length) {
    appendText(group, "当前对象没有可展示的宋代时间节点", {
      x: 1150, y: 500, class: "evolution-empty", "text-anchor": "middle",
    });
    layer.appendChild(group);
    return;
  }
  renderAxis(
    group,
    layout,
    options.selectedRange,
    options.selectionActive,
    options.selectedItem,
    options.entryContext,
  );
  renderEvolutionLegend(group, layout);
  const hasDrawableRelations = (layout.relations || []).some((relation) => relation.drawable)
    || (layout.relationGroups || []).some((relationGroup) => relationGroup.drawable);
  if (!hasDrawableRelations) {
    appendText(group, "当前对象暂无可定位的前后演变关系", {
      x: (layout.plotBounds.x + layout.plotBounds.right) / 2,
      y: layout.plotBounds.y + 76,
      class: "evolution-empty",
      "text-anchor": "middle",
    });
  }
  const selected = selectedKey(options.selectedItem);
  const selectionFocus = evolutionSelectionFocus(options.selectedItem);
  const focusedTimepointIds = new Set(selectionFocus.timepointIds);
  const eventsToRender = [];
  for (const lane of layout.lanes) {
    group.appendChild(svgElement("line", {
      x1: lane.trackStartX, y1: lane.y, x2: lane.trackEndX, y2: lane.y,
      stroke: COLORS.olive, "stroke-width": 0.65, "stroke-dasharray": "3 4", opacity: 0.45,
    }));
    for (const segment of lane.segments || []) {
      const segmentGroup = svgElement("g", {
        class: `evolution-lifecycle-segment${selectionFocus.active ? " is-dimmed" : ""}`,
      });
      segmentGroup.appendChild(svgElement("line", {
        x1: segment.startX, y1: segment.y, x2: segment.endX, y2: segment.y,
        stroke: COLORS.line, "stroke-width": 2.1,
      }));
      group.appendChild(segmentGroup);
    }
    renderLaneLabel(
      group,
      lane,
      lane.entityId === options.activeEntityId,
      options.handlers.onSelectEntity,
      layout.lanePitch,
    );
    for (const event of lane.events || []) {
      event.rangeStartX = event.yearStart == null ? event.baseX : (
        layout.yearScale.range[0]
          + (event.yearStart - layout.yearScale.domain[0])
            / Math.max(1, layout.yearScale.domain[1] - layout.yearScale.domain[0])
            * (layout.yearScale.range[1] - layout.yearScale.range[0])
      );
      event.rangeEndX = event.yearEnd == null ? event.baseX : (
        layout.yearScale.range[0]
          + (event.yearEnd - layout.yearScale.domain[0])
            / Math.max(1, layout.yearScale.domain[1] - layout.yearScale.domain[0])
            * (layout.yearScale.range[1] - layout.yearScale.range[0])
      );
      eventsToRender.push(event);
    }
  }

  const groupedRelationIds = new Set(layout.relationGroups.flatMap((item) => item.relationIds || []));
  const fanRelationIds = new Set(
    (layout.fanGroups || []).flatMap((fan) => fan.relations.map((relation) => relation.id)),
  );
  const ungrouped = layout.relations.filter((relation) => !groupedRelationIds.has(relation.id));
  // Wrong-layer bug: displaced-event stems used to live inside each event
  // group. A later ordinary event could therefore paint its stem over an
  // earlier establish/abolish glyph occupying the true-year anchor. Paint all
  // stems first; relations remain above them and every event glyph masks the
  // stem interior at the end.
  for (const event of eventsToRender) {
    renderEventStem(
      group,
      event,
      selectionFocus.active && !focusedTimepointIds.has(event.id),
    );
  }
  for (const fan of layout.fanGroups || []) {
    renderFanGroup(group, fan, selected, selectionFocus.active, options.handlers);
  }
  for (const relation of ungrouped) {
    if (fanRelationIds.has(relation.id)) continue;
    renderRelation(
      group,
      relation,
      selected === `relation:${relation.id}`,
      selectionFocus.active && selected !== `relation:${relation.id}`,
      options.handlers,
    );
  }
  for (const relationGroup of layout.relationGroups) {
    renderRelationGroup(group, relationGroup, selected, selectionFocus.active, options.handlers);
  }
  // Render the selected event last so its emphasis stays on top of
  // neighbouring marks instead of being painted over by them.
  const orderedEvents = [
    ...eventsToRender.filter((event) => selected !== `timepoint:${event.id}`),
    ...eventsToRender.filter((event) => selected === `timepoint:${event.id}`),
  ];
  for (const event of orderedEvents) {
    renderEventMark(
      group,
      event,
      selected === `timepoint:${event.id}`,
      selectionFocus.active && !focusedTimepointIds.has(event.id),
      options.handlers,
    );
  }
  renderOffAxis(group, layout, options.selectedItem, {
    ...selectionFocus,
    timepointIds: focusedTimepointIds,
  }, options.handlers);
  layer.appendChild(group);
}

/** Render the data-driven evolution layer into the unchanged 4-01 design SVG. */
export function renderEvolutionOverlay(svg, options) {
  svg.querySelector(".dynamic-evolution-layer")?.remove();
  ensureDefs(svg);
  const layer = svgElement("g", { class: "dynamic-evolution-layer" });
  layer.style.pointerEvents = "none";
  renderSelector(layer, options);
  renderSelectedActions(layer, options);
  renderMain(layer, options.layout, options);
  svg.appendChild(layer);
  return layer;
}
