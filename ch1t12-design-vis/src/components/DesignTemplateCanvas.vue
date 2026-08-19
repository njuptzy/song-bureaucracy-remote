<template>
  <div ref="hostRef" class="design-template"
    :class="{ loading: loading, 'revision-panel-active': revisionPanelActive }">
    <div v-if="error" class="template-message">{{ error }}</div>
    <div v-else-if="loading" class="template-message">载入 SVG 设计画板…</div>
    <div ref="svgMountRef" class="svg-mount"></div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import * as d3 from "d3";
import {
  buildYearSnapshot,
  hierarchyEdgesWithoutCollectives,
} from "../utils/snapshot";
import {
  buildInstitutionGroupNodes,
  CENTRAL_GROUP_NAMES,
  entityInstitutionGroup,
  institutionGroupId,
} from "../utils/central_groups";
import {
  buildSubordinateGroupNodes,
  subordinateGroupFor,
  subordinateGroupId,
} from "../utils/subordinate_groups";
import {
  anchorBranchToGroup,
  buildHierarchyEdgeIndex,
  fitRangeShift,
  focusPanToCenter,
  hierarchyNodeGap,
  isHorizontalWheelGesture,
  panFromScrollbarOffset,
  panScrollbarGeometry,
  pushOverlappingRanges,
  relativeAffineMatrix,
  virtualBusRange,
  virtualBusY,
} from "../utils/hierarchy_layout";
import {
  collapseInstitutionGroups,
  compositionDetailButtonVisible,
  compositionViewButtonVisible,
  expansionAfterLayout,
  expansionAnchorId,
  hierarchyPathAfterInstitutionGroupToggle,
  institutionGroupsAfterLayout,
  mergeExpansionPaths,
  removeExpandedSubtree,
  toggleInstitutionGroupIds,
} from "../utils/hierarchy_expansion";
import {
  HIERARCHY_HEADER_LAYOUT,
  hierarchyAnimationShouldRun,
} from "../utils/hierarchy_animation";
import {
  resolveHierarchyContext,
  resolveVisibleSelection,
} from "../utils/hierarchy_navigation";
import {
  clampCompositionScroll,
  compositionScrollAfterDrag,
  compositionSliderGeometry,
} from "../utils/composition_scroll";
import { buildCompositionModel } from "../utils/composition_model";
import {
  fitCompositionBlock,
  layoutComposition,
  COMPOSITION_GEOMETRY,
} from "../utils/composition_layout";
import { buildEvolutionLanes, buildEvolutionModel } from "../utils/evolution_model";
import { layoutEvolutionModel } from "../utils/evolution_layout";
import { windowEvolutionModel } from "../utils/evolution_window";
import {
  evolutionComparisonAfterAdd,
} from "../utils/evolution_selection";
import {
  evolutionSelectionComparison,
  formatYearOffset,
  resolveHierarchyReturnContext,
  resolveHierarchyReturnContexts,
  staffEdgesForEvolutionTimepoint,
} from "../utils/evolution_context";
import { dictionaryEntryText } from "../utils/dictionary_entry";
import { relationshipSourceOriginal } from "../utils/relationship_source";
import {
  compareInstitutionIdsBySourceOrder,
  compareInstitutionsBySourceOrder,
} from "../utils/institution_order";
import { renderEvolutionOverlay } from "../renderers/evolution_renderer";
import { renderTimetreeOverlay } from "../renderers/timetree_renderer";
import {
  buildTimetreeRows,
  defaultTimetreeExpandedKeys,
  timetreeCategoryKey,
  timetreeLaneEntityIds,
  toggleTimetreeExpansion,
} from "../utils/timetree_model";
import {
  clampTimetreeScroll,
  layoutTimetreeEvents,
  layoutTimetreeRelations,
  layoutTimetreeSegments,
  TIMETREE_GEOMETRY,
  timetreeLayoutSpan,
  timetreeEventsForLane,
  timetreeRelationEndpointIds,
  timetreeRelationsForEntity,
  timetreeYearToX,
} from "../utils/timetree_layout";
import { formatStandardTime } from "../utils/time_format";
import {
  buildTimelineYearTicks,
  formatTimelineEmperor,
  formatTimelineRegnalYear,
  formatTimelineSelectionHeader,
  layoutTimelineEraLabels,
  layoutTimelineEmperorLabels,
  normalizeTimelineEras,
  normalizeTimelineEmperorReigns,
} from "../utils/timeline_data";
import {
  layoutMajorEventLabels,
  MAJOR_EVENTS,
  STATIC_MAJOR_EVENT_TITLES,
  majorEventTooltip,
  normalizeMajorEvents,
} from "../utils/major_events";
import { detailHeaderLayout } from "../utils/detail_header";
import {
  nodeChangeIndicatorAriaLabel,
  nodeChangeIndicatorItems,
  nodeChangeIndicatorLayout,
} from "../utils/node_change_indicator";
import {
  CHANGE_TYPE_LABELS,
  buildSnapshotTransition,
  buildStructuralChangeIndex,
  changeSummaryForEntities,
  changeSummaryForEntity,
  changesForEntities,
  changesForEntity,
  resolveTransitionSelection,
} from "../utils/transition_model";

const props = defineProps({
  data: { type: Object, required: true },
  initialState: { type: Object, default: null },
  revisionPanelActive: { type: Boolean, default: false },
  globalUndoAvailable: { type: Boolean, default: false },
  fixedViewMode: { type: String, default: "" },
});
const emit = defineEmits(["state-change", "selection-change", "detail-entity-change", "global-undo"]);
const initialState = props.initialState || {};

const hostRef = ref(null);
const svgMountRef = ref(null);
const loading = ref(true);
const error = ref("");
const VIEW_MODES = ["hierarchy", "composition", "evolution"];
const viewMode = ref(VIEW_MODES.includes(props.fixedViewMode)
  ? props.fixedViewMode
  : VIEW_MODES.includes(initialState.viewMode)
    ? initialState.viewMode
    : "hierarchy");
const viewModeLocked = computed(() => VIEW_MODES.includes(props.fixedViewMode));
function isEvolutionCanvasMode() {
  return viewMode.value === "evolution";
}
const evolutionMode = ref(initialState.evolutionMode === "compare" ? "compare" : "single");
const evolutionEntityIds = ref(Array.isArray(initialState.evolutionEntityIds)
  ? initialState.evolutionEntityIds.slice(0, 4)
  : []);
const selectedEvolutionItem = ref(initialState.selectedEvolutionItem
  ? { ...initialState.selectedEvolutionItem, item: null }
  : null);
const evolutionLanePage = ref(Number.isFinite(initialState.evolutionLanePage)
  ? Math.max(1, Math.floor(initialState.evolutionLanePage))
  : 1);
const evolutionSearchOpen = ref(false);
const comparisonPaneOffsets = ref({
  hierarchy: {
    x: Number(initialState.comparisonPaneOffsets?.hierarchy?.x) || 0,
    y: Number(initialState.comparisonPaneOffsets?.hierarchy?.y) || 0,
  },
  evolution: {
    x: Number(initialState.comparisonPaneOffsets?.evolution?.x) || 0,
    y: Number(initialState.comparisonPaneOffsets?.evolution?.y) || 0,
  },
});
// 时间线树视图状态：展开键 null = 用默认（制度组全展开）；滚动与选中独立于其他视图。
const timetreeExpandedKeys = ref(null);
const timetreeScroll = ref(0);
const timetreeSelectedEventId = ref(null);
const timetreeSelectedRelationId = ref(null);
const selectedRange = ref(Array.isArray(initialState.selectedRange)
  ? initialState.selectedRange.slice(0, 2)
  : [1080, 1080]);
const pendingRange = ref([...selectedRange.value]);
const timelineSelectionActive = ref(initialState.timelineSelectionActive ?? true);
const selectedId = ref(initialState.selectedId ?? null);
// 入口上下文只存在于本次层级 → 演变会话，不写入 localStorage。
const evolutionEntryContext = ref(null);
const hierarchyReturnNotice = ref(null);
const changeTrackEntityId = ref(null);
const changeTrackGroup = ref(null);
const focusedTransition = ref(null);
const compositionFocusId = ref(initialState.compositionFocusId ?? null);
const selectedCategory = ref(initialState.selectedCategory || "中央机构");
const expandedDetailId = ref(null);
const inlineDetailField = ref("duty");
const inlineDetailOfficialId = ref(null);
const spaceAwareExpansion = ref(initialState.spaceAwareExpansion ?? false);
const showVirtualNodes = ref(initialState.showVirtualNodes !== false);
const hierarchyAnimationEnabled = ref(false);
const svgCache = new Map();
const hierarchyTemplateCache = new WeakMap();
const yearSnapshotCache = new Map();
let detailPanelScrollOffset = 0;
let pendingDetailSectionKey = null;
const collapsedHierarchyIds = new Set();
let expandedHierarchyPath = [];
let hierarchyPanX = 0;
let hierarchyPanY = 0;
let hierarchyPanFocusId = null;
let hierarchyPanTransitionOverride = null;
let hierarchyEdgeIndexCache = {
  sourceEdges: null,
  collectiveIds: null,
  index: buildHierarchyEdgeIndex(),
};
let expandedInstitutionGroupIds = [];
let lastExpandedInstitutionGroupId = null;
let expandedSubordinateGroupIds = [];
let lastExpandedSubordinateGroupId = null;
let inlineCompositionScrollOffset = 0;
let renderRevision = 0;
let lastExpandedHierarchyId = null;
let timelineRefreshFrame = null;
let timelineRefreshNeedsStatic = false;
let evolutionModelCacheKey = "";
let evolutionModelCache = null;
let evolutionLayoutCacheKey = "";
let evolutionLayoutCache = null;
let structuralChangeIndex = null;
let activeTransitionAnimation = 0;
let activeTransitionCleanupFrame = null;
let reduceMotionQuery = null;
const expandedChangeEvidenceKeys = new Set();
const transitionTrackItemKeyCache = new WeakMap();

const YEAR_MIN = props.data.meta?.yearMin ?? 960;
const YEAR_MAX = props.data.meta?.yearMax ?? 1279;
const TIMELINE_SCALE_END = YEAR_MAX + 1;
// 直接沿用原设计稿“年份”刻度竖线的两个端点：960 年 x=221.63，
// 1280 年 x=1546.36。210.2/1535.6 是原稿年份文字的左起点，
// 不是刻度坐标；若误用文字起点，960 年的所有运行标记都会整体偏左。
// 时间轴上的所有运行数据（年号、事件、范围选择）必须共用这条坐标映射。
const TIMELINE_X_MIN = 221.63;
const TIMELINE_X_MAX = 1546.36;
const yearScale = d3.scaleLinear()
  .domain([YEAR_MIN, TIMELINE_SCALE_END])
  .range([TIMELINE_X_MIN, TIMELINE_X_MAX])
  .clamp(true);
const TIMELINE_YEAR_WIDTH = yearScale(YEAR_MIN + 1) - yearScale(YEAR_MIN);

const DETAIL_PANEL_BOUNDS = {
  x: 81.77,
  y: 497.57,
  width: 393.72,
  height: 380.1,
};

// 原画板4-02右侧完整制度构成区域。进入具体机构后，该机构按原稿“省级总框”
// 语法使用整块空间，不再把中书/门下示例区当成独立静态内容保留。
const COMPOSITION_CONTENT_BOUNDS = {
  x: 503.48,
  y: 147.58,
  width: 1309.84,
  height: 717.85,
};

let entityMap = new Map();
let collectiveEntityIds = new Set();
let titleMap = new Map();
let timepointRowById = new Map();
let institutionGroupNames = { 中央机构: CENTRAL_GROUP_NAMES };

function rebuildDataIndexes(data) {
  entityMap = new Map((data?.entities || []).map((entity) => [entity.id, entity]));
  collectiveEntityIds = new Set(data?.collectiveEntityIds || []);
  titleMap = new Map();
  for (const entity of data?.entities || []) {
    if (!titleMap.has(entity.title)) titleMap.set(entity.title, entity);
  }
  timepointRowById = new Map();
  for (const rows of Object.values(data?.timepoints || {})) {
    for (const row of rows || []) {
      if (row?.id != null) timepointRowById.set(row.id, row);
    }
  }
  institutionGroupNames = data?.meta?.institutionGroupNames || {
    中央机构: CENTRAL_GROUP_NAMES,
  };
  structuralChangeIndex = buildStructuralChangeIndex(data || {});
}

rebuildDataIndexes(props.data);
lastExpandedInstitutionGroupId = institutionGroupId(
  "中央机构",
  entityInstitutionGroup(titleMap.get("尚书省"), "中央机构")
);
expandedInstitutionGroupIds = [lastExpandedInstitutionGroupId];
function yearSnapshot(year) {
  if (yearSnapshotCache.has(year)) {
    const cached = yearSnapshotCache.get(year);
    yearSnapshotCache.delete(year);
    yearSnapshotCache.set(year, cached);
    return cached;
  }
  const snapshot = buildYearSnapshot(props.data, year);
  yearSnapshotCache.set(year, snapshot);
  if (yearSnapshotCache.size > 16) {
    yearSnapshotCache.delete(yearSnapshotCache.keys().next().value);
  }
  return snapshot;
}

const currentSnapshot = computed(() => (
  timelineSelectionActive.value ? yearSnapshot(selectedRange.value[0]) : null
));

function currentCanvasYear() {
  return Number.isFinite(Number(selectedRange.value[0]))
    ? Math.round(Number(selectedRange.value[0]))
    : YEAR_MIN;
}

function evolutionEntryYear() {
  return evolutionEntryContext.value?.entryYear ?? currentCanvasYear();
}

function setEvolutionEntryContext(entityId, sourceView) {
  const year = currentCanvasYear();
  evolutionEntryContext.value = {
    entryYear: year,
    entryEntityId: entityId ?? null,
    currentYear: year,
    sourceView: sourceView || viewMode.value,
  };
}
const persistedCanvasState = computed(() => ({
  viewMode: viewMode.value,
  evolutionMode: evolutionMode.value,
  evolutionEntityIds: [...evolutionEntityIds.value],
  selectedEvolutionItem: selectedEvolutionItem.value
    ? { kind: selectedEvolutionItem.value.kind, id: selectedEvolutionItem.value.id }
    : null,
  evolutionLanePage: evolutionLanePage.value,
  selectedRange: [...selectedRange.value],
  timelineSelectionActive: timelineSelectionActive.value,
  selectedId: selectedId.value,
  compositionFocusId: compositionFocusId.value,
  selectedCategory: selectedCategory.value,
  spaceAwareExpansion: spaceAwareExpansion.value,
  showVirtualNodes: showVirtualNodes.value,
}));

function restoreCanvasState(state) {
  if (!state || typeof state !== "object") return;
  const nextViewMode = viewModeLocked.value
    ? props.fixedViewMode
    : VIEW_MODES.includes(state.viewMode)
      ? state.viewMode
      : viewMode.value;
  const viewChanged = nextViewMode !== viewMode.value;

  viewMode.value = nextViewMode;
  evolutionMode.value = state.evolutionMode === "compare" ? "compare" : "single";
  evolutionEntityIds.value = Array.isArray(state.evolutionEntityIds)
    ? state.evolutionEntityIds.slice(0, 4)
    : [];
  selectedEvolutionItem.value = state.selectedEvolutionItem
    ? { ...state.selectedEvolutionItem, item: null }
    : null;
  evolutionLanePage.value = Number.isFinite(state.evolutionLanePage)
    ? Math.max(1, Math.floor(state.evolutionLanePage))
    : 1;

  const rawRange = Array.isArray(state.selectedRange) ? state.selectedRange : selectedRange.value;
  const rangeStart = Number.isFinite(Number(rawRange[0])) ? Number(rawRange[0]) : YEAR_MIN;
  const rangeEnd = Number.isFinite(Number(rawRange[1])) ? Number(rawRange[1]) : rangeStart;
  const normalizedRange = [
    Math.max(YEAR_MIN, Math.min(YEAR_MAX, Math.round(rangeStart))),
    Math.max(YEAR_MIN, Math.min(YEAR_MAX, Math.round(rangeEnd))),
  ].sort((a, b) => a - b);
  selectedRange.value = normalizedRange;
  pendingRange.value = [...normalizedRange];
  timelineSelectionActive.value = state.timelineSelectionActive !== false;
  selectedId.value = state.selectedId ?? null;
  compositionFocusId.value = state.compositionFocusId ?? null;
  if (typeof state.selectedCategory === "string" && state.selectedCategory.trim()) {
    selectedCategory.value = state.selectedCategory.trim();
  }
  spaceAwareExpansion.value = state.spaceAwareExpansion === true;
  showVirtualNodes.value = state.showVirtualNodes !== false;

  // 这些是当前点击产生的临时高亮，不属于上一个画布状态。
  evolutionSearchOpen.value = false;
  hierarchyReturnNotice.value = null;
  changeTrackEntityId.value = null;
  changeTrackGroup.value = null;
  focusedTransition.value = null;
  expandedDetailId.value = null;
  inlineDetailOfficialId.value = null;
  collapsedHierarchyIds.clear();
  expandedHierarchyPath = [];
  lastExpandedHierarchyId = null;

  if (!viewChanged) {
    flushTimelineRefresh(true);
  }
}

defineExpose({ restoreCanvasState });

watch(persistedCanvasState, (state) => emit("state-change", state), {
  immediate: true,
  deep: true,
});

watch(selectedId, (entityId) => emit("detail-entity-change", entityId), {
  immediate: true,
});

watch(() => props.data, (data) => {
  rebuildDataIndexes(data);
  const detailOnly = data?.detailUpdateEntityId != null && !data?.revisionPreview;
  if (detailOnly) {
    const svg = svgMountRef.value?.querySelector("svg.live-design-svg");
    if (svg) updateDetails(svg);
    return;
  }
  const affectedEntityIds = new Set(data?.revisionPreview?.affectedEntityIds || []);
  const affectedYears = data?.revisionPreview?.affectedYears || [];
  if (!data?.revisionPreview) {
    yearSnapshotCache.clear();
  } else if (affectedYears.length) {
    const earliest = Math.min(...affectedYears);
    for (const year of yearSnapshotCache.keys()) {
      if (year >= earliest) yearSnapshotCache.delete(year);
    }
  }
  const currentEvolutionIds = new Set([
    ...(evolutionModelCache?.visibleEntityIds || []),
    ...evolutionEntityIds.value,
  ]);
  const evolutionAffected = !data?.revisionPreview
    || [...affectedEntityIds].some((id) => currentEvolutionIds.has(id));
  if (evolutionAffected) {
    evolutionModelCacheKey = "";
    evolutionModelCache = null;
    evolutionLayoutCacheKey = "";
    evolutionLayoutCache = null;
  }
  if (svgMountRef.value) refreshTemplate({ rebindStatic: true, rebindControls: true });
}, { flush: "post" });

function normalizeText(element) {
  return (element.textContent || "").replace(/\s+/g, "").trim();
}

function position(element) {
  const match = /translate\(([-.\d]+)[ ,]([-.\d]+)/.exec(element.getAttribute("transform") || "");
  return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
}

function findTextAt(svg, x, y, tolerance = 1) {
  return [...svg.querySelectorAll("text")].find((element) => {
    const point = position(element);
    return point && Math.abs(point.x - x) <= tolerance && Math.abs(point.y - y) <= tolerance;
  });
}

function setText(element, text) {
  if (!element) return;
  element.replaceChildren(document.createTextNode(text || "暂无资料"));
}

function wrapText(element, text, charsPerLine = 28, lineHeight = 24, maxLines = 7) {
  if (!element) return 0;
  const content = String(text || "暂无资料").replace(/\r\n?/g, "\n").trim();
  const lines = [];
  const closingPunctuation = /[，。；：！？、〉》）】」』]/;
  const paragraphs = content.split("\n");
  paragraphs.forEach((paragraph, paragraphIndex) => {
    if (lines.length >= maxLines) return;
    const normalized = paragraph.replace(/\s+/g, " ").trim();
    if (!normalized) {
      if (paragraphIndex < paragraphs.length - 1 && lines.length < maxLines) lines.push("");
      return;
    }
    let offset = 0;
    while (offset < normalized.length && lines.length < maxLines) {
      let end = Math.min(normalized.length, offset + charsPerLine);
      while (end < normalized.length && closingPunctuation.test(normalized[end])) end += 1;
      let line = normalized.slice(offset, end);
      if (end < normalized.length && lines.length === maxLines - 1) line = `${line.slice(0, -1)}…`;
      lines.push(line);
      offset = end;
    }
    if (paragraphIndex < paragraphs.length - 1 && lines.length < maxLines) lines.push("");
  });
  if (!lines.length) lines.push("暂无资料");
  if (lines.length > maxLines) lines.length = maxLines;
  element.replaceChildren();
  for (const [index, line] of lines.entries()) {
    const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
    tspan.setAttribute("x", "0");
    tspan.setAttribute("y", String(index * lineHeight));
    tspan.textContent = line;
    element.appendChild(tspan);
  }
  return lines.length;
}

function selectLinkedEntity(entityId) {
  const target = entityMap.get(entityId);
  if (!target) return;
  detailPanelScrollOffset = 0;
  inlineCompositionScrollOffset = 0;
  expandedDetailId.value = null;
  inlineDetailOfficialId.value = null;
  selectedId.value = target.id;
  if (isEvolutionCanvasMode()) {
    selectedEvolutionItem.value = null;
    evolutionEntityIds.value = evolutionMode.value === "single"
      ? [target.id]
      : [...new Set([...evolutionEntityIds.value, target.id])].slice(0, 4);
    evolutionLanePage.value = 1;
    refreshTemplate();
    return;
  }
  if (viewMode.value !== "composition") {
    if (target.type === "机构") {
      focusHierarchyContext(target, true);
    } else {
      const affiliation = staffEdgesForView().find((edge) => edge.official === target.id);
      const org = affiliation ? entityMap.get(affiliation.org) : null;
      if (org) focusHierarchyContext(org, true);
    }
  }
  refreshTemplate({ rebindControls: viewMode.value !== "composition" });
}

function renderLinkedTokens(element, tokens, emptyText, charsPerLine = 28, lineHeight = 18) {
  if (!element) return 0;
  const normalized = tokens.length ? tokens : [{ text: emptyText }];
  element.replaceChildren();
  let line = 0;
  let lineLength = 0;
  for (const token of normalized) {
    let remaining = token.text;
    while (remaining) {
      const room = charsPerLine - lineLength;
      if (room <= 0) {
        line += 1;
        lineLength = 0;
        continue;
      }
      const chunk = remaining.slice(0, room);
      remaining = remaining.slice(chunk.length);
      const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
      if (lineLength === 0) {
        tspan.setAttribute("x", "0");
        tspan.setAttribute("y", String(line * lineHeight));
      }
      tspan.textContent = chunk;
      if (token.entityId != null) {
        tspan.dataset.entityId = String(token.entityId);
        tspan.style.cursor = "pointer";
        tspan.style.fill = "#866d6d";
        tspan.style.textDecoration = "underline";
        d3.select(tspan).on("click.detail-entity-link", (event) => {
          event.preventDefault();
          event.stopPropagation();
          selectLinkedEntity(token.entityId);
        });
      }
      element.appendChild(tspan);
      lineLength += chunk.length;
    }
  }
  return line + 1;
}

function wrapVerticalText(element, text, charsPerColumn = 11, maxColumns = 6, columnGap = 9.81) {
  if (!element) return;
  const content = (text || "暂无资料").replace(/\s+/g, " ").trim();
  const columns = [];
  let offset = 0;
  while (offset < content.length && columns.length < maxColumns) {
    const end = Math.min(content.length, offset + charsPerColumn);
    let column = content.slice(offset, end);
    if (end < content.length && columns.length === maxColumns - 1) {
      column = `${column.slice(0, -1)}…`;
    }
    columns.push(column);
    offset = end;
  }
  element.replaceChildren();
  columns.forEach((column, index) => {
    const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
    tspan.setAttribute("x", String(-index * columnGap));
    tspan.setAttribute("y", "0");
    tspan.textContent = column;
    element.appendChild(tspan);
  });
}

function fitVerticalBarLabel(label, fullTitle, rect) {
  if (!label || !rect) return;
  const x = Number(rect.getAttribute("x"));
  const y = Number(rect.getAttribute("y"));
  const width = Number(rect.getAttribute("width"));
  const height = Number(rect.getAttribute("height"));
  if (![x, y, width, height].every(Number.isFinite)) return;
  const maxGlyphs = 12;
  const displayTitle = fullTitle.length > maxGlyphs
    ? `${fullTitle.slice(0, maxGlyphs - 1)}…`
    : fullTitle;
  label.replaceChildren();
  label.removeAttribute("transform");
  label.removeAttribute("text-anchor");
  label.removeAttribute("dominant-baseline");
  label.style.writingMode = "horizontal-tb";
  label.style.textOrientation = "mixed";
  label.setAttribute("text-anchor", "middle");
  // 长名称在加宽的书脊内按传统顺序分成右、左两列，避免靠增加高度换字号。
  const columns = displayTitle.length > 6
    ? [
      displayTitle.slice(0, Math.ceil(displayTitle.length / 2)),
      displayTitle.slice(Math.ceil(displayTitle.length / 2)),
    ]
    : [displayTitle];
  const longestColumn = Math.max(...columns.map((column) => column.length));
  const bodyHeight = height - 34;
  const fontSize = Math.min(
    INLINE_COMPOSITION.titleFontSize,
    bodyHeight / Math.max(1, longestColumn)
  );
  label.style.fontSize = `${fontSize}px`;
  const centerX = x + width / 2;
  const top = y + 7;
  const columnGap = Math.min(width * 0.34, fontSize * 1.08);
  columns.forEach((column, columnIndex) => {
    const columnX = centerX + ((columns.length - 1) / 2 - columnIndex) * columnGap;
    [...column].forEach((character, index) => {
      const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
      tspan.setAttribute("x", String(columnX));
      tspan.setAttribute("y", String(top + fontSize * (index + 0.82)));
      tspan.textContent = character;
      label.appendChild(tspan);
    });
  });
}

function fitQuotaLabel(quota, person, edge, rect) {
  if (!quota || !rect) return;
  const x = Number(rect.getAttribute("x"));
  const y = Number(rect.getAttribute("y"));
  const width = Number(rect.getAttribute("width"));
  const height = Number(rect.getAttribute("height"));
  if (![x, y, width, height].every(Number.isFinite)) return;
  const text = edge.staff_quota ? `（${edge.staff_quota}）` : "未载";
  setText(quota, text);
  quota.removeAttribute("transform");
  quota.style.writingMode = "horizontal-tb";
  quota.setAttribute("text-anchor", "middle");
  quota.removeAttribute("dominant-baseline");
  quota.style.fontSize = `${Math.min(
    INLINE_COMPOSITION.quotaFontSize,
    24 / Math.max(2, text.length)
  )}px`;
  quota.setAttribute("x", String(x + width / 2));
  quota.setAttribute("y", String(y + height - 7));
  if (person) {
    person.style.display = edge.staff_quota ? "" : "none";
    person.removeAttribute("transform");
    person.style.writingMode = "horizontal-tb";
    person.setAttribute("text-anchor", "middle");
    person.style.fontSize = `${INLINE_COMPOSITION.personFontSize}px`;
    person.setAttribute("x", String(x + width / 2));
    person.setAttribute("y", String(y + height - 2));
  }
}

function clearTextWidthConstraint(element) {
  if (!element) return;
  element.removeAttribute("textLength");
  element.removeAttribute("lengthAdjust");
}

function detailHeaderSlots(svg) {
  const title = svg.querySelector("[data-detail-header-title]")
    || findTextAt(svg, 99.85, 505.87);
  const year = svg.querySelector("[data-detail-header-year]")
    || findTextAt(svg, 189.74, 502.91);
  if (title) title.dataset.detailHeaderTitle = "";
  if (year) year.dataset.detailHeaderYear = "";
  return { title, year };
}

function layoutDetailHeader(svg, titleText, yearText) {
  const slots = detailHeaderSlots(svg);
  setText(slots.title, titleText);
  setText(slots.year, yearText);
  clearTextWidthConstraint(slots.title);
  clearTextWidthConstraint(slots.year);
  if (!slots.title || !slots.year) return { ...slots, contentOffsetY: 0 };

  slots.title.setAttribute("transform", "translate(99.85 505.87)");
  slots.year.setAttribute("transform", "translate(189.74 502.91)");
  const layout = detailHeaderLayout({
    titleWidth: slots.title.getComputedTextLength(),
    yearWidth: slots.year.getComputedTextLength(),
  });
  slots.year.setAttribute("transform", `translate(${layout.yearX} ${layout.yearY})`);

  const topRightBorder = svg.querySelector(".detail-panel-group")?.__topRightBorder;
  topRightBorder?.setAttribute(
    "points",
    `229.27 877.67 475.49 877.67 475.49 497.57 ${layout.borderStartX} 497.57`,
  );
  return {
    ...slots,
    contentOffsetY: layout.stacked ? 20 : 0,
  };
}

function intervalOverlapsRange(start, end) {
  const [rangeStart, rangeEnd] = selectedRange.value;
  return start <= rangeEnd && end >= rangeStart;
}

function timepointActive(timepoint) {
  if (timepoint.year_start == null || timepoint.year_end == null) return true;
  return intervalOverlapsRange(timepoint.year_start, timepoint.year_end);
}

function selectedRangeLabel() {
  const [start, end] = selectedRange.value;
  if (start === YEAR_MIN && end === YEAR_MAX) return `宋代历史全貌（${start}—${end}年）`;
  if (start === end) return `公元${start}年制度截面`;
  return `公元${start}—${end}年制度范围`;
}

function activeTimepoints(entityId) {
  if (currentSnapshot.value) {
    const timepoint = currentSnapshot.value.currentTimepointByEntity.get(entityId);
    return timepoint ? [timepoint] : [];
  }
  return (props.data.timepoints[String(entityId)] || []).filter(timepointActive);
}

function entityActive(entityId) {
  if (currentSnapshot.value) return currentSnapshot.value.entityIds.has(entityId);
  const timepoints = props.data.timepoints[String(entityId)] || [];
  return timepoints.length > 0;
}

function hierarchyEdgesForView() {
  return hierarchyEdgeIndexForView().edges;
}

function hierarchyEdgeIndexForView() {
  const sourceEdges = currentSnapshot.value?.hierarchyEdges || props.data.hierarchyEdges || [];
  if (
    hierarchyEdgeIndexCache.sourceEdges !== sourceEdges
    || hierarchyEdgeIndexCache.collectiveIds !== collectiveEntityIds
  ) {
    hierarchyEdgeIndexCache = {
      sourceEdges,
      collectiveIds: collectiveEntityIds,
      index: buildHierarchyEdgeIndex(
        hierarchyEdgesWithoutCollectives(sourceEdges, collectiveEntityIds),
      ),
    };
  }
  return hierarchyEdgeIndexCache.index;
}

function staffEdgesForView() {
  return currentSnapshot.value?.staffEdges || props.data.staffEdges;
}

function staffFor(entityId) {
  return staffEdgesForView().filter((edge) => edge.org === entityId);
}

function childrenFor(entityId) {
  return hierarchyEdgeIndexForView().childrenFor(entityId);
}

function titleOf(entityId) {
  return entityMap.get(entityId)?.title || `#${entityId}`;
}

function compareInstitutionIds(firstId, secondId) {
  return compareInstitutionIdsBySourceOrder(entityMap, firstId, secondId);
}

const CATEGORY_NAMES = ["内廷机构", "中央机构", "路级机构", "州县机构", "军队机构"];
const DESIGN_ASSET_VERSION = encodeURIComponent(__APP_BUILD_ID__);
const versionedDesignAsset = (path) => `${path}?v=${DESIGN_ASSET_VERSION}`;
const HIERARCHY_DESIGN_URL = versionedDesignAsset("/api/design/hierarchy.svg");
const DESIGN_URL_BY_MODE = {
  hierarchy: HIERARCHY_DESIGN_URL,
  composition: versionedDesignAsset("/api/design/composition.svg"),
  evolution: HIERARCHY_DESIGN_URL,
  timetree: HIERARCHY_DESIGN_URL,
  comparison: HIERARCHY_DESIGN_URL,
};

function templateCategoryItems(svg) {
  const sharedItems = [...svg.querySelectorAll(
    ".shared-category-navigation > .shared-category-item"
  )].map((group) => ({
    category: group.dataset.category || "",
    textElement: [...group.children].find(
      (child) => child.tagName.toLowerCase() === "text"
    ),
    group,
  })).filter(({ category, textElement }) => (
    CATEGORY_NAMES.includes(category) && textElement
  ));
  if (sharedItems.length) return sharedItems;

  return [...svg.children]
    .filter((group) => group.tagName.toLowerCase() === "g")
    .map((group) => {
      const textElement = [...group.children].find((child) => (
        child.tagName.toLowerCase() === "text"
        && CATEGORY_NAMES.includes(normalizeText(child))
      ));
      return textElement
        ? { category: normalizeText(textElement), textElement, group }
        : null;
    })
    .filter(Boolean);
}

function prepareSharedCategoryGroup(group, category) {
  [group, ...group.querySelectorAll("[class]")].forEach((element) => {
    element.removeAttribute("class");
  });
  group.classList.add("shared-category-item");
  group.dataset.category = category;

  const label = [...group.children].find(
    (child) => child.tagName.toLowerCase() === "text"
  );
  label?.classList.add("shared-category-label");

  const outline = [...group.children].find(
    (child) => child.tagName.toLowerCase() === "polygon"
  );
  outline?.classList.add("shared-category-outline");

  const selection = [...group.children].find((child) => (
    child.tagName.toLowerCase() === "g" && child.querySelector("polygon")
  ));
  if (selection) {
    selection.classList.add("shared-category-selection");
    selection.querySelector("polygon")?.classList.add("shared-category-selection-shape");
  }
  return group;
}

// 两张设计画板的内容区不同，但顶部品牌标题和朝代标题必须保持同一基准。
// 只同步几何位置，不复制 class：两份 SVG 的 cls 编号各自独立，不能跨画板复用。
function alignCompositionHeader(svg) {
  const hierarchyTemplate = svgCache.get(HIERARCHY_DESIGN_URL);
  if (!hierarchyTemplate) throw new Error("层级视图头部模板未加载");

  const headerTexts = new Set(["中国古代职官体系", "宋朝", "层级视图", "编制视图"]);
  const sourceTexts = [...hierarchyTemplate.querySelectorAll("text")].filter((element) => {
    const point = position(element);
    return point && point.y < 115 && headerTexts.has(normalizeText(element));
  });
  const targetTexts = [...svg.querySelectorAll("text")].filter((element) => {
    const point = position(element);
    return point && point.y < 115 && headerTexts.has(normalizeText(element));
  });

  for (const source of sourceTexts) {
    const target = targetTexts.find((element) => (
      normalizeText(element) === normalizeText(source)
    ));
    if (!target) continue;
    const transform = source.getAttribute("transform");
    if (transform) target.setAttribute("transform", transform);
  }

  // 朝代标题右侧的前后切换箭头也是头部几何的一部分。编制原稿的
  // 两枚箭头仍在旧的宋朝坐标（约 750），不能只移动文字而留下旧图标。
  // 仅复制 d 路径，保留目标 SVG 自己的 class，避免跨画板复用 cls 编号。
  const dynastyControls = (root) => [...root.querySelectorAll("path")]
    .filter((element) => {
      const path = element.getAttribute("d") || "";
      const match = /^M([-\.\d]+),([-\.\d]+)/.exec(path);
      if (!match || path.length > 180) return false;
      const x = Number(match[1]);
      const y = Number(match[2]);
      return x >= 500 && x <= 900 && y >= 70 && y <= 90;
    })
    .sort((left, right) => {
      const leftX = Number(/^M([-\.\d]+)/.exec(left.getAttribute("d") || "")?.[1]);
      const rightX = Number(/^M([-\.\d]+)/.exec(right.getAttribute("d") || "")?.[1]);
      return leftX - rightX;
    });
  const sourceControls = dynastyControls(hierarchyTemplate);
  const targetControls = dynastyControls(svg);
  if (sourceControls.length !== 2 || targetControls.length !== 2) {
    throw new Error("朝代切换符号槽位不完整");
  }
  sourceControls.forEach((source, index) => {
    targetControls[index].setAttribute("d", source.getAttribute("d"));
  });

  // 标题左侧还有一条朝代装饰横线。它与标题、切换符号属于同一组
  // 几何槽位；只移动标题和符号会让编制画板的原稿横线压到“宋朝”文字。
  const dynastyRule = (root) => [...root.querySelectorAll("line")]
    .filter((element) => {
      const x1 = Number(element.getAttribute("x1"));
      const x2 = Number(element.getAttribute("x2"));
      const y1 = Number(element.getAttribute("y1"));
      const y2 = Number(element.getAttribute("y2"));
      return [x1, x2, y1, y2].every(Number.isFinite)
        && Math.abs(y1 - y2) < 0.1
        && y1 >= 70 && y1 <= 90
        && x1 >= 500 && x1 <= 700
        && x2 > x1 && x2 - x1 < 30;
    })
    .sort((left, right) => Number(left.getAttribute("x1")) - Number(right.getAttribute("x1")));
  const sourceRule = dynastyRule(hierarchyTemplate)[0];
  const targetRule = dynastyRule(svg)[0];
  if (!sourceRule || !targetRule) throw new Error("朝代标题装饰横线缺失");
  ["x1", "x2", "y1", "y2"].forEach((attribute) => {
    targetRule.setAttribute(attribute, sourceRule.getAttribute(attribute));
  });

}

// 4-02 原稿把路级四司嵌进分类栏；完整编制画板只需沿用层级画板的
// 五大类导航。直接克隆 4-01 的五个原始 group，避免维护第二套坐标。
function alignCompositionCategoryNavigation(svg) {
  const hierarchyTemplate = svgCache.get(HIERARCHY_DESIGN_URL);
  if (!hierarchyTemplate) throw new Error("层级视图分类栏模板未加载");
  const sourceItems = templateCategoryItems(hierarchyTemplate);
  const targetItems = templateCategoryItems(svg);
  if (sourceItems.length !== CATEGORY_NAMES.length || targetItems.length !== CATEGORY_NAMES.length) {
    throw new Error("机构分类栏槽位不完整");
  }

  const sourceByCategory = new Map(sourceItems.map((item) => [item.category, item]));
  const targetGroups = [...new Set(targetItems.map((item) => item.group))];
  const insertionPoint = targetGroups[0];
  const parent = insertionPoint?.parentNode;
  if (!parent) throw new Error("机构分类栏挂载点缺失");

  const navigation = svgElement("g", { class: "shared-category-navigation" });
  for (const category of CATEGORY_NAMES) {
    const source = sourceByCategory.get(category);
    if (!source) throw new Error(`层级视图缺少${category}槽位`);
    navigation.appendChild(
      prepareSharedCategoryGroup(source.group.cloneNode(true), category)
    );
  }
  parent.insertBefore(navigation, insertionPoint);
  targetGroups.forEach((group) => group.remove());
}

function entityCategory(entity) {
  return entity.category || "中央机构";
}

function templateSelectionCategory() {
  if (viewMode.value !== "composition" || compositionFocusId.value == null) {
    return selectedCategory.value;
  }
  const focus = entityMap.get(compositionFocusId.value);
  if (!focus) return selectedCategory.value;
  const context = resolveHierarchyContext(focus.id, hierarchyEdgesForView(), entityMap);
  return entityCategory(context.root || focus);
}

function focusHierarchyContext(entity, revealPath = false) {
  const context = resolveHierarchyContext(entity.id, hierarchyEdgesForView(), entityMap);
  const root = context.root || entity;
  const category = entityCategory(root);
  selectedCategory.value = category;
  lastExpandedInstitutionGroupId = institutionGroupId(
    category,
    entityInstitutionGroup(root, category)
  );
  expandedInstitutionGroupIds = [lastExpandedInstitutionGroupId];
  if (revealPath) {
    expandedHierarchyPath = context.path.slice(0, -1);
    lastExpandedHierarchyId = expandedHierarchyPath.at(-1) ?? null;
    if (!spaceAwareExpansion.value) expandedSubordinateGroupIds = [];
    for (let index = 0; index < context.path.length - 1; index += 1) {
      const parent = entityMap.get(context.path[index]);
      const child = entityMap.get(context.path[index + 1]);
      const group = subordinateGroupFor(parent?.title, child?.title);
      if (!group) continue;
      const groupId = subordinateGroupId(parent.id, group);
      expandedSubordinateGroupIds = spaceAwareExpansion.value
        ? [...new Set([...expandedSubordinateGroupIds, groupId])]
        : [groupId];
      lastExpandedSubordinateGroupId = groupId;
    }
  }
  return context;
}

function hierarchyRootEntities(category) {
  const hierarchyEdges = hierarchyEdgesForView();
  const childIds = new Set(hierarchyEdges.map((edge) => edge.child));
  return props.data.entities.filter(
    (entity) => entity.type === "机构"
      && !collectiveEntityIds.has(entity.id)
      && entityCategory(entity) === category
      && entityActive(entity.id)
      && !childIds.has(entity.id)
  );
}

function categoryFocus(category) {
  const roots = hierarchyRootEntities(category);
  return [...roots].sort(compareInstitutionsBySourceOrder)[0] || null;
}

function quotaText(edge) {
  const quota = edge.staff_quota ? `${edge.staff_quota}人` : "员额未载";
  return `${titleOf(edge.official)}（${quota}${edge.staff_type ? `，${edge.staff_type}` : ""}）`;
}

const INLINE_DETAIL_FIELDS = [
  { key: "source", label: "出处：" },
  { key: "origin", label: "职源与沿革文本：" },
  { key: "aliases", label: "简称与别名：" },
  { key: "duty", label: "执掌：" },
  { key: "children", label: "下级机构：" },
  { key: "office", label: "衙署：" },
  { key: "composition", label: "编制文本：" },
];
const DETAIL_PANEL_EXTRA_KEYS = ["extra-1", "extra-2", "extra-3"];
const DETAIL_PANEL_SECTION_KEYS = [
  ...INLINE_DETAIL_FIELDS.map((field) => field.key),
  ...DETAIL_PANEL_EXTRA_KEYS,
];

function inlineDetailValues(entity) {
  const dictionary = props.data.dictionary[entity.title] || {};
  const timepoints = activeTimepoints(entity.id);
  const detailTimepoints = (props.data.timepoints[String(entity.id)] || [])
    .filter((timepoint) => Object.keys(timepoint).some((key) => key.startsWith("detail_")))
    .filter((timepoint) => (
      currentSnapshot.value
        ? timepoint.year_start <= selectedRange.value[0]
        : timepointActive(timepoint)
    ))
    .sort((a, b) => a.year_start - b.year_start || a.id - b.id);
  const currentTimepoint = detailTimepoints.at(-1) || timepoints.at(-1) || {};
  const staff = staffFor(entity.id);
  const children = childrenFor(entity.id);
  const events = timepoints
    .map((item) => `${item.time || "时间未明"}：${item.event || item.quotation || "未载事件"}`)
    .join("；");
  const page = dictionary.page || "";
  const source = [
    page ? (page.startsWith("《") ? page : `《宋代官制辞典》第${page}页`) : "",
    dictionary.catalog || "",
    currentTimepoint.detail_source || dictionary.source || "",
  ].filter(Boolean).join("；");
  return {
    source: source || "当前实体未匹配到独立辞典词条。",
    origin: currentTimepoint.detail_origin || dictionary.origin || events || "原文未单列职源与沿革。",
    aliases: dictionary.aliases || "原文未单列简称与别名。",
    duty: currentTimepoint.detail_duty || dictionary.duty || events || dictionary.text || "当前年份未载明确职掌。",
    children: children.length
      ? children.map((edge) => titleOf(edge.child)).join("、")
      : dictionary.children || "当前年份未载明确下级机构。",
    office: currentTimepoint.detail_office || dictionary.office || "原文未单列衙署。",
    composition: currentTimepoint.detail_composition || dictionary.composition
      || (staff.length ? staff.map(quotaText).join("；") : "当前年份未载明确编制。"),
  };
}

function selectedEntity() {
  if (isEvolutionCanvasMode()) {
    const evolutionSelection = entityMap.get(selectedId.value)
      || entityMap.get(evolutionEntityIds.value[0]);
    if (evolutionSelection?.id !== selectedId.value) {
      selectedId.value = evolutionSelection?.id ?? null;
    }
    return evolutionSelection || null;
  }
  const selected = entityMap.get(selectedId.value);
  const activeEntityIds = currentSnapshot.value?.entityIds || null;
  const keepsTransitionContext = selected?.id === changeTrackEntityId.value;
  if (keepsTransitionContext) return selected;
  const fallback = selected && (!activeEntityIds || activeEntityIds.has(selected.id))
    ? null
    : categoryFocus(selectedCategory.value);
  const resolved = resolveVisibleSelection(selected, activeEntityIds, fallback);
  if (resolved?.id !== selectedId.value) selectedId.value = resolved?.id ?? null;
  return resolved;
}

function graphFocusEntity() {
  if (viewMode.value === "composition" && compositionFocusId.value != null) {
    const compositionFocus = entityMap.get(compositionFocusId.value);
    if (compositionFocus?.type === "机构") return compositionFocus;
  }
  const selected = selectedEntity();
  if (selected?.type === "机构") return selected;
  const affiliation = staffEdgesForView().find((edge) => edge.official === selected?.id);
  return affiliation
    ? entityMap.get(affiliation.org)
    : selected || categoryFocus(selectedCategory.value);
}

function hierarchyLevels(rootId, maxDepth) {
  const levels = [[rootId]];
  const visited = new Set([rootId]);
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const next = [];
    for (const parentId of levels[depth - 1]) {
      const children = childrenFor(parentId)
        .map((edge) => edge.child)
        .filter((id) => !visited.has(id))
        .sort(compareInstitutionIds);
      for (const childId of children) {
        visited.add(childId);
        next.push(childId);
      }
    }
    levels.push(next);
  }
  return levels;
}

function hierarchyTreeData(rootId, depth = 0, visiting = new Set()) {
  const entity = entityMap.get(rootId);
  if (!entity || visiting.has(rootId)) return null;
  const nextVisiting = new Set(visiting).add(rootId);
  const allChildren = childrenFor(rootId)
    .map((edge) => edge.child)
    .filter((id) => !nextVisiting.has(id))
    .sort(compareInstitutionIds);
  const shouldExpand = expandedHierarchyPath.includes(rootId);
  const groupedChildren = shouldExpand
    && showVirtualNodes.value
    ? buildSubordinateGroupNodes({
      parent: entity,
      childIds: allChildren,
      entityMap,
      expandedGroupIds: expandedSubordinateGroupIds,
      treeForChild: (id) => hierarchyTreeData(id, depth + 2, nextVisiting),
    })
    : null;
  const shownChildren = shouldExpand ? allChildren : [];
  return {
    id: rootId,
    title: entity.title,
    childCount: allChildren.length,
    hiddenCount: allChildren.length - shownChildren.length,
    children: groupedChildren || shownChildren
      .map((id) => hierarchyTreeData(id, depth + 1, nextVisiting))
      .filter(Boolean),
  };
}

function hierarchyExpansionPath(node) {
  return node.ancestors()
    .reverse()
    .filter((ancestor) => !ancestor.data.isVirtual)
    .map((ancestor) => ancestor.data.id);
}

function hierarchySubtreeIds(rootId) {
  return hierarchyEdgeIndexForView().subtreeIds(rootId);
}

function renderExpansionCandidate() {
  expandedHierarchyPath = expansionAfterLayout({
    candidateIds: expandedHierarchyPath,
  });
  refreshTemplate();
}

function renderInstitutionGroupCandidate() {
  expandedInstitutionGroupIds = institutionGroupsAfterLayout({
    candidateIds: expandedInstitutionGroupIds,
  });
  refreshTemplate();
}

function renderSubordinateGroupCandidate() {
  expandedSubordinateGroupIds = institutionGroupsAfterLayout({
    candidateIds: expandedSubordinateGroupIds,
  });
  refreshTemplate();
}

function categoryForestData(category) {
  const roots = hierarchyRootEntities(category).map((entity) => entity.id);
  const orderedRoots = roots.sort(compareInstitutionIds);
  const availableGroupIds = new Set(orderedRoots.map((entityId) => {
    const entity = entityMap.get(entityId);
    return institutionGroupId(category, entityInstitutionGroup(entity, category));
  }));
  const previousExpandedGroupIds = expandedInstitutionGroupIds;
  expandedInstitutionGroupIds = expandedInstitutionGroupIds.filter((id) => availableGroupIds.has(id));
  if (previousExpandedGroupIds.length && !expandedInstitutionGroupIds.length && orderedRoots.length) {
    const fallback = entityMap.get(orderedRoots[0]);
    lastExpandedInstitutionGroupId = institutionGroupId(
      category,
      entityInstitutionGroup(fallback, category)
    );
    expandedInstitutionGroupIds = [lastExpandedInstitutionGroupId];
  }
  const virtualId = `category:${category}`;
  const showRoots = !collapsedHierarchyIds.has(virtualId);
  const visibleRoots = !showVirtualNodes.value
    ? orderedRoots.map((id) => hierarchyTreeData(id, 1)).filter(Boolean)
    : showRoots
    ? buildInstitutionGroupNodes({
      rootIds: orderedRoots,
      entityMap,
      category,
      groupNames: institutionGroupNames[category] || [],
      expandedGroupIds: expandedInstitutionGroupIds,
      treeForRoot: (id) => hierarchyTreeData(id, 2),
    })
    : [];
  if (showVirtualNodes.value) {
    visibleRoots.forEach((group) => {
      group.memberEntityIds = group.memberEntityIds.flatMap(hierarchySubtreeIds);
    });
  }
  return {
    id: virtualId,
    title: category,
    childCount: orderedRoots.length,
    hiddenCount: showVirtualNodes.value ? orderedRoots.length - visibleRoots.length : 0,
    isVirtual: true,
    // 大类根（中央机构、路级机构等）始终是可见导航节点；关闭开关时
    // 只把它作为真实机构的布局根，隐藏制度组和下属分组这些辅助节点。
    isLayoutRoot: false,
    memberEntityIds: orderedRoots.flatMap(hierarchySubtreeIds),
    children: visibleRoots,
  };
}

function elementBounds(element) {
  try {
    return element.getBBox();
  } catch {
    return null;
  }
}

function fitDynamicNodeLabel(label, fullTitle, polygonBounds) {
  if (!label || !polygonBounds) return;
  const availableLength = polygonBounds.height - 4;
  const maxGlyphs = Math.max(1, Math.floor(availableLength / 17.14));
  const displayTitle = fullTitle.length > maxGlyphs
    ? `${fullTitle.slice(0, maxGlyphs - 1)}…`
    : fullTitle;
  setText(label, displayTitle);
  label.setAttribute("text-anchor", "middle");
  label.setAttribute("dominant-baseline", "central");
  label.setAttribute(
    "transform",
    `translate(${polygonBounds.x + polygonBounds.width / 2} ${polygonBounds.y + polygonBounds.height / 2})`
  );
}

function nodeStructuralChangeSummary(node) {
  if (!timelineSelectionActive.value || selectedRange.value[0] !== selectedRange.value[1]) {
    return null;
  }
  const year = selectedRange.value[0];
  if (!node.data.isVirtual) {
    return changeSummaryForEntity(structuralChangeIndex, node.data.id, year);
  }
  return changeSummaryForEntities(
    structuralChangeIndex,
    node.data.memberEntityIds || [],
    year,
  );
}

function openEntityChangeTrack(entityId, event = null) {
  const entity = entityMap.get(entityId);
  if (!entity || entity.type !== "机构") return;
  event?.preventDefault?.();
  event?.stopPropagation?.();
  selectedId.value = entityId;
  changeTrackEntityId.value = entityId;
  changeTrackGroup.value = null;
  focusedTransition.value = null;
  expandedChangeEvidenceKeys.clear();
  detailPanelScrollOffset = 0;
  pendingDetailSectionKey = "extra-1";
  refreshTemplate();
}

function openGroupChangeTrack(nodeData, event = null) {
  const memberEntityIds = [...new Set(nodeData.memberEntityIds || [])]
    .filter((entityId) => entityMap.get(entityId)?.type === "机构");
  if (!memberEntityIds.length) return;
  event?.preventDefault?.();
  event?.stopPropagation?.();
  changeTrackEntityId.value = null;
  changeTrackGroup.value = {
    id: nodeData.id,
    title: nodeData.title,
    memberEntityIds,
    changes: changesForEntities(structuralChangeIndex, memberEntityIds),
  };
  focusedTransition.value = null;
  expandedChangeEvidenceKeys.clear();
  detailPanelScrollOffset = 0;
  pendingDetailSectionKey = "extra-1";
  refreshTemplate();
}

function appendNodeChangeIndicator(nodeGroup, node, hitBounds) {
  const summary = nodeStructuralChangeSummary(node);
  if (!summary || !summary.total || !hitBounds) return;
  const items = nodeChangeIndicatorItems(summary);
  if (!items.length) return;
  const layout = nodeChangeIndicatorLayout(items);
  const marker = svgElement("g", { class: "node-change-indicator" });
  const centerX = hitBounds.x + hitBounds.width / 2;
  marker.setAttribute(
    "transform",
    `translate(${centerX - layout.width / 2} ${hitBounds.y - layout.height - 2})`,
  );
  marker.setAttribute("aria-label", nodeChangeIndicatorAriaLabel(
    node.data.title,
    summary,
    node.data.isVirtual,
  ));
  marker.setAttribute("role", "button");
  marker.setAttribute("tabindex", "0");
  marker.appendChild(svgElement("rect", {
    class: "node-change-indicator-hit-area",
    x: -4,
    y: -4,
    width: layout.width + 8,
    height: layout.height + 8,
    fill: "transparent",
    "pointer-events": "all",
  }));
  layout.items.forEach((item) => {
    const itemGroup = svgElement("g", {
      class: `node-change-indicator-item is-${item.kind}`,
      transform: `translate(${item.centerX} ${item.centerY})`,
    });
    const surface = svgElement("circle", {
      class: "node-change-indicator-surface",
      cx: 0,
      cy: 0,
      r: item.radius,
    });
    const label = svgElement("text", {
      x: 0,
      y: 0.3,
      "text-anchor": "middle",
      "dominant-baseline": "central",
    });
    label.textContent = item.label;
    const title = svgElement("title");
    title.textContent = item.title;
    itemGroup.append(surface, label, title);
    marker.appendChild(itemGroup);
  });
  const activate = node.data.isVirtual
    ? (event) => openGroupChangeTrack(node.data, event)
    : (event) => openEntityChangeTrack(node.data.id, event);
  marker.style.cursor = "pointer";
  d3.select(marker)
    .on("click.change-indicator", activate)
    .on("keydown.change-indicator", (event) => {
      if (event.key === "Enter" || event.key === " ") activate(event);
    });
  nodeGroup.appendChild(marker);
}

function appendCompositionNodeButton(nodeGroup, {
  className,
  x,
  y,
  ariaLabel,
  titleText,
  onActivate,
}) {
  const buttonSize = 11;
  const button = document.createElementNS(SVG_NS, "g");
  button.classList.add("composition-detail-button", className);
  button.setAttribute("transform", `translate(${x} ${y})`);
  button.setAttribute("role", "button");
  button.setAttribute("tabindex", "0");
  button.setAttribute("aria-label", ariaLabel);
  button.style.cursor = "pointer";

  const hitArea = document.createElementNS(SVG_NS, "rect");
  hitArea.setAttribute("x", "-4");
  hitArea.setAttribute("y", "-4");
  hitArea.setAttribute("width", "19");
  hitArea.setAttribute("height", "19");
  hitArea.setAttribute("fill", "transparent");
  hitArea.setAttribute("pointer-events", "all");

  const surface = document.createElementNS(SVG_NS, "rect");
  surface.classList.add("composition-detail-button-surface");
  surface.setAttribute("width", String(buttonSize));
  surface.setAttribute("height", String(buttonSize));
  surface.setAttribute("rx", "1.5");
  surface.setAttribute("fill", "#563905");
  surface.setAttribute("fill-opacity", "0");
  surface.setAttribute("stroke", "none");

  const bookIcon = document.createElementNS(SVG_NS, "path");
  bookIcon.setAttribute(
    "d",
    "M4 5.5c2.15-.7 4.02-.28 5.5 1.05v8.05C8 13.32 6.15 12.9 4 13.55V5.5Zm11 0c-2.15-.7-4.02-.28-5.5 1.05v8.05c1.5-1.28 3.35-1.7 5.5-1.05V5.5Z"
  );
  bookIcon.setAttribute("fill", "none");
  bookIcon.setAttribute("stroke", "#563905");
  bookIcon.setAttribute("stroke-width", "1.15");
  bookIcon.setAttribute("stroke-linecap", "round");
  bookIcon.setAttribute("stroke-linejoin", "round");
  bookIcon.setAttribute("transform", "scale(0.62)");
  bookIcon.setAttribute("opacity", "0.9");

  const title = document.createElementNS(SVG_NS, "title");
  title.textContent = titleText;
  button.append(hitArea, surface, bookIcon, title);
  d3.select(button)
    .on("pointerdown.composition-action", (event) => event.stopPropagation())
    .on("click.composition-action", onActivate)
    .on("keydown.composition-action", (event) => {
      if (event.key === "Enter" || event.key === " ") onActivate(event);
    })
    .on("mouseenter.composition-action", () => {
      surface.setAttribute("fill-opacity", "0.12");
    })
    .on("mouseleave.composition-action", () => {
      surface.setAttribute("fill-opacity", "0");
    });
  nodeGroup.appendChild(button);
}

const INLINE_DETAIL_BOUNDS = {
  left: 747.3 - 763.56,
  top: 160.96 - 196.11,
  bottom: 287.81 - 196.11,
};
const INLINE_COMPOSITION = {
  spineX: 763.56,
  panelX: 786.04,
  barX: 794.72,
  panelY: 160.96,
  panelHeight: 126.85,
  barY: 169.5,
  barHeight: 110,
  barWidth: 32,
  barPitch: 40,
  titleFontSize: 13.2,
  quotaFontSize: 7.5,
  personFontSize: 8,
  pageXOffset: 37,
  pageWidth: 126,
  pageShift: 134,
  panelRightPadding: 12,
  maxPanelWidth: 330,
  trackY: 284.6,
};
const INLINE_TITLE_POLYGON_BOUNDS = {
  x: 747.3,
  y: 160.96,
  width: 33.22,
  height: 126.85,
};
function displayStaffFor(entityId) {
  const byOfficial = new Map();
  for (const edge of staffFor(entityId)) {
    const official = entityMap.get(edge.official);
    if (!official?.title?.trim() || official.type !== "官职") continue;
    const current = byOfficial.get(edge.official);
    if (!current || (!current.staff_quota && edge.staff_quota)) {
      byOfficial.set(edge.official, edge);
    }
  }
  return [...byOfficial.values()];
}

function inlineCompositionGeometry(entityId) {
  // 一个有效官职实体只生成一根书脊；重复关系和无标题端点不占空槽。
  const staff = displayStaffFor(entityId);
  const selectedIndex = staff.findIndex(
    (edge) => edge.official === inlineDetailOfficialId.value
  );
  const barX = (index) => (
    INLINE_COMPOSITION.barX
    + index * INLINE_COMPOSITION.barPitch
    + (selectedIndex >= 0 && index > selectedIndex ? INLINE_COMPOSITION.pageShift : 0)
  );
  let contentRight = staff.length
    ? barX(staff.length - 1) + INLINE_COMPOSITION.barWidth
    : INLINE_COMPOSITION.panelX + 4;
  if (selectedIndex >= 0) {
    contentRight = Math.max(
      contentRight,
      barX(selectedIndex) + INLINE_COMPOSITION.pageXOffset + INLINE_COMPOSITION.pageWidth
    );
  }
  const totalContentWidth = contentRight + INLINE_COMPOSITION.panelRightPadding
    - INLINE_COMPOSITION.panelX;
  const panelWidth = Math.min(totalContentWidth, INLINE_COMPOSITION.maxPanelWidth);
  const panelRight = INLINE_COMPOSITION.panelX + panelWidth;
  const maxScroll = Math.max(0, totalContentWidth - panelWidth);
  inlineCompositionScrollOffset = clampCompositionScroll(
    inlineCompositionScrollOffset,
    maxScroll
  );
  if (selectedIndex >= 0 && maxScroll > 0) {
    const selectedLeft = barX(selectedIndex) - INLINE_COMPOSITION.panelX;
    const selectedRight = barX(selectedIndex)
      + INLINE_COMPOSITION.pageXOffset
      + INLINE_COMPOSITION.pageWidth
      - INLINE_COMPOSITION.panelX;
    if (selectedLeft < inlineCompositionScrollOffset) {
      inlineCompositionScrollOffset = selectedLeft;
    } else if (selectedRight > inlineCompositionScrollOffset + panelWidth) {
      inlineCompositionScrollOffset = selectedRight - panelWidth;
    }
    inlineCompositionScrollOffset = clampCompositionScroll(
      inlineCompositionScrollOffset,
      maxScroll
    );
  }
  return {
    staff,
    selectedIndex,
    barX,
    panelRight,
    panelWidth,
    totalContentWidth,
    maxScroll,
    scrollOffset: inlineCompositionScrollOffset,
    left: INLINE_DETAIL_BOUNDS.left,
    right: panelRight - INLINE_COMPOSITION.spineX,
  };
}

function renderInlineDetailCard(svg, layer, templateGroup, layout, entity) {
  if (!templateGroup || !layout || !entity) return;
  const card = templateGroup.cloneNode(true);
  card.classList.add("inline-design-detail", "dynamic-tree-node");
  card.dataset.entityId = String(entity.id);
  card.setAttribute("transform", `translate(${layout.x - 763.56} ${layout.y - 196.11})`);

  const titleLabel = findTextAt(card, 763.56, 196.11, 2);
  fitDynamicNodeLabel(titleLabel, entity.title, INLINE_TITLE_POLYGON_BOUNDS);

  const geometry = inlineCompositionGeometry(entity.id);
  const officialGroups = [...card.children].filter(
    (element) => element.tagName.toLowerCase() === "g" && element.querySelector("text.cls-64")
  );
  const officialTemplate = officialGroups.find((group) => (
    Math.abs(Number(group.querySelector("rect.cls-15")?.getAttribute("x")) - INLINE_COMPOSITION.barX) < 0.1
  )) || officialGroups[0];
  const pageGroup = [...card.children].find(
    (element) => element.tagName.toLowerCase() === "g" && element.querySelector("text.cls-66")
  );
  const pageTemplate = pageGroup?.cloneNode(true);
  officialGroups.forEach((group) => group.remove());
  pageGroup?.remove();

  // 设计稿中的七栏摘要在机构详情页重复信息且挤压核心编制视图，整体移除。
  const directoryLabel = [...card.querySelectorAll("text.cls-67")][0];
  directoryLabel?.parentElement?.remove();

  const panelRect = [...card.children].find((element) => (
    element.tagName.toLowerCase() === "rect"
    && Math.abs(Number(element.getAttribute("x")) - INLINE_COMPOSITION.panelX) < 0.1
  ));
  if (panelRect) {
    panelRect.setAttribute("y", String(INLINE_COMPOSITION.panelY));
    panelRect.setAttribute("height", String(INLINE_COMPOSITION.panelHeight));
    panelRect.setAttribute("width", String(geometry.panelRight - INLINE_COMPOSITION.panelX));
  }
  const panelBorder = [...card.children].find((element) => (
    element.tagName.toLowerCase() === "line"
    && Math.abs(Number(element.getAttribute("x1")) - 1075.8) < 0.1
  ));
  if (panelBorder) {
    panelBorder.setAttribute("x1", String(geometry.panelRight + 2.42));
    panelBorder.setAttribute("x2", String(geometry.panelRight + 2.42));
    panelBorder.setAttribute("y1", String(INLINE_COMPOSITION.panelY));
    panelBorder.setAttribute("y2", String(INLINE_COMPOSITION.panelY + INLINE_COMPOSITION.panelHeight));
  }
  const panelTrack = [...card.children].find((element) => (
    element.tagName.toLowerCase() === "rect" && element.classList.contains("cls-79")
  ));
  const panelProgress = [...card.children].find((element) => (
    element.tagName.toLowerCase() === "rect" && element.classList.contains("cls-37")
  ));
  const panelWidth = geometry.panelWidth;

  const clipId = `inline-composition-clip-${entity.id}`;
  const clipPath = document.createElementNS("http://www.w3.org/2000/svg", "clipPath");
  clipPath.id = clipId;
  clipPath.setAttribute("clipPathUnits", "userSpaceOnUse");
  const clipRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  clipRect.setAttribute("x", String(INLINE_COMPOSITION.panelX));
  clipRect.setAttribute("y", String(INLINE_COMPOSITION.panelY));
  clipRect.setAttribute("width", String(panelWidth));
  clipRect.setAttribute("height", String(INLINE_COMPOSITION.panelHeight));
  clipPath.appendChild(clipRect);
  svg.querySelector("defs")?.appendChild(clipPath);
  const compositionViewport = document.createElementNS("http://www.w3.org/2000/svg", "g");
  compositionViewport.classList.add("inline-composition-scroll-viewport");
  compositionViewport.setAttribute("clip-path", `url(#${clipId})`);
  const compositionContent = document.createElementNS("http://www.w3.org/2000/svg", "g");
  compositionContent.classList.add("inline-composition-scroll-content");
  compositionViewport.appendChild(compositionContent);

  const slider = compositionSliderGeometry({
    panelWidth,
    totalContentWidth: geometry.totalContentWidth,
    scrollOffset: geometry.scrollOffset,
    maxScroll: geometry.maxScroll,
  });
  const sliderEnabled = slider.enabled;
  const { thumbWidth, thumbTravel } = slider;
  const updateCompositionScroll = (nextOffset) => {
    inlineCompositionScrollOffset = clampCompositionScroll(nextOffset, geometry.maxScroll);
    compositionContent.setAttribute(
      "transform",
      `translate(${-inlineCompositionScrollOffset} 0)`
    );
    if (panelProgress && sliderEnabled) {
      const thumbX = INLINE_COMPOSITION.panelX
        + compositionSliderGeometry({
          panelWidth,
          totalContentWidth: geometry.totalContentWidth,
          scrollOffset: inlineCompositionScrollOffset,
          maxScroll: geometry.maxScroll,
        }).thumbOffset;
      panelProgress.setAttribute("x", String(thumbX));
    }
  };

  if (panelTrack) {
    panelTrack.removeAttribute("transform");
    panelTrack.setAttribute("x", String(INLINE_COMPOSITION.panelX));
    panelTrack.setAttribute("y", String(INLINE_COMPOSITION.trackY));
    panelTrack.setAttribute("width", String(panelWidth));
    panelTrack.setAttribute("height", "2.77");
    panelTrack.style.display = sliderEnabled ? "" : "none";
  }
  if (panelProgress) {
    panelProgress.removeAttribute("transform");
    panelProgress.setAttribute("y", String(INLINE_COMPOSITION.trackY - 0.7));
    panelProgress.setAttribute("width", String(thumbWidth));
    panelProgress.setAttribute("height", "4.2");
    panelProgress.setAttribute("rx", "2.1");
    panelProgress.style.display = sliderEnabled ? "" : "none";
    panelProgress.style.cursor = sliderEnabled ? "grab" : "default";
  }
  if (sliderEnabled && panelProgress) {
    const sliderHitArea = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    sliderHitArea.classList.add("inline-composition-slider-hit-area");
    sliderHitArea.setAttribute("x", String(INLINE_COMPOSITION.panelX));
    sliderHitArea.setAttribute("y", String(INLINE_COMPOSITION.trackY - 5));
    sliderHitArea.setAttribute("width", String(panelWidth));
    sliderHitArea.setAttribute("height", "12");
    sliderHitArea.setAttribute("fill", "transparent");
    sliderHitArea.style.cursor = "ew-resize";
    card.insertBefore(sliderHitArea, panelProgress);
    d3.select(sliderHitArea).on("click.inline-composition-slider", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const [pointerX] = d3.pointer(event, card);
      const desiredThumbOffset = Math.max(
        0,
        Math.min(thumbTravel, pointerX - INLINE_COMPOSITION.panelX - thumbWidth / 2)
      );
      updateCompositionScroll(desiredThumbOffset / Math.max(1, thumbTravel) * geometry.maxScroll);
    });
  }
  updateCompositionScroll(geometry.scrollOffset);

  const selectedOfficial = geometry.selectedIndex >= 0
    ? entityMap.get(geometry.staff[geometry.selectedIndex].official)
    : null;
  const values = selectedOfficial ? inlineDetailValues(selectedOfficial) : null;
  geometry.staff.forEach((edge, index) => {
    if (!officialTemplate) return;
    const group = officialTemplate.cloneNode(true);
    const label = group.querySelector("text.cls-64");
    const offsetX = geometry.barX(index) - INLINE_COMPOSITION.barX;
    group.setAttribute("transform", `translate(${offsetX} 0)`);
    for (const bar of group.querySelectorAll("rect")) {
      bar.setAttribute("y", String(INLINE_COMPOSITION.barY));
      bar.setAttribute("width", String(INLINE_COMPOSITION.barWidth));
      bar.setAttribute("height", String(INLINE_COMPOSITION.barHeight));
    }
    const officialTitleText = titleOf(edge.official);
    fitVerticalBarLabel(label, officialTitleText, group.querySelector("rect.cls-15"));
    const quota = group.querySelector("text.cls-72");
    const person = group.querySelector("text.cls-74");
    fitQuotaLabel(quota, person, edge, group.querySelector("rect.cls-15"));
    const isSelected = edge.official === inlineDetailOfficialId.value;
    label.style.fill = isSelected ? "#866d6d" : "#351704";
    group.style.cursor = "pointer";
    d3.select(group).on("click.inline-official", (event) => {
      event.preventDefault();
      event.stopPropagation();
      inlineDetailOfficialId.value = isSelected ? null : edge.official;
      inlineDetailField.value = "duty";
      refreshTemplate();
    });
    compositionContent.appendChild(group);
  });

  if (selectedOfficial && pageTemplate && values) {
    const pageX = geometry.barX(geometry.selectedIndex) + INLINE_COMPOSITION.pageXOffset;
    pageTemplate.setAttribute("transform", `translate(${pageX - 812.52} 0)`);
    for (const [index, pageRect] of [...pageTemplate.querySelectorAll("rect")].entries()) {
      pageRect.setAttribute("y", String(INLINE_COMPOSITION.barY + (index ? 4 : 0)));
      pageRect.setAttribute("width", String(INLINE_COMPOSITION.pageWidth));
      pageRect.setAttribute("height", String(INLINE_COMPOSITION.barHeight - (index ? 8 : 0)));
    }
    const description = pageTemplate.querySelector("text.cls-66");
    description.setAttribute(
      "transform",
      `translate(${812.52 + INLINE_COMPOSITION.pageWidth - 12} ${INLINE_COMPOSITION.barY + 10})`
    );
    description.style.fontSize = "9px";
    wrapVerticalText(description, values[inlineDetailField.value], 11, 12, 10.2);
    const descriptionTitle = document.createElementNS("http://www.w3.org/2000/svg", "title");
    descriptionTitle.textContent = `${selectedOfficial.title}：${values[inlineDetailField.value]}`;
    pageTemplate.appendChild(descriptionTitle);
    compositionContent.appendChild(pageTemplate);
  }

  const scrollComposition = (event) => {
    if (!sliderEnabled) return;
    event.preventDefault();
    event.stopPropagation();
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ? event.deltaX
      : event.deltaY;
    updateCompositionScroll(inlineCompositionScrollOffset + delta);
  };
  compositionViewport.addEventListener("wheel", scrollComposition, { passive: false });
  panelRect?.addEventListener("wheel", scrollComposition, { passive: false });
  if (panelProgress && sliderEnabled) {
    d3.select(panelProgress).call(
      d3.drag()
        .on("start", (event) => {
          event.sourceEvent?.stopPropagation();
          panelProgress.style.cursor = "grabbing";
        })
        .on("drag", (event) => {
          updateCompositionScroll(compositionScrollAfterDrag({
            currentOffset: inlineCompositionScrollOffset,
            deltaX: event.dx,
            maxScroll: geometry.maxScroll,
            thumbTravel,
          }));
        })
        .on("end", () => {
          panelProgress.style.cursor = "grab";
        })
    );
  }
  card.appendChild(compositionViewport);

  const cardTitle = document.createElementNS("http://www.w3.org/2000/svg", "title");
  cardTitle.textContent = `${entity.title}：点击官职翻开详情书页，点击机构书脊收起`;
  card.appendChild(cardTitle);
  d3.select(card)
    .on("click.inline-detail", (event) => event.stopPropagation())
    .on("dblclick.inline-detail", (event) => event.stopPropagation());
  if (titleLabel?.parentElement) {
    titleLabel.parentElement.style.cursor = "zoom-out";
    d3.select(titleLabel.parentElement).on("click.inline-detail-close", (event) => {
      event.preventDefault();
      event.stopPropagation();
      expandedDetailId.value = null;
      inlineDetailOfficialId.value = null;
      refreshTemplate();
    });
  }
  layer.appendChild(card);
}

function hierarchyTemplates(svg) {
  if (hierarchyTemplateCache.has(svg)) return hierarchyTemplateCache.get(svg);
  const templateText = findTextAt(svg, 763.56, 196.11, 2);
  const templateGroup = templateText?.parentElement?.cloneNode(true);
  const inlineDetailTemplate = templateText?.parentElement?.parentElement?.cloneNode(true);
  const templatePolygonBounds = elementBounds(templateText?.parentElement?.querySelector("polygon"));
  const emperorText = findTextAt(svg, 1141.69, 153.09, 2);
  const emperorRect = [...svg.querySelectorAll("rect")].find(
    (element) => Math.abs(Number(element.getAttribute("x")) - 1128.61) <= 0.1
      && Math.abs(Number(element.getAttribute("y")) - 133.04) <= 0.1
      && Math.abs(Number(element.getAttribute("width")) - 60.84) <= 0.1
      && Math.abs(Number(element.getAttribute("height")) - 28.23) <= 0.1
  );
  if (!templateGroup || !emperorText || !emperorRect || !templatePolygonBounds) return null;

  // 缓存必须保存脱离画板的不可变模板。原节点随后会被状态绑定调整透明度，
  // 若直接缓存引用，下一次局部重绘会把变淡后的样式复制到虚拟分类标题。
  const emperorTextTemplate = emperorText.cloneNode(true);
  const emperorRectTemplate = emperorRect.cloneNode(true);

  // 原稿的“皇帝”只作为横排分类根的样式模板，不在动态机构树中重复显示。
  emperorText.style.display = "none";
  emperorRect.style.display = "none";

  const centerNodes = [...svg.children].filter((element) => {
    if (["defs", "style", "image"].includes(element.tagName.toLowerCase())) return false;
    const bounds = elementBounds(element);
    return bounds
      && bounds.x >= 480
      && bounds.y >= 130
      && bounds.x + bounds.width <= 1835
      && bounds.y + bounds.height <= 885;
  });
  centerNodes.forEach((element) => {
    element.style.display = "none";
  });

  const templates = {
    templateGroup,
    inlineDetailTemplate,
    templatePolygonBounds,
    emperorText: emperorTextTemplate,
    emperorRect: emperorRectTemplate,
  };
  hierarchyTemplateCache.set(svg, templates);
  return templates;
}

function renderDynamicHierarchy(svg) {
  svg.querySelector(".hierarchy-year-marker")?.remove();
  const templates = hierarchyTemplates(svg);
  if (!templates) return;
  const {
    templateGroup,
    inlineDetailTemplate,
    templatePolygonBounds,
    emperorText,
    emperorRect,
  } = templates;

  const data = categoryForestData(selectedCategory.value);
  if (!data) return;
  const yearMarker = svgElement("g", { class: "hierarchy-year-marker" });
  const yearLabel = formatTimelineSelectionHeader({
    selectionActive: timelineSelectionActive.value,
    range: selectedRange.value,
    rangeLabel: selectedRangeLabel(),
    eras: props.data.meta?.eras,
    reigns: props.data.meta?.emperorReigns,
  });
  // 原稿标题基线为 94.2，42.86px 字号的可见字框中轴约为 78；
  // 使用固定中轴和与原稿文字一致的 central 基线，避免年号贴到上端。
  const headerCenterY = 78;
  const yearText = svgElement("text", {
    class: "cls-49",
    x: 960,
    y: headerCenterY,
    "text-anchor": "middle",
    "dominant-baseline": "central",
  });
  yearText.style.fontSize = "32px";
  setText(yearText, yearLabel);
  yearMarker.appendChild(yearText);
  svg.appendChild(yearMarker);
  const root = d3.hierarchy(data);
  const area = { left: 500, right: 1830, top: 130, bottom: 850 };
  // 变化气泡位于子节点上方；为真实层级之间预留独立空隙，
  // 避免第三层气泡侵入第二层节点的底部区域。
  const depthGap = 150;
  const institutionDepthY = 295;
  const expandedComposition = expandedDetailId.value != null
    ? inlineCompositionGeometry(expandedDetailId.value)
    : null;
  const virtualNodeWidth = (node) => Math.max(
    Number(emperorRect.getAttribute("width")),
    node.data.title.length * 17.14 + 24
  );
  const nodeLeftExtent = (node) => {
    if (node.data.isVirtual) return virtualNodeWidth(node) / 2;
    return expandedDetailId.value === node.data.id
      ? Math.abs(expandedComposition?.left ?? INLINE_DETAIL_BOUNDS.left)
      : 17;
  };
  const nodeRightExtent = (node) => {
    if (node.data.isVirtual) return virtualNodeWidth(node) / 2;
    return expandedDetailId.value === node.data.id
      ? Math.max(17, expandedComposition?.right ?? 17)
      : 17;
  };
  d3.tree()
    .nodeSize([52, depthGap])
    .separation((a, b) => {
      // D3 在同层按“右节点 a、左节点 b”询问间距；详情只向右展开，
      // 因此只把 b 的右宽度和 a 的左宽度计入，不能在左侧镜像留白。
      // 不同下属虚拟组必须形成独立的视觉分区，避免各组总线首尾相接。
      const structuralGap = hierarchyNodeGap(a, b);
      const requiredDistance = nodeRightExtent(b)
        + nodeLeftExtent(a)
        + structuralGap;
      return Math.max(a.parent === b.parent ? 1 : 1.25, requiredDistance / 52);
    })(root);
  const hierarchyNodes = root.descendants();
  const hierarchyLinks = root.links();

  // 制度组是稳定导航层，必须完整铺在中央区域；下方机构树单独按当前组定位。
  // 不能直接用整棵不对称树的坐标，否则展开某组时会把其他制度组推出画布。
  const areaCenterX = (area.left + area.right) / 2;
  const institutionGroupNodes = (root.children || []).filter(
    (node) => node.data.isInstitutionGroup
  );
  const expandedInstitutionGroupIdSet = new Set(expandedInstitutionGroupIds);
  const expandedInstitutionGroupNodes = institutionGroupNodes.filter(
    (node) => expandedInstitutionGroupIdSet.has(node.data.id)
  );
  const institutionGroupRowX = new Map();
  if (institutionGroupNodes.length) {
    const nodeWidths = institutionGroupNodes.map(virtualNodeWidth);
    const availableGap = institutionGroupNodes.length > 1
      ? ((area.right - area.left) - d3.sum(nodeWidths)) / (institutionGroupNodes.length - 1)
      : 22;
    const groupGap = Math.max(12, Math.min(22, availableGap));
    const rowWidth = d3.sum(nodeWidths) + groupGap * (institutionGroupNodes.length - 1);
    let cursorX = areaCenterX - rowWidth / 2;
    for (const [index, node] of institutionGroupNodes.entries()) {
      const width = nodeWidths[index];
      institutionGroupRowX.set(node.data.id, cursorX + width / 2);
      cursorX += width + groupGap;
    }
  }

  // 空间展开保持制度组及各分支的原始相对位置；超宽内容只通过整体平移浏览。
  const expandedBranchCenterX = new Map();
  let focusedBranchNode = null;
  for (const expandedInstitutionGroupNode of expandedInstitutionGroupNodes) {
    let branchCenterX = institutionGroupRowX.get(expandedInstitutionGroupNode.data.id)
      ?? areaCenterX;
    if (expandedInstitutionGroupNode.descendants().length <= 1) {
      expandedBranchCenterX.set(expandedInstitutionGroupNode.data.id, branchCenterX);
      continue;
    }
    const branchNodes = expandedInstitutionGroupNode.descendants().slice(1);
    const anchorId = expansionAnchorId(
      expandedHierarchyPath,
      spaceAwareExpansion.value || expandedInstitutionGroupNodes.length > 1
    );
    const branchFocus = branchNodes.find((node) => node.data.id === anchorId);
    if (branchFocus) focusedBranchNode = branchFocus;
    const minOffset = d3.min(
      branchNodes,
      (node) => node.x - expandedInstitutionGroupNode.x - nodeLeftExtent(node)
    );
    const maxOffset = d3.max(
      branchNodes,
      (node) => node.x - expandedInstitutionGroupNode.x + nodeRightExtent(node)
    );
    const branchWidth = maxOffset - minOffset;
    const viewportWidth = area.right - area.left;
    if (branchFocus) {
      // 展开大机构时让它仍位于所属制度组正下方；超宽的下级树交给视口拖动，
      // 不能为了塞满画布把父节点漂到相邻制度组下面。
      branchCenterX = anchorBranchToGroup(
        branchCenterX,
        expandedInstitutionGroupNode.x,
        branchFocus.x
      );
    } else if (expandedInstitutionGroupNodes.length === 1) {
      branchCenterX = branchWidth <= viewportWidth
        ? Math.max(
          area.left - minOffset,
          Math.min(area.right - maxOffset, branchCenterX)
        )
        : areaCenterX - (minOffset + maxOffset) / 2;
    }
    expandedBranchCenterX.set(expandedInstitutionGroupNode.data.id, branchCenterX);
  }

  const clipId = "dynamic-tree-viewport-clip";
  const clipPath = document.createElementNS("http://www.w3.org/2000/svg", "clipPath");
  clipPath.id = clipId;
  const clipRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  clipRect.setAttribute("x", String(area.left));
  clipRect.setAttribute("y", String(area.top));
  clipRect.setAttribute("width", String(area.right - area.left));
  clipRect.setAttribute("height", String(area.bottom - area.top));
  clipPath.appendChild(clipRect);
  const defs = svg.querySelector("defs");
  defs?.appendChild(clipPath);

  const nodeLabelClipId = "dynamic-tree-node-label-clip";
  const nodeLabelClipPath = document.createElementNS("http://www.w3.org/2000/svg", "clipPath");
  nodeLabelClipPath.id = nodeLabelClipId;
  nodeLabelClipPath.setAttribute("clipPathUnits", "userSpaceOnUse");
  const nodeLabelClipRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  nodeLabelClipRect.setAttribute("x", String(templatePolygonBounds.x + 3));
  nodeLabelClipRect.setAttribute("y", String(templatePolygonBounds.y + 2));
  nodeLabelClipRect.setAttribute("width", String(templatePolygonBounds.width - 6));
  nodeLabelClipRect.setAttribute("height", String(templatePolygonBounds.height - 4));
  nodeLabelClipPath.appendChild(nodeLabelClipRect);
  defs?.appendChild(nodeLabelClipPath);

  const viewport = document.createElementNS("http://www.w3.org/2000/svg", "g");
  viewport.classList.add("dynamic-tree-viewport");
  viewport.setAttribute("clip-path", `url(#${clipId})`);
  const dragSurface = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  dragSurface.setAttribute("x", String(area.left));
  dragSurface.setAttribute("y", String(area.top));
  dragSurface.setAttribute("width", String(area.right - area.left));
  dragSurface.setAttribute("height", String(area.bottom - area.top));
  dragSurface.setAttribute("fill", "transparent");
  dragSurface.style.cursor = "grab";
  viewport.appendChild(dragSurface);

  const layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
  layer.classList.add("dynamic-tree-layer");
  viewport.appendChild(layer);

  const nodeLayout = new Map(hierarchyNodes.map((node) => {
    let x;
    if (node.depth === 0) {
      x = areaCenterX;
    } else if (node.data.isInstitutionGroup) {
      x = institutionGroupRowX.get(node.data.id) ?? areaCenterX;
    } else {
      const institutionGroupAncestor = node.ancestors().find(
        (ancestor) => expandedInstitutionGroupIdSet.has(ancestor.data.id)
      );
      x = institutionGroupAncestor
        ? (expandedBranchCenterX.get(institutionGroupAncestor.data.id) ?? areaCenterX)
        + node.x - institutionGroupAncestor.x
        : areaCenterX + node.x - root.x;
    }
    // 制度组是新增的一层导航，不能再完整占用旧树的一层高度。
    // 一级机构贴近制度组，后续真实上下级仍沿用设计稿的层间距。
    const y = node.depth === 0
      ? 147.15
      : node.depth >= 2
        ? institutionDepthY + (node.depth - 2) * depthGap
        : 221.11 + (node.depth - 1) * depthGap;
    if (node.data.isVirtual) {
      const width = virtualNodeWidth(node);
      const height = Number(emperorRect.getAttribute("height"));
      return [node, { x, y, top: y - height / 2, bottom: y + height / 2, width, height }];
    }
    return [node, {
      x,
      y,
      left: x + (
        expandedDetailId.value === node.data.id
          ? expandedComposition?.left ?? INLINE_DETAIL_BOUNDS.left
          : -17
      ),
      right: x + (
        expandedDetailId.value === node.data.id ? expandedComposition?.right ?? 17 : 17
      ),
      top: y + (
        expandedDetailId.value === node.data.id
          ? INLINE_DETAIL_BOUNDS.top
          : templatePolygonBounds.y - 196.11
      ),
      bottom: y + (
        expandedDetailId.value === node.data.id
          ? INLINE_DETAIL_BOUNDS.bottom
          : templatePolygonBounds.y + templatePolygonBounds.height - 196.11
      ),
    }];
  }));

  // 制度组发生重叠时，按从左到右的方向整体推开。当前制度组以及它右侧的
  // 制度组都继承同一累计位移，标题、后代节点和连线维持各自的相对位置。
  if (institutionGroupNodes.length > 1) {
    const branchRanges = institutionGroupNodes
      .map((institutionGroupNode) => {
        const branchNodes = institutionGroupNode.descendants();
        const bounds = branchNodes
          .map((node) => nodeLayout.get(node))
          .filter(Boolean)
          .map((layout) => ({
            left: layout.left ?? layout.x - (layout.width || 34) / 2,
            right: layout.right ?? layout.x + (layout.width || 34) / 2,
          }));
        if (!bounds.length) return null;
        return {
          id: institutionGroupNode.data.id,
          left: Math.min(...bounds.map((bound) => bound.left)),
          right: Math.max(...bounds.map((bound) => bound.right)),
        };
      })
      .filter(Boolean);
    const packedRanges = pushOverlappingRanges(branchRanges, 24);
    const originalRangeById = new Map(branchRanges.map((range) => [range.id, range]));
    const groupById = new Map(
      institutionGroupNodes.map((node) => [node.data.id, node]),
    );
    const shiftLayout = (layout, delta) => {
      if (!layout || !delta) return;
      layout.x += delta;
      if (layout.left != null) layout.left += delta;
      if (layout.right != null) layout.right += delta;
    };
    for (const packedRange of packedRanges) {
      const originalRange = originalRangeById.get(packedRange.id);
      const group = groupById.get(packedRange.id);
      if (!originalRange || !group) continue;
      const delta = packedRange.left - originalRange.left;
      if (!delta) continue;
      group.descendants().forEach((node) => {
        shiftLayout(nodeLayout.get(node), delta);
      });
    }
  }

  if (!spaceAwareExpansion.value && focusedBranchNode?.children?.length) {
    const descendantLayouts = focusedBranchNode.descendants()
      .slice(1)
      .map((node) => nodeLayout.get(node));
    const descendantLeft = d3.min(
      descendantLayouts,
      (layout) => layout.left ?? layout.x - (layout.width || 34) / 2
    );
    const descendantRight = d3.max(
      descendantLayouts,
      (layout) => layout.right ?? layout.x + (layout.width || 34) / 2
    );
    const descendantShift = fitRangeShift(
      descendantLeft,
      descendantRight,
      area.left + 18,
      area.right - 18
    );
    if (descendantShift) {
      descendantLayouts.forEach((layout) => {
        layout.x += descendantShift;
        if (layout.left != null) layout.left += descendantShift;
        if (layout.right != null) layout.right += descendantShift;
      });
    }
  }

  const horizontalBounds = [...nodeLayout.values()].map((layout) => ({
    left: layout.left ?? layout.x - (layout.width || 34) / 2,
    right: layout.right ?? layout.x + (layout.width || 34) / 2,
  }));
  const contentLeft = d3.min(horizontalBounds, (bounds) => bounds.left) ?? area.left;
  const contentRight = d3.max(horizontalBounds, (bounds) => bounds.right) ?? area.right;
  const contentWidth = contentRight - contentLeft;
  const viewportWidth = area.right - area.left;
  const minPan = contentWidth <= viewportWidth ? 0 : area.right - contentRight;
  const maxPan = contentWidth <= viewportWidth ? 0 : area.left - contentLeft;
  const contentTop = d3.min([...nodeLayout.values()], (layout) => layout.top) ?? area.top;
  const contentBottom = d3.max([...nodeLayout.values()], (layout) => layout.bottom) ?? area.bottom;
  const contentHeight = contentBottom - contentTop;
  const viewportHeight = area.bottom - area.top;
  const minPanY = contentHeight <= viewportHeight ? 0 : area.bottom - contentBottom;
  const maxPanY = contentHeight <= viewportHeight ? 0 : area.top - contentTop;
  const panControls = document.createElementNS("http://www.w3.org/2000/svg", "g");
  panControls.classList.add("dynamic-tree-pan-controls");
  viewport.appendChild(panControls);
  const makePanRect = (className, attributes) => {
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.classList.add(className, "dynamic-tree-scroll-control");
    Object.entries(attributes).forEach(([name, value]) => rect.setAttribute(name, String(value)));
    panControls.appendChild(rect);
    return rect;
  };
  let horizontalTrack = null;
  let horizontalThumb = null;
  let horizontalHitArea = null;
  if (contentWidth > viewportWidth) {
    horizontalHitArea = makePanRect("dynamic-tree-scroll-hit-horizontal", {
      x: area.left,
      y: area.bottom - 13,
      width: viewportWidth,
      height: 13,
      fill: "transparent",
    });
    horizontalTrack = makePanRect("dynamic-tree-scroll-track-horizontal", {
      x: area.left,
      y: area.bottom - 6,
      width: viewportWidth,
      height: 1.5,
      rx: 0.75,
      fill: "#563905",
      opacity: 0.2,
    });
    horizontalTrack.style.pointerEvents = "none";
    horizontalThumb = makePanRect("dynamic-tree-scroll-thumb-horizontal", {
      x: area.left,
      y: area.bottom - 7.4,
      width: 42,
      height: 4.2,
      rx: 2.1,
      fill: "#563905",
      opacity: 0.7,
    });
    horizontalHitArea.style.cursor = "ew-resize";
    horizontalThumb.style.cursor = "grab";
  }
  let verticalTrack = null;
  let verticalThumb = null;
  let verticalHitArea = null;
  if (contentHeight > viewportHeight) {
    verticalHitArea = makePanRect("dynamic-tree-scroll-hit-vertical", {
      x: area.right - 13,
      y: area.top,
      width: 13,
      height: viewportHeight,
      fill: "transparent",
    });
    verticalTrack = makePanRect("dynamic-tree-scroll-track-vertical", {
      x: area.right - 6,
      y: area.top,
      width: 1.5,
      height: viewportHeight,
      rx: 0.75,
      fill: "#563905",
      opacity: 0.2,
    });
    verticalTrack.style.pointerEvents = "none";
    verticalThumb = makePanRect("dynamic-tree-scroll-thumb-vertical", {
      x: area.right - 7.4,
      y: area.top,
      width: 4.2,
      height: 42,
      rx: 2.1,
      fill: "#563905",
      opacity: 0.7,
    });
    verticalHitArea.style.cursor = "ns-resize";
    verticalThumb.style.cursor = "grab";
  }
  const updatePanControls = () => {
    if (horizontalThumb) {
      const geometry = panScrollbarGeometry({
        viewportSize: viewportWidth,
        contentSize: contentWidth,
        minPan,
        maxPan,
        currentPan: hierarchyPanX,
      });
      horizontalThumb.setAttribute("x", String(area.left + geometry.thumbOffset));
      horizontalThumb.setAttribute("width", String(geometry.thumbSize));
    }
    if (verticalThumb) {
      const geometry = panScrollbarGeometry({
        viewportSize: viewportHeight,
        contentSize: contentHeight,
        minPan: minPanY,
        maxPan: maxPanY,
        currentPan: hierarchyPanY,
      });
      verticalThumb.setAttribute("y", String(area.top + geometry.thumbOffset));
      verticalThumb.setAttribute("height", String(geometry.thumbSize));
    }
  };
  const applyHierarchyPan = (nextPanX, nextPanY = hierarchyPanY) => {
    // 切年过渡必须沿用切换前的画布偏移。新年份的内容范围不同，
    // 如果此处立即按新范围 clamp，会在正式节点生成的瞬间把整棵树
    // 向上/向下推一段距离，过渡层随后只能表现为“最后一帧跳动”。
    // 过渡结束后 hierarchyPanTransitionOverride 已清空，用户拖拽和
    // 滚轮仍然走正常边界裁剪。
    if (hierarchyPanTransitionOverride) {
      hierarchyPanX = nextPanX;
      hierarchyPanY = nextPanY;
    } else {
      hierarchyPanX = Math.max(minPan, Math.min(maxPan, nextPanX));
      hierarchyPanY = Math.max(minPanY, Math.min(maxPanY, nextPanY));
    }
    layer.setAttribute("transform", `translate(${hierarchyPanX} ${hierarchyPanY})`);
    updatePanControls();
  };
  if (horizontalHitArea && horizontalThumb) {
    d3.select(horizontalHitArea).on("click.tree-scroll", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const geometry = panScrollbarGeometry({
        viewportSize: viewportWidth,
        contentSize: contentWidth,
        minPan,
        maxPan,
        currentPan: hierarchyPanX,
      });
      const [pointerX] = d3.pointer(event, viewport);
      const offset = pointerX - area.left - geometry.thumbSize / 2;
      applyHierarchyPan(
        panFromScrollbarOffset(offset, geometry.thumbTravel, minPan, maxPan),
        hierarchyPanY
      );
    });
    d3.select(horizontalThumb).call(
      d3.drag()
        .on("start", (event) => {
          event.sourceEvent?.stopPropagation();
          horizontalThumb.style.cursor = "grabbing";
        })
        .on("drag", (event) => {
          const geometry = panScrollbarGeometry({
            viewportSize: viewportWidth,
            contentSize: contentWidth,
            minPan,
            maxPan,
            currentPan: hierarchyPanX,
          });
          applyHierarchyPan(
            panFromScrollbarOffset(
              geometry.thumbOffset + event.dx,
              geometry.thumbTravel,
              minPan,
              maxPan
            ),
            hierarchyPanY
          );
        })
        .on("end", () => {
          horizontalThumb.style.cursor = "grab";
        })
    );
  }
  if (verticalHitArea && verticalThumb) {
    d3.select(verticalHitArea).on("click.tree-scroll", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const geometry = panScrollbarGeometry({
        viewportSize: viewportHeight,
        contentSize: contentHeight,
        minPan: minPanY,
        maxPan: maxPanY,
        currentPan: hierarchyPanY,
      });
      const [, pointerY] = d3.pointer(event, viewport);
      const offset = pointerY - area.top - geometry.thumbSize / 2;
      applyHierarchyPan(
        hierarchyPanX,
        panFromScrollbarOffset(offset, geometry.thumbTravel, minPanY, maxPanY)
      );
    });
    d3.select(verticalThumb).call(
      d3.drag()
        .on("start", (event) => {
          event.sourceEvent?.stopPropagation();
          verticalThumb.style.cursor = "grabbing";
        })
        .on("drag", (event) => {
          const geometry = panScrollbarGeometry({
            viewportSize: viewportHeight,
            contentSize: contentHeight,
            minPan: minPanY,
            maxPan: maxPanY,
            currentPan: hierarchyPanY,
          });
          applyHierarchyPan(
            hierarchyPanX,
            panFromScrollbarOffset(
              geometry.thumbOffset + event.dy,
              geometry.thumbTravel,
              minPanY,
              maxPanY
            )
          );
        })
        .on("end", () => {
          verticalThumb.style.cursor = "grab";
        })
    );
  }
  const panOverride = hierarchyPanTransitionOverride;
  let nextPanX = panOverride?.x ?? hierarchyPanX;
  let nextPanY = panOverride?.y ?? hierarchyPanY;
  if (!panOverride && hierarchyPanFocusId != null) {
    const focusNode = hierarchyNodes.find((node) => (
      node.data.id === hierarchyPanFocusId
    ));
    if (focusNode) {
      const focusLayout = nodeLayout.get(focusNode);
      if (focusLayout) {
        nextPanX = focusPanToCenter(
          focusLayout.x,
          (area.left + area.right) / 2,
          minPan,
          maxPan,
        );
      }
    }
    hierarchyPanFocusId = null;
  }
  const expandedLayout = nodeLayout.get(
    hierarchyNodes.find((node) => (
      !node.data.isVirtual && node.data.id === expandedDetailId.value
    ))
  );
  if (expandedLayout && !panOverride) {
    const detailLeft = expandedLayout.left + nextPanX;
    const detailRight = expandedLayout.right + nextPanX;
    const detailTop = expandedLayout.top + nextPanY;
    const detailBottom = expandedLayout.bottom + nextPanY;
    if (detailLeft < area.left) nextPanX += area.left - detailLeft;
    if (detailRight > area.right) nextPanX -= detailRight - area.right;
    if (detailTop < area.top) nextPanY += area.top - detailTop;
    if (detailBottom > area.bottom) nextPanY -= detailBottom - area.bottom;
  }
  applyHierarchyPan(nextPanX, nextPanY);

  d3.select(viewport)
    .call(d3.drag()
      .filter((event) => (
        !event.target.closest?.(".dynamic-tree-node")
        && !event.target.closest?.(".dynamic-tree-scroll-control")
      ))
      .on("start", () => {
        dragSurface.style.cursor = "grabbing";
      })
      .on("drag", (event) => {
        applyHierarchyPan(hierarchyPanX + event.dx, hierarchyPanY + event.dy);
      })
      .on("end", () => {
        dragSurface.style.cursor = "grab";
      }))
    .on("wheel.tree-pan", (event) => {
      const horizontalGesture = isHorizontalWheelGesture(event);
      if (horizontalGesture) {
        event.preventDefault();
        event.stopPropagation();
      }
      if (event.ctrlKey) return;
      if (contentWidth <= viewportWidth && contentHeight <= viewportHeight) return;
      event.preventDefault();
      event.stopPropagation();
      if (contentHeight > viewportHeight && !event.shiftKey && Math.abs(event.deltaY) >= Math.abs(event.deltaX)) {
        applyHierarchyPan(hierarchyPanX, hierarchyPanY - event.deltaY);
      } else {
        const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
        applyHierarchyPan(hierarchyPanX - delta, hierarchyPanY);
      }
    }, { passive: false });

  const appendLink = (points, endpoints = null) => {
    const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    polyline.setAttribute("class", "cls-26 dynamic-tree-link");
    polyline.setAttribute("points", points);
    if (endpoints) {
      polyline.dataset.sourceEntityId = String(endpoints.sourceId);
      polyline.dataset.targetEntityId = String(endpoints.targetId);
    }
    polyline.style.pointerEvents = "none";
    layer.appendChild(polyline);
  };

  // 每个虚拟节点使用独立横向总线，虚拟分组不冒充数据库中的历史层级边。
  const virtualParents = hierarchyNodes.filter((node) => (
    node.data.isVirtual && !node.data.isLayoutRoot && node.children?.length
  ));
  for (const virtualParent of virtualParents) {
    const source = nodeLayout.get(virtualParent);
    const targets = virtualParent.children.map((child) => nodeLayout.get(child));
    const targetTop = Math.min(...targets.map((target) => target.top));
    const busY = virtualBusY(source.bottom, targetTop, virtualParent.depth);
    const [busLeft, busRight] = virtualBusRange(
      source.x,
      targets.map((target) => target.x)
    );
    appendLink(`${source.x},${source.bottom} ${source.x},${busY}`);
    appendLink(`${busLeft},${busY} ${busRight},${busY}`);
    targets.forEach((target) => {
      appendLink(`${target.x},${busY} ${target.x},${target.top}`);
    });
  }

  // 更深层级严格从父节点外框底边连到子节点外框顶边。
  for (const link of hierarchyLinks.filter((item) => !item.source.data.isVirtual)) {
    const source = nodeLayout.get(link.source);
    const target = nodeLayout.get(link.target);
    const middleY = (source.bottom + target.top) / 2;
    appendLink(
      `${source.x},${source.bottom} ${source.x},${middleY} ${target.x},${middleY} ${target.x},${target.top}`,
      { sourceId: link.source.data.id, targetId: link.target.data.id },
    );
  }

  let expandedDetailNode = null;
  for (const node of hierarchyNodes) {
    if (node.data.isLayoutRoot) continue;
    const layout = nodeLayout.get(node);
    const nodeGroup = node.data.isVirtual
      ? document.createElementNS("http://www.w3.org/2000/svg", "g")
      : templateGroup.cloneNode(true);
    nodeGroup.classList.add("dynamic-tree-node");
    nodeGroup.setAttribute("role", "button");
    nodeGroup.setAttribute("tabindex", "0");
    if (!node.data.isVirtual) nodeGroup.dataset.entityId = String(node.data.id);
    if (node.data.isVirtual) {
      nodeGroup.dataset.virtualRole = node.data.isInstitutionGroup
        ? "institution-group"
        : node.data.isSubordinateGroup
          ? "subordinate-group"
          : "category-root";
      nodeGroup.setAttribute("aria-label", `${node.data.title}，${node.data.childCount}项`);
      const rootRect = emperorRect.cloneNode(true);
      rootRect.style.removeProperty("display");
      rootRect.setAttribute("x", String(-layout.width / 2));
      rootRect.setAttribute("y", String(-layout.height / 2));
      rootRect.setAttribute("width", String(layout.width));
      rootRect.setAttribute("height", String(layout.height));
      rootRect.removeAttribute("opacity");
      rootRect.style.removeProperty("opacity");
      const rootLabel = emperorText.cloneNode(true);
      rootLabel.style.removeProperty("display");
      rootLabel.removeAttribute("opacity");
      rootLabel.style.removeProperty("opacity");
      rootLabel.removeAttribute("transform");
      rootLabel.setAttribute("x", "0");
      rootLabel.setAttribute("y", "0");
      rootLabel.setAttribute("text-anchor", "middle");
      rootLabel.setAttribute("dominant-baseline", "central");
      setText(rootLabel, node.data.title);
      if (node.data.isInstitutionGroup) rootRect.setAttribute("opacity", "0.82");
      nodeGroup.append(rootRect, rootLabel);
      nodeGroup.setAttribute("transform", `translate(${layout.x} ${layout.y})`);
    } else {
      nodeGroup.setAttribute("transform", `translate(${layout.x - 763.56} ${layout.y - 196.11})`);
    }
    const label = nodeGroup.querySelector("text");
    const hiddenCount = node.data.hiddenCount || 0;
    if (!node.data.isVirtual) setText(label, node.data.title);
    if (label && !node.data.isVirtual) label.dataset.entityId = String(node.data.id);
    const isExpanded = node.data.isInstitutionGroup
      ? expandedInstitutionGroupIds.includes(node.data.id)
      : node.data.isSubordinateGroup
        ? expandedSubordinateGroupIds.includes(node.data.id)
        : node.data.isVirtual
          ? !collapsedHierarchyIds.has(node.data.id)
          : expandedHierarchyPath.includes(node.data.id);
    if (!node.data.isVirtual && node.data.id !== selectedId.value && !isExpanded) {
      nodeGroup.querySelector("g.cls-81")?.remove();
    }
    layer.appendChild(nodeGroup);

    const polygonBounds = node.data.isVirtual ? null : templatePolygonBounds;
    const hitBounds = node.data.isVirtual
      ? { x: -layout.width / 2, y: -layout.height / 2, width: layout.width, height: layout.height }
      : polygonBounds;
    if (hitBounds) {
      const hitArea = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      hitArea.classList.add("dynamic-tree-node-hit-area");
      hitArea.setAttribute("x", String(hitBounds.x));
      hitArea.setAttribute("y", String(hitBounds.y));
      hitArea.setAttribute("width", String(hitBounds.width));
      hitArea.setAttribute("height", String(hitBounds.height));
      hitArea.setAttribute("fill", "transparent");
      hitArea.setAttribute("pointer-events", "all");
      hitArea.setAttribute("aria-hidden", "true");
      nodeGroup.insertBefore(hitArea, nodeGroup.firstChild);
    }
    if (!node.data.isVirtual) fitDynamicNodeLabel(label, node.data.title, polygonBounds);
    if (!node.data.isVirtual && expandedDetailId.value === node.data.id) {
      // 详情 SVG 自带同一根书脊，隐藏基础节点以免两层描边和文字叠在一起。
      nodeGroup.style.visibility = "hidden";
    }
    if (label && polygonBounds) {
      const labelClipGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
      labelClipGroup.setAttribute("clip-path", `url(#${nodeLabelClipId})`);
      label.parentNode.insertBefore(labelClipGroup, label);
      labelClipGroup.appendChild(label);
    }
    if (!node.data.isVirtual && polygonBounds && hiddenCount > 0) {
      const bounds = polygonBounds;
      const entryReserve = node.data.id === selectedId.value ? 14 : 0;
      const barCount = Math.min(5, Math.max(1, Math.ceil(Math.log2(hiddenCount + 1))));
      for (let index = 0; index < barCount; index += 1) {
        const bar = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        bar.setAttribute("x", String(bounds.x + 1));
        bar.setAttribute("y", String(bounds.y + bounds.height - 4 - index * 3));
        bar.setAttribute("width", String(bounds.width - 2 - entryReserve));
        bar.setAttribute("height", "1.8");
        bar.setAttribute("fill", "#563905");
        bar.setAttribute("opacity", ".55");
        nodeGroup.appendChild(bar);
      }
    }
    appendNodeChangeIndicator(nodeGroup, node, hitBounds);

    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    const interactionHint = node.data.childCount
      ? (isExpanded ? "；再次点击收起下级机构" : "；点击展开下级机构")
      : "";
    const detailHint = node.data.isVirtual
      ? ""
      : "；右上角开书按钮就地展开编制关系，选中后点击右下角按钮进入编制视图";
    title.textContent = hiddenCount
      ? `${node.data.title}；尚有 ${hiddenCount} 个下级机构未展开${interactionHint}${detailHint}`
      : `${node.data.title}${interactionHint}${detailHint}`;
    nodeGroup.appendChild(title);
    if (!node.data.isVirtual) nodeGroup.setAttribute("aria-label", title.textContent);

    nodeGroup.style.cursor = "pointer";
    if (!node.data.isVirtual && expandedDetailId.value === node.data.id) expandedDetailNode = node;

    if (compositionDetailButtonVisible({
      isVirtual: node.data.isVirtual,
      isExpanded,
      isSelected: node.data.id === selectedId.value,
      isDetailOpen: expandedDetailId.value === node.data.id,
    }) && polygonBounds) {
      const buttonSize = 11;
      const buttonX = polygonBounds.x + polygonBounds.width - buttonSize - 3;
      appendCompositionNodeButton(nodeGroup, {
        className: "inline-composition-button",
        x: buttonX,
        y: polygonBounds.y + 3,
        ariaLabel: `展开${node.data.title}的编制关系`,
        titleText: "就地展开编制关系",
        onActivate: (event) => {
          event.preventDefault();
          event.stopPropagation();
          detailPanelScrollOffset = 0;
          inlineDetailField.value = "duty";
          inlineCompositionScrollOffset = 0;
          expandedDetailId.value = node.data.id;
          inlineDetailOfficialId.value = null;
          refreshTemplate();
        },
      });
    }

    if (compositionViewButtonVisible({
      isVirtual: node.data.isVirtual,
      isSelected: node.data.id === selectedId.value,
    }) && polygonBounds) {
      const buttonSize = 11;
      appendCompositionNodeButton(nodeGroup, {
        className: "composition-view-button",
        x: polygonBounds.x + polygonBounds.width - buttonSize - 3,
        y: polygonBounds.y + polygonBounds.height - buttonSize - 3,
        ariaLabel: `进入${node.data.title}的编制视图`,
        titleText: "进入编制视图",
        onActivate: (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (viewModeLocked.value) return;
          detailPanelScrollOffset = 0;
          inlineDetailField.value = "duty";
          inlineCompositionScrollOffset = 0;
          expandedDetailId.value = null;
          inlineDetailOfficialId.value = null;
          selectedId.value = node.data.id;
          compositionFocusId.value = node.data.id;
          viewMode.value = "composition";
        },
      });
    }

    const toggleVirtualNode = (event) => {
      event.preventDefault();
      event.stopPropagation();
      hierarchyReturnNotice.value = null;
      changeTrackGroup.value = null;
      hierarchyPanFocusId = node.data.id;
      if (node.data.isSubordinateGroup) {
        const wasExpanded = expandedSubordinateGroupIds.includes(node.data.id);
        expandedSubordinateGroupIds = toggleInstitutionGroupIds(
          expandedSubordinateGroupIds,
          node.data.id,
          spaceAwareExpansion.value
        );
        if (!wasExpanded) lastExpandedSubordinateGroupId = node.data.id;
        if (!wasExpanded) {
          renderSubordinateGroupCandidate();
          return;
        }
      } else if (node.data.isInstitutionGroup) {
        const wasExpanded = expandedInstitutionGroupIds.includes(node.data.id);
        expandedInstitutionGroupIds = toggleInstitutionGroupIds(
          expandedInstitutionGroupIds,
          node.data.id,
          spaceAwareExpansion.value
        );
        if (!wasExpanded) lastExpandedInstitutionGroupId = node.data.id;
        expandedHierarchyPath = hierarchyPathAfterInstitutionGroupToggle(
          expandedHierarchyPath,
          spaceAwareExpansion.value,
        );
        if (!spaceAwareExpansion.value) lastExpandedHierarchyId = null;
        if (!wasExpanded) {
          renderInstitutionGroupCandidate();
          return;
        }
      } else if (collapsedHierarchyIds.has(node.data.id)) {
        collapsedHierarchyIds.delete(node.data.id);
      } else {
        collapsedHierarchyIds.add(node.data.id);
        expandedHierarchyPath = [];
        lastExpandedHierarchyId = null;
      }
      refreshTemplate();
    };
    const nodeSelection = d3.select(nodeGroup)
      .on("click.dynamic-tree", (event) => {
        if (node.data.isVirtual) {
          toggleVirtualNode(event);
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        hierarchyReturnNotice.value = null;
        detailPanelScrollOffset = 0;
        inlineCompositionScrollOffset = 0;
        hierarchyPanFocusId = node.data.id;
        changeTrackGroup.value = null;
        expandedDetailId.value = null;
        inlineDetailOfficialId.value = null;
        selectedId.value = node.data.id;
        if (node.data.childCount) {
          const expandedIndex = expandedHierarchyPath.indexOf(node.data.id);
          if (expandedIndex >= 0) {
            expandedHierarchyPath = removeExpandedSubtree(
              expandedHierarchyPath,
              hierarchySubtreeIds(node.data.id)
            );
            lastExpandedHierarchyId = expandedHierarchyPath.at(-1) ?? null;
          } else {
            const fallbackPath = hierarchyExpansionPath(node);
            expandedHierarchyPath = mergeExpansionPaths(
              expandedHierarchyPath,
              fallbackPath,
              spaceAwareExpansion.value
            );
            lastExpandedHierarchyId = node.data.id;
            renderExpansionCandidate();
            return;
          }
        }
        refreshTemplate();
      });
    nodeSelection.on("keydown.dynamic-tree", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (node.data.isVirtual) {
        toggleVirtualNode(event);
      } else {
        event.preventDefault();
        event.stopPropagation();
        nodeGroup.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }
    });
  }

  if (expandedDetailNode) {
    renderInlineDetailCard(
      svg,
      layer,
      inlineDetailTemplate,
      nodeLayout.get(expandedDetailNode),
      entityMap.get(expandedDetailNode.data.id)
    );
  }
  svg.appendChild(viewport);
}

function ensureGlobalUndoControl(svg) {
  let control = svg.querySelector(".global-undo-control");
  if (!control) {
    control = svgElement("g", {
      class: "global-undo-control",
      "pointer-events": "all",
    });
    // 可见边框很小，不能把它本身当作唯一点击区域；用独立透明层承接点击，
    // 避免点击落到底层 SVG 画板。
    const hitArea = svgElement("rect", {
      class: "global-undo-hit-area",
      x: 1828,
      y: 75,
      width: 39,
      height: 36,
      rx: 3,
      fill: "transparent",
      "pointer-events": "all",
    });
    const surface = svgElement("rect", {
      class: "global-undo-surface",
      x: 1833.53,
      y: 79.99,
      width: 28,
      height: 25.96,
      rx: 2.74,
      ry: 2.74,
      fill: "#fff",
      "fill-opacity": 0,
      stroke: "#563905",
      "stroke-width": 0.78,
      "stroke-opacity": 0.42,
    });
    const label = svgElement("text", {
      class: "cls-49",
      x: 1847.53,
      y: 98.84,
      "text-anchor": "middle",
    });
    label.style.fontFamily = "Arial, sans-serif";
    label.style.fontSize = "17px";
    setText(label, "↶");
    control.append(hitArea, surface, label);
    svg.appendChild(control);
  }
  const active = props.globalUndoAvailable;
  const surface = control.querySelector(".global-undo-surface");
  const label = control.querySelector("text");
  surface?.setAttribute("fill-opacity", active ? "0.16" : "0");
  surface?.setAttribute("stroke-opacity", active ? "0.8" : "0.42");
  if (label) label.style.opacity = active ? "1" : "0.34";
  control.setAttribute("role", "button");
  control.setAttribute("tabindex", active ? "0" : "-1");
  control.setAttribute("aria-label", "撤回上一步界面操作");
  control.setAttribute("aria-disabled", active ? "false" : "true");
  control.style.cursor = active ? "pointer" : "default";
  control.style.pointerEvents = active ? "all" : "none";
  const activate = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (active) emit("global-undo");
  };
  d3.select(control)
    .on("click.global-undo", active ? activate : null)
    .on("keydown.global-undo", active ? (event) => {
      if (event.key === "Enter" || event.key === " ") activate(event);
    } : null);
  // 把按钮放到 SVG 最上层，避免动态层或原稿元素覆盖透明命中区。
  svg.appendChild(control);
}

function assignSlots(slots, entityIds) {
  const ordered = [...slots].sort((a, b) => {
    const pa = position(a);
    const pb = position(b);
    return pa.x - pb.x || pa.y - pb.y;
  });
  ordered.forEach((slot, index) => {
    const entityId = entityIds[index];
    if (entityId == null) {
      slot.style.opacity = "0";
      slot.removeAttribute("data-entity-id");
      return;
    }
    const title = titleOf(entityId);
    slot.style.opacity = "1";
    slot.dataset.entityId = String(entityId);
    setText(slot, title.length > 13 ? `${title.slice(0, 12)}…` : title);
  });
}

function populateHierarchyCenter(svg) {
  const focus = graphFocusEntity();
  if (!focus) return;
  const texts = [...svg.querySelectorAll("text")];
  const rootSlot = findTextAt(svg, 763.56, 196.11, 2);
  const buckets = [
    rootSlot ? [rootSlot] : [],
    texts.filter((element) => {
      const point = position(element);
      return point && point.x > 480 && point.y >= 300 && point.y < 400 && element.getAttribute("class") === "cls-56";
    }),
    texts.filter((element) => {
      const point = position(element);
      return point && point.x > 480 && point.y >= 430 && point.y < 550 && ["cls-48", "cls-56"].includes(element.getAttribute("class"));
    }),
    texts.filter((element) => {
      const point = position(element);
      return point && point.x > 480 && point.y >= 570 && point.y < 700 && ["cls-38", "cls-59"].includes(element.getAttribute("class"));
    }),
    texts.filter((element) => {
      const point = position(element);
      return point && point.x > 480 && point.y >= 700 && point.y < 850 && element.getAttribute("class") === "cls-59";
    }),
  ];
  const levels = hierarchyLevels(focus.id, buckets.length - 1);
  buckets.forEach((slots, depth) => assignSlots(slots, levels[depth] || []));

  // 原画板还预留了两个皇帝直属机构槽；填入焦点机构的同级机构，而非保留示例名称。
  const siblingSlots = [findTextAt(svg, 1735.2, 196.3, 2), findTextAt(svg, 1780.8, 196.3, 2)].filter(Boolean);
  const parentEdge = hierarchyEdgesForView().find((edge) => edge.child === focus.id);
  const siblings = parentEdge
    ? childrenFor(parentEdge.parent)
      .map((edge) => edge.child)
      .filter((id) => id !== focus.id)
      .sort(compareInstitutionIds)
    : [];
  assignSlots(siblingSlots, siblings);
  const contextSlot = findTextAt(svg, 1446.2, 183, 2);
  if (contextSlot) assignSlots([contextSlot], parentEdge ? [parentEdge.parent] : []);
}

// —— 编制视图（画板 4-02）：数据 join + 模板盖章 ——
// 设计稿中的示例机构列只作为样式来源（cls-17/18 边框、cls-28/38/50/31 文字类），
// 首次进入编制视图时整批隐藏；实际内容由 composition_model（数据 join）
// 和 composition_layout（坐标排版）两个纯函数生成，不再复用示例槽位。
const compositionExampleCache = new WeakMap();

function hideCompositionExamples(svg) {
  if (compositionExampleCache.has(svg)) return;
  [...svg.children].forEach((element) => {
    if (["defs", "style", "image"].includes(element.tagName.toLowerCase())) return;
    // getBBox 不含元素自身的 translate，文本类元素必须用 transform 里的参考点判断位置。
    const point = position(element);
    const rawX = element.getAttribute("x");
    const rawY = element.getAttribute("y");
    const attrX = rawX == null ? null : Number(rawX);
    const attrY = rawY == null ? null : Number(rawY);
    const bbox = elementBounds(element);
    const x = point?.x ?? attrX ?? bbox?.x;
    const y = point?.y ?? attrY ?? bbox?.y;
    if (x == null || y == null) return;
    if (x >= 480 && y >= 130 && x <= 1835 && y <= 885) {
      element.style.display = "none";
    }
  });
  compositionExampleCache.set(svg, true);
}

const SVG_NS = "http://www.w3.org/2000/svg";

function svgElement(tag, attrs = {}) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, String(value));
  return element;
}

// 竖排文字：首列落在 (x, y)，后续列向右 +pitch（CSS writing-mode: tb 负责竖排）。
function stampVerticalText(parent, {
  x, y, text, cls, charsPerCol, pitch, maxCols = 4, entityId = null,
  fontSize = null,
}) {
  const element = svgElement("text", { class: cls, transform: `translate(${x} ${y})` });
  // 原 SVG 的 class 自带固定字号；动态嵌套标题必须用布局计算后的字号覆盖它，
  // 否则 14/13.5px 的几何仍会以 16px 绘制并发生列间碰撞。
  if (Number.isFinite(fontSize)) element.style.fontSize = `${fontSize}px`;
  const content = Array.from(String(text || ""));
  const cols = [];
  for (let offset = 0; offset < content.length && cols.length < maxCols; offset += charsPerCol) {
    let column = content.slice(offset, offset + charsPerCol);
    if (offset + charsPerCol < content.length && cols.length === maxCols - 1) {
      column = [...column.slice(0, -1), "…"];
    }
    cols.push(column.join(""));
  }
  cols.forEach((column, index) => {
    const tspan = svgElement("tspan", { x: String(index * pitch), y: "0" });
    tspan.textContent = column;
    element.appendChild(tspan);
  });
  if (entityId != null) element.dataset.entityId = String(entityId);
  parent.appendChild(element);
  return element;
}

function stampStaffTracks(group, item) {
  const tracks = item.staffTracks || [];
  const labelRect = item.labelRect || item.rect;
  tracks.forEach((track, index) => {
    // 原稿的编制始终接在机构名下方，多列以标题基线为中心向左展开。
    const x = labelRect.x
      + item.staffRightmostXOffset
      - index * item.staffTrackPitch;
    stampVerticalText(group, {
      x,
      y: labelRect.y + item.staffYOffset,
      text: track.text,
      cls: `${item.staffClass || "cls-31"} composition-staff-text`,
      charsPerCol: Math.max(1, Array.from(track.text).length),
      pitch: item.staffTrackPitch,
      maxCols: 1,
      fontSize: item.staffFontSize,
    });
  });
}

function stampCompositionItem(layer, item, geometry) {
  const { rect } = item;
  const labelRect = item.labelRect || rect;
  const group = svgElement("g", { class: `composition-item composition-${item.kind}` });
  group.style.cursor = "pointer";
  if (item.titlePlateRect) {
    group.appendChild(svgElement("rect", {
      class: "cls-8 composition-focus-title-plate",
      x: item.titlePlateRect.x,
      y: item.titlePlateRect.y,
      width: item.titlePlateRect.width,
      height: item.titlePlateRect.height,
    }));
  }
  if (item.kind === "column") {
    const level = Math.min(4, Math.max(3, Number(item.depth || 1) + 2));
    group.appendChild(svgElement("rect", {
      class: `cls-18 composition-institution-border composition-level-${level}`,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    }));
  } else {
    group.appendChild(svgElement("rect", {
      class: "composition-item-hit-area",
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    }));
  }
  d3.select(group).on("click", (event) => {
    event.stopPropagation();
    selectLinkedEntity(item.id);
  });
  const titleClass = item.kind === "focus"
    ? "cls-28"
    : item.kind === "section"
      ? "cls-38"
      : "cls-50";
  const titleFontSize = item.fontSize || (item.kind === "focus"
    ? geometry.focusTitleFontSize
    : item.kind === "section"
      ? geometry.sectionTitleFontSize
      : geometry.columnTitleFontSize);
  stampVerticalText(group, {
    x: labelRect.x + item.titleXOffset,
    y: labelRect.y + item.titleYOffset,
    text: item.title,
    cls: titleClass,
    charsPerCol: item.titleCapacity,
    pitch: item.titlePitch || titleFontSize + geometry.titleColGap,
    maxCols: item.titleCols || 1,
    entityId: item.id,
    fontSize: titleFontSize,
  });
  stampStaffTracks(group, item);
  layer.appendChild(group);
  for (const child of item.children || []) stampCompositionItem(layer, child, geometry);
}

function renderDynamicComposition(svg) {
  svg.querySelector(".dynamic-composition-layer")?.remove();
  hideCompositionExamples(svg);
  const layer = svgElement("g", { class: "dynamic-composition-layer" });
  svg.appendChild(layer);
  const focus = graphFocusEntity();
  const model = focus && buildCompositionModel({
    focusId: focus.id,
    entityMap,
    childrenFor,
    staffFor,
    titleOf,
  });
  const layout = model && layoutComposition(model, {
    origin: {
      x: COMPOSITION_CONTENT_BOUNDS.x,
      y: COMPOSITION_CONTENT_BOUNDS.y,
    },
    maxWidth: COMPOSITION_CONTENT_BOUNDS.width,
    maxHeight: COMPOSITION_CONTENT_BOUNDS.height,
  });
  if (!layout) return;
  const { geometry } = layout;
  const fitted = fitCompositionBlock(layout.bounds, COMPOSITION_CONTENT_BOUNDS);
  if (!fitted) return;
  const content = svgElement("g", {
    class: "dynamic-composition-fitted-content",
    transform: `translate(${fitted.translateX} ${fitted.translateY}) scale(${fitted.scale})`,
  });
  layer.appendChild(content);

  content.appendChild(svgElement("rect", {
    class: "cls-3 composition-institution-border composition-level-1",
    x: layout.parentRect.x,
    y: layout.parentRect.y,
    width: layout.parentRect.width,
    height: layout.parentRect.height,
  }));
  stampCompositionItem(content, layout.focusLabel, geometry);
  for (const block of layout.blocks) {
    content.appendChild(svgElement("rect", {
      class: `cls-17 composition-institution-border composition-level-2${block.kind === "attachments" ? " composition-attachments-frame" : ""}`,
      x: block.rect.x,
      y: block.rect.y,
      width: block.rect.width,
      height: block.rect.height,
    }));
    if (block.label) stampCompositionItem(content, block.label, geometry);
    for (const item of block.items) stampCompositionItem(content, item, geometry);
  }
}

const evolutionTemplateCache = new WeakMap();

function hideEvolutionExamples(svg) {
  hierarchyTemplates(svg);
  if (evolutionTemplateCache.has(svg)) return;
  [...svg.children].forEach((element) => {
    if (["defs", "style", "image"].includes(element.tagName.toLowerCase())) return;
    if (normalizeText(element).startsWith("宋朝的职官体系是自秦朝以来")) {
      element.classList.add("evolution-intro-copy");
    }
    const point = position(element);
    const bounds = elementBounds(element);
    const x = point?.x ?? bounds?.x;
    const y = point?.y ?? bounds?.y;
    if (x == null || y == null) return;
    if (x >= 58 && x <= 480 && y >= 270 && y <= 478) {
      element.style.display = "none";
    }
  });
  evolutionTemplateCache.set(svg, true);
}

function evolutionFocusEntities() {
  return evolutionEntityIds.value
    .map((entityId) => entityMap.get(entityId))
    .filter(Boolean)
    .slice(0, 4);
}

function ensureEvolutionFocus() {
  let focusEntities = evolutionFocusEntities();
  if (!focusEntities.length) {
    const fallback = entityMap.get(selectedId.value) || categoryFocus(selectedCategory.value);
    if (fallback) {
      evolutionEntityIds.value = [fallback.id];
      selectedId.value = fallback.id;
      focusEntities = [fallback];
    }
  }
  if (evolutionMode.value === "single" && focusEntities.length > 1) {
    const activeId = focusEntities.some((entity) => entity.id === selectedId.value)
      ? selectedId.value
      : focusEntities[0].id;
    evolutionEntityIds.value = [activeId];
    focusEntities = [entityMap.get(activeId)].filter(Boolean);
  }
  return focusEntities;
}

const COMPARISON_PLOT_BOUNDS = {
  x: 520,
  y: 238,
  width: 1278,
  height: 610,
};
const COMPARISON_GAP = 18;
// 对照视图左右两块共用的等比例缩放入口：1 = 当前大小，1.1 = 放大 10%。
// 只允许统一缩放，不能分别修改宽高，否则会破坏设计稿比例。
const COMPARISON_PANE_SCALE = 0.7;
const COMPARISON_VIEWBOX = {
  x: 500,
  y: 120,
  width: 1340,
  height: 750,
};

function comparisonPaneScale() {
  const propValue = Number(props.comparisonScale);
  if (Number.isFinite(propValue) && propValue > 0) return propValue;
  const queryValue = new URLSearchParams(window.location.search).get("comparisonScale");
  const parsed = Number(queryValue);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : COMPARISON_PANE_SCALE;
}

function createComparisonChildSvg() {
  const child = svgCache.get(HIERARCHY_DESIGN_URL).cloneNode(true);
  child.removeAttribute("width");
  child.removeAttribute("height");
  child.setAttribute(
    "viewBox",
    `${COMPARISON_VIEWBOX.x} ${COMPARISON_VIEWBOX.y} ${COMPARISON_VIEWBOX.width} ${COMPARISON_VIEWBOX.height}`
  );
  // 保持原设计稿比例；空间通过裁剪区和上沿对齐利用，不能靠非等比拉伸。
  child.setAttribute("preserveAspectRatio", "xMidYMin meet");
  child.classList.add("comparison-child-svg");
  return child;
}

function retainComparisonLayer(child, selector) {
  [...child.children].forEach((element) => {
    const tag = element.tagName.toLowerCase();
    if (["defs", "style"].includes(tag) || element.matches(selector)) return;
    element.remove();
  });
}

function hideComparisonPlotExamples(svg) {
  const area = COMPARISON_PLOT_BOUNDS;
  for (const element of [...svg.children]) {
    const tag = element.tagName.toLowerCase();
    if (["defs", "style", "image"].includes(tag)) continue;
    if (element.classList.contains("detail-panel-group")) continue;
    const bounds = elementBounds(element);
    const textPoints = [...element.querySelectorAll("text")]
      .map((text) => position(text))
      .filter(Boolean);
    const overlaps = (bounds
      && bounds.x < area.x + area.width
      && bounds.x + bounds.width > area.x
      && bounds.y < area.y + area.height
      && bounds.y + bounds.height > area.y)
      || textPoints.some((point) => (
        point.x >= area.x - 20
        && point.x <= area.x + area.width + 20
        && point.y >= area.y - 20
        && point.y <= area.y + area.height + 20
      ));
    if (overlaps) element.style.display = "none";
  }
}

function comparisonPointerPoint(svg, event) {
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const matrix = svg.getScreenCTM();
  return matrix ? point.matrixTransform(matrix.inverse()) : { x: event.clientX, y: event.clientY };
}

function clampComparisonPaneOffset(svg, baseX, baseY, width, height, offset) {
  const viewBox = svg.viewBox?.baseVal;
  const bounds = viewBox?.width
    ? viewBox
    : { x: 0, y: 0, width: 1920, height: 1080 };
  const handleTop = baseY - 30;
  return {
    x: Math.max(bounds.x - baseX, Math.min(
      bounds.x + bounds.width - baseX - width,
      offset.x,
    )),
    y: Math.max(bounds.y - handleTop, Math.min(
      bounds.y + bounds.height - baseY - height,
      offset.y,
    )),
  };
}

function bindComparisonPaneDrag(svg, group, handle, key, baseX, baseY, width, height) {
  const apply = (offset) => {
    group.setAttribute("transform", `translate(${offset.x} ${offset.y})`);
  };
  const save = (offset) => {
    comparisonPaneOffsets.value = {
      ...comparisonPaneOffsets.value,
      [key]: { ...offset },
    };
    apply(offset);
  };
  apply(clampComparisonPaneOffset(
    svg,
    baseX,
    baseY,
    width,
    height,
    comparisonPaneOffsets.value[key] || { x: 0, y: 0 },
  ));

  let drag = null;
  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const startOffset = comparisonPaneOffsets.value[key] || { x: 0, y: 0 };
    drag = {
      pointerId: event.pointerId,
      start: comparisonPointerPoint(svg, event),
      startOffset: { ...startOffset },
      current: { ...startOffset },
    };
    handle.setPointerCapture?.(event.pointerId);
    handle.classList.add("is-dragging");
  });
  handle.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const point = comparisonPointerPoint(svg, event);
    drag.current = clampComparisonPaneOffset(svg, baseX, baseY, width, height, {
      x: drag.startOffset.x + point.x - drag.start.x,
      y: drag.startOffset.y + point.y - drag.start.y,
    });
    apply(drag.current);
  });
  const finishDrag = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    handle.releasePointerCapture?.(event.pointerId);
    handle.classList.remove("is-dragging");
    save(drag.current);
    drag = null;
  };
  handle.addEventListener("pointerup", finishDrag);
  handle.addEventListener("pointercancel", finishDrag);
  handle.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
    save({ x: 0, y: 0 });
  });
  handle.addEventListener("keydown", (event) => {
    const delta = event.shiftKey ? 20 : 8;
    const movement = {
      ArrowLeft: [-delta, 0],
      ArrowRight: [delta, 0],
      ArrowUp: [0, -delta],
      ArrowDown: [0, delta],
    }[event.key];
    if (!movement) return;
    event.preventDefault();
    event.stopPropagation();
    const current = comparisonPaneOffsets.value[key] || { x: 0, y: 0 };
    save(clampComparisonPaneOffset(svg, baseX, baseY, width, height, {
      x: current.x + movement[0],
      y: current.y + movement[1],
    }));
  });
}

function renderDynamicComparison(svg) {
  hideEvolutionExamples(svg);
  hideComparisonPlotExamples(svg);
  svg.querySelector(".dynamic-comparison-layer")?.remove();

  const layer = svgElement("g", { class: "dynamic-comparison-layer" });
  const blockWidth = (COMPARISON_PLOT_BOUNDS.width - COMPARISON_GAP) / 2;
  const leftX = COMPARISON_PLOT_BOUNDS.x;
  const rightX = leftX + blockWidth + COMPARISON_GAP;
  const leftSvg = createComparisonChildSvg();
  const rightSvg = createComparisonChildSvg();
  const paneScale = Math.max(0.1, comparisonPaneScale());
  const childWidth = blockWidth * paneScale;
  const childHeight = COMPARISON_PLOT_BOUNDS.height * paneScale;
  const createPaneViewport = (child, x, key, title) => {
    // 不再用固定 clipPath 截断放大后的画板；每一侧改成独立的 HTML 滚动视口。
    // 这样比例超过 100% 时内容仍然完整存在，只是通过滚动查看超出部分。
    const paneGroup = svgElement("g", { class: `comparison-pane-group comparison-pane-${key}` });
    const viewport = svgElement("foreignObject", {
      class: "comparison-pane-viewport",
      x,
      y: COMPARISON_PLOT_BOUNDS.y,
      width: blockWidth,
      height: COMPARISON_PLOT_BOUNDS.height,
    });
    const scroll = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
    scroll.className = "comparison-pane-scroll";
    scroll.setAttribute("role", "region");
    scroll.setAttribute("aria-label", `${title}可滚动画布`);
    const stage = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
    stage.className = "comparison-pane-stage";
    stage.style.width = `${Math.max(blockWidth, childWidth)}px`;
    stage.style.height = `${Math.max(COMPARISON_PLOT_BOUNDS.height, childHeight)}px`;
    child.setAttribute("x", "0");
    child.setAttribute("y", "0");
    child.setAttribute("width", String(childWidth));
    child.setAttribute("height", String(childHeight));
    stage.appendChild(child);
    scroll.appendChild(stage);
    viewport.appendChild(scroll);
    const handle = svgElement("g", {
      class: "comparison-pane-drag-handle",
      role: "button",
      tabindex: "0",
      "aria-label": `拖动${title}整体位置；双击复位`,
    });
    handle.appendChild(svgElement("rect", {
      class: "comparison-pane-drag-surface",
      x,
      y: COMPARISON_PLOT_BOUNDS.y - 28,
      width: blockWidth,
      height: 24,
      rx: 2,
    }));
    const heading = svgElement("text", {
      class: "comparison-pane-heading",
      x: x + blockWidth / 2,
      y: COMPARISON_PLOT_BOUNDS.y - 11,
      "text-anchor": "middle",
    });
    setText(heading, title);
    const hint = svgElement("title");
    setText(hint, `按住拖动${title}整体位置；双击恢复默认位置`);
    handle.append(heading, hint);
    paneGroup.append(handle, viewport);
    bindComparisonPaneDrag(
      svg,
      paneGroup,
      handle,
      key,
      x,
      COMPARISON_PLOT_BOUNDS.y,
      blockWidth,
      COMPARISON_PLOT_BOUNDS.height,
    );
    return paneGroup;
  };
  layer.append(
    createPaneViewport(leftSvg, leftX, "hierarchy", "层级结构"),
    createPaneViewport(rightSvg, rightX, "evolution", "时间沿革"),
  );
  const divider = svgElement("line", {
    class: "comparison-pane-divider",
    x1: String(leftX + blockWidth + COMPARISON_GAP / 2),
    x2: String(leftX + blockWidth + COMPARISON_GAP / 2),
    y1: String(COMPARISON_PLOT_BOUNDS.y),
    y2: String(COMPARISON_PLOT_BOUNDS.y + COMPARISON_PLOT_BOUNDS.height),
  });
  layer.appendChild(divider);
  svg.appendChild(layer);

  // 先在各自的嵌套画板中运行原有渲染器，保留节点/事件处理器，
  // 再移除设计稿示例，只留下动态层；不会复制整张页面。
  renderDynamicHierarchy(leftSvg);
  retainComparisonLayer(leftSvg, ".dynamic-tree-viewport");
  renderDynamicEvolution(rightSvg);
  // 对照区只保留时间轴本体；对象选择器属于独立演变视图入口，
  // 放在双栏中会覆盖层级内容并造成误解。
  rightSvg.querySelector(".evolution-selector-layer")?.remove();
  retainComparisonLayer(rightSvg, ".dynamic-evolution-layer");

  svg.__evolutionModel = rightSvg.__evolutionModel;
  svg.__evolutionLayout = rightSvg.__evolutionLayout;
}

function renderDynamicEvolution(svg) {
  hideEvolutionExamples(svg);
  const focusEntities = ensureEvolutionFocus();
  const focusIds = focusEntities.map((entity) => entity.id);
  const modelKey = focusIds.join(":");
  if (!evolutionModelCache || evolutionModelCacheKey !== modelKey) {
    evolutionModelCache = buildEvolutionModel(
      props.data,
      focusIds,
      { yearMin: YEAR_MIN, yearMax: YEAR_MAX },
    );
    evolutionModelCacheKey = modelKey;
    evolutionLayoutCacheKey = "";
    evolutionLayoutCache = null;
  }
  const windowedModel = windowEvolutionModel(evolutionModelCache, evolutionLanePage.value, 8);
  if (windowedModel.laneWindow.page !== evolutionLanePage.value) {
    evolutionLanePage.value = windowedModel.laneWindow.page;
  }
  const layoutKey = `${modelKey}:${windowedModel.laneWindow.page}`;
  if (!evolutionLayoutCache || evolutionLayoutCacheKey !== layoutKey) {
    evolutionLayoutCache = layoutEvolutionModel(windowedModel, {
      x: 520,
      y: 258,
      width: 1278,
      height: 568,
    });
    evolutionLayoutCacheKey = layoutKey;
  }
  const model = windowedModel;
  const layout = evolutionLayoutCache;
  if (selectedEvolutionItem.value) {
    const { kind, id } = selectedEvolutionItem.value;
    const item = kind === "relation"
      ? layout.relations.find((relation) => relation.id === id)
      : layout.lanes
        .flatMap((lane) => [...(lane.events || []), ...(lane.offAxisEvents || [])])
        .find((event) => event.id === id);
    selectedEvolutionItem.value = item ? { kind, id, item } : null;
  }
  svg.__evolutionModel = model;
  svg.__evolutionLayout = layout;

  const handlers = {
    onSelectEntity(entityId) {
      selectedId.value = entityId;
      selectedEvolutionItem.value = null;
      emit("selection-change", null);
      detailPanelScrollOffset = 0;
      refreshTemplate();
    },
    onRemoveEntity(entityId) {
      const remaining = evolutionEntityIds.value.filter((id) => id !== entityId);
      if (!remaining.length) return;
      evolutionEntityIds.value = remaining;
      if (selectedId.value === entityId) selectedId.value = remaining[0];
      selectedEvolutionItem.value = null;
      evolutionLanePage.value = 1;
      detailPanelScrollOffset = 0;
      refreshTemplate();
    },
    onAddEntity(entityId) {
      const next = evolutionComparisonAfterAdd(evolutionEntityIds.value, entityId);
      evolutionMode.value = next.mode;
      evolutionEntityIds.value = next.entityIds;
      selectedId.value = next.activeEntityId;
      selectedEvolutionItem.value = null;
      evolutionLanePage.value = 1;
      evolutionSearchOpen.value = false;
      detailPanelScrollOffset = 0;
      refreshTemplate();
    },
    onModeChange(mode) {
      if (mode === evolutionMode.value) return;
      evolutionMode.value = mode;
      evolutionSearchOpen.value = false;
      selectedEvolutionItem.value = null;
      evolutionLanePage.value = 1;
      if (mode === "single") {
        const activeId = evolutionEntityIds.value.includes(selectedId.value)
          ? selectedId.value
          : evolutionEntityIds.value[0];
        evolutionEntityIds.value = activeId == null ? [] : [activeId];
      }
      refreshTemplate();
    },
    onSearchOpenChange(open) {
      evolutionSearchOpen.value = Boolean(open);
      refreshTemplate();
    },
    onLanePageChange(page) {
      const nextPage = Math.max(1, Math.min(model.laneWindow.pageCount, Math.floor(page)));
      if (nextPage === evolutionLanePage.value) return;
      evolutionLanePage.value = nextPage;
      selectedEvolutionItem.value = null;
      if (!focusIds.includes(selectedId.value)) selectedId.value = focusIds[0] ?? null;
      detailPanelScrollOffset = 0;
      refreshTemplate();
    },
    onSelectEvent(event) {
      const current = selectedEvolutionItem.value;
      if (current?.kind === "timepoint" && current.id === event.id) {
        // 再次点击已选中的事件 = 取消选择；入口年份线保持不动。
        selectedEvolutionItem.value = null;
        emit("selection-change", null);
        refreshTemplate();
        return;
      }
      selectedId.value = event.entityId;
      selectedEvolutionItem.value = { kind: "timepoint", id: event.id, item: event };
      emit("selection-change", {
        kind: "timepoint",
        id: event.id,
        entityId: event.entityId,
        item: { ...event },
      });
      detailPanelScrollOffset = 0;
      refreshTemplate();
    },
    onSelectRelation(relation) {
      const current = selectedEvolutionItem.value;
      if (current?.kind === "relation" && current.id === relation.id) {
        // 再次点击已选中的关系 = 取消选择；入口年份线保持不动。
        selectedEvolutionItem.value = null;
        emit("selection-change", null);
        refreshTemplate();
        return;
      }
      selectedEvolutionItem.value = { kind: "relation", id: relation.id, item: relation };
      emit("selection-change", {
        kind: "relation",
        id: relation.id,
        item: { ...relation },
      });
      detailPanelScrollOffset = 0;
      refreshTemplate();
    },
    onCommitYear(year) {
      if (year == null) return;
      commitTimelineRange([year, year]);
    },
    onOpenHierarchy(entityId, year) {
      openHierarchyFromEvolution({ entityId, year, reason: "selected-action" });
    },
  };

  renderEvolutionOverlay(svg, {
    layout,
    entities: props.data.entities,
    focusEntities,
    activeEntityId: selectedId.value,
    selectedItem: selectedEvolutionItem.value,
    selectedRange: selectedRange.value,
    selectionActive: timelineSelectionActive.value,
    entryContext: evolutionEntryContext.value,
    hierarchyResolution: evolutionHierarchyResolution(),
    mode: evolutionMode.value,
    searchOpen: evolutionSearchOpen.value,
    handlers,
  });
}

// —— 时间线树视图：左侧层级树（原层级逆时针旋转 90°）+ 右侧逐行对齐的时间线 ——

function timetreeActiveExpandedKeys(category) {
  if (timetreeExpandedKeys.value !== null) return timetreeExpandedKeys.value;
  const categoryKey = timetreeCategoryKey(category);
  if (collapsedHierarchyIds.has(categoryKey)) return [];
  return defaultTimetreeExpandedKeys({
    category,
  });
}

function renderDynamicTimetree(svg) {
  hideEvolutionExamples(svg);
  // hideEvolutionExamples 的隐藏区（x58–480/y270–478）覆盖了左侧分类导航，
  // 时间线树视图仍需要它切换分类，恢复显示。
  for (const element of svg.children) {
    if (element.style?.display !== "none") continue;
    const text = normalizeText(element);
    if (CATEGORY_NAMES.some((name) => text.includes(name))) {
      element.style.removeProperty("display");
    }
  }
  const treeTemplates = hierarchyTemplates(svg);
  const category = selectedCategory.value;
  const rows = buildTimetreeRows({
    entities: props.data.entities,
    hierarchyEdges: hierarchyEdgesForView(),
    category,
    collectiveIds: [...collectiveEntityIds],
    activeEntityIds: currentSnapshot.value?.entityIds || null,
    groupNames: institutionGroupNames[category] || [],
    expandedIds: new Set(timetreeActiveExpandedKeys(category)),
  });
  const laneModel = buildEvolutionLanes(
    props.data,
    timetreeLaneEntityIds(rows),
    { yearMin: YEAR_MIN, yearMax: YEAR_MAX },
  );

  const geometry = TIMETREE_GEOMETRY;
  const layoutSpan = timetreeLayoutSpan(rows);
  const scrollOffset = clampTimetreeScroll(timetreeScroll.value, layoutSpan, geometry);
  if (scrollOffset !== timetreeScroll.value) timetreeScroll.value = scrollOffset;
  const xOf = (year) => timetreeYearToX(year, YEAR_MIN, YEAR_MAX, geometry.plot);
  const yByEntityId = new Map(rows
    .filter((row) => row.entityId != null)
    .map((row) => [row.entityId, geometry.rowsTop
      + (row.layoutIndex ?? row.rowIndex) * geometry.rowPitch
      + geometry.rowPitch / 2 - scrollOffset]));

  const lanesByEntityId = new Map(laneModel.lanes.map((lane) => [lane.entityId, lane]));
  const visibleLaneIds = new Set(laneModel.lanes.map((lane) => lane.entityId));
  const activeLaneId = visibleLaneIds.has(selectedId.value) ? selectedId.value : null;
  const focusedLaneRelations = timetreeRelationsForEntity(laneModel.relations, activeLaneId);
  const linkedEndpointIds = activeLaneId == null
    ? null
    : timetreeRelationEndpointIds(focusedLaneRelations);
  const eventsByLane = new Map();
  const segmentsByLane = new Map();
  const eventPositionById = new Map();
  for (const lane of laneModel.lanes) {
    const y = yByEntityId.get(lane.entityId);
    const events = layoutTimetreeEvents(
      timetreeEventsForLane(lane.events, {
        active: lane.entityId === activeLaneId,
        linkedEndpointIds,
      }),
      xOf,
    );
    eventsByLane.set(lane.entityId, events);
    segmentsByLane.set(lane.entityId, layoutTimetreeSegments(lane.segments, xOf));
    for (const event of events) {
      eventPositionById.set(event.id, {
        x: event.baseX,
        y: y + (event.dy || 0),
        iconType: event.iconType,
        rawTime: event.rawTime,
        effectiveYear: event.effectiveYear,
      });
    }
  }
  const relations = layoutTimetreeRelations(focusedLaneRelations, eventPositionById)
    .filter((relation) => relation.drawable);

  const handlers = {
    onSelectEntity(entityId) {
      selectedId.value = entityId;
      timetreeSelectedEventId.value = null;
      timetreeSelectedRelationId.value = null;
      emit("selection-change", null);
      detailPanelScrollOffset = 0;
      refreshTemplate();
    },
    onToggleNode(key) {
      timetreeExpandedKeys.value = toggleTimetreeExpansion(
        rows,
        timetreeActiveExpandedKeys(category),
        key,
      );
      refreshTemplate();
    },
    onExpandAll() {
      const next = new Set(timetreeActiveExpandedKeys(category));
      for (const row of buildTimetreeRows({
        entities: props.data.entities,
        hierarchyEdges: hierarchyEdgesWithoutCollectives(props.data.hierarchyEdges || []),
        category,
        collectiveIds: [...collectiveEntityIds],
        groupNames: institutionGroupNames[category] || [],
        expandedIds: new Set(["__none__"]),
      })) {
        if (row.totalChildren > 0) next.add(row.key);
      }
      // 全部展开需要递归收集： collapsed 节点的下级键也要在集合里。
      let grew = true;
      while (grew) {
        grew = false;
        for (const row of buildTimetreeRows({
          entities: props.data.entities,
          hierarchyEdges: hierarchyEdgesWithoutCollectives(props.data.hierarchyEdges || []),
          category,
          collectiveIds: [...collectiveEntityIds],
          groupNames: institutionGroupNames[category] || [],
          expandedIds: next,
        })) {
          if (row.totalChildren > 0 && !next.has(row.key)) {
            next.add(row.key);
            grew = true;
          }
        }
      }
      timetreeExpandedKeys.value = [...next];
      refreshTemplate();
    },
    onCollapseAll() {
      timetreeExpandedKeys.value = [];
      refreshTemplate();
    },
    onSelectEvent(event) {
      if (timetreeSelectedEventId.value === event.id) {
        // 再次点击已选中的事件 = 取消选择（与演变视图一致）。
        timetreeSelectedEventId.value = null;
        refreshTemplate();
        return;
      }
      selectedId.value = event.entityId;
      timetreeSelectedEventId.value = event.id;
      timetreeSelectedRelationId.value = null;
      detailPanelScrollOffset = 0;
      refreshTemplate();
    },
    onSelectRelation(relation) {
      timetreeSelectedRelationId.value = timetreeSelectedRelationId.value === relation.id
        ? null
        : relation.id;
      refreshTemplate();
    },
    onScroll(deltaY) {
      const next = clampTimetreeScroll(
        timetreeScroll.value + deltaY * 0.6,
        layoutSpan,
        geometry,
      );
      if (next === timetreeScroll.value) return;
      timetreeScroll.value = next;
      scheduleTimelineRefresh();
    },
    onScrollToFraction(fraction) {
      const maxOffset = clampTimetreeScroll(Number.POSITIVE_INFINITY, layoutSpan, geometry);
      timetreeScroll.value = clampTimetreeScroll(maxOffset * fraction, layoutSpan, geometry);
      scheduleTimelineRefresh();
    },
    onOpenEvolution(entityId) {
      if (viewModeLocked.value) return;
      enterEvolutionView({ entityId, sourceView: "timetree" });
    },
  };

  renderTimetreeOverlay(svg, {
    rows,
    lanesByEntityId,
    eventsByLane,
    segmentsByLane,
    relations,
    yearMin: YEAR_MIN,
    yearMax: YEAR_MAX,
    scroll: {
      offset: scrollOffset,
      maxOffset: clampTimetreeScroll(Number.POSITIVE_INFINITY, layoutSpan, geometry),
      viewportHeight: geometry.rowsBottom - geometry.rowsTop,
      contentHeight: layoutSpan * geometry.rowPitch,
    },
    selectedEntityId: selectedId.value,
    selectedEventId: timetreeSelectedEventId.value,
    selectedRelationId: timetreeSelectedRelationId.value,
    treeTemplates,
    handlers,
  });
}

function populateCenter(svg) {
  if (viewMode.value === "hierarchy") renderDynamicHierarchy(svg);
  else if (viewMode.value === "composition") renderDynamicComposition(svg);
  else renderDynamicEvolution(svg);
}

function bindEntityTexts(svg) {
  const activeIds = new Set();
  for (const edge of hierarchyEdgesForView()) {
    activeIds.add(edge.parent);
    activeIds.add(edge.child);
  }
  for (const edge of staffEdgesForView()) {
    activeIds.add(edge.org);
    activeIds.add(edge.official);
  }

  d3.select(svg)
    .selectAll("text")
    .each(function () {
      if (this.closest(".dynamic-tree-layer, .dynamic-evolution-layer")) return;
      const entity = this.dataset.entityId
        ? entityMap.get(Number(this.dataset.entityId))
        : titleMap.get(normalizeText(this));
      if (!entity) return;
      const point = position(this);
      // 左侧详情标题和顶部信息卡由 updateDetails 单独处理。
      if (point && point.x < 500) return;
      this.dataset.entityId = String(entity.id);
      this.style.cursor = "pointer";
      this.style.transition = "opacity .18s ease";
      this.style.opacity = activeIds.has(entity.id) || activeTimepoints(entity.id).length ? "1" : "0.2";
      d3.select(this)
        .on("mouseenter", () => this.classList.add("svg-entity-hover"))
        .on("mouseleave", () => this.classList.remove("svg-entity-hover"))
        .on("click", (event) => {
          event.stopPropagation();
          selectLinkedEntity(entity.id);
        });
    });
}

function setupDetailPanel(svg) {
  const panelNodes = [...svg.children].filter((element) => {
    if (["defs", "style", "image"].includes(element.tagName.toLowerCase())) return false;
    let bounds;
    try {
      bounds = element.getBBox();
    } catch {
      return false;
    }
    return bounds.x >= 70
      && bounds.y >= 480
      && bounds.x + bounds.width <= 482
      && bounds.y + bounds.height <= 885;
  });
  if (!panelNodes.length) return;

  const panelGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
  panelGroup.classList.add("detail-panel-group");
  svg.insertBefore(panelGroup, panelNodes[0]);
  panelNodes.forEach((node) => panelGroup.appendChild(node));
  panelGroup.__topRightBorder = [...panelGroup.querySelectorAll("polyline")].find((polyline) => (
    (polyline.getAttribute("points") || "").includes("475.49 497.57 308.55 497.57")
  ));

  const defs = svg.querySelector("defs") || svg.insertBefore(
    document.createElementNS("http://www.w3.org/2000/svg", "defs"),
    svg.firstChild
  );
  const clipPath = document.createElementNS("http://www.w3.org/2000/svg", "clipPath");
  clipPath.id = "detail-panel-content-clip";
  clipPath.setAttribute("clipPathUnits", "userSpaceOnUse");
  const clipRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  clipRect.setAttribute("x", "88");
  clipRect.setAttribute("y", "524.81");
  clipRect.setAttribute("width", "371");
  clipRect.setAttribute("height", "352.41");
  clipPath.appendChild(clipRect);
  defs.appendChild(clipPath);

  const scrollViewport = document.createElementNS("http://www.w3.org/2000/svg", "g");
  scrollViewport.classList.add("detail-panel-scroll-viewport");
  scrollViewport.setAttribute("clip-path", "url(#detail-panel-content-clip)");
  const scrollContent = document.createElementNS("http://www.w3.org/2000/svg", "g");
  scrollContent.classList.add("detail-panel-scroll-content");
  scrollViewport.appendChild(scrollContent);
  panelGroup.appendChild(scrollViewport);

  const bodyPositions = [
    [101.29, 570.06],
    [100.33, 536.92],
    [101.29, 783.54],
    [100.33, 750.4],
    [100.33, 846.08],
  ];
  const contentNodes = bodyPositions
    .map(([x, y]) => findTextAt(svg, x, y))
    .filter(Boolean);
  const labelTemplate = findTextAt(svg, 100.33, 536.92)?.cloneNode(false);
  const contentTemplate = findTextAt(svg, 101.29, 570.06)?.cloneNode(false);
  contentNodes.forEach((node) => node.remove());
  if (labelTemplate && contentTemplate) {
    const sectionLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    sectionLayer.classList.add("detail-panel-sections");
    for (const key of DETAIL_PANEL_SECTION_KEYS) {
      const label = labelTemplate.cloneNode(false);
      label.dataset.detailSectionLabel = key;
      const content = contentTemplate.cloneNode(false);
      content.dataset.detailSectionContent = key;
      sectionLayer.append(label, content);
    }
    scrollContent.appendChild(sectionLayer);
  }

  const scrollTrack = [...panelGroup.querySelectorAll("rect")].find((rect) => (
    Math.abs(Number(rect.getAttribute("x")) - 471.34) < 1
    && Math.abs(Number(rect.getAttribute("y")) - 524.81) < 1
    && Number(rect.getAttribute("height")) > 300
  ));
  const scrollThumb = [...panelGroup.querySelectorAll("rect")].find((rect) => (
    Math.abs(Number(rect.getAttribute("x")) - 471.34) < 1
    && Math.abs(Number(rect.getAttribute("y")) - 524.81) < 1
    && Number(rect.getAttribute("height")) > 20
    && Number(rect.getAttribute("height")) < 200
  ));
  if (scrollTrack) {
    scrollTrack.removeAttribute("class");
    scrollTrack.classList.add("detail-panel-scroll-track");
    scrollTrack.setAttribute("x", "465.25");
    scrollTrack.setAttribute("width", "1.5");
    scrollTrack.setAttribute("rx", "0.75");
    scrollTrack.setAttribute("fill", "#563905");
    scrollTrack.setAttribute("opacity", "0.2");
  }
  if (scrollThumb) {
    scrollThumb.removeAttribute("class");
    scrollThumb.classList.add("detail-panel-scroll-thumb");
    scrollThumb.setAttribute("x", "464.25");
    scrollThumb.setAttribute("width", "3.5");
    scrollThumb.setAttribute("rx", "1.75");
    scrollThumb.setAttribute("fill", "#563905");
    scrollThumb.setAttribute("opacity", "0.62");
  }

  const scrollHitArea = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  scrollHitArea.classList.add("detail-panel-scroll-hit-area");
  scrollHitArea.setAttribute("x", String(DETAIL_PANEL_BOUNDS.x));
  scrollHitArea.setAttribute("y", "524.81");
  scrollHitArea.setAttribute("width", String(DETAIL_PANEL_BOUNDS.width));
  scrollHitArea.setAttribute("height", "352.41");
  scrollHitArea.setAttribute("fill", "transparent");
  scrollHitArea.setAttribute("pointer-events", "all");
  scrollHitArea.style.cursor = "default";
  panelGroup.insertBefore(scrollHitArea, scrollViewport);
  if (scrollThumb) panelGroup.appendChild(scrollThumb);

  const updateScroll = () => {
    const contentBottom = Number(scrollContent.dataset.contentBottom || 536.92);
    const viewportBottom = 872;
    const maxScroll = Math.max(0, contentBottom - viewportBottom);
    detailPanelScrollOffset = Math.max(0, Math.min(maxScroll, detailPanelScrollOffset));
    scrollContent.setAttribute("transform", `translate(0 ${-detailPanelScrollOffset})`);
    if (!scrollTrack || !scrollThumb) return;
    const trackY = Number(scrollTrack.getAttribute("y"));
    const trackHeight = Number(scrollTrack.getAttribute("height"));
    const contentHeight = Math.max(1, contentBottom - 536.92);
    const viewportHeight = viewportBottom - 536.92;
    const proportionalThumbHeight = trackHeight * viewportHeight / contentHeight;
    const thumbHeight = Math.max(30, Math.min(96, trackHeight, proportionalThumbHeight));
    const thumbTravel = trackHeight - thumbHeight;
    const thumbY = trackY + (maxScroll ? detailPanelScrollOffset / maxScroll * thumbTravel : 0);
    scrollThumb.setAttribute("y", String(thumbY));
    scrollThumb.setAttribute("height", String(thumbHeight));
    scrollTrack.style.display = maxScroll ? "" : "none";
    scrollThumb.style.display = maxScroll ? "" : "none";
    scrollThumb.style.cursor = maxScroll ? "grab" : "default";
  };
  panelGroup.__updateDetailScroll = updateScroll;

  const scrollDetailPanel = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const renderedHeight = svg.getBoundingClientRect().height || svg.viewBox.baseVal.height;
    detailPanelScrollOffset += event.deltaY * svg.viewBox.baseVal.height / renderedHeight;
    updateScroll();
  };
  // 正文链接位于 scrollViewport，空白区域由底层 hit area 承接；
  // 两层都监听滚轮，保持整个详情框可滚动。
  scrollViewport.addEventListener("wheel", scrollDetailPanel, { passive: false });
  scrollHitArea.addEventListener("wheel", scrollDetailPanel, { passive: false });

  if (scrollThumb) {
    d3.select(scrollThumb).call(
      d3.drag()
        .on("start", (event) => {
          event.sourceEvent?.stopPropagation();
          scrollThumb.style.cursor = "grabbing";
        })
        .on("drag", (event) => {
          const contentBottom = Number(scrollContent.dataset.contentBottom || 536.92);
          const maxScroll = Math.max(0, contentBottom - 872);
          const trackHeight = Number(scrollTrack?.getAttribute("height") || 352.41);
          const thumbHeight = Number(scrollThumb.getAttribute("height"));
          const thumbTravel = Math.max(1, trackHeight - thumbHeight);
          detailPanelScrollOffset += event.dy * maxScroll / thumbTravel;
          updateScroll();
        })
        .on("end", updateScroll)
    );
  }

}

const EVOLUTION_EFFECT_LABELS = {
  activate: "启用",
  preserve: "普通记载",
  deactivate: "罢废",
  ignore: "拟议未行",
};

const EVOLUTION_EVENT_TYPE_LABELS = {
  establish: "建置",
  restore: "复置",
  abolish: "罢废",
  rename: "改称",
  reorganize: "改置",
  merge: "合并",
  split: "分拆",
  incorporate: "并入",
  duty_transfer: "职掌移交",
  affiliation_change: "隶属变化",
  staffing_change: "编制变化",
  record: "一般记载",
};

const EVOLUTION_TIME_TYPE_LABELS = {
  exact: "明确时间点",
  range: "明确连续区间",
  bounded: "模糊时间边界",
  undated: "年代未明",
  unresolved: "时间待核查",
  pre_song: "宋前资料",
};

function evidenceLinesForKeys(keys, fallbackQuotation = "") {
  const seen = new Set();
  const citations = (keys || []).flatMap((key) => props.data.citations?.[key] || [])
    .filter((item) => {
      const identity = [item.citation, item.quotation, item.note].filter(Boolean).join(":")
        || item.id;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
  const uniqueValues = (field) => [...new Set(
    citations.map((item) => item[field]).filter(Boolean),
  )];
  const quotation = uniqueValues("quotation").join("；") || fallbackQuotation;
  const source = uniqueValues("citation").join("；");
  const note = uniqueValues("note").join("；");
  return {
    quotation: quotation || "当前记录没有可展示的逐字引文。",
    source: source || "当前记录没有单列出处。",
    note: note || "无补充校勘说明。",
  };
}

function evidenceLines(key, fallbackQuotation = "") {
  return evidenceLinesForKeys([key], fallbackQuotation);
}

function memberTimeLabel(member) {
  const row = timepointRowById.get(member?.timepointId) || {};
  return formatStandardTime({
    yearStart: member?.yearStart ?? row.year_start,
    yearEnd: member?.yearEnd ?? row.year_end,
    month: row.month,
    day: row.day,
    isLeapMonth: row.is_leap_month,
    rawTime: member?.rawTime || row.raw_time,
  });
}

function eventTimeLabel(event) {
  const row = timepointRowById.get(event?.id) || {};
  return formatStandardTime({
    yearStart: event?.yearStart ?? row.year_start,
    yearEnd: event?.yearEnd ?? row.year_end,
    month: row.month,
    day: row.day,
    isLeapMonth: row.is_leap_month,
    rawTime: event?.rawTime || row.raw_time,
  });
}

function relationEndpointLabel(member) {
  const entity = entityMap.get(member?.entityId);
  return `${entity?.title || `#${member?.entityId}`}（${memberTimeLabel(member)}）`;
}

function evolutionComparisonText(comparison) {
  if (!comparison) return "距入口年份未定";
  if (comparison.kind === "timepoint") return comparison.label;
  return comparison.endpoints.map((endpoint) => (
    `${endpoint.role === "source" ? "来源" : "目标"} ${titleOf(endpoint.entityId)}：${endpoint.label}`
  )).join("；") || "距入口年份未定";
}

function evolutionCurrentEntryText() {
  const entryYear = evolutionEntryYear();
  const currentYear = currentCanvasYear();
  const suffix = entryYear === currentYear
    ? ""
    : `；当前年份：${currentYear}年（${formatYearOffset(entryYear, currentYear)}）`;
  return `入口年份：${entryYear}年${suffix}`;
}

function evolutionDetailPayload(svg) {
  const model = svg.__evolutionModel;
  const selected = selectedEvolutionItem.value;
  if (selected?.kind === "timepoint") {
    const event = selected.item;
    const entity = entityMap.get(event.entityId) || selectedEntity();
    if (event.structuralHierarchyChange && event.hierarchyChange) {
      const change = event.hierarchyChange;
      const child = entityMap.get(change.childId);
      const previousParent = entityMap.get(change.previousParentId);
      const nextParent = entityMap.get(change.nextParentId);
      const evidence = evidenceLinesForKeys(event.evidenceKeys, event.quotation);
      const relationshipOriginal = relationshipSourceOriginal(props.data, event.evidenceKeys);
      const comparison = evolutionSelectionComparison(selected, evolutionEntryYear());
      const role = event.hierarchyRole === "subject"
        ? "本机构的上级发生变化"
        : event.hierarchyRole === "former_parent"
          ? "本机构失去一个直属下属"
          : "本机构新增一个直属下属";
      const hierarchySummary = [
        event.hierarchyChangeLabel || event.event,
        `本车道含义：${role}`,
        `变动机构：${child?.title || `#${change.childId}`}`,
        `原上级机构：${previousParent?.title || `#${change.previousParentId}`}`,
        `新上级机构：${nextParent?.title || `#${change.nextParentId}`}`,
      ].join("；");
      const derivationNote = "改隶事件根据相邻的无歧义年份中明确记载的上下级关系变化派生；同年存在多个上级时不作推断，也不改变相关机构的存废状态。";
      return {
        title: entity?.title || "层级变化",
        year: eventTimeLabel(event),
        sections: [
          { label: "事件：", value: event.event || event.hierarchyChangeLabel || "改隶事件" },
          {
            label: "事件类型：",
            value: EVOLUTION_EVENT_TYPE_LABELS[event.eventType] || "隶属变化",
          },
          {
            label: relationshipOriginal.count > 1
              ? `关系来源词条原文（${relationshipOriginal.count}条）：`
              : "关系来源词条原文：",
            value: relationshipOriginal.text,
          },
          {
            label: "存废判定：",
            value: `${EVOLUTION_EFFECT_LABELS[event.effect] || event.effect || "普通记载"}。关系箭头不参与这一判定。`,
          },
          {
            label: "时间精度：",
            value: `${EVOLUTION_TIME_TYPE_LABELS[event.timeType] || event.timeType || "未标注"}${event.parse_note ? `；${event.parse_note}` : ""}`,
          },
          { label: "距入口年份：", value: evolutionComparisonText(comparison) },
          { label: "相关关系：", value: hierarchySummary },
          { label: "出处：", value: evidence.source },
          { label: "校勘说明：", value: `${derivationNote}${evidence.note ? `；${evidence.note}` : ""}` },
        ],
      };
    }
    const dictionaryOriginal = dictionaryEntryText(props.data.dictionary?.[entity?.title] || {});
    const evidence = evidenceLines(`T${event.id}`, event.quotation);
    const comparison = evolutionSelectionComparison(selected, evolutionEntryYear());
    const related = (model?.relations || []).filter((relation) => (
      relation.sourceTimepointId === event.id || relation.targetTimepointId === event.id
    ));
    return {
      title: entity?.title || "时间节点",
      year: eventTimeLabel(event),
      sections: [
        { label: "事件：", value: event.event || "原文未单列事件名。" },
        {
          label: "事件类型：",
          value: EVOLUTION_EVENT_TYPE_LABELS[event.eventType] || event.eventType || "一般记载",
        },
        {
          label: "词条原文：",
          value: dictionaryOriginal || "当前实体未匹配到辞典原文词条。",
        },
        {
          label: "存废判定：",
          value: `${EVOLUTION_EFFECT_LABELS[event.effect] || event.effect || "普通记载"}。关系箭头不参与这一判定。`,
        },
        {
          label: "时间精度：",
          value: `${EVOLUTION_TIME_TYPE_LABELS[event.timeType] || event.timeType || "未标注"}${event.parse_note ? `；${event.parse_note}` : ""}`,
        },
        { label: "距入口年份：", value: evolutionComparisonText(comparison) },
        {
          label: "相关关系：",
          value: related.length
            ? related.map((relation) => relation.label).join("；")
            : "当前时间点没有结构化演变关系。",
        },
        { label: "原文引文：", value: evidence.quotation },
        { label: "出处：", value: evidence.source },
        { label: "校勘说明：", value: evidence.note },
      ],
    };
  }

  if (selected?.kind === "relation") {
    const relation = selected.item;
    const evidence = evidenceLines(relation.evidenceKey || `R${relation.id}`, relation.quotation);
    const relationshipOriginal = relationshipSourceOriginal(
      props.data,
      [relation.evidenceKey || `R${relation.id}`],
    );
    const comparison = evolutionSelectionComparison(selected, evolutionEntryYear());
    const sources = (relation.sourceMembers || []).map(relationEndpointLabel).join("、");
    const targets = (relation.targetMembers || []).map(relationEndpointLabel).join("、");
    const endpointYears = [...new Set(
      [...(relation.sourceMembers || []), ...(relation.targetMembers || [])]
        .map((member) => memberTimeLabel(member)),
    )];
    return {
      title: relation.label,
      year: endpointYears.length ? endpointYears.join(" → ") : "年代未明",
      sections: [
        { label: "关系：", value: relation.label },
        { label: "来源：", value: sources || "来源端点未完整记录。" },
        { label: "目标：", value: targets || "目标端点未完整记录。" },
        { label: "距入口年份：", value: evolutionComparisonText(comparison) },
        {
          label: relationshipOriginal.count > 1
            ? `关系来源词条原文（${relationshipOriginal.count}条）：`
            : "关系来源词条原文：",
          value: relationshipOriginal.text,
        },
        {
          label: "编码状态：",
          value: relation.implementationStatus === "unclassified"
            ? "旧前后演变关系，尚未结构化细分；界面不依据自由文本猜测。"
            : `结构化关系${relation.groupId ? `；事件组 ${relation.groupId}` : "；未设置事件组"}。`,
        },
        { label: "出处：", value: evidence.source },
        { label: "校勘说明：", value: evidence.note },
      ],
    };
  }

  const entity = selectedEntity();
  if (!entity) return null;
  const lane = model?.lanes?.find((item) => item.entityId === entity.id);
  const relations = (model?.relations || []).filter((relation) => (
    relation.sourceEntityId === entity.id || relation.targetEntityId === entity.id
  ));
  const timepoints = props.data.timepoints[String(entity.id)] || [];
  const dictionary = props.data.dictionary?.[entity.title] || {};
  const dictionaryOriginal = dictionaryEntryText(dictionary);
  const segmentLabel = lane?.segments?.length
    ? lane.segments.map((segment) => `${segment.startYear}—${segment.endYear}`).join("；")
    : "当前算法未确认宋代存续段。";
  return {
    title: entity.title,
    year: `${timepoints.length} 个时间点`,
    sections: [
      { label: "实体类型：", value: entity.type },
      { label: "入口上下文：", value: evolutionCurrentEntryText() },
      {
        label: "词条原文：",
        value: dictionaryOriginal || "当前实体未匹配到辞典原文词条。",
      },
      { label: "确认存续段：", value: segmentLabel },
      {
        label: "时间节点：",
        value: timepoints.length
          ? timepoints.map((item) => `${formatStandardTime(item)}：${item.event || item.quotation || "未载事件"}`).join("；")
          : "没有时间节点。",
      },
      {
        label: "结构化关系：",
        value: relations.length
          ? relations.map((relation) => relation.label).join("；")
          : "没有直接演变关系。",
      },
      {
        label: "数据异常：",
        value: lane?.anomalies?.length
          ? `${lane.anomalies.length} 项时间链异常；各链按断开的轨道展示，不自动补线。`
          : "未发现多链头、悬空链接或环。",
      },
      { label: "职源与沿革：", value: dictionary.origin || dictionary.text || "原文未单列职源与沿革。" },
      { label: "出处：", value: dictionary.source || dictionary.catalog || dictionary.page || "当前实体未匹配到独立出处。" },
    ],
  };
}

function updateEvolutionDetails(svg) {
  const payload = evolutionDetailPayload(svg);
  if (!payload) return;
  const detailHeader = layoutDetailHeader(svg, payload.title, payload.year);

  let cursorY = 536.92 + detailHeader.contentOffsetY;
  DETAIL_PANEL_SECTION_KEYS.forEach((key, index) => {
    const label = svg.querySelector(`[data-detail-section-label='${key}']`);
    const content = svg.querySelector(`[data-detail-section-content='${key}']`);
    const section = payload.sections[index];
    if (!label || !content) return;
    if (!section) {
      label.style.display = "none";
      content.style.display = "none";
      return;
    }
    label.style.display = "";
    content.style.display = "";
    label.setAttribute("transform", `translate(100.33 ${cursorY})`);
    label.style.fill = "#351704";
    label.style.cursor = "default";
    d3.select(label).on("click.detail-field-link", null);
    setText(label, section.label);
    cursorY += 25;
    content.setAttribute("transform", `translate(101.29 ${cursorY})`);
    const lines = wrapText(content, section.value, 28, 18, Infinity);
    cursorY += Math.max(1, lines) * 18 + 13;
  });
  const scrollContent = svg.querySelector(".detail-panel-scroll-content");
  if (scrollContent) scrollContent.dataset.contentBottom = String(cursorY + 2);
  svg.querySelector(".detail-panel-group")?.__updateDetailScroll?.();
}

function transitionEndpointLabel(change) {
  const names = (ids) => ids.map((id) => titleOf(id)).join("、") || "未确定";
  if (change.type === "reparent") {
    return `${names([change.previousParentId])} → ${names([change.nextParentId])}`;
  }
  if (change.type === "create" || change.type === "restore") {
    return `来源未定 → ${names(change.targetIds)}`;
  }
  if (change.type === "remove") return `${names(change.sourceIds)} → 后继未定`;
  if (["evolve", "unclassified"].includes(change.type)) {
    return `${names(change.sourceIds)} → ${names(change.targetIds)}`;
  }
  return "同一机构保持对象身份";
}

function transitionEvidence(change) {
  const values = [...(change.citations || [])];
  if (change.quotation && !values.some((item) => item.quotation === change.quotation)) {
    values.unshift({ quotation: change.quotation, citation: "", note: "" });
  }
  return values;
}

function appendTrackTextLine(element, lineIndex, pieces) {
  let first = true;
  for (const piece of pieces) {
    const span = svgElement("tspan");
    if (first) {
      span.setAttribute("x", "0");
      span.setAttribute("y", String(lineIndex * 18));
      first = false;
    }
    span.textContent = piece.text;
    if (piece.className) span.classList.add(piece.className);
    if (piece.title) {
      const title = svgElement("title");
      title.textContent = piece.title;
      span.appendChild(title);
    }
    if (piece.onActivate) {
      span.setAttribute("role", "button");
      span.setAttribute("tabindex", "0");
      span.style.cursor = "pointer";
      d3.select(span)
        .on("click.transition-track", piece.onActivate)
        .on("keydown.transition-track", (event) => {
          if (event.key === "Enter" || event.key === " ") piece.onActivate(event);
        });
    }
    element.appendChild(span);
  }
}

function appendWrappedTrackText(element, text, lineIndex, className = "") {
  const normalized = String(text || "").replace(/\s+/g, " ").trim() || "未载说明";
  let offset = 0;
  let line = lineIndex;
  while (offset < normalized.length) {
    const chunk = normalized.slice(offset, offset + 27);
    appendTrackTextLine(element, line, [{ text: chunk, className }]);
    offset += chunk.length;
    line += 1;
  }
  return line;
}

function transitionTrackRenderKey(items) {
  let itemKey = transitionTrackItemKeyCache.get(items);
  if (!itemKey) {
    itemKey = items.map((change) => change.key).join(",");
    transitionTrackItemKeyCache.set(items, itemKey);
  }
  return [
    itemKey,
    focusedTransition.value?.key || "",
    [...expandedChangeEvidenceKeys].sort().join(","),
  ].join("|");
}

function renderTransitionTrackItems(svg, element, items) {
  const renderKey = transitionTrackRenderKey(items);
  if (element.dataset.transitionTrackRenderKey === renderKey) {
    return Number(element.dataset.transitionTrackLineCount) || 1;
  }
  element.replaceChildren();
  if (!items.length) {
    appendTrackTextLine(element, 0, [{ text: "当前机构暂无可定位的结构变化记录。" }]);
    element.dataset.transitionTrackRenderKey = renderKey;
    element.dataset.transitionTrackLineCount = "1";
    return 1;
  }
  let line = 0;
  items.forEach((change, index) => {
    const active = focusedTransition.value?.key === change.key;
    const yearLabel = change.eventYear != null ? `${change.eventYear}` : "未定";
    appendTrackTextLine(element, line, [
      { text: `${change.eventTime || `${yearLabel}年`} · `, className: active ? "is-focused" : "" },
      { text: CHANGE_TYPE_LABELS[change.type] || "结构变化", className: "transition-track-type" },
      { text: "  " },
      {
        text: `前往${yearLabel}年`,
        className: "transition-track-action",
        title: `跳转到${yearLabel}年制度截面`,
        onActivate: (event) => {
          event.preventDefault();
          event.stopPropagation();
          commitTimelineRange([change.eventYear, change.eventYear], { focusedChange: change });
        },
      },
    ]);
    line += 1;
    line = appendWrappedTrackText(element, change.eventText, line);
    line = appendWrappedTrackText(
      element,
      transitionEndpointLabel(change),
      line,
      "transition-track-endpoints",
    );
    const evidence = transitionEvidence(change);
    if (evidence.length) {
      const evidenceExpanded = expandedChangeEvidenceKeys.has(change.key);
      appendTrackTextLine(element, line, [{
        text: evidenceExpanded ? "收起证据" : `查看证据（${evidence.length}）`,
        className: "transition-track-action",
        onActivate: (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (evidenceExpanded) expandedChangeEvidenceKeys.delete(change.key);
          else expandedChangeEvidenceKeys.add(change.key);
          updateDetails(svg);
        },
      }]);
      line += 1;
      if (evidenceExpanded) {
        for (const evidenceItem of evidence) {
          if (evidenceItem.quotation) {
            line = appendWrappedTrackText(
              element,
              `原文：${evidenceItem.quotation}`,
              line,
              "transition-track-evidence",
            );
          }
          if (evidenceItem.citation) {
            line = appendWrappedTrackText(
              element,
              `出处：${evidenceItem.citation}`,
              line,
              "transition-track-evidence",
            );
          }
          if (evidenceItem.note) {
            line = appendWrappedTrackText(
              element,
              `说明：${evidenceItem.note}`,
              line,
              "transition-track-evidence",
            );
          }
        }
      }
    }
    if (index < items.length - 1) line += 0.55;
  });
  const lineCount = Math.max(1, line);
  element.dataset.transitionTrackRenderKey = renderKey;
  element.dataset.transitionTrackLineCount = String(lineCount);
  return lineCount;
}

function renderTransitionTrack(svg, element, entityId) {
  return renderTransitionTrackItems(
    svg,
    element,
    changesForEntity(structuralChangeIndex, entityId),
  );
}

function transitionSummaryText(entityId) {
  const items = changesForEntity(structuralChangeIndex, entityId);
  const summary = changeSummaryForEntity(
    structuralChangeIndex,
    entityId,
    selectedRange.value[0],
  );
  const parts = [`共${items.length}项结构变化`];
  if (summary.past) parts.push(`最近过去为${summary.past.year}年`);
  if (summary.current) parts.push(`同年${summary.current.count}项`);
  if (summary.future) parts.push(`最近未来为${summary.future.year}年`);
  return parts.join("；");
}

function groupTransitionSummaryText(group) {
  const items = group.changes || changesForEntities(structuralChangeIndex, group.memberEntityIds);
  const summary = changeSummaryForEntities(
    structuralChangeIndex,
    group.memberEntityIds,
    selectedRange.value[0],
  );
  const parts = [
    `组内${group.memberEntityIds.length}个机构`,
    `共${items.length}项结构变化`,
  ];
  if (summary.past) parts.push(`最近过去为${summary.past.year}年`);
  if (summary.current) parts.push(`同年${summary.current.count}项`);
  if (summary.future) parts.push(`最近未来为${summary.future.year}年`);
  return parts.join("；");
}

function updateGroupChangeDetails(svg, group) {
  INLINE_DETAIL_FIELDS.forEach((field) => {
    const label = svg.querySelector(`[data-detail-section-label='${field.key}']`);
    const content = svg.querySelector(`[data-detail-section-content='${field.key}']`);
    if (label) label.style.display = "none";
    if (content) content.style.display = "none";
  });
  const detailSlots = layoutDetailHeader(
    svg,
    `${group.title} · 组内变化`,
    selectedRangeLabel(),
  );
  const unusedExtra = svg.querySelector("[data-detail-section-label='extra-3']");
  const unusedExtraContent = svg.querySelector("[data-detail-section-content='extra-3']");
  if (unusedExtra) unusedExtra.style.display = "none";
  if (unusedExtraContent) unusedExtraContent.style.display = "none";
  let cursorY = 536.92 + detailSlots.contentOffsetY;
  const summaryLabel = svg.querySelector("[data-detail-section-label='extra-1']");
  const summaryContent = svg.querySelector("[data-detail-section-content='extra-1']");
  if (summaryLabel && summaryContent) {
    summaryLabel.style.display = "";
    summaryContent.style.display = "";
    summaryLabel.setAttribute("transform", `translate(100.33 ${cursorY})`);
    setText(summaryLabel, "组内结构变化：");
    summaryLabel.style.fill = "#866d6d";
    cursorY += 25;
    summaryContent.setAttribute("transform", `translate(101.29 ${cursorY})`);
    const summaryLines = wrapText(
      summaryContent,
      groupTransitionSummaryText(group),
      28,
      18,
      Infinity,
    );
    cursorY += Math.max(1, summaryLines) * 18 + 13;
  }
  const trackLabel = svg.querySelector("[data-detail-section-label='extra-2']");
  const trackContent = svg.querySelector("[data-detail-section-content='extra-2']");
  if (trackLabel && trackContent) {
    trackLabel.style.display = "";
    trackContent.style.display = "";
    trackLabel.setAttribute("transform", `translate(100.33 ${cursorY})`);
    setText(trackLabel, "组内演变轨：");
    trackLabel.style.fill = "#866d6d";
    cursorY += 25;
    trackContent.setAttribute("transform", `translate(101.29 ${cursorY})`);
    const trackLines = renderTransitionTrackItems(
      svg,
      trackContent,
      group.changes || changesForEntities(structuralChangeIndex, group.memberEntityIds),
    );
    cursorY += Math.max(1, trackLines) * 18 + 13;
  }
  const scrollContent = svg.querySelector(".detail-panel-scroll-content");
  if (scrollContent) scrollContent.dataset.contentBottom = String(cursorY + 2);
  if (pendingDetailSectionKey) {
    const target = svg.querySelector(
      `[data-detail-section-label='${pendingDetailSectionKey}']`,
    );
    const targetY = position(target)?.y;
    if (Number.isFinite(targetY)) detailPanelScrollOffset = Math.max(0, targetY - 536.92);
    pendingDetailSectionKey = null;
  }
  svg.querySelector(".detail-panel-group")?.__updateDetailScroll?.();
}

function updateDetails(svg) {
  if (isEvolutionCanvasMode()) {
    updateEvolutionDetails(svg);
    return;
  }
  if (changeTrackGroup.value) {
    updateGroupChangeDetails(svg, changeTrackGroup.value);
    return;
  }
  if (hierarchyReturnNotice.value && !hierarchyReturnNotice.value.active) {
    const notice = hierarchyReturnNotice.value;
    const detailHeader = layoutDetailHeader(
      svg,
      notice.title || "返回层级",
      selectedRangeLabel(),
    );
    const [firstField, ...hiddenFields] = INLINE_DETAIL_FIELDS;
    const label = svg.querySelector(`[data-detail-section-label='${firstField.key}']`);
    const content = svg.querySelector(`[data-detail-section-content='${firstField.key}']`);
    if (label && content) {
      label.style.display = "";
      content.style.display = "";
      label.setAttribute("transform", `translate(100.33 ${536.92 + detailHeader.contentOffsetY})`);
      setText(label, "当前实体：");
      content.setAttribute("transform", `translate(101.29 ${561.92 + detailHeader.contentOffsetY})`);
      wrapText(
        content,
        `${notice.title}在${notice.year}年未确认存续，未生成虚假节点；已返回该年份可确认的最小层级结构。`,
        28,
        18,
        Infinity,
      );
    }
    hiddenFields.forEach((field) => {
      svg.querySelector(`[data-detail-section-label='${field.key}']`)?.style.setProperty("display", "none");
      svg.querySelector(`[data-detail-section-content='${field.key}']`)?.style.setProperty("display", "none");
    });
    DETAIL_PANEL_EXTRA_KEYS.forEach((key) => {
      svg.querySelector(`[data-detail-section-label='${key}']`)?.style.setProperty("display", "none");
      svg.querySelector(`[data-detail-section-content='${key}']`)?.style.setProperty("display", "none");
    });
    const scrollContent = svg.querySelector(".detail-panel-scroll-content");
    if (scrollContent) scrollContent.dataset.contentBottom = String(650 + detailHeader.contentOffsetY);
    detailPanelScrollOffset = 0;
    svg.querySelector(".detail-panel-group")?.__updateDetailScroll?.();
    return;
  }
  const entity = selectedEntity();
  if (!entity) {
    const detailHeader = layoutDetailHeader(svg, selectedCategory.value, selectedRangeLabel());
    const contentOffsetY = detailHeader.contentOffsetY;
    const [firstField, ...hiddenFields] = INLINE_DETAIL_FIELDS;
    const label = svg.querySelector(`[data-detail-section-label='${firstField.key}']`);
    const content = svg.querySelector(`[data-detail-section-content='${firstField.key}']`);
    if (label && content) {
      label.style.display = "";
      content.style.display = "";
      label.setAttribute("transform", `translate(100.33 ${536.92 + contentOffsetY})`);
      content.setAttribute("transform", `translate(101.29 ${561.92 + contentOffsetY})`);
      setText(label, "当前截面：");
      wrapText(
        content,
        "所选年份没有可展示的非统称根机构。统称实体仍按规则排除；可切换年份或取消时间选择查看。",
        28,
        18,
        Infinity
      );
    }
    hiddenFields.forEach((field) => {
      const hiddenLabel = svg.querySelector(`[data-detail-section-label='${field.key}']`);
      const hiddenContent = svg.querySelector(`[data-detail-section-content='${field.key}']`);
      if (hiddenLabel) hiddenLabel.style.display = "none";
      if (hiddenContent) hiddenContent.style.display = "none";
    });
    DETAIL_PANEL_EXTRA_KEYS.forEach((key) => {
      const extraLabel = svg.querySelector(`[data-detail-section-label='${key}']`);
      const extraContent = svg.querySelector(`[data-detail-section-content='${key}']`);
      if (extraLabel) extraLabel.style.display = "none";
      if (extraContent) extraContent.style.display = "none";
    });
    const scrollContent = svg.querySelector(".detail-panel-scroll-content");
    if (scrollContent) scrollContent.dataset.contentBottom = String(650 + contentOffsetY);
    detailPanelScrollOffset = 0;
    svg.querySelector(".detail-panel-group")?.__updateDetailScroll?.();
    return;
  }
  const values = inlineDetailValues(entity);
  const staff = displayStaffFor(entity.id);
  const children = childrenFor(entity.id);
  DETAIL_PANEL_EXTRA_KEYS.forEach((key) => {
    const extraLabel = svg.querySelector(`[data-detail-section-label='${key}']`);
    const extraContent = svg.querySelector(`[data-detail-section-content='${key}']`);
    if (extraLabel) extraLabel.style.display = "none";
    if (extraContent) extraContent.style.display = "none";
  });

  const detailSlots = layoutDetailHeader(svg, entity.title, selectedRangeLabel());
  let cursorY = 536.92 + detailSlots.contentOffsetY;
  for (const field of INLINE_DETAIL_FIELDS) {
    const label = svg.querySelector(`[data-detail-section-label='${field.key}']`);
    const content = svg.querySelector(`[data-detail-section-content='${field.key}']`);
    if (!label || !content) continue;
    label.style.display = "";
    content.style.display = "";
    label.setAttribute("transform", `translate(100.33 ${cursorY})`);
    setText(label, field.label);
    label.style.cursor = "default";
    label.style.fill = inlineDetailField.value === field.key ? "#866d6d" : "#351704";
    d3.select(label).on("click.detail-field-link", null);
    cursorY += 25;
    content.setAttribute("transform", `translate(101.29 ${cursorY})`);
    let lines;
    if (field.key === "children" && children.length) {
      const tokens = children.flatMap((edge, index) => [
        { text: titleOf(edge.child), entityId: edge.child },
        ...(index < children.length - 1 ? [{ text: "、" }] : []),
      ]);
      lines = renderLinkedTokens(content, tokens, values.children);
    } else if (field.key === "composition" && staff.length) {
      const tokens = staff.flatMap((edge, index) => [
        { text: titleOf(edge.official), entityId: edge.official },
        { text: `（${edge.staff_quota ? `${edge.staff_quota}人` : "员额未载"}${edge.staff_type ? `，${edge.staff_type}` : ""}）` },
        ...(index < staff.length - 1 ? [{ text: "；" }] : []),
      ]);
      lines = renderLinkedTokens(content, tokens, values.composition);
    } else {
      lines = wrapText(content, values[field.key], 28, 18, Infinity);
    }
    cursorY += Math.max(1, lines) * 18 + 13;
  }
  if (changeTrackEntityId.value === entity.id) {
    const summaryLabel = svg.querySelector("[data-detail-section-label='extra-1']");
    const summaryContent = svg.querySelector("[data-detail-section-content='extra-1']");
    if (summaryLabel && summaryContent) {
      summaryLabel.style.display = "";
      summaryContent.style.display = "";
      summaryLabel.setAttribute("transform", `translate(100.33 ${cursorY})`);
      setText(summaryLabel, "结构变化：");
      summaryLabel.style.fill = "#866d6d";
      cursorY += 25;
      summaryContent.setAttribute("transform", `translate(101.29 ${cursorY})`);
      const summaryLines = wrapText(
        summaryContent,
        transitionSummaryText(entity.id),
        28,
        18,
        Infinity,
      );
      cursorY += Math.max(1, summaryLines) * 18 + 13;
    }
    const trackLabel = svg.querySelector("[data-detail-section-label='extra-2']");
    const trackContent = svg.querySelector("[data-detail-section-content='extra-2']");
    if (trackLabel && trackContent) {
      trackLabel.style.display = "";
      trackContent.style.display = "";
      trackLabel.setAttribute("transform", `translate(100.33 ${cursorY})`);
      setText(trackLabel, "演变轨：");
      trackLabel.style.fill = "#866d6d";
      cursorY += 25;
      trackContent.setAttribute("transform", `translate(101.29 ${cursorY})`);
      const trackLines = renderTransitionTrack(svg, trackContent, entity.id);
      cursorY += Math.max(1, trackLines) * 18 + 13;
    }
  }
  cursorY += 2;
  const scrollContent = svg.querySelector(".detail-panel-scroll-content");
  if (scrollContent) scrollContent.dataset.contentBottom = String(cursorY);
  const updateScroll = svg.querySelector(".detail-panel-group")?.__updateDetailScroll;
  if (pendingDetailSectionKey) {
    const target = svg.querySelector(
      `[data-detail-section-label='${pendingDetailSectionKey}']`
    );
    const targetY = position(target)?.y;
    if (Number.isFinite(targetY)) {
      detailPanelScrollOffset = Math.max(0, targetY - 536.92);
    }
    pendingDetailSectionKey = null;
  }
  updateScroll?.();

  // 第一画板顶部浮动卡：仍使用原有框、竖排槽位和官职条，只替换内容。
  if (viewMode.value === "hierarchy") {
    setText(findTextAt(svg, 763.56, 196.11), entity.title);
    const officialSlots = [...svg.querySelectorAll("text")]
      .filter((element) => {
        const point = position(element);
        return point && point.x >= 790 && point.x <= 1080 && point.y >= 180 && point.y <= 240 && titleMap.has(normalizeText(element));
      })
      .sort((a, b) => position(a).x - position(b).x);
    officialSlots.forEach((slot, index) => {
      const edge = staff[index];
      slot.style.display = edge ? "" : "none";
      if (!edge) return;
      setText(slot, titleOf(edge.official));
      slot.dataset.entityId = String(edge.official);
      d3.select(slot).on("click", (event) => {
        event.stopPropagation();
        detailPanelScrollOffset = 0;
        selectedId.value = edge.official;
        refreshTemplate();
      });
      const slotPoint = position(slot);
      const quotaSlot = [...svg.querySelectorAll("text")].find((candidate) => {
        const point = position(candidate);
        return point && Math.abs(point.x - (slotPoint.x - 7.5)) < 4 && Math.abs(point.y - 269.7) < 2;
      });
      if (quotaSlot) setText(quotaSlot, edge.staff_quota ? `（${edge.staff_quota}）` : "（未载）");
    });
  }
}

function bindSpaceAwareExpansionControl(svg) {
  let control = svg.querySelector(".space-aware-expansion-control");
  if (!control) {
    const ns = "http://www.w3.org/2000/svg";
    control = document.createElementNS(ns, "g");
    control.classList.add("space-aware-expansion-control");
    control.setAttribute(
      "transform",
      `translate(${HIERARCHY_HEADER_LAYOUT.spaceControlX} ${HIERARCHY_HEADER_LAYOUT.settingsY})`,
    );
    control.setAttribute("role", "switch");
    control.setAttribute("tabindex", "0");
    control.style.cursor = "pointer";

    const outline = document.createElementNS(ns, "rect");
    outline.dataset.controlPart = "outline";
    outline.setAttribute("x", "0");
    outline.setAttribute("y", "0");
    outline.setAttribute("width", String(HIERARCHY_HEADER_LAYOUT.controlWidth));
    outline.setAttribute("height", String(HIERARCHY_HEADER_LAYOUT.settingsHeight));
    outline.setAttribute("fill", "#563905");
    outline.setAttribute("stroke", "#563905");

    const backPage = document.createElementNS(ns, "rect");
    backPage.dataset.controlPart = "back-page";
    backPage.setAttribute("x", "12");
    backPage.setAttribute("y", "9");
    backPage.setAttribute("width", "11");
    backPage.setAttribute("height", "16");
    backPage.setAttribute("fill", "none");
    backPage.setAttribute("stroke", "#563905");
    backPage.setAttribute("stroke-width", "0.9");

    const frontPage = backPage.cloneNode(false);
    frontPage.dataset.controlPart = "front-page";
    frontPage.setAttribute("x", "18");
    frontPage.setAttribute("y", "12");

    const label = document.createElementNS(ns, "text");
    label.setAttribute("class", "cls-49");
    label.setAttribute("x", "38");
    label.setAttribute("y", "18");
    label.setAttribute("dominant-baseline", "central");
    label.textContent = "空间展开";

    const title = document.createElementNS(ns, "title");
    control.append(outline, backPage, frontPage, label, title);
    svg.appendChild(control);
  }

  const sync = () => {
    const enabled = spaceAwareExpansion.value;
    const outline = control.querySelector("[data-control-part='outline']");
    const frontPage = control.querySelector("[data-control-part='front-page']");
    control.style.display = viewMode.value === "hierarchy" ? "" : "none";
    control.setAttribute("aria-checked", String(enabled));
    control.setAttribute(
      "aria-label",
      enabled
        ? "关闭空间展开，恢复单节点展开"
        : "开启空间展开，保留所有已展开机构，空间不足时使用底部滚动条"
    );
    outline.setAttribute("fill-opacity", enabled ? "0.12" : "0");
    outline.setAttribute("stroke-width", enabled ? "1.35" : "0.8");
    frontPage.setAttribute("fill", enabled ? "#563905" : "none");
    frontPage.setAttribute("fill-opacity", enabled ? "0.16" : "0");
    control.querySelector("title").textContent = enabled
      ? "空间展开已开启：保留所有已展开机构，空间不足时使用底部滚动条"
      : "空间展开已关闭：点击新节点时收起旧分支";
  };

  const toggle = (event) => {
    event.preventDefault();
    event.stopPropagation();
    spaceAwareExpansion.value = !spaceAwareExpansion.value;
    if (!spaceAwareExpansion.value) {
      expandedInstitutionGroupIds = collapseInstitutionGroups(
        expandedInstitutionGroupIds,
        lastExpandedInstitutionGroupId
      );
      expandedSubordinateGroupIds = collapseInstitutionGroups(
        expandedSubordinateGroupIds,
        lastExpandedSubordinateGroupId
      );
    }
    if (!spaceAwareExpansion.value && expandedHierarchyPath.length > 1) {
      const focusId = lastExpandedHierarchyId ?? expandedHierarchyPath.at(-1);
      expandedHierarchyPath = focusId == null
        ? []
        : resolveHierarchyContext(focusId, hierarchyEdgesForView(), entityMap).path;
    }
    hierarchyPanX = 0;
    hierarchyPanY = 0;
    sync();
    refreshTemplate();
  };
  d3.select(control)
    .on("click.space-aware-expansion", toggle)
    .on("keydown.space-aware-expansion", (event) => {
      if (event.key === "Enter" || event.key === " ") toggle(event);
    })
    .on("mouseenter.space-aware-expansion", () => {
      control.querySelector("[data-control-part='outline']")?.setAttribute("stroke-width", "1.35");
    })
    .on("mouseleave.space-aware-expansion", sync);
  svg.__syncSpaceAwareExpansionControl = sync;
  sync();
}

function bindHierarchyAnimationControl(svg) {
  let control = svg.querySelector(".hierarchy-animation-control");
  if (!control) {
    const ns = "http://www.w3.org/2000/svg";
    control = document.createElementNS(ns, "g");
    control.classList.add("hierarchy-animation-control");
    control.setAttribute(
      "transform",
      `translate(${HIERARCHY_HEADER_LAYOUT.animationControlX} ${HIERARCHY_HEADER_LAYOUT.settingsY})`,
    );
    control.setAttribute("role", "switch");
    control.setAttribute("tabindex", "0");
    control.style.cursor = "pointer";

    const outline = document.createElementNS(ns, "rect");
    outline.dataset.controlPart = "outline";
    outline.setAttribute("x", "0");
    outline.setAttribute("y", "0");
    outline.setAttribute("width", String(HIERARCHY_HEADER_LAYOUT.controlWidth));
    outline.setAttribute("height", String(HIERARCHY_HEADER_LAYOUT.settingsHeight));
    outline.setAttribute("fill", "#563905");
    outline.setAttribute("stroke", "#563905");

    const track = document.createElementNS(ns, "rect");
    track.dataset.controlPart = "track";
    track.setAttribute("x", "12");
    track.setAttribute("y", "11.5");
    track.setAttribute("width", "30");
    track.setAttribute("height", "13");
    track.setAttribute("rx", "6.5");
    track.setAttribute("fill", "none");
    track.setAttribute("stroke", "#563905");
    track.setAttribute("stroke-width", "0.9");

    const thumb = document.createElementNS(ns, "circle");
    thumb.dataset.controlPart = "thumb";
    thumb.setAttribute("cy", "18");
    thumb.setAttribute("r", "4.5");
    thumb.setAttribute("fill", "#563905");

    const label = document.createElementNS(ns, "text");
    label.setAttribute("class", "cls-49");
    label.setAttribute("x", "51");
    label.setAttribute("y", "18");
    label.setAttribute("dominant-baseline", "central");
    label.textContent = "层级动画";

    const title = document.createElementNS(ns, "title");
    control.append(outline, track, thumb, label, title);
    svg.appendChild(control);
  }

  const sync = () => {
    const reduceMotion = Boolean(reduceMotionQuery?.matches);
    const enabled = hierarchyAnimationEnabled.value && !reduceMotion;
    const outline = control.querySelector("[data-control-part='outline']");
    const track = control.querySelector("[data-control-part='track']");
    const thumb = control.querySelector("[data-control-part='thumb']");
    control.style.display = viewMode.value === "hierarchy" ? "" : "none";
    control.style.cursor = reduceMotion ? "not-allowed" : "pointer";
    control.setAttribute("tabindex", reduceMotion ? "-1" : "0");
    control.setAttribute("aria-disabled", String(reduceMotion));
    control.setAttribute("aria-checked", String(enabled));
    control.setAttribute(
      "aria-label",
      reduceMotion
        ? "系统已开启减少动态，层级动画不可用"
        : (enabled ? "关闭层级动画，时间切换立即完成" : "开启层级动画，展示机构退出、移动和新增")
    );
    outline.setAttribute("fill-opacity", enabled ? "0.12" : "0");
    outline.setAttribute("stroke-width", enabled ? "1.35" : "0.8");
    track.setAttribute("fill", enabled ? "#563905" : "none");
    track.setAttribute("fill-opacity", enabled ? "0.16" : "0");
    thumb.setAttribute("cx", enabled ? "35.5" : "18.5");
    thumb.setAttribute("fill-opacity", reduceMotion ? "0.38" : "1");
    control.querySelector("title").textContent = reduceMotion
      ? "系统减少动态已开启：年份切换将直接完成"
      : (enabled
        ? "层级动画已开启：依次展示退出、平移和新增"
        : "层级动画已关闭：年份切换直接完成");
  };

  const toggle = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (reduceMotionQuery?.matches) return;
    hierarchyAnimationEnabled.value = !hierarchyAnimationEnabled.value;
    if (!hierarchyAnimationEnabled.value) {
      cancelHierarchyTransition(svg);
      refreshTemplate();
    }
    sync();
  };
  d3.select(control)
    .on("click.hierarchy-animation", toggle)
    .on("keydown.hierarchy-animation", (event) => {
      if (event.key === "Enter" || event.key === " ") toggle(event);
    })
    .on("mouseenter.hierarchy-animation", () => {
      if (!reduceMotionQuery?.matches) {
        control.querySelector("[data-control-part='outline']")?.setAttribute("stroke-width", "1.35");
      }
    })
    .on("mouseleave.hierarchy-animation", sync);
  svg.__syncHierarchyAnimationControl = sync;
  sync();
}

function bindVirtualNodeVisibilityControl(svg) {
  let control = svg.querySelector(".virtual-node-visibility-control");
  if (!control) {
    const ns = "http://www.w3.org/2000/svg";
    control = document.createElementNS(ns, "g");
    control.classList.add("virtual-node-visibility-control");
    control.setAttribute(
      "transform",
      `translate(${HIERARCHY_HEADER_LAYOUT.virtualNodeControlX} ${HIERARCHY_HEADER_LAYOUT.settingsY})`,
    );
    control.setAttribute("role", "switch");
    control.setAttribute("tabindex", "0");
    control.style.cursor = "pointer";

    const outline = document.createElementNS(ns, "rect");
    outline.dataset.controlPart = "outline";
    outline.setAttribute("x", "0");
    outline.setAttribute("y", "0");
    outline.setAttribute("width", String(HIERARCHY_HEADER_LAYOUT.controlWidth));
    outline.setAttribute("height", String(HIERARCHY_HEADER_LAYOUT.settingsHeight));
    outline.setAttribute("fill", "#563905");
    outline.setAttribute("stroke", "#563905");

    // 沿用层级动画开关已有的轨道和滑块样式，避免为同类设置另造图标。
    const track = document.createElementNS(ns, "rect");
    track.dataset.controlPart = "track";
    track.setAttribute("x", "12");
    track.setAttribute("y", "11.5");
    track.setAttribute("width", "30");
    track.setAttribute("height", "13");
    track.setAttribute("rx", "6.5");
    track.setAttribute("fill", "none");
    track.setAttribute("stroke", "#563905");
    track.setAttribute("stroke-width", "0.9");

    const thumb = document.createElementNS(ns, "circle");
    thumb.dataset.controlPart = "thumb";
    thumb.setAttribute("cy", "18");
    thumb.setAttribute("r", "4.5");
    thumb.setAttribute("fill", "#563905");

    const label = document.createElementNS(ns, "text");
    label.setAttribute("class", "cls-49");
    label.setAttribute("x", "51");
    label.setAttribute("y", "18");
    label.setAttribute("dominant-baseline", "central");
    label.textContent = "虚拟节点";

    const title = document.createElementNS(ns, "title");
    control.append(outline, track, thumb, label, title);
    svg.appendChild(control);
  }

  const sync = () => {
    const enabled = showVirtualNodes.value;
    const outline = control.querySelector("[data-control-part='outline']");
    const track = control.querySelector("[data-control-part='track']");
    const thumb = control.querySelector("[data-control-part='thumb']");
    control.style.display = viewMode.value === "hierarchy" ? "" : "none";
    control.setAttribute("aria-checked", String(enabled));
    control.setAttribute(
      "aria-label",
      enabled ? "隐藏虚拟节点，保留真实机构和上下级关系" : "显示虚拟节点",
    );
    outline.setAttribute("fill-opacity", enabled ? "0.12" : "0");
    outline.setAttribute("stroke-width", enabled ? "1.35" : "0.8");
    track.setAttribute("fill", enabled ? "#563905" : "none");
    track.setAttribute("fill-opacity", enabled ? "0.16" : "0");
    thumb.setAttribute("cx", enabled ? "35.5" : "18.5");
    control.querySelector("title").textContent = enabled
      ? "虚拟节点已显示：包括类别、制度组和下属分组"
      : "虚拟节点已隐藏：只显示真实机构及其历史上下级关系";
  };

  const toggle = (event) => {
    event.preventDefault();
    event.stopPropagation();
    showVirtualNodes.value = !showVirtualNodes.value;
    hierarchyPanFocusId = selectedId.value;
    sync();
    refreshTemplate();
  };
  d3.select(control)
    .on("click.virtual-node-visibility", toggle)
    .on("keydown.virtual-node-visibility", (event) => {
      if (event.key === "Enter" || event.key === " ") toggle(event);
    })
    .on("mouseenter.virtual-node-visibility", () => {
      control.querySelector("[data-control-part='outline']")?.setAttribute("stroke-width", "1.35");
    })
    .on("mouseleave.virtual-node-visibility", sync);
  svg.__syncVirtualNodeVisibilityControl = sync;
  sync();
}

function enterEvolutionView({ entityId = null, sourceView = viewMode.value } = {}) {
  if (viewModeLocked.value) return;
  const requested = entityId != null ? entityMap.get(entityId) : null;
  // 顶部“演变视图”按钮没有显式传入 ID 时，应以用户刚点击的实体为准。
  // compositionFocusId 记录的是编制视图的父机构，不能覆盖层级视图中
  // 刚选中的下属机构（例如点击“补写所”后仍然沿用“秘书省”）。
  const selected = entityMap.get(selectedId.value);
  const compositionFocus = entityMap.get(compositionFocusId.value);
  const focus = requested || selected || compositionFocus || graphFocusEntity();
  if (focus) {
    selectedId.value = focus.id;
    evolutionEntityIds.value = [focus.id];
  }
  setEvolutionEntryContext(focus?.id ?? null, sourceView);
  hierarchyReturnNotice.value = null;
  evolutionMode.value = "single";
  selectedEvolutionItem.value = null;
  evolutionLanePage.value = 1;
  evolutionSearchOpen.value = false;
  detailPanelScrollOffset = 0;
  viewMode.value = "evolution";
}

function evolutionReturnEntityId() {
  const selectedItem = selectedEvolutionItem.value;
  if (selectedItem?.kind === "timepoint" && selectedItem.item?.entityId != null) {
    return selectedItem.item.entityId;
  }
  return selectedId.value ?? evolutionEntryContext.value?.entryEntityId ?? null;
}

function evolutionHierarchyResolution() {
  const selectedItem = selectedEvolutionItem.value;
  if (selectedItem?.kind !== "timepoint") return { targets: [] };
  const year = evolutionSelectionComparison(
    selectedItem,
    evolutionEntryContext.value?.entryYear,
  )?.year;
  if (year == null) {
    return { targets: [], message: "该时间点年份未定，无法定位编制机构" };
  }

  const requested = entityMap.get(selectedItem.item?.entityId);
  if (!requested) return { targets: [], message: `${year}年没有明确编制机构` };
  const snapshot = yearSnapshot(year);
  const snapshotStaffEdges = requested.type === "官职"
    ? staffEdgesForEvolutionTimepoint({
      officialId: requested.id,
      timepointId: selectedItem.item?.id,
      staffEdges: props.data.staffEdges || [],
      snapshotStaffEdges: snapshot.staffEdges,
    })
    : snapshot.staffEdges;
  const contexts = resolveHierarchyReturnContexts({
    entityId: requested.id,
    entities: props.data.entities,
    hierarchyEdges: snapshot.hierarchyEdges,
    staffEdges: snapshotStaffEdges,
    activeEntityIds: snapshot.entityIds,
  });
  if (requested.type === "官职" && !contexts.length) {
    return { targets: [], message: `${year}年没有明确编制机构` };
  }
  return {
    targets: contexts.map((context) => ({
      entityId: context.institutionId,
      title: context.institutionTitle,
      year,
    })),
  };
}

function openHierarchyFromEvolution({ entityId = null, year = null, reason = "entry" } = {}) {
  if (viewModeLocked.value) return;
  const requestedId = entityId ?? evolutionReturnEntityId();
  const requested = entityMap.get(requestedId);
  if (!requested) return;
  const targetYear = Number.isFinite(Number(year))
    ? Math.round(Number(year))
    : currentCanvasYear();
  const targetSnapshot = yearSnapshot(targetYear);
  const context = resolveHierarchyReturnContext({
    entityId: requested.id,
    entities: props.data.entities,
    hierarchyEdges: targetSnapshot.hierarchyEdges,
    staffEdges: targetSnapshot.staffEdges,
    activeEntityIds: targetSnapshot.entityIds,
  });
  if (!context) return;

  const institution = entityMap.get(context.institutionId);
  if (!institution) return;
  if (targetYear !== currentCanvasYear()) {
    commitTimelineRange([targetYear, targetYear]);
  }
  selectedId.value = institution.id;
  selectedEvolutionItem.value = null;
  focusHierarchyContext(institution, true);
  hierarchyReturnNotice.value = context.active
    ? null
    : {
      requestedEntityId: requested.id,
      institutionId: institution.id,
      title: requested.title,
      year: targetYear,
      reason,
    };
  viewMode.value = "hierarchy";
}

function restoreHierarchyFocus() {
  openHierarchyFromEvolution({ reason: "top-entry" });
}

function ensureTimetreeViewControl(svg) {
  let control = svg.querySelector(".timetree-view-control");
  if (!control) {
    control = svgElement("g", { class: "timetree-view-control" });
    // 演变视图按钮在 1248.5，空间展开控件在 1392（层级视图内显示）；
    // 时间线树放在演变视图左侧，避开两者。
    const surface = svgElement("rect", {
      x: 1110.5,
      y: 80,
      width: 125.8,
      height: 26,
      rx: 2.7,
      fill: "#a5a68d",
      "fill-opacity": 0,
      stroke: "#563905",
      "stroke-width": 0.78,
      "stroke-opacity": 0.42,
    });
    const template = findTextAt(svg, 1570.42, 98.84, 2);
    const label = template?.cloneNode(true) || svgElement("text", { class: "cls-49" });
    label.setAttribute("transform", "translate(1173.4 98.84)");
    label.setAttribute("text-anchor", "middle");
    setText(label, "时间线树");
    control.append(surface, label);
    svg.appendChild(control);
  }
  const active = viewMode.value === "timetree";
  if (viewModeLocked.value) {
    control.style.display = "none";
    return;
  }
  control.style.display = "";
  const surface = control.querySelector("rect");
  const label = control.querySelector("text");
  surface?.setAttribute("fill-opacity", active ? "0.30" : "0");
  surface?.setAttribute("stroke-opacity", active ? "0.8" : "0.42");
  if (label) label.style.fontWeight = active ? "700" : "400";
  const activate = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (active) return;
    selectedEvolutionItem.value = null;
    viewMode.value = "timetree";
  };
  control.setAttribute("role", "button");
  control.setAttribute("tabindex", active ? "-1" : "0");
  control.setAttribute("aria-label", active ? "当前为时间线树视图" : "打开时间线树视图");
  control.style.cursor = active ? "default" : "pointer";
  d3.select(control)
    .on("click.timetree-view", active ? null : activate)
    .on("keydown.timetree-view", active ? null : (event) => {
      if (event.key === "Enter" || event.key === " ") activate(event);
    });
}

function ensureEvolutionViewControl(svg) {
  // 三个视图始终等距排列；层级设置独立放在上一行，不再挤占视图位置。
  const layout = {
    surfaceX: HIERARCHY_HEADER_LAYOUT.evolutionViewX,
    labelX: HIERARCHY_HEADER_LAYOUT.evolutionViewLabelX,
  };
  let control = svg.querySelector(".evolution-view-control");
  if (!control) {
    control = svgElement("g", { class: "evolution-view-control" });
    const surface = svgElement("rect", {
      x: layout.surfaceX,
      y: HIERARCHY_HEADER_LAYOUT.viewRowY,
      width: 125.8,
      height: 26,
      rx: 2.7,
      fill: "#a5a68d",
      "fill-opacity": 0,
      stroke: "#563905",
      "stroke-width": 0.78,
      "stroke-opacity": 0.42,
    });
    const template = findTextAt(svg, 1570.42, 98.84, 2);
    const label = template?.cloneNode(true) || svgElement("text", { class: "cls-49" });
    label.setAttribute("transform", `translate(${layout.labelX} 98.84)`);
    label.setAttribute("text-anchor", "middle");
    setText(label, "演变视图");
    control.append(surface, label);
    svg.appendChild(control);
  }
  const active = viewMode.value === "evolution";
  if (viewModeLocked.value) {
    control.style.display = "none";
    return;
  }
  control.style.display = "";
  const surface = control.querySelector("rect");
  const label = control.querySelector("text");
  surface?.setAttribute("x", String(layout.surfaceX));
  label?.setAttribute("transform", `translate(${layout.labelX} 98.84)`);
  surface?.setAttribute("fill-opacity", active ? "0.30" : "0");
  surface?.setAttribute("stroke-opacity", active ? "0.8" : "0.42");
  if (label) label.style.fontWeight = active ? "700" : "400";
  makeEvolutionControlInteractive(control, active);
}

function ensureComparisonViewControl(svg) {
  let control = svg.querySelector(".comparison-view-control");
  if (!control) {
    control = svgElement("g", { class: "comparison-view-control" });
    // 与时间线树、演变视图放在同一行；保留较宽按钮容纳完整名称，
    // 右侧与时间线树保持和同组控件一致的 12.2px 间距。
    const surface = svgElement("rect", {
      x: 960.5,
      y: 80,
      width: 137.8,
      height: 26,
      rx: 2.7,
      fill: "#a5a68d",
      "fill-opacity": 0,
      stroke: "#563905",
      "stroke-width": 0.78,
      "stroke-opacity": 0.42,
    });
    const template = findTextAt(svg, 1570.42, 98.84, 2);
    const label = template?.cloneNode(true) || svgElement("text", { class: "cls-49" });
    label.setAttribute("transform", "translate(1029.4 98.84)");
    label.setAttribute("text-anchor", "middle");
    setText(label, "层级·演变对照");
    control.append(surface, label);
    svg.appendChild(control);
  }
  const active = viewMode.value === "comparison";
  const surface = control.querySelector("rect");
  const label = control.querySelector("text");
  surface?.setAttribute("fill-opacity", active ? "0.30" : "0");
  surface?.setAttribute("stroke-opacity", active ? "0.8" : "0.42");
  if (label) label.style.fontWeight = active ? "700" : "400";
  control.setAttribute("role", "button");
  control.setAttribute("tabindex", active ? "-1" : "0");
  control.setAttribute("aria-label", active ? "当前为层级与演变对照视图" : "打开层级与演变对照视图");
  control.style.cursor = active ? "default" : "pointer";
  const activate = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!active && !viewModeLocked.value) emit("open-comparison");
  };
  d3.select(control)
    .on("click.comparison-view", active || viewModeLocked.value ? null : activate)
    .on("keydown.comparison-view", active || viewModeLocked.value ? null : (event) => {
      if (event.key === "Enter" || event.key === " ") activate(event);
    });
}

function makeEvolutionControlInteractive(control, active) {
  const activate = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!active) enterEvolutionView();
  };
  control.setAttribute("role", "button");
  control.setAttribute("tabindex", active ? "-1" : "0");
  control.setAttribute("aria-label", active ? "当前为演变视图" : "打开演变视图");
  control.style.cursor = active ? "default" : "pointer";
  d3.select(control)
    .on("click.evolution-view", active ? null : activate)
    .on("keydown.evolution-view", active ? null : (event) => {
      if (event.key === "Enter" || event.key === " ") activate(event);
    });
}

function bindTemplateControls(svg) {
  svg.querySelectorAll(".view-mode-hit-area").forEach((element) => element.remove());
  ensureEvolutionViewControl(svg);
  ensureGlobalUndoControl(svg);
  bindVirtualNodeVisibilityControl(svg);
  svg.querySelector(".timetree-view-control")?.remove();
  svg.querySelector(".comparison-view-control")?.remove();
  const categoryItems = templateCategoryItems(svg);
  const selectionTemplate = categoryItems
    .map(({ group }) => [...group.children].find(
      (child) => child.tagName.toLowerCase() === "g"
        && (
          child.classList.contains("cls-81")
          || child.classList.contains("cls-59")
          || child.classList.contains("shared-category-selection")
        )
    ))
    .find(Boolean)?.cloneNode(true);

  for (const { group } of categoryItems) {
    [...group.children]
      .filter((child) => child.tagName.toLowerCase() === "g"
        && (
          child.classList.contains("cls-81")
          || child.classList.contains("cls-59")
          || child.classList.contains("shared-category-selection")
        ))
      .forEach((child) => child.remove());
  }

  const selectedItem = categoryItems.find(
    ({ category }) => category === templateSelectionCategory()
  );
  const selectedOutline = selectedItem
    ? [...selectedItem.group.children].find((child) => child.tagName.toLowerCase() === "polygon")
    : null;
  if (selectionTemplate && selectedItem && selectedOutline) {
    const selectionPolygon = selectionTemplate.querySelector("polygon");
    selectionPolygon?.setAttribute("points", selectedOutline.getAttribute("points") || "");
    selectedItem.group.insertBefore(selectionTemplate, selectedItem.group.firstChild);
  }

  d3.select(svg)
    .selectAll("text")
    .each(function () {
      if (this.closest(".dynamic-tree-layer, .dynamic-evolution-layer, .evolution-view-control")) return;
      const text = normalizeText(this);
      if (text === "层级视图" || text === "编制视图") {
        const targetMode = text === "层级视图" ? "hierarchy" : "composition";
        const viewLabelCenter = targetMode === "hierarchy"
          ? HIERARCHY_HEADER_LAYOUT.hierarchyViewLabelX
          : HIERARCHY_HEADER_LAYOUT.compositionViewLabelX;
        this.setAttribute("text-anchor", "middle");
        this.setAttribute("transform", `translate(${viewLabelCenter} 98.84)`);
        const returningFromEvolution = targetMode === "hierarchy"
          && viewMode.value === "evolution";
        const returnLabel = returningFromEvolution ? "返回层级" : "层级视图";
        // 编制视图只能从层级机构词条的右下角入口进入；顶栏只承担返回层级。
        const canActivate = !viewModeLocked.value && targetMode === "hierarchy"
          && (viewMode.value === "composition"
            || viewMode.value === "evolution");
        const activateView = (event) => {
          event.stopPropagation();
          if (!canActivate) return;
          if (viewMode.value === "evolution") {
            openHierarchyFromEvolution({ reason: "top-entry" });
          } else if (compositionFocusId.value != null) {
            const focus = entityMap.get(compositionFocusId.value);
            if (focus) {
              selectedId.value = focus.id;
              focusHierarchyContext(focus, true);
            }
          }
          if (!viewModeLocked.value) viewMode.value = "hierarchy";
        };
        if (targetMode === "hierarchy") setText(this, returnLabel);
        this.style.cursor = canActivate ? "pointer" : "default";
        this.style.fontWeight = targetMode === viewMode.value ? "700" : "400";
        this.setAttribute(
          "aria-label",
          returningFromEvolution
            ? `返回层级（${currentCanvasYear() === evolutionEntryYear() ? "入口年" : "当前年"}）`
            : "层级视图",
        );
        d3.select(this).on("click.view-mode", canActivate ? activateView : null);
        const bounds = elementBounds(this);
        if (canActivate && bounds && this.parentNode) {
          const hitArea = document.createElementNS("http://www.w3.org/2000/svg", "rect");
          hitArea.classList.add("view-mode-hit-area");
          hitArea.setAttribute("x", String(bounds.x - 12));
          hitArea.setAttribute("y", String(bounds.y - 8));
          hitArea.setAttribute("width", String(bounds.width + 24));
          hitArea.setAttribute("height", String(bounds.height + 16));
          hitArea.setAttribute("fill", "transparent");
          hitArea.setAttribute("pointer-events", "all");
          hitArea.style.cursor = "pointer";
          const transform = this.getAttribute("transform");
          if (transform) hitArea.setAttribute("transform", transform);
          this.parentNode.insertBefore(hitArea, this);
          d3.select(hitArea).on("click.view-mode", activateView);
        }
      }

      if (CATEGORY_NAMES.includes(text)) {
        const category = text;
        const group = this.parentElement;
        const categoryInteractive = viewMode.value === "hierarchy";
        if (!categoryInteractive) {
          this.style.cursor = "default";
          d3.select(this).on("click.category", null);
          if (group?.tagName.toLowerCase() === "g") {
            group.style.cursor = "default";
            group.style.pointerEvents = "none";
            d3.select(group).on("click.category", null);
          }
          return;
        }
        const activate = (event) => {
          event.stopPropagation();
          detailPanelScrollOffset = 0;
          collapsedHierarchyIds.clear();
          expandedHierarchyPath = [];
          lastExpandedHierarchyId = null;
          hierarchyPanX = 0;
          hierarchyPanY = 0;
          selectedCategory.value = category;
          selectedId.value = null;
          expandedDetailId.value = null;
          inlineDetailOfficialId.value = null;
          const focus = categoryFocus(category);
          lastExpandedInstitutionGroupId = focus
            ? institutionGroupId(category, entityInstitutionGroup(focus, category))
            : null;
          expandedInstitutionGroupIds = lastExpandedInstitutionGroupId
            ? [lastExpandedInstitutionGroupId]
            : [];
          refreshTemplate({ rebindControls: true });
        };
        this.style.cursor = "pointer";
        d3.select(this).on("click.category", activate);
        if (group?.tagName.toLowerCase() === "g") {
          group.style.cursor = "pointer";
          group.style.pointerEvents = "bounding-box";
          d3.select(group).on("click.category", activate);
        }
      }
    });

  bindSpaceAwareExpansionControl(svg);
  bindHierarchyAnimationControl(svg);

}

function matrixTransformValue(matrix) {
  return `matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`;
}

function transformedCenter(node, matrix) {
  const shape = node.querySelector("polygon, rect:not(.dynamic-tree-node-hit-area)");
  const bounds = elementBounds(shape || node);
  if (!bounds) return { x: matrix.e, y: matrix.f };
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  return {
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f,
  };
}

function captureHierarchyFrame(svg, { cloneNodes = false } = {}) {
  const nodes = new Map();
  const rootMatrix = svg.getCTM?.();
  svg.querySelectorAll(".dynamic-tree-node[data-entity-id]").forEach((node) => {
    const entityId = Number(node.dataset.entityId);
    const matrix = relativeAffineMatrix(rootMatrix, node.getCTM?.());
    if (!Number.isFinite(entityId) || !matrix) return;
    nodes.set(entityId, {
      entityId,
      matrix,
      center: transformedCenter(node, matrix),
      cloneSource: cloneNodes ? node : null,
    });
  });
  const links = cloneNodes
    ? [...svg.querySelectorAll(".dynamic-tree-link[data-source-entity-id]")].map((link) => {
      const matrix = relativeAffineMatrix(rootMatrix, link.getCTM?.());
      return matrix ? {
        cloneSource: link,
        matrix,
        sourceId: Number(link.dataset.sourceEntityId),
        targetId: Number(link.dataset.targetEntityId),
      } : null;
    }).filter(Boolean)
    : [];
  return { nodes, links };
}

function cloneHierarchyTransitionNode(item) {
  const clone = item?.cloneSource?.cloneNode(true);
  if (!clone) return null;
  clone.querySelectorAll(
    ".node-change-indicator, .composition-detail-button, .dynamic-tree-node-hit-area, title",
  ).forEach((element) => element.remove());
  clone.removeAttribute("role");
  clone.removeAttribute("tabindex");
  clone.removeAttribute("aria-label");
  clone.style.pointerEvents = "none";
  clone.style.visibility = "visible";
  return clone;
}

function cloneHierarchyTransitionLink(item) {
  const clone = item?.cloneSource?.cloneNode(false);
  if (!clone) return null;
  clone.classList.add("hierarchy-transition-old-link");
  clone.setAttribute("transform", matrixTransformValue(item.matrix));
  clone.style.pointerEvents = "none";
  return clone;
}

function hierarchyMatrixChanged(previous, next, threshold = 0.35) {
  return ["a", "b", "c", "d", "e", "f"]
    .some((key) => Math.abs(previous[key] - next[key]) > threshold);
}

function transitionLinePoints(parent, child) {
  const middleY = (parent.y + child.y) / 2;
  return `${parent.x},${parent.y} ${parent.x},${middleY} ${child.x},${middleY} ${child.x},${child.y}`;
}

function cancelHierarchyTransition(svg) {
  activeTransitionAnimation += 1;
  if (activeTransitionCleanupFrame != null) {
    window.cancelAnimationFrame(activeTransitionCleanupFrame);
    activeTransitionCleanupFrame = null;
  }
  d3.select(svg)
    .selectAll(".dynamic-tree-node, .dynamic-tree-link")
    .interrupt("hierarchy-time");
  const previousOverlay = svg.querySelector(".hierarchy-transition-layer");
  if (previousOverlay) {
    d3.select(previousOverlay).selectAll("*").interrupt("hierarchy-time");
    previousOverlay.remove();
  }
}

function playHierarchyTransition(svg, oldFrame, changes) {
  cancelHierarchyTransition(svg);
  const revision = ++activeTransitionAnimation;
  const newFrame = captureHierarchyFrame(svg);
  newFrame.nodes.forEach((item, entityId) => {
    item.node = svg.querySelector(`.dynamic-tree-node[data-entity-id='${entityId}']`);
  });
  if (!oldFrame?.nodes?.size || reduceMotionQuery?.matches) {
    return;
  }

  // 三阶段过渡：退出 → 直接平移 → 新内容出现。
  // hierarchyPanTransitionOverride 保证平移不会叠加一次额外的整体上移。
  const exitDuration = 1400;
  const moveDelay = exitDuration + 260;
  const moveDuration = 1600;
  const moveEnd = moveDelay + moveDuration;
  const enterDelay = moveDelay + moveDuration + 260;
  const enterDuration = 1400;
  const easing = d3.easeCubicOut;
  const transitionPromises = [];
  const trackTransition = (transition) => {
    transitionPromises.push(transition.end());
    return transition;
  };
  const overlay = svgElement("g", {
    class: "hierarchy-transition-layer",
    "pointer-events": "none",
  });
  svg.appendChild(overlay);

  const commonIds = [...oldFrame.nodes.keys()].filter((id) => newFrame.nodes.has(id));
  const movedCommonIds = commonIds.filter((entityId) => hierarchyMatrixChanged(
    oldFrame.nodes.get(entityId).matrix,
    newFrame.nodes.get(entityId).matrix,
  ));
  const removedIds = [...oldFrame.nodes.keys()].filter((id) => !newFrame.nodes.has(id));
  const createdIds = [...newFrame.nodes.keys()].filter((id) => !oldFrame.nodes.has(id));
  const removedIdSet = new Set(removedIds);
  const createdIdSet = new Set(createdIds);
  const phaseTwoIdSet = new Set(movedCommonIds);
  for (const change of changes || []) {
    if (change.type !== "reparent") continue;
    const entityId = change.targetIds[0] ?? change.sourceIds[0];
    if (entityId != null) phaseTwoIdSet.add(entityId);
  }
  const linkTouches = (link, ids) => ids.has(link.sourceId) || ids.has(link.targetId);
  const newLinks = [...svg.querySelectorAll(".dynamic-tree-link[data-source-entity-id]")]
    .map((link) => ({
      node: link,
      sourceId: Number(link.dataset.sourceEntityId),
      targetId: Number(link.dataset.targetEntityId),
    }))
    .filter((link) => linkTouches(link, createdIdSet) || linkTouches(link, phaseTwoIdSet));
  for (const link of newLinks) link.node.style.opacity = "0";
  for (const entityId of [...movedCommonIds, ...createdIds]) {
    const node = newFrame.nodes.get(entityId)?.node;
    if (node) node.style.opacity = "0";
  }

  for (const oldLink of oldFrame.links || []) {
    const exits = linkTouches(oldLink, removedIdSet);
    const moves = linkTouches(oldLink, phaseTwoIdSet);
    if (!exits && !moves) continue;
    const clone = cloneHierarchyTransitionLink(oldLink);
    if (!clone) continue;
    overlay.appendChild(clone);
    const transition = d3.select(clone).transition("hierarchy-time");
    trackTransition(transition
      .duration(exitDuration)
      .ease(easing)
      .style("opacity", 0));
  }

  for (const entityId of movedCommonIds) {
    const oldItem = oldFrame.nodes.get(entityId);
    const newItem = newFrame.nodes.get(entityId);
    const clone = cloneHierarchyTransitionNode(oldItem);
    if (!clone) continue;
    clone.setAttribute("transform", matrixTransformValue(oldItem.matrix));
    clone.style.opacity = "1";
    overlay.appendChild(clone);
    // 直接从旧坐标插值到新坐标；不再先做一个额外的向上位移。
    trackTransition(d3.select(clone)
      .transition("hierarchy-time")
      .delay(moveDelay)
      .duration(moveDuration)
      .ease(easing)
      .attr("transform", matrixTransformValue(newItem.matrix))
      .on("end.handoff", function () {
        this.style.opacity = "0";
      }));
  }

  // 平移副本到位后与正式节点做同帧交接；第三阶段只负责真正的新设节点。
  for (const entityId of movedCommonIds) {
    const node = newFrame.nodes.get(entityId)?.node;
    if (!node) continue;
    trackTransition(d3.select(node)
      .transition("hierarchy-time")
      .delay(moveEnd)
      .duration(0)
      .style("opacity", 1));
  }

  for (const entityId of removedIds) {
    const oldItem = oldFrame.nodes.get(entityId);
    const clone = cloneHierarchyTransitionNode(oldItem);
    if (!clone) continue;
    clone.setAttribute("transform", matrixTransformValue(oldItem.matrix));
    clone.style.opacity = "1";
    overlay.appendChild(clone);
    trackTransition(d3.select(clone)
      .transition("hierarchy-time")
      .duration(exitDuration)
      .ease(easing)
      .style("opacity", 0));
  }

  for (const entityId of createdIds) {
    const node = newFrame.nodes.get(entityId)?.node;
    if (!node) continue;
    trackTransition(d3.select(node)
      .transition("hierarchy-time")
      .delay(enterDelay)
      .duration(enterDuration)
      .ease(easing)
      .style("opacity", 1));
  }

  for (const link of newLinks) {
    trackTransition(d3.select(link.node)
      .transition("hierarchy-time")
      .delay(enterDelay)
      .duration(enterDuration)
      .ease(easing)
      .style("opacity", 1));
  }

  for (const change of changes || []) {
    if (change.type === "reparent") {
      const entityId = change.targetIds[0] ?? change.sourceIds[0];
      const oldChild = oldFrame.nodes.get(entityId)?.center;
      const newChild = newFrame.nodes.get(entityId)?.center;
      const oldParent = oldFrame.nodes.get(change.previousParentId)?.center;
      const newParent = newFrame.nodes.get(change.nextParentId)?.center;
      if (!oldChild || !newChild || !oldParent || !newParent) continue;
      const line = svgElement("polyline", {
        class: "hierarchy-transition-link",
        points: transitionLinePoints(oldParent, oldChild),
      });
      overlay.insertBefore(line, overlay.firstChild);
      trackTransition(d3.select(line)
        .transition("hierarchy-time")
        .delay(moveDelay)
        .duration(moveDuration)
        .ease(easing)
        .attr("points", transitionLinePoints(newParent, newChild))
        .on("end.handoff", function () {
          this.style.opacity = "0";
        }));
    }
    if (["evolve", "unclassified"].includes(change.type)
      && change.sourceIds.length === 1
      && change.targetIds.length === 1) {
      const source = oldFrame.nodes.get(change.sourceIds[0])?.center;
      const target = newFrame.nodes.get(change.targetIds[0])?.center;
      if (!source || !target) continue;
      const line = svgElement("line", {
        class: "hierarchy-transition-evolution-link",
        x1: source.x,
        y1: source.y,
        x2: source.x,
        y2: source.y,
      });
      overlay.insertBefore(line, overlay.firstChild);
      trackTransition(d3.select(line)
        .transition("hierarchy-time")
        .delay(moveDelay)
        .duration(moveDuration)
        .ease(easing)
        .attr("x2", target.x)
        .attr("y2", target.y)
        .on("end.handoff", function () {
          this.style.opacity = "0";
        }));
    }
  }

  Promise.allSettled(transitionPromises).then(() => {
    if (revision !== activeTransitionAnimation) return;
    activeTransitionCleanupFrame = window.requestAnimationFrame(() => {
      if (revision !== activeTransitionAnimation) return;
      activeTransitionCleanupFrame = null;
      newFrame.nodes.forEach(({ node }) => {
        if (node) node.style.opacity = "1";
      });
      newLinks.forEach((link) => link.node.style.removeProperty("opacity"));
      overlay.remove();
    });
  });
}

function commitTimelineRange(nextRange, { focusedChange = null } = {}) {
  const normalized = [
    Math.max(YEAR_MIN, Math.min(YEAR_MAX, Math.round(nextRange[0]))),
    Math.max(YEAR_MIN, Math.min(YEAR_MAX, Math.round(nextRange[1] ?? nextRange[0]))),
  ].sort((a, b) => a - b);
  const oldRange = [...selectedRange.value];
  const oldYear = oldRange[0];
  const nextYear = normalized[0];
  pendingRange.value = [...normalized];
  timelineSelectionActive.value = true;
  if (isEvolutionCanvasMode() && evolutionEntryContext.value) {
    evolutionEntryContext.value = {
      ...evolutionEntryContext.value,
      currentYear: nextYear,
    };
  }
  hierarchyReturnNotice.value = null;
  if (oldRange[0] === normalized[0] && oldRange[1] === normalized[1]) {
    focusedTransition.value = focusedChange;
    const svg = svgMountRef.value?.querySelector("svg.live-design-svg");
    if (svg) updateDetails(svg);
    return;
  }

  const svg = svgMountRef.value?.querySelector("svg.live-design-svg");
  const animateHierarchy = hierarchyAnimationShouldRun({
    enabled: hierarchyAnimationEnabled.value,
    viewMode: viewMode.value,
    hasSvg: Boolean(svg),
    reduceMotion: Boolean(reduceMotionQuery?.matches),
  });
  const oldFrame = animateHierarchy
    ? captureHierarchyFrame(svg, { cloneNodes: true })
    : null;
  const fromSnapshot = yearSnapshot(oldYear);
  const toSnapshot = yearSnapshot(nextYear);
  const currentEntityId = selectedId.value;
  const changes = buildSnapshotTransition({
    data: props.data,
    index: structuralChangeIndex,
    fromSnapshot,
    toSnapshot,
    fromYear: oldYear,
    toYear: nextYear,
    focusEntityId: currentEntityId,
  });
  const selection = resolveTransitionSelection({
    changes,
    currentEntityId,
    targetSnapshot: toSnapshot,
    fromYear: oldYear,
    toYear: nextYear,
  });

  selectedRange.value = [...normalized];
  focusedTransition.value = focusedChange || selection.change;
  if (selection.entityId != null) selectedId.value = selection.entityId;
  if (selection.reason === "one-to-one-evolution") {
    if (changeTrackEntityId.value != null) changeTrackEntityId.value = selection.entityId;
    const target = entityMap.get(selection.entityId);
    if (target?.type === "机构") focusHierarchyContext(target, true);
  } else if (selection.reason === "context-only" && currentEntityId != null) {
    changeTrackEntityId.value = currentEntityId;
  }
  if (oldFrame && svg) {
    hierarchyPanTransitionOverride = { x: hierarchyPanX, y: hierarchyPanY };
    try {
      refreshTemplate();
    } finally {
      hierarchyPanTransitionOverride = null;
    }
  } else {
    refreshTemplate();
  }
  if (oldFrame && svg) playHierarchyTransition(svg, oldFrame, changes);
}

function bindMajorEvents(svg) {
  const labelBaseY = 928.02;
  const labelRowGap = 13;
  const staticTitleSet = new Set(STATIC_MAJOR_EVENT_TITLES);
  const staticLabels = [...svg.querySelectorAll("text")].filter((text) => {
    const point = position(text);
    return point
      && Math.abs(point.y - 931.02) < 0.2
      && staticTitleSet.has(normalizeText(text));
  });
  const staticPointLines = [...svg.querySelectorAll("line")].filter((line) => (
    Math.abs(Number(line.getAttribute("y1")) - 909.59) < 0.1
    && Math.abs(Number(line.getAttribute("y2")) - 916.43) < 0.1
  ));
  const staticRangeBars = [...svg.querySelectorAll("rect")].filter((rect) => {
    const y = Number(rect.getAttribute("y"));
    const height = Number(rect.getAttribute("height"));
    return Math.abs(height - 2.95) < 0.1
      && (Math.abs(y - 909.83) < 0.1 || Math.abs(y - 913.58) < 0.1);
  });

  const labelTemplate = staticLabels[0]?.cloneNode(true);
  const pointTemplate = staticPointLines.find((line) => (
    (line.getAttribute("class") || "").split(/\s+/).includes("cls-26")
  ))?.cloneNode(true) || staticPointLines[0]?.cloneNode(true);
  const rangeTemplate = staticRangeBars.find((rect) => Math.abs(Number(rect.getAttribute("y")) - 909.83) < 0.1)
    ?.cloneNode(true);
  if (!labelTemplate || !pointTemplate || !rangeTemplate) return;

  staticLabels.forEach((element) => element.style.setProperty("display", "none"));
  staticPointLines.forEach((element) => element.style.setProperty("display", "none"));
  staticRangeBars.forEach((element) => element.style.setProperty("display", "none"));

  const eventLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
  eventLayer.classList.add("timeline-major-events");
  eventLayer.setAttribute("data-source", "src/utils/major_events.js");
  eventLayer.setAttribute("aria-label", "依据史料时间绑定的重大事件");

  const events = normalizeMajorEvents(MAJOR_EVENTS, { yearMin: YEAR_MIN, yearMax: YEAR_MAX });
  const labelLayouts = layoutMajorEventLabels(events, yearScale);
  for (const [eventIndex, event] of events.entries()) {
    const titleText = majorEventTooltip(event);
    if (event.kind === "range") {
      const bar = rangeTemplate.cloneNode(true);
      bar.style.removeProperty("display");
      const startX = yearScale(event.startYear);
      const endX = yearScale(Math.min(TIMELINE_SCALE_END, event.endYear + 1));
      bar.setAttribute("x", String(startX));
      bar.setAttribute("width", String(Math.max(0, endX - startX)));
      bar.setAttribute("pointer-events", "none");
      const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
      title.textContent = titleText;
      bar.replaceChildren(title);
      eventLayer.appendChild(bar);
    } else {
      const marker = pointTemplate.cloneNode(true);
      marker.style.removeProperty("display");
      const x = yearScale(event.startYear);
      marker.setAttribute("x1", String(x));
      marker.setAttribute("x2", String(x));
      marker.setAttribute("pointer-events", "none");
      const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
      title.textContent = titleText;
      marker.replaceChildren(title);
      eventLayer.appendChild(marker);
    }

    const label = labelTemplate.cloneNode(true);
    label.style.removeProperty("display");
    const labelLayout = labelLayouts[eventIndex];
    label.setAttribute(
      "transform",
      `translate(${labelLayout.x} ${labelBaseY + labelLayout.row * labelRowGap})`,
    );
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("pointer-events", "none");
    const tspan = label.querySelector("tspan");
    if (tspan) {
      tspan.setAttribute("x", "0");
      tspan.setAttribute("y", "0");
      tspan.textContent = event.title;
    } else {
      label.textContent = event.title;
    }
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = titleText;
    label.appendChild(title);
    eventLayer.appendChild(label);
  }

  svg.appendChild(eventLayer);
}

function bindTimelineRange(svg) {
  const originalTriangle = [...svg.querySelectorAll("path")].find(
    (path) => (path.getAttribute("d") || "").startsWith("M837.34,1027.81")
  );
  const originalYear = [...svg.querySelectorAll("text")].find(
    (text) => normalizeText(text) === "1109年" && Math.abs((position(text)?.y ?? 0) - 1035.22) < 1
  );
  const originalGuideLine = [...svg.querySelectorAll("line")].find(
    (line) => Math.abs(Number(line.getAttribute("x1")) - 838.19) < 0.1
      && Math.abs(Number(line.getAttribute("y1")) - 913.08) < 0.1
      && Math.abs(Number(line.getAttribute("y2")) - 1021.73) < 0.1
  );
  if (!originalTriangle || !originalYear) return;
  const timelineTextAtY = (y, predicate = () => true) => [...svg.querySelectorAll("text")].find((text) => {
    const point = position(text);
    return point && Math.abs(point.y - y) < 1 && predicate(normalizeText(text));
  });
  const yearTickClass = timelineTextAtY(1008.07, (value) => /^\d+年$/.test(value))
    ?.getAttribute("class") || originalYear.getAttribute("class") || "cls-39";
  const emperorClass = timelineTextAtY(964.71)?.getAttribute("class") || "cls-58";
  const eraClass = timelineTextAtY(982.24)?.getAttribute("class") || "cls-44";
  const emperorSeparatorClass = [...svg.querySelectorAll("line")]
    .find((line) => Math.abs(Number(line.getAttribute("y1")) - 951.49) < 0.1
      && Math.abs(Number(line.getAttribute("y2")) - 969.8) < 0.1)
    ?.getAttribute("class") || "cls-26";
  const eraSeparatorClass = [...svg.querySelectorAll("line")]
    .find((line) => Math.abs(Number(line.getAttribute("y1")) - 973.55) < 0.1
      && Math.abs(Number(line.getAttribute("y2")) - 984.96) < 0.1)
    ?.getAttribute("class") || "cls-36";
  originalTriangle.style.display = "none";
  originalYear.style.display = "none";
  const eraRecords = normalizeTimelineEras(props.data?.meta?.eras);
  const emperorRecords = normalizeTimelineEmperorReigns(props.data?.meta?.emperorReigns);
  if (eraRecords.length) {
    // 原 SVG 中的年份、年号是设计示意，不是运行数据。只有在服务端提供
    // 完整年号表时才隐藏它们，避免旧 API 暂时缺字段时出现空时间轴。
    [...svg.querySelectorAll("text")].forEach((text) => {
      const point = position(text);
      const value = normalizeText(text);
      const isStaticYear = Math.abs((point?.y ?? 0) - 1008.07) < 3
        && /^\d+年$/.test(value);
      const isStaticEra = Math.abs((point?.y ?? 0) - 982.24) < 3;
      if (isStaticYear || isStaticEra) text.style.display = "none";
    });
    // cls-36 是原稿示意年号的分隔竖线；它们与真实年号起点不一致，
    // 必须和示意文字一起移除，后面再按 ERA_YEARS 重新绘制。
    [...svg.querySelectorAll("line")].forEach((line) => {
      const y1 = Number(line.getAttribute("y1"));
      const y2 = Number(line.getAttribute("y2"));
      if (Math.abs(y1 - 973.55) < 0.1
        && Math.abs(y2 - 984.96) < 0.1) {
        line.style.display = "none";
      }
    });
  }
  if (emperorRecords.length) {
    // 设计稿中的帝王名称及分隔线仅为示意，按完整在位数据重新绘制。
    [...svg.querySelectorAll("text")].forEach((text) => {
      const point = position(text);
      if (Math.abs((point?.y ?? 0) - 964.71) < 1) {
        text.style.display = "none";
      }
    });
    [...svg.querySelectorAll("line")].forEach((line) => {
      const y1 = Number(line.getAttribute("y1"));
      const y2 = Number(line.getAttribute("y2"));
      if (Math.abs(y1 - 951.49) < 0.1
        && Math.abs(y2 - 969.8) < 0.1) {
        line.style.display = "none";
      }
    });
  }
  // 设计稿的 1109 年标记由三段竖线和上下端帽组成，需与静态三角一起隐藏。
  originalGuideLine?.parentElement?.parentElement?.style.setProperty("display", "none");

  bindMajorEvents(svg);

  if (eraRecords.length || emperorRecords.length) {
    const timelineDataLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    timelineDataLayer.classList.add("timeline-data-labels");
    const timelineSources = [];
    if (emperorRecords.length) timelineSources.push("normalize_times.SONG_EMPEROR_REIGNS");
    if (eraRecords.length) timelineSources.push("normalize_times.ERA_YEARS");
    timelineDataLayer.setAttribute("data-source", timelineSources.join(","));
    timelineDataLayer.setAttribute("aria-label", "依据完整帝王在位与年号数据绘制的时间轴");

    if (emperorRecords.length) {
      const emperorLabels = layoutTimelineEmperorLabels(
        emperorRecords,
        (year) => yearScale(Math.min(YEAR_MAX + 1, year)),
        { fontSize: 14.26, padding: 0 },
      );
      const boundaryXs = emperorLabels.map((reign) => reign.startX);
      const finalBoundaryX = emperorLabels.at(-1)?.endX;
      if (Number.isFinite(finalBoundaryX)) boundaryXs.push(finalBoundaryX);

      for (const x of [...new Set(boundaryXs)]) {
        const separator = document.createElementNS("http://www.w3.org/2000/svg", "line");
        separator.setAttribute("class", emperorSeparatorClass);
        separator.setAttribute("x1", String(x));
        separator.setAttribute("x2", String(x));
        separator.setAttribute("y1", "951.49");
        separator.setAttribute("y2", "969.8");
        separator.setAttribute("pointer-events", "none");
        timelineDataLayer.appendChild(separator);
      }

      for (const reign of emperorLabels) {
        if (!reign.labelVisible) continue;
        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.setAttribute("class", emperorClass);
        label.setAttribute("x", String(reign.labelX));
        label.setAttribute("y", "964.71");
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("pointer-events", "none");
        label.textContent = reign.labelText;
        const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
        const personalName = reign.personalName ? `（${reign.personalName}）` : "";
        title.textContent = `${reign.name}${personalName}：${reign.start}—${reign.end}年`;
        label.appendChild(title);
        timelineDataLayer.appendChild(label);
      }
    }

    if (eraRecords.length) {
      for (const year of buildTimelineYearTicks(YEAR_MIN, YEAR_MAX, 10)) {
        const x = yearScale(year);
        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.setAttribute("class", yearTickClass);
        label.setAttribute("x", String(x));
        label.setAttribute("y", "1008.07");
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("pointer-events", "none");
        label.textContent = `${year}年`;
        timelineDataLayer.appendChild(label);
      }

      // 年号区间和起始竖线全部保留。起止年份跨度不足 4 年的年号不显示文字，
      // 达到年限但名称过长时在自己的时间格内显示省略号，不按字数改变年限阈值。
      const labelY = 982.24;
      const labelFontSize = 10;
      const eraLabels = layoutTimelineEraLabels(
        eraRecords,
        (year) => yearScale(Math.min(YEAR_MAX + 1, year)),
        { minYears: 4, fontSize: labelFontSize, padding: 0 },
      );

      for (const era of eraLabels) {
        const { startX } = era;
        // 竖线是年号区间的分隔符，x 必须绑定真实起始年，不能跟随避让后的文字。
        const separator = document.createElementNS("http://www.w3.org/2000/svg", "line");
        separator.setAttribute("class", eraSeparatorClass);
        separator.setAttribute("x1", String(startX));
        separator.setAttribute("x2", String(startX));
        separator.setAttribute("y1", "973.55");
        separator.setAttribute("y2", "984.96");
        separator.setAttribute("pointer-events", "none");
        timelineDataLayer.appendChild(separator);

        if (!era.labelVisible) continue;

        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.setAttribute("class", eraClass);
        label.setAttribute("x", String(era.labelX));
        label.setAttribute("y", String(labelY));
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("pointer-events", "none");
        label.textContent = era.labelText;
        const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
        title.textContent = `${era.name}：${era.start}—${era.end}年`;
        label.appendChild(title);
        timelineDataLayer.appendChild(label);
      }
    }

    // 让范围选择控件位于数据标签之上，但不改变数据标签的位置。
    svg.appendChild(timelineDataLayer);
  }

  const timelineLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
  timelineLayer.classList.add("timeline-range-control");
  svg.appendChild(timelineLayer);

  const brush = d3.brushX()
    .extent([[TIMELINE_X_MIN, 909.73], [TIMELINE_X_MAX, 1042]])
    .handleSize(18);
  const brushLayer = d3.select(timelineLayer)
    .append("g")
    .attr("class", "timeline-range-brush")
    .call(brush);
  brushLayer.select(".overlay")
    .attr("fill", "transparent")
    .attr("cursor", "crosshair");
  brushLayer.select(".selection")
    .attr("fill", "transparent")
    .attr("stroke", "none")
    .attr("cursor", "grab");
  brushLayer.selectAll(".handle")
    .attr("fill", "transparent")
    .attr("stroke", "none")
    .attr("cursor", "ew-resize");

  const rangeLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
  rangeLine.classList.add("timeline-selected-range");
  rangeLine.setAttribute("y1", "1024");
  rangeLine.setAttribute("y2", "1024");
  rangeLine.setAttribute("stroke", "#563905");
  rangeLine.setAttribute("stroke-width", "3");
  rangeLine.setAttribute("pointer-events", "none");
  timelineLayer.appendChild(rangeLine);

  const handleGroups = [0, 1].map((index) => {
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.classList.add("timeline-range-handle");
    group.setAttribute("pointer-events", "none");

    const guide = document.createElementNS("http://www.w3.org/2000/svg", "line");
    guide.setAttribute("y1", "909.73");
    guide.setAttribute("y2", "1024");
    guide.setAttribute("stroke", "#351704");
    guide.setAttribute("stroke-width", "0.81");
    guide.setAttribute("stroke-dasharray", "2.1 2.1");
    guide.setAttribute("pointer-events", "none");

    const triangle = originalTriangle.cloneNode(true);
    triangle.style.removeProperty("display");
    triangle.setAttribute("pointer-events", "none");

    const label = originalYear.cloneNode(true);
    label.style.removeProperty("display");
    label.setAttribute("pointer-events", "none");

    const emperorLabel = originalYear.cloneNode(true);
    emperorLabel.style.removeProperty("display");
    emperorLabel.classList.add("timeline-range-emperor");
    emperorLabel.style.setProperty("font-size", "9.5px");
    emperorLabel.style.setProperty("fill-opacity", "0.92");
    emperorLabel.setAttribute("pointer-events", "none");

    const regnalLabel = originalYear.cloneNode(true);
    regnalLabel.style.removeProperty("display");
    regnalLabel.classList.add("timeline-range-regnal-year");
    regnalLabel.style.setProperty("font-size", "9px");
    regnalLabel.style.setProperty("fill-opacity", "0.82");
    regnalLabel.setAttribute("pointer-events", "none");

    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = index === 0 ? "所选时段起始年份" : "所选时段结束年份";

    group.append(guide, triangle, label, emperorLabel, regnalLabel, title);
    timelineLayer.appendChild(group);
    return { group, guide, triangle, label, emperorLabel, regnalLabel, title, index };
  });

  const cancelControl = document.createElementNS("http://www.w3.org/2000/svg", "g");
  cancelControl.classList.add("timeline-cancel-selection");
  cancelControl.style.cursor = "pointer";
  cancelControl.setAttribute("role", "button");
  cancelControl.setAttribute("aria-label", "取消当前时间选择，恢复显示全宋");
  cancelControl.setAttribute("tabindex", "0");
  const cancelHitArea = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  cancelHitArea.setAttribute("x", "94");
  cancelHitArea.setAttribute("y", "1027");
  cancelHitArea.setAttribute("width", "82");
  cancelHitArea.setAttribute("height", "23");
  cancelHitArea.setAttribute("fill", "none");
  cancelHitArea.setAttribute("pointer-events", "all");
  cancelHitArea.setAttribute("stroke", "#563905");
  cancelHitArea.setAttribute("stroke-width", "0.8");
  cancelHitArea.setAttribute("stroke-opacity", "0.72");
  const cancelLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
  cancelLabel.setAttribute("class", "cls-39");
  cancelLabel.setAttribute("x", "135");
  cancelLabel.setAttribute("y", "1039");
  cancelLabel.setAttribute("text-anchor", "middle");
  cancelLabel.setAttribute("dominant-baseline", "central");
  cancelLabel.textContent = "× 取消选择";
  const cancelTitle = document.createElementNS("http://www.w3.org/2000/svg", "title");
  cancelTitle.textContent = "取消当前时间选择，恢复显示全宋";
  cancelControl.append(cancelHitArea, cancelLabel, cancelTitle);
  timelineLayer.appendChild(cancelControl);

  const renderRange = (range) => {
    const selectionVisible = timelineSelectionActive.value;
    cancelControl.style.display = selectionVisible ? "" : "none";
    rangeLine.style.display = selectionVisible ? "" : "none";
    handleGroups.forEach((handle) => {
      handle.group.style.display = selectionVisible ? "" : "none";
    });
    if (!selectionVisible) return;
    const [start, end] = range;
    const years = [start, end];
    rangeLine.setAttribute("x1", String(yearScale(start)));
    rangeLine.setAttribute("x2", String(yearScale(end)));
    rangeLine.style.display = start === end ? "none" : "";
    for (const handle of handleGroups) {
      const year = years[handle.index];
      const x = yearScale(year);
      const isDuplicate = handle.index === 1 && start === end;
      handle.group.style.display = isDuplicate ? "none" : "";
      handle.guide.setAttribute("x1", String(x));
      handle.guide.setAttribute("x2", String(x));
      handle.triangle.setAttribute("transform", `translate(${x - 837.69} 0)`);
      handle.label.setAttribute("transform", `translate(${x + 7} 1035.22)`);
      handle.label.replaceChildren(document.createTextNode(`${year}年`));
      const emperor = formatTimelineEmperor(year, emperorRecords);
      handle.emperorLabel.setAttribute("transform", `translate(${x + 7} 1046.22)`);
      handle.emperorLabel.replaceChildren(document.createTextNode(emperor));
      const regnalYear = formatTimelineRegnalYear(year, eraRecords);
      handle.regnalLabel.setAttribute("transform", `translate(${x + 7} 1057.22)`);
      handle.regnalLabel.replaceChildren(document.createTextNode(regnalYear));
      handle.title.textContent = `${handle.index === 0 ? "所选时段起始" : "所选时段结束"}：${year}年，${emperor}，${regnalYear}`;
    }
  };

  const rangeFromPointer = (event) => {
    const x = d3.pointer(event.sourceEvent, timelineLayer)[0];
    const year = Math.max(YEAR_MIN, Math.min(YEAR_MAX, Math.round(yearScale.invert(x))));
    return [year, year];
  };

  const moveBrush = (range) => {
    if (range[0] === range[1]) {
      const center = yearScale(range[0]);
      brushLayer.call(brush.move, [
        Math.max(TIMELINE_X_MIN, center - TIMELINE_YEAR_WIDTH / 2),
        Math.min(TIMELINE_X_MAX, center + TIMELINE_YEAR_WIDTH / 2),
      ]);
      return;
    }
    brushLayer.call(brush.move, [yearScale(range[0]), yearScale(range[1])]);
  };

  brush.on("brush", (event) => {
    if (!event.sourceEvent || !event.selection) return;
    const nextRange = rangeFromPointer(event);
    timelineSelectionActive.value = true;
    pendingRange.value = nextRange;
    renderRange(nextRange);
  });
  brush.on("end", (event) => {
    if (!event.sourceEvent) return;
    const nextRange = rangeFromPointer(event);
    pendingRange.value = nextRange;
    moveBrush(nextRange);
    commitTimelineRange(nextRange);
  });

  const cancelSelection = (event) => {
    event.preventDefault();
    event.stopPropagation();
    timelineSelectionActive.value = false;
    selectedRange.value = [YEAR_MIN, YEAR_MAX];
    pendingRange.value = [YEAR_MIN, YEAR_MAX];
    focusedTransition.value = null;
    if (isEvolutionCanvasMode()) selectedEvolutionItem.value = null;
    brushLayer.call(brush.move, null);
    renderRange(selectedRange.value);
    flushTimelineRefresh();
  };
  d3.select(cancelControl)
    .on("click.cancel-selection", cancelSelection)
    .on("keydown.cancel-selection", (event) => {
      if (event.key === "Enter" || event.key === " ") cancelSelection(event);
    });

  svg.__syncTimelineSelectionStyle = () => renderRange(pendingRange.value);
  svg.__moveTimelineSelection = () => {
    if (timelineSelectionActive.value) moveBrush(pendingRange.value);
    else brushLayer.call(brush.move, null);
  };
  renderRange(pendingRange.value);
  if (timelineSelectionActive.value) moveBrush(pendingRange.value);
}

function installDesignFonts() {
  if (document.getElementById("ch1t12-design-fonts")) return;
  const style = document.createElement("style");
  style.id = "ch1t12-design-fonts";
  style.textContent = `
    @font-face { font-family: FZQINGKBYSS-M--GB1-0; src: url('${versionedDesignAsset("/api/design/fzqing.ttf")}') format('truetype'); font-display: swap; }
    @font-face { font-family: FZQINGKBYSS-R--GB1-0; src: url('${versionedDesignAsset("/api/design/fzqing.ttf")}') format('truetype'); font-display: swap; }
    @font-face { font-family: FZQingKeBenYueSongS; src: url('${versionedDesignAsset("/api/design/fzqing.ttf")}') format('truetype'); font-display: swap; }
    @font-face { font-family: AdobeSongStd-Light-GBpc-EUC-H; src: local('Songti SC'), local('STSong'), url('${versionedDesignAsset("/api/design/adobe-song.otf")}') format('opentype'); font-display: swap; }
  `;
  document.head.appendChild(style);
}

function softenCanvasBackground(svg) {
  const viewBox = (svg.getAttribute("viewBox") || "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (viewBox.length !== 4 || !viewBox.every(Number.isFinite)) return;
  const [, , viewWidth, viewHeight] = viewBox;
  const backgroundImage = [...svg.querySelectorAll("image")].find((image) => (
    Math.abs(Number(image.getAttribute("width")) - viewWidth) < 0.5
    && Math.abs(Number(image.getAttribute("height")) - viewHeight) < 0.5
  ));
  if (!backgroundImage) return;
  svg.style.backgroundColor = "#fbfaf7";
  backgroundImage.setAttribute("opacity", "0.35");
}

async function loadSvgTemplate(url) {
  if (svgCache.has(url)) return;
  const response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const source = await response.text();
  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  const parsedSvg = parsed.documentElement;
  if (parsedSvg.localName !== "svg" || parsed.querySelector("parsererror")) {
    throw new Error("原 SVG 无法解析");
  }
  softenCanvasBackground(parsedSvg);
  svgCache.set(url, document.importNode(parsedSvg, true));
}

async function renderTemplate() {
  const requestedMode = viewMode.value;
  const revision = ++renderRevision;
  const url = DESIGN_URL_BY_MODE[requestedMode] || HIERARCHY_DESIGN_URL;
  const requiredUrls = requestedMode === "composition"
    ? [url, HIERARCHY_DESIGN_URL]
    : [url];
  const needsLoad = requiredUrls.some((requiredUrl) => !svgCache.has(requiredUrl));
  if (needsLoad) loading.value = true;
  error.value = "";
  try {
    await Promise.all(requiredUrls.map(loadSvgTemplate));
    if (revision !== renderRevision || requestedMode !== viewMode.value) return;
    const svg = svgCache.get(url).cloneNode(true);
    if (requestedMode === "composition") {
      alignCompositionHeader(svg);
      alignCompositionCategoryNavigation(svg);
    }
    svgMountRef.value.replaceChildren(svg);
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.classList.add("live-design-svg");
    selectedEntity();
    populateCenter(svg);
    bindEntityTexts(svg);
    bindTemplateControls(svg);
    bindTimelineRange(svg);
    setupDetailPanel(svg);
    updateDetails(svg);
  } catch (reason) {
    if (revision !== renderRevision) return;
    error.value = `SVG 设计稿加载失败：${reason.message}`;
  } finally {
    if (revision === renderRevision) loading.value = false;
  }
}

function refreshTemplate({ rebindStatic = false, rebindControls = false } = {}) {
  const svg = svgMountRef.value?.querySelector("svg.live-design-svg");
  if (!svg) {
    renderTemplate();
    return;
  }

  if (viewMode.value === "hierarchy") {
    cancelHierarchyTransition(svg);
    svg.querySelector(".dynamic-tree-viewport")?.remove();
    svg.querySelectorAll(
      "clipPath[id^='dynamic-tree-'], clipPath[id^='inline-composition-']"
    ).forEach((clipPath) => clipPath.remove());
  }
  if (viewMode.value === "evolution") {
    svg.querySelector(".dynamic-evolution-layer")?.remove();
    svg.querySelectorAll("[data-evolution-def]").forEach((element) => element.remove());
  }

  selectedEntity();
  populateCenter(svg);
  // 编制画板的动态机构列由 renderDynamicComposition 生成并自带 data-entity-id，
  // 需要整图扫描绑定悬停与点击；层级画板的动态节点在 populateCenter 内自行绑定。
  if (rebindStatic || viewMode.value === "composition") {
    bindEntityTexts(svg);
  }
  if (rebindControls) bindTemplateControls(svg);
  updateDetails(svg);
  svg.__syncTimelineSelectionStyle?.();
  svg.__moveTimelineSelection?.();
  svg.__syncSpaceAwareExpansionControl?.();
  svg.__syncHierarchyAnimationControl?.();
  svg.__syncVirtualNodeVisibilityControl?.();
}

function scheduleTimelineRefresh({ rebindStatic = false } = {}) {
  timelineRefreshNeedsStatic ||= rebindStatic;
  if (timelineRefreshFrame != null) return;
  timelineRefreshFrame = window.requestAnimationFrame(() => {
    const needsStatic = timelineRefreshNeedsStatic;
    timelineRefreshFrame = null;
    timelineRefreshNeedsStatic = false;
    refreshTemplate({ rebindStatic: needsStatic });
  });
}

function flushTimelineRefresh(rebindStatic = false) {
  if (timelineRefreshFrame != null) {
    window.cancelAnimationFrame(timelineRefreshFrame);
    timelineRefreshFrame = null;
  }
  timelineRefreshNeedsStatic = false;
  refreshTemplate({ rebindStatic });
}

watch(viewMode, renderTemplate);
watch(() => props.globalUndoAvailable, () => {
  const svg = svgMountRef.value?.querySelector("svg.live-design-svg");
  if (svg) ensureGlobalUndoControl(svg);
});
onMounted(async () => {
  reduceMotionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)") || null;
  installDesignFonts();
  try {
    await document.fonts?.load('17.14px "FZQINGKBYSS-M--GB1-0"');
  } catch {
    // 字体加载失败时仍保留 SVG 自带的回退字体。
  }
  renderTemplate();
});
onUnmounted(() => {
  const svg = svgMountRef.value?.querySelector("svg.live-design-svg");
  if (svg) cancelHierarchyTransition(svg);
  else {
    activeTransitionAnimation += 1;
    if (activeTransitionCleanupFrame != null) {
      window.cancelAnimationFrame(activeTransitionCleanupFrame);
    }
  }
  if (timelineRefreshFrame != null) window.cancelAnimationFrame(timelineRefreshFrame);
});
</script>

<style scoped>
.design-template {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
  background: #f5f3ec;
}

.svg-mount {
  width: 100%;
  height: 100%;
}

.svg-mount :deep(.live-design-svg) {
  display: block;
  width: 100%;
  height: 100%;
}

.design-template.revision-panel-active .svg-mount :deep(.evolution-selector-layer) {
  visibility: hidden;
  pointer-events: none;
}

.design-template.revision-panel-active .svg-mount :deep(.evolution-intro-copy) {
  display: none;
}

.svg-mount :deep(.shared-category-label) {
  fill: #351704;
  font-family: FZQINGKBYSS-M--GB1-0, FZQingKeBenYueSongS;
  font-size: 19.34px;
  glyph-orientation-vertical: 0deg;
  text-orientation: upright;
  writing-mode: tb;
}

.svg-mount :deep(.shared-category-outline) {
  fill: none;
  stroke: #563905;
  stroke-miterlimit: 10;
}

.svg-mount :deep(.shared-category-selection) {
  opacity: 0.4;
}

.svg-mount :deep(.shared-category-selection-shape) {
  fill: #351704;
  stroke: #563905;
  stroke-miterlimit: 10;
  stroke-width: 0.75px;
}

.svg-mount :deep(.dynamic-tree-node:focus) {
  outline: none;
}

.svg-mount :deep(.dynamic-tree-node:focus-visible .dynamic-tree-node-hit-area) {
  stroke: #563905;
  stroke-width: 1.2;
  stroke-dasharray: 3 2;
}

.svg-mount :deep(.node-change-indicator) {
  pointer-events: all;
}

.svg-mount :deep(.node-change-indicator:focus) {
  outline: none;
}

.svg-mount :deep(.node-change-indicator-surface) {
  fill: #f5f3ec;
  stroke: #866d6d;
  stroke-width: 1px;
}

.svg-mount :deep(.node-change-indicator .is-past .node-change-indicator-surface) {
  fill: #918069;
  fill-opacity: 0.92;
  stroke: #563905;
}

.svg-mount :deep(.node-change-indicator text) {
  fill: #351704;
  font-family: AdobeSongStd-Light-GBpc-EUC-H, Songti SC, serif;
  font-size: 8.8px;
  font-weight: 700;
  letter-spacing: 0;
  pointer-events: none;
}

.svg-mount :deep(.node-change-indicator .is-past text) {
  fill: #fffdf8;
}

.svg-mount :deep(.node-change-indicator:hover .node-change-indicator-surface),
.svg-mount :deep(.node-change-indicator:focus-visible .node-change-indicator-surface) {
  stroke-width: 1.35px;
}

.svg-mount :deep(.transition-track-type) {
  fill: #866d6d;
  font-weight: 700;
}

.svg-mount :deep(.transition-track-action) {
  fill: #866d6d;
  text-decoration: underline;
}

.svg-mount :deep(.transition-track-action:focus) {
  outline: none;
  fill: #563905;
}

.svg-mount :deep(.transition-track-endpoints) {
  fill: #6f6253;
}

.svg-mount :deep(.transition-track-evidence) {
  fill: #625545;
}

.svg-mount :deep(.is-focused) {
  fill: #563905;
  font-weight: 700;
}

.svg-mount :deep(.hierarchy-transition-layer) {
  isolation: isolate;
}

.svg-mount :deep(.hierarchy-transition-link) {
  fill: none;
  stroke: #866d6d;
  stroke-width: 1.3px;
  stroke-dasharray: 4 2;
}

.svg-mount :deep(.hierarchy-transition-evolution-link) {
  stroke: #866d6d;
  stroke-width: 1.6px;
  stroke-dasharray: 5 3;
}

.svg-mount :deep(.composition-detail-button:focus) {
  outline: none;
}

.svg-mount :deep(.composition-detail-button:focus-visible .composition-detail-button-surface) {
  fill-opacity: 0.08;
  stroke: #563905;
  stroke-width: 0.8;
  stroke-dasharray: 1.5 1;
}

.svg-mount :deep(.composition-item-hit-area) {
  fill: transparent;
  stroke: none;
  pointer-events: all;
}

.svg-mount :deep(.composition-institution-border) {
  fill: none;
  stroke: #563905;
}

.svg-mount :deep(.composition-level-1) {
  stroke-width: 3px;
}

.svg-mount :deep(.composition-level-2) {
  stroke-width: 2px;
}

.svg-mount :deep(.composition-level-3) {
  stroke-width: 1.15px;
}

.svg-mount :deep(.composition-level-4) {
  stroke-width: 0.51px;
}

.svg-mount :deep(.space-aware-expansion-control:focus) {
  outline: none;
}

.svg-mount :deep(.hierarchy-animation-control:focus) {
  outline: none;
}

.svg-mount :deep(.space-aware-expansion-control:focus-visible [data-control-part="outline"]),
.svg-mount :deep(.hierarchy-animation-control:focus-visible [data-control-part="outline"]) {
  stroke-width: 1.35;
  stroke-dasharray: 3 2;
}

.svg-mount :deep(.svg-entity-hover) {
  filter: drop-shadow(0 0 2px rgba(53, 23, 4, 0.75));
  text-decoration: underline;
}

/* —— 时间线树视图 —— */
.svg-mount :deep(.timetree-axis-label) {
  fill: #918069;
  font-size: 11px;
  letter-spacing: 1px;
}

.svg-mount :deep(.timetree-header-control) {
  fill: #563905;
  font-size: 11px;
  letter-spacing: 1px;
}

.svg-mount :deep(.timetree-header-control:hover) {
  text-decoration: underline;
}

.svg-mount :deep(.timetree-tree-node) {
  cursor: pointer;
}

.svg-mount :deep(.timetree-tree-node:focus) {
  outline: none;
}

.svg-mount :deep(.timetree-offaxis-badge) {
  fill: #918069;
  font-size: 9px;
  letter-spacing: 0.5px;
}

.svg-mount :deep(.timetree-empty-hint) {
  fill: #918069;
  font-size: 14px;
  letter-spacing: 3px;
}

.svg-mount :deep(.timetree-scrollbar-thumb:hover) {
  fill-opacity: 0.5;
}

.svg-mount :deep(.dynamic-comparison-layer) {
  pointer-events: none;
}

.svg-mount :deep(.comparison-pane-viewport) {
  overflow: visible;
  pointer-events: auto;
}

.svg-mount :deep(.comparison-pane-group) {
  pointer-events: auto;
}

.svg-mount :deep(.comparison-pane-scroll) {
  width: 100%;
  height: 100%;
  overflow: auto;
  pointer-events: auto;
  scrollbar-color: rgba(86, 57, 5, 0.56) rgba(86, 57, 5, 0.08);
  scrollbar-width: thin;
}

.svg-mount :deep(.comparison-pane-stage) {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 100%;
  min-height: 100%;
}

.svg-mount :deep(.comparison-child-svg) {
  overflow: visible;
  display: block;
}

.svg-mount :deep(.comparison-pane-drag-handle) {
  pointer-events: all;
  cursor: grab;
  touch-action: none;
}

.svg-mount :deep(.comparison-pane-drag-handle.is-dragging) {
  cursor: grabbing;
}

.svg-mount :deep(.comparison-pane-drag-surface) {
  fill: rgba(245, 243, 236, 0.86);
  stroke: rgba(86, 57, 5, 0.42);
  stroke-width: 0.8px;
}

.svg-mount :deep(.comparison-pane-drag-handle:hover .comparison-pane-drag-surface),
.svg-mount :deep(.comparison-pane-drag-handle:focus-visible .comparison-pane-drag-surface),
.svg-mount :deep(.comparison-pane-drag-handle.is-dragging .comparison-pane-drag-surface) {
  fill: rgba(145, 128, 105, 0.18);
  stroke-opacity: 0.82;
}

.svg-mount :deep(.comparison-pane-drag-handle:focus) {
  outline: none;
}

.svg-mount :deep(.comparison-child-svg .dynamic-tree-viewport),
.svg-mount :deep(.comparison-child-svg .dynamic-evolution-layer) {
  pointer-events: all;
}

.svg-mount :deep(.comparison-pane-heading) {
  fill: #563905;
  font-family: FZQINGKBYSS-M--GB1-0, FZQingKeBenYueSongS;
  font-size: 16px;
  letter-spacing: 2px;
  pointer-events: none;
}

.svg-mount :deep(.comparison-pane-divider) {
  stroke: #563905;
  stroke-opacity: 0.34;
  stroke-width: 0.8px;
  stroke-dasharray: 2 3;
  pointer-events: none;
}

.template-message {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  z-index: 5;
  color: #563905;
  background: #f5f3ec;
  letter-spacing: 3px;
}
</style>
