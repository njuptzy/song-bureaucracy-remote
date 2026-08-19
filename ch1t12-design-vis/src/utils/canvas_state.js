export const CANVAS_STATE_STORAGE_KEY = "song-bureaucracy:canvas-state:v1";

const CANVAS_STATE_VERSION = 1;
const VIEW_MODES = new Set(["hierarchy", "composition", "evolution"]);
const EVOLUTION_MODES = new Set(["single", "compare"]);
const EVOLUTION_ITEM_KINDS = new Set(["timepoint", "relation"]);

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function finiteId(value) {
  const number = finiteNumber(value);
  return number == null ? null : number;
}

export function sanitizeCanvasState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const state = {};
  if (VIEW_MODES.has(value.viewMode)) state.viewMode = value.viewMode;
  if (EVOLUTION_MODES.has(value.evolutionMode)) state.evolutionMode = value.evolutionMode;

  if (Array.isArray(value.evolutionEntityIds)) {
    state.evolutionEntityIds = [...new Set(value.evolutionEntityIds
      .map(finiteId)
      .filter((id) => id != null))].slice(0, 4);
  }

  if (value.selectedEvolutionItem === null) {
    state.selectedEvolutionItem = null;
  } else if (
    value.selectedEvolutionItem
    && typeof value.selectedEvolutionItem === "object"
    && EVOLUTION_ITEM_KINDS.has(value.selectedEvolutionItem.kind)
  ) {
    const id = finiteId(value.selectedEvolutionItem.id);
    if (id != null) {
      state.selectedEvolutionItem = {
        kind: value.selectedEvolutionItem.kind,
        id,
      };
    }
  }

  const lanePage = finiteNumber(value.evolutionLanePage);
  if (lanePage != null) state.evolutionLanePage = Math.max(1, Math.floor(lanePage));

  if (Array.isArray(value.selectedRange) && value.selectedRange.length >= 2) {
    const start = finiteNumber(value.selectedRange[0]);
    const end = finiteNumber(value.selectedRange[1]);
    if (start != null && end != null) {
      state.selectedRange = [Math.min(start, end), Math.max(start, end)];
    }
  }

  if (typeof value.timelineSelectionActive === "boolean") {
    state.timelineSelectionActive = value.timelineSelectionActive;
  }
  // Older builds persisted relation endpoint years as a selected interval.
  // A relation has two event times, not a continuous duration.
  if (state.selectedEvolutionItem?.kind === "relation") {
    state.timelineSelectionActive = false;
  }

  for (const key of ["selectedId", "compositionFocusId"]) {
    if (value[key] === null) {
      state[key] = null;
      continue;
    }
    const id = finiteId(value[key]);
    if (id != null) state[key] = id;
  }

  if (typeof value.selectedCategory === "string" && value.selectedCategory.trim()) {
    state.selectedCategory = value.selectedCategory.trim();
  }
  if (typeof value.spaceAwareExpansion === "boolean") {
    state.spaceAwareExpansion = value.spaceAwareExpansion;
  }
  if (typeof value.showVirtualNodes === "boolean") {
    state.showVirtualNodes = value.showVirtualNodes;
  }
  return Object.keys(state).length ? state : null;
}

function browserStorage(storage) {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

export function readCanvasState(storage = null) {
  try {
    const target = browserStorage(storage);
    if (!target) return null;
    const payload = JSON.parse(target.getItem(CANVAS_STATE_STORAGE_KEY));
    if (payload?.version !== CANVAS_STATE_VERSION) return null;
    return sanitizeCanvasState(payload.state);
  } catch {
    return null;
  }
}

export function writeCanvasState(value, storage = null) {
  const state = sanitizeCanvasState(value);
  if (!state) return false;

  try {
    const target = browserStorage(storage);
    if (!target) return false;
    target.setItem(CANVAS_STATE_STORAGE_KEY, JSON.stringify({
      version: CANVAS_STATE_VERSION,
      state,
    }));
    return true;
  } catch {
    return false;
  }
}
