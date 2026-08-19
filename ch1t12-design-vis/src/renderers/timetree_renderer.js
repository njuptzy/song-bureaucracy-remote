import { relationPath } from "./evolution_renderer.js";
import {
  fitTimetreeCapsuleLabel,
  TIMETREE_GEOMETRY,
  timetreeAlignedHalfWidths,
  timetreeLaneLinkSpan,
  timetreeNodeColumns,
  timetreeVirtualBusGeometry,
  timetreeRowY,
} from "../utils/timetree_layout.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// 视觉常量与 evolution_renderer.js 保持一致（调色时需两处同步）。
const COLORS = {
  ink: "#351704",
  line: "#563905",
  olive: "#918069",
  selected: "#866d6d",
  paper: "#f5f3ec",
  abolish: "#a0432e",
};

// 与演变视图统一：所有关系线同一粗细同一透明度，只有选中才加粗实色。
const RELATION_STROKE = {
  width: 1.1,
  opacity: 0.35,
  selectedWidth: 1.7,
  selectedOpacity: 1,
};

function svgElement(tag, attrs = {}) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value != null) element.setAttribute(name, String(value));
  }
  return element;
}

function appendText(parent, text, attrs = {}) {
  const element = svgElement("text", attrs);
  element.textContent = text;
  parent.appendChild(element);
  return element;
}

function addTitle(element, text) {
  const title = svgElement("title");
  title.textContent = text;
  element.appendChild(title);
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

function eventDescription(event) {
  return [event.rawTime || event.time || "时间未明", event.event || event.quotation || "未载事件"]
    .filter(Boolean)
    .join("：");
}

function ensureTimetreeDefs(svg, geometry) {
  svg.querySelectorAll("[data-timetree-def]").forEach((element) => element.remove());
  let defs = svg.querySelector("defs");
  if (!defs) {
    defs = svgElement("defs");
    svg.insertBefore(defs, svg.firstChild);
  }

  const clip = svgElement("clipPath", {
    id: "timetree-rows-clip",
    clipPathUnits: "userSpaceOnUse",
    "data-timetree-def": "clip",
  });
  clip.appendChild(svgElement("rect", {
    x: geometry.content.x0 - 2,
    y: geometry.rowsTop - 16,
    width: geometry.content.x1 - geometry.content.x0 + 4,
    height: geometry.rowsBottom - geometry.rowsTop + 32,
  }));

  const arrow = svgElement("marker", {
    id: "timetree-relation-arrow",
    markerWidth: 6,
    markerHeight: 6,
    refX: 5.5,
    refY: 3,
    orient: "auto",
    markerUnits: "userSpaceOnUse",
    "data-timetree-def": "marker",
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

function renderAxis(parent, geometry, yearMin, yearMax) {
  const { plot, dividerX, axisY, rowsTop, rowsBottom } = geometry;
  parent.appendChild(svgElement("line", {
    class: "timetree-region-divider",
    x1: dividerX, y1: rowsTop - 12, x2: dividerX, y2: rowsBottom,
    stroke: COLORS.line, "stroke-width": 0.65, "stroke-opacity": 0.18,
    "pointer-events": "none",
  }));
  parent.appendChild(svgElement("line", {
    x1: plot.x0, y1: axisY, x2: plot.x1, y2: axisY,
    stroke: COLORS.olive, "stroke-width": 0.7,
  }));
  const ticks = [yearMin, ...[1000, 1050, 1100, 1150, 1200, 1250].filter(
    (year) => year > yearMin && year < yearMax,
  ), yearMax];
  const scale = (year) => plot.x0
    + (year - yearMin) / Math.max(1, yearMax - yearMin) * (plot.x1 - plot.x0);
  for (const year of ticks) {
    const x = scale(year);
    parent.appendChild(svgElement("line", {
      x1: x, y1: rowsTop - 8, x2: x, y2: rowsBottom,
      stroke: COLORS.line, "stroke-width": 0.5, "stroke-opacity": 0.07,
      "pointer-events": "none",
    }));
    parent.appendChild(svgElement("line", {
      x1: x, y1: axisY - 6, x2: x, y2: axisY + 6,
      stroke: COLORS.line, "stroke-width": 0.65,
    }));
    appendText(parent, String(year), {
      x, y: axisY - 11, class: "timetree-axis-label", "text-anchor": "middle",
    });
  }
}

function renderHeaderControls(parent, geometry, handlers) {
  const y = geometry.axisY - 6;
  const collapse = appendText(parent, "全部收起", {
    x: geometry.dividerX - 12,
    y,
    class: "timetree-header-control",
    "text-anchor": "end",
  });
  makeInteractive(collapse, "收起全部层级节点", () => handlers.onCollapseAll?.());
  const expand = appendText(parent, "全部展开", {
    x: geometry.dividerX - 72,
    y,
    class: "timetree-header-control",
    "text-anchor": "end",
  });
  makeInteractive(expand, "展开全部层级节点", () => handlers.onExpandAll?.());
}

function renderRowHitArea(parent, row, y, geometry) {
  const hitArea = svgElement("rect", {
    class: "timetree-row-hit-area",
    x: geometry.content.x0,
    y: y - geometry.rowPitch / 2,
    width: geometry.content.x1 - geometry.content.x0,
    height: geometry.rowPitch,
    fill: "transparent",
  });
  if (row.entityId != null) hitArea.style.cursor = "pointer";
  parent.appendChild(hitArea);
  return hitArea;
}

// ---- 层级树节点：完全复用层级视图的模板盖章，整体逆时针旋转 90° ----

function setNodeText(element, text) {
  if (!element) return;
  element.replaceChildren(document.createTextNode(text || "暂无资料"));
}

// 与层级视图 fitDynamicNodeLabel 同规则：按胶囊可用长度截断（模板空间里
// 胶囊是竖放的，可用长度 = polygon 高度；旋转后即横向可用宽度）。
function fitCapsuleLabel(label, fullTitle, capsuleLength) {
  if (!label) return;
  const fitted = fitTimetreeCapsuleLabel(fullTitle, capsuleLength);
  label.style.fontSize = `${fitted.fontSize}px`;
  label.style.letterSpacing = "0";
  setNodeText(label, fitted.text);
}

function virtualNodeWidth(row, templates) {
  return Math.max(
    Number(templates.emperorRect.getAttribute("width")),
    row.title.length * 17.14 + 24,
  );
}

// 真实机构节点：盖章层级视图的胶囊模板（竖排胶囊 + 竖排文字 + cls-81 标记 +
// 收起计数短横），内容保持模板坐标不动，由外壳做 rotate(-90)。
function stampCapsuleNode(svg, row, templates, selected, nodeIndex) {
  const nodeGroup = templates.templateGroup.cloneNode(true);
  nodeGroup.removeAttribute("transform");
  nodeGroup.dataset.entityId = String(row.entityId);
  const bounds = templates.templatePolygonBounds;
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  // 未选中且未展开的节点不保留原稿的选中标记（与层级视图一致）。
  if (!selected && !row.expanded) nodeGroup.querySelector("g.cls-81")?.remove();

  const label = nodeGroup.querySelector("text");
  if (label) {
    // 旋转后胶囊横放，文字改为横排并随外壳转正：rotate(90) 抵消外壳的 -90°。
    label.style.writingMode = "horizontal-tb";
    label.style.textOrientation = "mixed";
    fitCapsuleLabel(label, row.title, bounds.height);
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("dominant-baseline", "central");
    label.setAttribute("transform", `translate(${cx} ${cy}) rotate(90)`);
    // 与层级视图相同的文字裁剪（模板空间内，随外壳一起旋转）。
    const clipId = `timetree-node-clip-${nodeIndex}`;
    const clipPath = svgElement("clipPath", {
      id: clipId,
      clipPathUnits: "userSpaceOnUse",
      "data-timetree-def": "node-clip",
    });
    clipPath.appendChild(svgElement("rect", {
      x: bounds.x + 3,
      y: bounds.y + 2,
      width: bounds.width - 6,
      height: bounds.height - 4,
    }));
    svg.querySelector("defs")?.appendChild(clipPath);
    const clipGroup = svgElement("g", { "clip-path": `url(#${clipId})` });
    label.parentNode.insertBefore(clipGroup, label);
    clipGroup.appendChild(label);
  }

  // 点击热区 = 胶囊外框（随外壳旋转）。
  nodeGroup.insertBefore(svgElement("rect", {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    fill: "transparent",
    "pointer-events": "all",
    "aria-hidden": "true",
  }), nodeGroup.firstChild);

  // 收起下级的计数短横：与层级视图相同的 log2 档位，旋转后落在横胶囊右端。
  const hiddenCount = row.childCount || 0;
  if (hiddenCount > 0) {
    const barCount = Math.min(5, Math.max(1, Math.ceil(Math.log2(hiddenCount + 1))));
    for (let index = 0; index < barCount; index += 1) {
      nodeGroup.appendChild(svgElement("rect", {
        x: bounds.x + 1,
        y: bounds.y + bounds.height - 4 - index * 3,
        width: bounds.width - 2,
        height: 1.8,
        fill: COLORS.line,
        opacity: 0.55,
      }));
    }
  }
  return nodeGroup;
}

// 制度组虚拟节点：沿用层级视图的"皇帝"模板（横排胶囊 + 居中文字），
// 该模板本身即横向，不再旋转。
function stampGroupNode(row, templates, width) {
  const nodeGroup = svgElement("g");
  const height = Number(templates.emperorRect.getAttribute("height"));
  const rect = templates.emperorRect.cloneNode(true);
  rect.style.removeProperty("display");
  rect.setAttribute("x", String(-width / 2));
  rect.setAttribute("y", String(-height / 2));
  rect.setAttribute("width", String(width));
  rect.setAttribute("height", String(height));
  rect.removeAttribute("opacity");
  rect.style.removeProperty("opacity");
  rect.setAttribute("opacity", row.isInstitutionGroup ? "0.82" : "1");
  const label = templates.emperorText.cloneNode(true);
  label.style.removeProperty("display");
  label.removeAttribute("opacity");
  label.style.removeProperty("opacity");
  label.removeAttribute("transform");
  label.style.writingMode = "horizontal-tb";
  label.style.textOrientation = "mixed";
  label.setAttribute("x", "0");
  label.setAttribute("y", "0");
  label.setAttribute("text-anchor", "middle");
  label.setAttribute("dominant-baseline", "central");
  setNodeText(label, row.title);
  nodeGroup.append(rect, label);
  return nodeGroup;
}

// 连线与层级视图同一语法（cls-26 正交折线）：从父节点外框右边中点，
// 经父子中点竖线，接到子节点外框左边中点。
function renderTreeLink(parent, parentNode, childNode) {
  const midX = (parentNode.right + childNode.left) / 2;
  const polyline = svgElement("polyline", {
    class: "cls-26 timetree-tree-link",
    points: `${parentNode.right},${parentNode.y} ${midX},${parentNode.y} ${midX},${childNode.y} ${childNode.left},${childNode.y}`,
  });
  polyline.style.pointerEvents = "none";
  parent.appendChild(polyline);
}

// 虚拟类别/制度组严格复用层级视图的共同总线语法；旋转后横向总线变为竖向。
function renderVirtualTreeBus(parent, parentNode, childNodes) {
  const bus = timetreeVirtualBusGeometry(parentNode, childNodes);
  if (!bus) return;
  const appendLine = (x1, y1, x2, y2) => {
    const line = svgElement("line", {
      class: "cls-26 timetree-tree-link",
      x1, y1, x2, y2,
      "pointer-events": "none",
    });
    parent.appendChild(line);
  };
  appendLine(bus.parent.x0, bus.parent.y, bus.parent.x1, bus.parent.y);
  appendLine(bus.busX, bus.y0, bus.busX, bus.y1);
  bus.children.forEach((child) => appendLine(child.x0, child.y, child.x1, child.y));
}

// 机构节点与其右侧时间车道的直接对应线。使用虚线，避免与实体存续线混淆。
function renderLaneLink(parent, nodeInfo, y, geometry, selected) {
  if (!nodeInfo) return;
  const { x0, x1 } = timetreeLaneLinkSpan(nodeInfo.right, geometry);
  parent.appendChild(svgElement("line", {
    class: `timetree-lane-link${selected ? " is-selected" : ""}`,
    x1: x0,
    y1: y,
    x2: x1,
    y2: y,
    stroke: COLORS.olive,
    "stroke-width": selected ? 1.05 : 0.72,
    "stroke-opacity": selected ? 0.62 : 0.28,
    "stroke-dasharray": "2.5 3.5",
    "stroke-linecap": "round",
    "pointer-events": "none",
  }));
}

function renderTreeNode(svg, parent, row, info, selected, handlers, templates, nodeIndex) {
  const wrapper = svgElement("g", {
    class: `timetree-tree-node${row.isVirtual ? " is-virtual" : ""}${selected ? " is-selected" : ""}`,
  });
  if (row.isVirtual) {
    wrapper.setAttribute("transform", `translate(${info.x} ${info.y})`);
    wrapper.appendChild(stampGroupNode(row, templates, info.right - info.left));
  } else {
    const bounds = templates.templatePolygonBounds;
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    wrapper.setAttribute(
      "transform",
      `translate(${info.x} ${info.y}) rotate(-90) translate(${-cx} ${-cy})`,
    );
    wrapper.appendChild(stampCapsuleNode(svg, row, templates, selected, nodeIndex));
  }
  const hasChildren = row.totalChildren > 0;
  const expandHint = hasChildren
    ? (row.expanded ? "；点击收起下级" : `；点击展开 ${row.totalChildren} 个下级`)
    : "";
  const evolutionHint = row.entityId != null ? "；双击进入演变视图" : "";
  addTitle(wrapper, `${row.title}${expandHint}${evolutionHint}`);
  makeInteractive(wrapper, row.title, () => {
    // 与层级视图一致的交互语义：点有下级的节点 = 展开/收起 + 选中。
    if (hasChildren) handlers.onToggleNode?.(row.key);
    if (row.entityId != null) handlers.onSelectEntity?.(row.entityId);
  });
  if (row.entityId != null) {
    wrapper.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      handlers.onOpenEvolution?.(row.entityId);
    });
  }
  parent.appendChild(wrapper);
}

function renderSegments(parent, segments, y) {
  for (const segment of segments || []) {
    if (segment.x1 - segment.x0 < 1.5) continue;
    parent.appendChild(svgElement("line", {
      class: "timetree-lifespan",
      x1: segment.x0, y1: y, x2: segment.x1, y2: y,
      stroke: COLORS.olive,
      "stroke-width": 2,
      "stroke-opacity": 0.5,
      "stroke-linecap": "round",
      "pointer-events": "none",
    }));
  }
}

function renderEvent(parent, event, y, selected, handlers) {
  const iconType = event.iconType || "record";
  const eventY = y + (event.dy || 0);
  const group = svgElement("g", {
    class: `timetree-event timetree-event-${iconType}${selected ? " is-selected" : ""}`,
  });
  const x = event.baseX;

  if (event.timeType === "bounded" && event.rangeStartX != null && event.rangeEndX != null) {
    let startX = Math.min(event.rangeStartX, event.rangeEndX);
    let endX = Math.max(event.rangeStartX, event.rangeEndX);
    const degenerate = Math.abs(endX - startX) < 1;
    if (!degenerate && endX - startX < 8) {
      startX = x - 4;
      endX = x + 4;
    }
    // 起止同年（"宋初"类锚定单年）不画塌陷装饰，与演变视图保持一致。
    if (!degenerate) {
      group.appendChild(svgElement("line", {
        x1: startX, y1: eventY + 8.5, x2: endX, y2: eventY + 8.5,
        stroke: COLORS.olive, "stroke-width": 1.1, "stroke-dasharray": "3 2",
      }));
      group.appendChild(svgElement("path", {
        d: `M${startX} ${eventY + 5}V${eventY + 8.5}M${endX} ${eventY + 5}V${eventY + 8.5}`,
        fill: "none", stroke: COLORS.olive, "stroke-width": 1.1,
      }));
    }
  }
  if (event.timeType === "range" && event.rangeStartX != null && event.rangeEndX != null) {
    const startX = event.rangeStartX;
    const endX = event.rangeEndX;
    group.appendChild(svgElement("path", {
      d: `M${startX} ${eventY - 13}V${eventY - 20}H${endX}V${eventY - 13}`,
      fill: "none", stroke: COLORS.olive, "stroke-width": 0.8,
    }));
    const stemTopX = Math.max(Math.min(startX, endX), Math.min(Math.max(startX, endX), x));
    group.appendChild(svgElement("line", {
      x1: x, y1: eventY - 4.2, x2: stemTopX, y2: eventY - 13,
      stroke: COLORS.olive, "stroke-width": 0.65, "stroke-opacity": 0.85,
      "pointer-events": "none",
    }));
  }

  // 错层回指：竖直茎 + 车道上的定位点，与演变视图"密集点错层"同语法。
  if (event.displaced) {
    group.appendChild(svgElement("line", {
      x1: x, y1: y, x2: x, y2: eventY,
      stroke: COLORS.olive, "stroke-width": 0.65, "stroke-opacity": 0.74,
      "pointer-events": "none",
    }));
    group.appendChild(svgElement("circle", {
      cx: x, cy: y, r: 1.65, fill: COLORS.line, "pointer-events": "none",
    }));
  }

  if (iconType === "establish" || iconType === "abolish") {
    const up = iconType === "establish";
    const size = selected ? 5.6 : 4.8;
    const apexY = up ? eventY - size : eventY + size;
    const baseY = up ? eventY + size * 0.79 : eventY - size * 0.79;
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
      cx: x, cy: eventY, r: selected ? 4.2 : 2.6,
      fill: selected ? COLORS.selected : COLORS.paper,
      stroke: selected ? COLORS.selected : COLORS.line,
      "stroke-width": selected ? 1.2 : 1,
    }));
  }

  group.appendChild(svgElement("circle", {
    cx: x, cy: eventY, r: event.displaced ? 5.5 : 10,
    fill: "transparent", "pointer-events": "all",
  }));
  addTitle(group, eventDescription(event));
  makeInteractive(group, `查看${eventDescription(event)}`, () => handlers.onSelectEvent?.(event));
  parent.appendChild(group);
}

function renderRelation(parent, relation, selected, handlers) {
  if (!relation.drawable) return;
  const group = svgElement("g", {
    class: `timetree-relation${selected ? " is-selected" : ""}`,
    "data-relation-id": relation.id,
  });
  const stroke = selected ? COLORS.selected : COLORS.line;
  for (const source of relation.sourcePoints) {
    for (const target of relation.targetPoints) {
      group.appendChild(svgElement("path", {
        d: relationPath(source, target),
        fill: "none",
        stroke,
        "stroke-width": selected ? RELATION_STROKE.selectedWidth : RELATION_STROKE.width,
        "stroke-opacity": selected
          ? RELATION_STROKE.selectedOpacity
          : RELATION_STROKE.opacity,
        "marker-end": "url(#timetree-relation-arrow)",
      }));
    }
  }
  const source = relation.sourcePoints[0];
  const target = relation.targetPoints[0];
  const hit = svgElement("path", {
    d: relationPath(source, target),
    fill: "none",
    stroke: "transparent",
    "stroke-width": 14,
    "pointer-events": "stroke",
  });
  group.appendChild(hit);
  const endpoints = [...relation.sourcePoints, ...relation.targetPoints];
  addTitle(group, `${relation.label}：${endpoints
    .map((point) => point.rawTime || point.effectiveYear || "年代未明")
    .join(" → ")}`);
  makeInteractive(group, `查看关系${relation.label}`, () => handlers.onSelectRelation?.(relation));
  parent.appendChild(group);
}

function renderOffAxisBadge(parent, lane, y, geometry) {
  const count = lane.offAxisEvents?.length || 0;
  if (!count) return;
  const badge = appendText(parent, `轴外·${count}`, {
    x: geometry.plot.x1 - 2,
    y: y + 3,
    class: "timetree-offaxis-badge",
    "text-anchor": "end",
  });
  addTitle(badge, lane.offAxisEvents
    .map((event) => eventDescription(event))
    .join("\n"));
}

function renderScrollbar(parent, scroll, geometry, handlers) {
  if (!scroll || scroll.maxOffset <= 0) return;
  const trackX = geometry.content.x1 + 6;
  const trackY = geometry.rowsTop;
  const trackHeight = geometry.rowsBottom - geometry.rowsTop;
  const thumbHeight = Math.max(
    28,
    trackHeight * scroll.viewportHeight / scroll.contentHeight,
  );
  const travel = trackHeight - thumbHeight;
  const thumbY = trackY + (scroll.offset / scroll.maxOffset) * travel;
  parent.appendChild(svgElement("rect", {
    class: "timetree-scrollbar-track",
    x: trackX, y: trackY, width: 4, height: trackHeight,
    fill: COLORS.line, "fill-opacity": 0.06, rx: 2,
  }));
  const thumb = svgElement("rect", {
    class: "timetree-scrollbar-thumb",
    x: trackX, y: thumbY, width: 4, height: thumbHeight,
    fill: COLORS.line, "fill-opacity": 0.3, rx: 2,
  });
  thumb.style.cursor = "grab";
  parent.appendChild(thumb);
  const fractionFromEvent = (event) => {
    // SVG 以 xMidYMid meet 等比缩放：反算 viewBox 坐标需统一缩放率加 letterbox 偏移。
    const svgEl = parent.ownerSVGElement;
    const rect = svgEl?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return null;
    const scale = Math.min(rect.width / 1920, rect.height / 1080);
    const offsetY = (rect.height - 1080 * scale) / 2;
    const svgY = (event.clientY - rect.top - offsetY) / scale;
    return (svgY - trackY - thumbHeight / 2) / Math.max(1, travel);
  };
  const onDrag = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const fraction = fractionFromEvent(event);
    if (fraction != null) handlers.onScrollToFraction?.(Math.max(0, Math.min(1, fraction)));
  };
  thumb.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    thumb.setPointerCapture(event.pointerId);
    const move = (moveEvent) => onDrag(moveEvent);
    const up = () => {
      thumb.removeEventListener("pointermove", move);
      thumb.removeEventListener("pointerup", up);
      thumb.removeEventListener("pointercancel", up);
    };
    thumb.addEventListener("pointermove", move);
    thumb.addEventListener("pointerup", up);
    thumb.addEventListener("pointercancel", up);
  });
}

/**
 * 时间线树视图：左侧层级树（原层级结构逆时针旋转 90°：根在左、深度向右、
 * 兄弟纵排）与右侧时间线逐行对齐；每一非虚拟行就是一条机构车道。
 */
export function renderTimetreeOverlay(svg, options) {
  const {
    rows = [],
    lanesByEntityId = new Map(),
    eventsByLane = new Map(),
    segmentsByLane = new Map(),
    relations = [],
    yearMin,
    yearMax,
    scroll = null,
    selectedEntityId = null,
    selectedEventId = null,
    selectedRelationId = null,
    treeTemplates = null,
    handlers = {},
  } = options;
  const geometry = TIMETREE_GEOMETRY;

  ensureTimetreeDefs(svg, geometry);
  svg.querySelector(".dynamic-timetree-layer")?.remove();

  const layer = svgElement("g", { class: "dynamic-timetree-layer" });
  svg.appendChild(layer);

  renderAxis(layer, geometry, yearMin, yearMax);
  renderHeaderControls(layer, geometry, handlers);

  if (!rows.length) {
    appendText(layer, "当前分类暂无机构数据", {
      x: (geometry.content.x0 + geometry.content.x1) / 2,
      y: (geometry.rowsTop + geometry.rowsBottom) / 2,
      class: "timetree-empty-hint",
      "text-anchor": "middle",
    });
    return;
  }

  const content = svgElement("g", { "clip-path": "url(#timetree-rows-clip)" });
  layer.appendChild(content);

  const yByKey = new Map(rows.map((row) => [
    row.key,
    timetreeRowY(row.layoutIndex ?? row.rowIndex, scroll?.offset || 0, geometry),
  ]));

  // 每个树节点的最终坐标与外框左右缘（连线端点用）。
  // 旋转后真实节点横放：横向半长 = 模板竖胶囊高度的一半。
  const nodeInfoByKey = new Map();
  if (treeTemplates) {
    const capsuleHalf = treeTemplates.templatePolygonBounds.height / 2;
    const naturalHalfWidthByKey = new Map(rows.map((row) => [
      row.key,
      row.isVirtual ? virtualNodeWidth(row, treeTemplates) / 2 : capsuleHalf,
    ]));
    const halfWidthByKey = timetreeAlignedHalfWidths(rows, naturalHalfWidthByKey);
    const xByDepth = timetreeNodeColumns(rows, halfWidthByKey, geometry);
    for (const row of rows) {
      const x = xByDepth.get(row.depth);
      const y = yByKey.get(row.key);
      const halfW = halfWidthByKey.get(row.key);
      nodeInfoByKey.set(row.key, { x, y, left: x - halfW, right: x + halfW });
    }
  }

  // 第一遍：透明点击热区与存续段（底层）。热区不再绘制整行底色，避免
  // 父子节点的重叠行带叠成灰色覆盖块。
  const underlay = svgElement("g", { class: "timetree-underlay" });
  content.appendChild(underlay);
  for (const row of rows) {
    const y = yByKey.get(row.key);
    const selected = row.entityId != null && row.entityId === selectedEntityId;
    const hitArea = renderRowHitArea(underlay, row, y, geometry);
    if (row.entityId != null) {
      makeInteractive(hitArea, `查看${row.title}`, () => handlers.onSelectEntity?.(row.entityId));
    }
    if (row.entityId != null) {
      renderLaneLink(underlay, nodeInfoByKey.get(row.key), y, geometry, selected);
      renderSegments(underlay, segmentsByLane.get(row.entityId), y);
    }
  }


  // 第二遍：层级连线。虚拟父节点的所有下级共享一根分叉总线；真实机构
  // 仍按数据库中的每条明确上下级边逐条连接。
  if (treeTemplates) {
    const rowByKey = new Map(rows.map((row) => [row.key, row]));
    const childrenByParentKey = new Map();
    for (const row of rows) {
      if (!row.parentKey || !rowByKey.has(row.parentKey)) continue;
      if (!childrenByParentKey.has(row.parentKey)) childrenByParentKey.set(row.parentKey, []);
      childrenByParentKey.get(row.parentKey).push(row);
    }
    for (const [parentKey, childRows] of childrenByParentKey) {
      const parentRow = rowByKey.get(parentKey);
      const parentInfo = nodeInfoByKey.get(parentKey);
      const childInfos = childRows.map((row) => nodeInfoByKey.get(row.key)).filter(Boolean);
      if (!parentInfo || !childInfos.length) continue;
      if (parentRow.isVirtual) {
        renderVirtualTreeBus(underlay, parentInfo, childInfos);
      } else {
        childInfos.forEach((childInfo) => renderTreeLink(underlay, parentInfo, childInfo));
      }
    }
  }

  // 关系线压在事件点之下。
  const relationLayer = svgElement("g", { class: "timetree-relations" });
  content.appendChild(relationLayer);
  for (const relation of relations) {
    renderRelation(relationLayer, relation, relation.id === selectedRelationId, handlers);
  }

  // 第二遍：事件点与树节点（顶层，保证可点）。
  const overlay = svgElement("g", { class: "timetree-overlay" });
  content.appendChild(overlay);
  let nodeIndex = 0;
  for (const row of rows) {
    const y = yByKey.get(row.key);
    if (row.entityId != null) {
      for (const event of eventsByLane.get(row.entityId) || []) {
        renderEvent(overlay, event, y, event.id === selectedEventId, handlers);
      }
      const lane = lanesByEntityId.get(row.entityId);
      if (lane) renderOffAxisBadge(overlay, lane, y, geometry);
    }
    if (treeTemplates) {
      renderTreeNode(
        svg,
        overlay,
        row,
        nodeInfoByKey.get(row.key),
        row.entityId != null && row.entityId === selectedEntityId,
        handlers,
        treeTemplates,
        nodeIndex,
      );
      nodeIndex += 1;
    }
  }

  // 滚轮滚动：挂在整层上，事件从行带/事件点冒泡上来，不挡任何点击。
  layer.addEventListener("wheel", (event) => {
    event.preventDefault();
    handlers.onScroll?.(event.deltaY);
  }, { passive: false });

  renderScrollbar(layer, scroll, geometry, handlers);
}
