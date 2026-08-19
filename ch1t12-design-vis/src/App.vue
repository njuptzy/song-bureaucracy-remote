<template>
  <main ref="applicationShellRef" class="application-shell">
    <DesignTemplateCanvas
      v-if="data"
      ref="canvasRef"
      :data="data"
      :initial-state="canvasState"
      :revision-panel-active="revisionPanelVisible || editMode"
      :global-undo-available="Boolean(!revisionBusy && navigationHistory.length)"
      @state-change="handleCanvasStateChange"
      @selection-change="handleSelectionChange"
      @detail-entity-change="handleDetailEntityChange"
      @global-undo="undoCanvasNavigation"
    />
    <div v-else class="loading">{{ loadError || "正在读取职官数据…" }}</div>
    <RevisionWorkspace
      v-if="baseData && isEvolutionView"
      :edit-mode="editMode"
      :drawer="revisionDrawer"
      :state="revisionState"
      :commits="commits"
      :selection="selectedFact"
      :data="data"
      :busy="revisionBusy"
      :error="revisionError"
      :connection-mode="connectionMode"
      :connect-source="connectSource"
      :connect-target="connectTarget"
      :panel-style="revisionPanelStyle"
      @toggle-edit="toggleEditMode"
      @toggle-drawer="toggleDrawer"
      @clear-selection="selectedFact = null"
      @add-operation="addOperation"
      @workspace-action="workspaceAction"
      @remove-group="removeGroup"
      @commit="commitDraft"
      @restore="restoreVersion"
      @delete-commit="deleteCommit"
      @toggle-connect="toggleConnectionMode"
      @cancel-connect="cancelConnection"
      @add-connection="addConnection"
    />
  </main>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import DesignTemplateCanvas from "./components/DesignTemplateCanvas.vue";
import RevisionWorkspace from "./components/RevisionWorkspace.vue";
import { readCanvasState, writeCanvasState } from "./utils/canvas_state";
import { filterSongData } from "./utils/song_scope";
import { applyRevisionPreview } from "./utils/revision_patch";
import { revisionDelete, revisionPost, revisionRequest } from "./utils/revision_api";

const baseData = ref(null);
const data = ref(null);
const dataVersion = ref("");
const loadError = ref("");
const canvasState = ref(readCanvasState());
const revisionState = ref(null);
const revisionPreview = ref(null);
const revisionDrawer = ref("");
const revisionError = ref("");
const revisionBusy = ref(false);
const editMode = ref(false);
const selectedFact = ref(null);
const commits = ref([]);
// 全局撤回记录界面导航，不调用修订工作区的数据库撤回接口。
const navigationHistory = ref([]);
const canvasRef = ref(null);
let canvasStateEventSeen = false;
let pendingNavigationRestoreSignature = "";
const NAVIGATION_HISTORY_LIMIT = 100;
const connectionMode = ref(false);
const connectSource = ref(null);
const connectTarget = ref(null);
const applicationShellRef = ref(null);
const revisionPanelStyle = ref({});
let versionTimer = null;
let panelResizeObserver = null;
let activeDetailEntityId = null;
const loadedDetailEntityIds = new Set();
const pendingDetailRequests = new Map();
const loadedDetailRelationIds = new Set();
const pendingRelationDetailRequests = new Map();

const DESIGN_VIEWBOX = { width: 1920, height: 1080 };
const REVISION_PANEL_BOUNDS = { x: 82, y: 145, width: 393, height: 338 };

function updateRevisionPanelGeometry() {
  const shell = applicationShellRef.value;
  if (!shell) return;
  const width = shell.clientWidth;
  const height = shell.clientHeight;
  if (!width || !height) return;
  const scale = Math.min(width / DESIGN_VIEWBOX.width, height / DESIGN_VIEWBOX.height);
  const offsetX = (width - DESIGN_VIEWBOX.width * scale) / 2;
  const offsetY = (height - DESIGN_VIEWBOX.height * scale) / 2;
  revisionPanelStyle.value = {
    "--revision-panel-left": `${offsetX + REVISION_PANEL_BOUNDS.x * scale}px`,
    "--revision-panel-top": `${offsetY + REVISION_PANEL_BOUNDS.y * scale}px`,
    "--revision-panel-width": `${REVISION_PANEL_BOUNDS.width * scale}px`,
    "--revision-panel-height": `${REVISION_PANEL_BOUNDS.height * scale}px`,
  };
}

const isEvolutionView = computed(() => canvasState.value?.viewMode === "evolution");
const revisionPanelVisible = computed(() => {
  if (!isEvolutionView.value) return false;
  if (revisionDrawer.value) return true;
  if (!editMode.value) return false;
  if (connectionMode.value) return Boolean(connectSource.value && connectTarget.value);
  return Boolean(selectedFact.value);
});

function handleCanvasStateChange(state) {
  const nextState = state || {};
  const nextSignature = JSON.stringify(nextState);
  const previousState = canvasState.value;
  const previousSignature = previousState ? JSON.stringify(previousState) : "";

  // 撤回直接恢复同一个画布实例；恢复后的第一次同步不能再次入栈。
  if (pendingNavigationRestoreSignature) {
    pendingNavigationRestoreSignature = "";
    canvasStateEventSeen = true;
    canvasState.value = nextState;
    writeCanvasState(nextState);
    updateRevisionPanelGeometry();
    return;
  }

  // 首次挂载只建立当前状态，不生成一条“撤回到空状态”的记录。
  if (!canvasStateEventSeen) {
    canvasStateEventSeen = true;
    canvasState.value = nextState;
    writeCanvasState(nextState);
    updateRevisionPanelGeometry();
    return;
  }

  if (previousState && nextSignature !== previousSignature) {
    navigationHistory.value = [
      ...navigationHistory.value,
      JSON.parse(JSON.stringify(previousState)),
    ].slice(-NAVIGATION_HISTORY_LIMIT);
  }
  canvasState.value = nextState;
  writeCanvasState(nextState);
  updateRevisionPanelGeometry();
}

function undoCanvasNavigation() {
  if (revisionBusy.value || !navigationHistory.value.length || !canvasRef.value) return;
  const previousState = navigationHistory.value.at(-1);
  navigationHistory.value = navigationHistory.value.slice(0, -1);
  pendingNavigationRestoreSignature = JSON.stringify(previousState);
  const restoredState = JSON.parse(JSON.stringify(previousState));
  canvasRef.value.restoreCanvasState(restoredState);
  canvasState.value = restoredState;
  writeCanvasState(restoredState);
}

function handleSelectionChange(selection) {
  selectedFact.value = selection;
  if (selection?.entityId != null) void loadEntityDetails(selection.entityId);
  const relationIds = selection?.kind === "relation"
    ? [selection.id]
    : (selection?.item?.evidenceKeys || [])
      .map((key) => /^R(\d+)$/.exec(String(key))?.[1])
      .filter(Boolean);
  relationIds.forEach((relationId) => void loadRelationDetails(relationId));
  if (editMode.value && selection && !connectionMode.value) {
    revisionDrawer.value = "";
  }
  if (!editMode.value || !connectionMode.value || selection?.kind !== "timepoint") return;
  if (!connectSource.value) {
    connectSource.value = selection;
    connectTarget.value = null;
    return;
  }
  if (String(connectSource.value.id) === String(selection.id)) return;
  connectTarget.value = selection;
}

function handleDetailEntityChange(entityId) {
  activeDetailEntityId = entityId !== null
    && entityId !== undefined
    && entityId !== ""
    && Number.isFinite(Number(entityId))
    ? Number(entityId)
    : null;
  if (activeDetailEntityId != null) void loadEntityDetails(activeDetailEntityId);
}

const DESIGN_ASSET_VERSION = encodeURIComponent(__APP_BUILD_ID__);

function versionedDesignAsset(path) {
  return `${path}?v=${DESIGN_ASSET_VERSION}`;
}

function warmInitialDesignAssets() {
  const urls = [
    versionedDesignAsset("/api/design/hierarchy.svg"),
    versionedDesignAsset("/api/design/fzqing.ttf"),
  ];
  return Promise.allSettled(urls.map(async (url) => {
    const response = await fetch(url, { cache: "force-cache" });
    if (response.ok) await response.arrayBuffer();
  }));
}

async function fetchJson(url, cache = "default") {
  const response = await fetch(url, { cache });
  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.json();
      if (body?.error) detail = `：${body.error}`;
    } catch { /* non-JSON body */ }
    throw new Error(`HTTP ${response.status}${detail}`);
  }
  return response.json();
}

function applyPreview(preview = revisionPreview.value) {
  if (!baseData.value) return;
  data.value = preview?.state?.draft?.group_count
    ? applyRevisionPreview(baseData.value, preview)
    : baseData.value;
}

function mergeEntityDetails(target, details) {
  const entityId = String(details.entityId);
  const quotations = details.timepointQuotations || {};
  const timepoints = { ...(target.timepoints || {}) };
  if (timepoints[entityId]) {
    timepoints[entityId] = timepoints[entityId].map((item) => ({
      ...item,
      ...(Object.prototype.hasOwnProperty.call(quotations, item.id)
        ? { quotation: quotations[item.id] }
        : {}),
    }));
  }
  const relationQuotations = details.relationQuotations || {};
  const changeRelations = (target.changeRelations || []).map((relation) => ({
    ...relation,
    ...(Object.prototype.hasOwnProperty.call(relationQuotations, relation.id)
      ? { quotation: relationQuotations[relation.id] }
      : {}),
  }));
  return {
    ...target,
    detailUpdateEntityId: Number(details.entityId),
    timepoints,
    changeRelations,
    citations: { ...(target.citations || {}), ...(details.citations || {}) },
    dictionary: { ...(target.dictionary || {}), ...(details.dictionary || {}) },
  };
}

function mergeRelationDetails(target, details) {
  return {
    ...target,
    relationshipSources: {
      ...(target.relationshipSources || {}),
      ...(details.relationshipSources || {}),
    },
  };
}

async function loadEntityDetails(entityId) {
  const numericId = Number(entityId);
  if (!baseData.value || !Number.isFinite(numericId) || loadedDetailEntityIds.has(numericId)) return;
  if (pendingDetailRequests.has(numericId)) return pendingDetailRequests.get(numericId);
  const requestVersion = dataVersion.value;
  const request = (async () => {
    try {
      const url = `/api/details/entity/${numericId}?v=${encodeURIComponent(requestVersion)}`;
      const details = await fetchJson(url, "force-cache");
      if (!baseData.value || requestVersion !== dataVersion.value) return;
      baseData.value = mergeEntityDetails(baseData.value, details);
      loadedDetailEntityIds.add(numericId);
      applyPreview();
    } catch (reason) {
      revisionError.value = `词条详情加载失败：${reason.message}`;
    } finally {
      pendingDetailRequests.delete(numericId);
    }
  })();
  pendingDetailRequests.set(numericId, request);
  return request;
}

async function loadRelationDetails(relationId) {
  const numericId = Number(relationId);
  if (!baseData.value || !Number.isFinite(numericId) || loadedDetailRelationIds.has(numericId)) return;
  if (pendingRelationDetailRequests.has(numericId)) return pendingRelationDetailRequests.get(numericId);
  const requestVersion = dataVersion.value;
  const request = (async () => {
    try {
      const url = `/api/details/relation/${numericId}?v=${encodeURIComponent(requestVersion)}`;
      const details = await fetchJson(url, "force-cache");
      if (!baseData.value || requestVersion !== dataVersion.value) return;
      baseData.value = mergeRelationDetails(baseData.value, details);
      loadedDetailRelationIds.add(numericId);
      applyPreview();
    } catch (reason) {
      revisionError.value = `关系来源原文加载失败：${reason.message}`;
    } finally {
      pendingRelationDetailRequests.delete(numericId);
    }
  })();
  pendingRelationDetailRequests.set(numericId, request);
  return request;
}

async function refreshRevision() {
  revisionState.value = await revisionRequest("/api/revisions/state");
  revisionPreview.value = await revisionRequest("/api/revisions/draft/preview");
  revisionState.value = revisionPreview.value.state || revisionState.value;
  applyPreview();
}

async function refreshData(force = false) {
  try {
    const { version } = await fetchJson("/api/version", "no-store");
    if (!force && version === dataVersion.value) return;
    if (!force && revisionState.value?.draft?.group_count) {
      await refreshRevision();
      return;
    }
    const dataUrl = `/data/song-bureaucracy-core.json?v=${encodeURIComponent(version)}`;
    baseData.value = filterSongData(await fetchJson(dataUrl, "force-cache"));
    dataVersion.value = version;
    loadedDetailEntityIds.clear();
    pendingDetailRequests.clear();
    loadedDetailRelationIds.clear();
    pendingRelationDetailRequests.clear();
    loadError.value = "";
    if (revisionState.value?.draft?.group_count) applyPreview();
    else data.value = baseData.value;
    if (activeDetailEntityId != null) void loadEntityDetails(activeDetailEntityId);
  } catch (reason) {
    loadError.value = `数据加载失败：${reason.message}`;
  }
}

async function loadCommits() {
  const payload = await revisionRequest("/api/revisions/commits");
  commits.value = payload.commits || [];
}

function toggleEditMode() {
  if (revisionState.value?.edit_locked) return;
  editMode.value = !editMode.value;
  revisionError.value = "";
  if (!editMode.value) cancelConnection();
}

async function toggleDrawer(name) {
  const opening = revisionDrawer.value !== name;
  revisionDrawer.value = opening ? name : "";
  revisionError.value = "";
  if (opening) {
    selectedFact.value = null;
    cancelConnection();
  }
  if (revisionDrawer.value === "history") {
    try { await loadCommits(); } catch (reason) { revisionError.value = reason.message; }
  }
}

async function runRevisionAction(callback) {
  revisionBusy.value = true;
  revisionError.value = "";
  try {
    return await callback();
  } catch (reason) {
    revisionError.value = reason.message;
    throw reason;
  } finally {
    revisionBusy.value = false;
  }
}

async function addOperation(payload) {
  try {
    const result = await runRevisionAction(() => revisionPost("/api/revisions/draft/operations", payload));
    revisionPreview.value = result.preview;
    revisionState.value = result.preview.state;
    applyPreview(result.preview);
    revisionDrawer.value = "workspace";
    selectedFact.value = null;
  } catch { /* error is displayed by runRevisionAction */ }
}

async function workspaceAction(action) {
  if (action === "discard" && !window.confirm("放弃当前工作区的全部修改？")) return;
  try {
    await runRevisionAction(() => revisionPost(`/api/revisions/draft/${action}`));
    await refreshRevision();
  } catch { /* displayed */ }
}

async function removeGroup(groupId) {
  try {
    await runRevisionAction(() => revisionDelete(`/api/revisions/draft/operations/${groupId}`));
    await refreshRevision();
  } catch { /* displayed */ }
}

async function commitDraft(summary) {
  try {
    await runRevisionAction(() => revisionPost("/api/revisions/commit", { summary }));
    revisionPreview.value = null;
    await refreshData(true);
    await Promise.all([refreshRevision(), loadCommits()]);
    revisionDrawer.value = "history";
    editMode.value = false;
    selectedFact.value = null;
    cancelConnection();
  } catch { /* displayed */ }
}

async function restoreVersion(targetHash) {
  if (!window.confirm("恢复会创建一条新的反向提交，已有历史不会删除。继续？")) return;
  try {
    const preview = await runRevisionAction(() => revisionPost("/api/revisions/restore-preview", { target_hash: targetHash }));
    if (!window.confirm(`将生成 ${preview.operation_count} 项反向操作。确认恢复？`)) return;
    await runRevisionAction(() => revisionPost("/api/revisions/restore", { target_hash: targetHash }));
    await refreshData(true);
    await Promise.all([refreshRevision(), loadCommits()]);
  } catch { /* displayed */ }
}

async function deleteCommit(commit) {
  const operationCount = Number(commit?.operation_count || 0);
  const confirmed = window.confirm(
    `删除“${commit?.summary || commit?.hash?.slice(0, 8)}”将撤销其 ${operationCount} 项数据库操作，`
    + "并永久移除这条历史。此操作只能依靠 latest-rollback 应急备份恢复。继续？",
  );
  if (!confirmed) return;
  try {
    await runRevisionAction(() => revisionDelete(`/api/revisions/commits/${commit.hash}`));
    revisionPreview.value = null;
    await refreshData(true);
    await Promise.all([refreshRevision(), loadCommits()]);
    selectedFact.value = null;
    cancelConnection();
  } catch { /* displayed */ }
}

function toggleConnectionMode() {
  connectionMode.value = !connectionMode.value;
  revisionDrawer.value = "";
  connectSource.value = null;
  connectTarget.value = null;
  selectedFact.value = null;
}

function cancelConnection() {
  connectionMode.value = false;
  connectSource.value = null;
  connectTarget.value = null;
}

async function addConnection(payload) {
  await addOperation(payload);
  if (!revisionError.value) cancelConnection();
}

onMounted(async () => {
  updateRevisionPanelGeometry();
  panelResizeObserver = new ResizeObserver(updateRevisionPanelGeometry);
  if (applicationShellRef.value) panelResizeObserver.observe(applicationShellRef.value);
  void warmInitialDesignAssets();
  await refreshData(true);
  try {
    await Promise.all([refreshRevision(), loadCommits()]);
  } catch (reason) {
    revisionError.value = `版本工作区加载失败：${reason.message}`;
  }
  versionTimer = window.setInterval(refreshData, 30000);
});

onBeforeUnmount(() => {
  if (versionTimer != null) window.clearInterval(versionTimer);
  panelResizeObserver?.disconnect();
});
</script>

<style scoped>
.application-shell { position: relative; width: 100%; height: 100%; overflow: hidden; }
.loading { width: 100%; height: 100%; display: grid; place-items: center; color: var(--ink-2); letter-spacing: 4px; }
</style>
