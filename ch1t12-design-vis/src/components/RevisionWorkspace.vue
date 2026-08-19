<template>
  <div class="revision-ui" :class="{ 'is-editing': editMode }" :style="panelStyle">
    <nav class="revision-toolbar" aria-label="修订工具">
      <button
        class="toolbar-command edit-command"
        :class="{ active: editMode }"
        type="button"
        :disabled="state?.edit_locked"
        :title="state?.lock_reason || (editMode ? '退出修改模式' : '进入修改模式')"
        @click="$emit('toggle-edit')"
      >
        <span class="command-mark">校</span>{{ editMode ? "退出修改" : "进入修改" }}
      </button>
      <button
        class="toolbar-command"
        :class="{ active: drawer === 'workspace' }"
        type="button"
        title="查看草稿修改工作区"
        @click="$emit('toggle-drawer', 'workspace')"
      >
        修改工作区<span v-if="draftCount" class="draft-count">{{ draftCount }}</span>
      </button>
      <button
        class="toolbar-command"
        :class="{ active: drawer === 'history' }"
        type="button"
        title="查看线性提交历史"
        @click="$emit('toggle-drawer', 'history')"
      >提交历史</button>
    </nav>

    <div v-if="state?.edit_locked" class="revision-lock" role="alert">
      {{ state.lock_reason }}
    </div>

    <div v-if="editMode && connectionMode" class="connection-guide">
      <span class="connection-step" :class="{ done: connectSource }">1 来源</span>
      <span class="guide-line"></span>
      <span class="connection-step" :class="{ done: connectTarget }">2 目标</span>
      <button type="button" class="text-command" @click="$emit('cancel-connect')">取消连接</button>
    </div>

    <section v-if="!drawer && editMode && !connectionMode" class="selection-editor" aria-label="演变校订区域">
      <fieldset class="editor-frame">
        <legend class="editor-heading editor-frame-title">
          <strong>演变校订</strong>
        </legend>
        <div class="editor-frame-scroll">
          <template v-if="selection">
            <header class="editor-context-heading">
              <div>
                <span class="editor-kicker">{{ selection.kind === 'timepoint' ? '时间点校订' : '演变关系校订' }}</span>
                <strong>{{ selectionTitle }}</strong>
              </div>
              <button type="button" class="icon-command" title="清空当前选择" @click="$emit('clear-selection')">×</button>
            </header>

            <template v-if="selection.kind === 'timepoint'">
              <div class="editor-tabs" role="tablist">
                <button v-for="item in timepointActions" :key="item.value" type="button"
                  :class="{ active: action === item.value }" @click="action = item.value">{{ item.label }}</button>
              </div>
              <div v-if="action !== 'delete'" class="form-grid">
                <label class="field field-wide">
                  <span>原文纪年</span>
                  <input v-model="timeForm.time" type="text" @input="normalizeTime" />
                </label>
                <div class="normalized-time field-wide">
                  <span>{{ normalizedLabel }}</span>
                  <small>{{ normalizedTime?.parse_note || '输入纪年后即时解析' }}</small>
                </div>
                <label class="field field-wide">
                  <span>事件</span>
                  <textarea v-model="timeForm.event" rows="3"></textarea>
                </label>
                <label class="field">
                  <span>事件类型</span>
                  <select v-model="timeForm.event_type">
                    <option v-for="item in eventTypeOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
                  </select>
                </label>
                <label class="field">
                  <span>存废影响</span>
                  <select v-model="timeForm.lifecycle_effect">
                    <option v-for="item in lifecycleEffectOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
                  </select>
                </label>
                <label v-if="action === 'insert'" class="field">
                  <span>插入位置</span>
                  <select v-model="insertPosition">
                    <option value="after">当前点之后</option>
                    <option value="before">当前点之前</option>
                  </select>
                </label>
                <label class="field"><span>属性分类</span><input v-model="timeForm.attr_category" type="text" /></label>
                <label class="field"><span>官员类型</span><input v-model="timeForm.attr_officer_type" type="text" /></label>
                <label class="field"><span>品级</span><input v-model="timeForm.attr_grade" type="text" /></label>
              </div>
              <p v-else class="impact-copy">
                删除会把关联关系、引用、标准化时间和链指针调整作为一个不可拆分的操作组加入草稿。
              </p>
            </template>

            <template v-else>
              <div class="editor-tabs" role="tablist">
                <button type="button" :class="{ active: action === 'update' }" @click="action = 'update'">调整关系</button>
                <button type="button" :class="{ active: action === 'delete' }" @click="action = 'delete'">删除</button>
              </div>
              <div v-if="action === 'update'" class="relation-endpoints">
                <label class="field field-wide"><span>来源时间点</span><select v-model="relationForm.subject_id">
                  <option v-for="point in compatibleTimepoints" :key="point.id" :value="point.id">{{ point.label }}</option>
                </select></label>
                <button type="button" class="swap-command" title="交换来源和目标方向" @click="swapRelation">⇄ 交换方向</button>
                <label class="field field-wide"><span>目标时间点</span><select v-model="relationForm.object_id">
                  <option v-for="point in compatibleTimepoints" :key="point.id" :value="point.id">{{ point.label }}</option>
                </select></label>
              </div>
              <p v-else class="impact-copy">删除关系不会删除端点时间点；关系引用会作为自动联动一并移除。</p>
            </template>

            <div class="evidence-section">
              <label class="field field-wide"><span>修改理由</span><textarea v-model="reason" rows="2" placeholder="说明为什么要作出这项历史判断"></textarea></label>
              <div v-if="existingEvidence.length && action !== 'insert'" class="evidence-mode">
                <label><input v-model="evidenceMode" type="radio" value="existing" /> 关联已有证据</label>
                <label><input v-model="evidenceMode" type="radio" value="new" /> 新增证据</label>
              </div>
              <label v-if="evidenceMode === 'existing'" class="field field-wide"><span>已有证据</span><select v-model="existingCitationId">
                <option v-for="item in existingEvidence" :key="item.id" :value="item.id">{{ item.citation || item.quotation }}</option>
              </select></label>
              <template v-else>
                <label class="field field-wide"><span>出处</span><input v-model="evidence.citation" type="text" placeholder="书名、卷次或条目来源" /></label>
                <label class="field field-wide"><span>逐字引文</span><textarea v-model="evidence.quotation" rows="3"></textarea></label>
                <label class="field field-wide"><span>证据说明</span><input v-model="evidence.note" type="text" /></label>
              </template>
            </div>
            <footer class="editor-footer">
              <span class="form-error">{{ localError }}</span>
              <button class="primary-command" type="button" :disabled="busy" @click="submitSelection">加入草稿</button>
            </footer>
          </template>
        </div>
      </fieldset>
    </section>

    <section v-if="!drawer && editMode && connectionMode" class="selection-editor connection-editor" aria-label="新建前后演变区域">
      <fieldset class="editor-frame">
        <legend class="editor-heading editor-frame-title"><strong>新建前后演变</strong></legend>
        <div class="editor-frame-scroll">
          <template v-if="connectSource && connectTarget">
            <header class="editor-context-heading"><strong>{{ connectLabel }}</strong></header>
            <label class="field field-wide"><span>关系说明</span><input v-model="connectQuotation" type="text" /></label>
            <label class="field field-wide"><span>修改理由</span><textarea v-model="connectReason" rows="2"></textarea></label>
            <label class="field field-wide"><span>出处</span><input v-model="connectEvidence.citation" type="text" /></label>
            <label class="field field-wide"><span>逐字引文</span><textarea v-model="connectEvidence.quotation" rows="2"></textarea></label>
            <footer class="editor-footer">
              <span class="form-error">{{ localError }}</span>
              <button type="button" class="primary-command" @click="submitConnection">加入关系</button>
            </footer>
          </template>
        </div>
      </fieldset>
    </section>

    <aside v-if="drawer" class="revision-drawer" :aria-label="drawer === 'workspace' ? '修改工作区' : '提交历史'">
      <header class="drawer-heading">
        <div><span>{{ drawer === 'workspace' ? '当前判断' : '版本轨迹' }}</span><strong>{{ drawer === 'workspace' ? '修改工作区' : '提交历史' }}</strong></div>
        <button type="button" class="icon-command" title="关闭侧栏" @click="$emit('toggle-drawer', drawer)">×</button>
      </header>
      <template v-if="drawer === 'workspace'">
        <div class="workspace-controls">
          <button type="button" class="icon-command" title="撤销上一步" :disabled="!state?.draft?.can_undo" @click="$emit('workspace-action', 'undo')">↶</button>
          <button type="button" class="icon-command" title="重做下一步" :disabled="!state?.draft?.can_redo" @click="$emit('workspace-action', 'redo')">↷</button>
          <button type="button" class="text-command" :disabled="!state?.draft?.total_group_count" @click="$emit('workspace-action', 'discard')">全部放弃</button>
          <button type="button" class="text-command connect-command" @click="$emit('toggle-connect')">连接时间点</button>
        </div>
        <div v-if="!groups.length" class="drawer-empty">选中演变图中的时间点或关系，开始记录校订判断。</div>
        <ol v-else class="draft-list">
          <li v-for="group in groups" :key="group.group_id" :class="{ inactive: group.position > state.draft.cursor }">
            <div class="draft-line"><strong>{{ group.label }}</strong><button type="button" class="icon-command" title="移除此操作组" @click="$emit('remove-group', group.group_id)">×</button></div>
            <p>{{ group.reason }}</p>
            <div class="operation-summary">
              <span>{{ manualCount(group) }} 项人工修改</span><span>{{ automaticCount(group) }} 项自动联动</span>
            </div>
            <details class="group-differences">
              <summary>查看差异与证据</summary>
              <div v-for="operation in group.operations" :key="`${operation.operation_order}:${operation.target_id}`" class="operation-detail" :class="{ automatic: operation.automatic }">
                <div class="operation-title">
                  <span>{{ operation.automatic ? "自动联动" : "人工修改" }}</span>
                  <strong>{{ operationLabel(operation) }}</strong>
                </div>
                <dl v-if="fieldChanges(operation).length" class="field-differences">
                  <template v-for="change in fieldChanges(operation)" :key="change.field">
                    <dt>{{ fieldLabel(change.field) }}</dt>
                    <dd><del>{{ valueText(change.before) }}</del><span>→</span><ins>{{ valueText(change.after) }}</ins></dd>
                  </template>
                </dl>
              </div>
              <div v-if="group.evidence?.length" class="group-evidence">
                <span>证据</span>
                <blockquote v-for="(item, index) in group.evidence" :key="index">
                  <cite>{{ item.citation }}</cite>{{ item.quotation }}
                </blockquote>
              </div>
            </details>
          </li>
        </ol>
        <div v-if="groups.length" class="commit-section">
          <label class="field field-wide"><span>提交说明</span><textarea v-model="commitSummary" rows="2" placeholder="概括这一组完整历史判断"></textarea></label>
          <button type="button" class="primary-command" :disabled="busy || !activeGroupCount" @click="$emit('commit', commitSummary)">提交全部草稿</button>
        </div>
      </template>
      <template v-else>
        <div v-if="!commits.length" class="drawer-empty">尚无提交历史。</div>
        <ol v-else class="history-list">
          <li v-for="commit in commits" :key="commit.hash" :class="{ head: commit.hash === state?.head }">
            <div class="history-line"><strong>{{ commit.summary }}</strong><code>{{ commit.hash.slice(0, 8) }}</code></div>
            <p>{{ formatDate(commit.created_at) }} · {{ commit.operation_count }} 项操作</p>
            <div class="history-actions">
              <button v-if="!commit.is_baseline && commit.hash !== state?.head" type="button" class="text-command" @click="$emit('restore', commit.hash)">恢复至此版本</button>
              <button v-else-if="commit.is_baseline && commit.hash !== state?.head" type="button" class="text-command" @click="$emit('restore', commit.hash)">恢复至初始基线</button>
              <button v-if="!commit.is_baseline && commit.hash === state?.head" type="button" class="text-command danger-command" :disabled="busy" @click="$emit('delete-commit', commit)">删除此提交</button>
            </div>
          </li>
        </ol>
      </template>
    </aside>

    <div v-if="error" class="revision-toast" role="alert">{{ error }}</div>
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from "vue";
import { revisionPost } from "../utils/revision_api";

const props = defineProps({
  editMode: { type: Boolean, default: false },
  drawer: { type: String, default: "" },
  state: { type: Object, default: null },
  commits: { type: Array, default: () => [] },
  selection: { type: Object, default: null },
  data: { type: Object, default: null },
  busy: { type: Boolean, default: false },
  error: { type: String, default: "" },
  connectionMode: { type: Boolean, default: false },
  connectSource: { type: Object, default: null },
  connectTarget: { type: Object, default: null },
  panelStyle: { type: Object, default: () => ({}) },
});
const emit = defineEmits([
  "toggle-edit", "toggle-drawer", "clear-selection", "add-operation", "workspace-action",
  "remove-group", "commit", "restore", "delete-commit", "toggle-connect", "cancel-connect", "add-connection",
]);

const timepointActions = [
  { value: "update", label: "编辑" },
  { value: "insert", label: "新增相邻" },
  { value: "delete", label: "删除" },
];
const eventTypeOptions = [
  { value: "establish", label: "建置" },
  { value: "restore", label: "复置" },
  { value: "abolish", label: "罢废" },
  { value: "rename", label: "改称" },
  { value: "reorganize", label: "改置" },
  { value: "merge", label: "合并" },
  { value: "split", label: "分拆" },
  { value: "incorporate", label: "并入" },
  { value: "duty_transfer", label: "职掌移交" },
  { value: "affiliation_change", label: "隶属变化" },
  { value: "staffing_change", label: "编制变化" },
  { value: "record", label: "一般记载" },
];
const lifecycleEffectOptions = [
  { value: "activate", label: "启用" },
  { value: "preserve", label: "普通记载" },
  { value: "deactivate", label: "罢废" },
  { value: "ignore", label: "拟议未行" },
];
const action = ref("update");
const insertPosition = ref("after");
const reason = ref("");
const evidenceMode = ref("new");
const existingCitationId = ref(null);
const normalizedTime = ref(null);
const localError = ref("");
const commitSummary = ref("");
const connectReason = ref("");
const connectQuotation = ref("");
const connectEvidence = reactive({ citation: "", quotation: "" });
const timeForm = reactive({
  time: "",
  event: "",
  event_type: "record",
  lifecycle_effect: "preserve",
  attr_category: "",
  attr_officer_type: "",
  attr_grade: "",
});
const relationForm = reactive({ subject_id: null, object_id: null });
const evidence = reactive({ citation: "", quotation: "", note: "" });
let normalizeTimer = null;

const draftCount = computed(() => props.state?.draft?.group_count || 0);
const groups = computed(() => props.state?.draft?.groups || []);
const activeGroupCount = computed(() => props.state?.draft?.group_count || 0);
const originalSelectionId = computed(() => (
  props.selection?.item?._revision_original_id
  ?? props.selection?.item?.revisionOriginalId
  ?? props.selection?.id
));
const selectionTitle = computed(() => {
  if (props.selection?.kind === "timepoint") {
    const entity = (props.data?.entities || []).find((item) => item.id === props.selection.entityId);
    return `${entity?.title || "时间点"} · ${props.selection.item?.rawTime || props.selection.item?.time || "年代未明"}`;
  }
  return props.selection?.item?.label || "前后演变";
});
const evidenceKey = computed(() => `${props.selection?.kind === "timepoint" ? "T" : "R"}${originalSelectionId.value}`);
const existingEvidence = computed(() => (props.data?.citations?.[evidenceKey.value] || []).filter((item) => item.id != null));
const compatibleTimepoints = computed(() => {
  const points = [];
  const selectedRelation = props.selection?.item;
  const selectedSource = selectedRelation?.sourceEntityId;
  const entityType = (props.data?.entities || []).find((entity) => entity.id === selectedSource)?.type;
  const entityMap = new Map((props.data?.entities || []).map((entity) => [entity.id, entity]));
  for (const [entityId, rows] of Object.entries(props.data?.timepoints || {})) {
    const entity = entityMap.get(Number(entityId)) || entityMap.get(entityId);
    if (entityType && entity?.type !== entityType) continue;
    for (const row of rows || []) {
      if (String(row.id).includes(":")) continue;
      points.push({ id: row.id, label: `${entity?.title || entityId} · ${row.time || row.raw_time || "年代未明"}` });
    }
  }
  return points;
});
const normalizedLabel = computed(() => {
  const item = normalizedTime.value;
  if (!item) return "等待解析";
  if (item.year_start == null) return `${item.time_type} · 未解析出具体年份`;
  const span = item.year_end && item.year_end !== item.year_start ? `${item.year_start}—${item.year_end}` : `${item.year_start}`;
  return `${span} 年 · ${item.time_type}`;
});
const connectLabel = computed(() => {
  const title = (point) => {
    const entity = (props.data?.entities || []).find((item) => item.id === point?.entityId);
    return `${entity?.title || "?"} ${point?.item?.rawTime || point?.item?.time || ""}`;
  };
  return `${title(props.connectSource)} → ${title(props.connectTarget)}`;
});

watch(() => props.selection, (selection) => {
  action.value = "update";
  reason.value = "";
  localError.value = "";
  evidenceMode.value = "new";
  const item = selection?.item || {};
  if (selection?.kind === "timepoint") {
    Object.assign(timeForm, {
      time: item.rawTime || item.time || "",
      event: item.event || "",
      event_type: item.event_type || item.eventType || "record",
      lifecycle_effect: item.lifecycle_effect || item.effect || "preserve",
      attr_category: item.attr_category || "",
      attr_officer_type: item.attr_officer_type || "",
      attr_grade: item.attr_grade || "",
    });
    normalizeTime();
  } else if (selection?.kind === "relation") {
    relationForm.subject_id = item.sourceTimepointId ?? item.source_timepoint_id;
    relationForm.object_id = item.targetTimepointId ?? item.target_timepoint_id;
  }
  if (existingEvidence.value.length) {
    evidenceMode.value = "existing";
    existingCitationId.value = existingEvidence.value[0].id;
  }
}, { immediate: true, deep: false });

watch(action, (value) => {
  if (value === "insert") evidenceMode.value = "new";
});

function normalizeTime() {
  window.clearTimeout(normalizeTimer);
  normalizeTimer = window.setTimeout(async () => {
    try {
      normalizedTime.value = await revisionPost("/api/revisions/normalize-time", { time: timeForm.time });
    } catch {
      normalizedTime.value = null;
    }
  }, 180);
}

function evidencePayload() {
  if (evidenceMode.value === "existing") {
    return [{ mode: "existing", citation_id: existingCitationId.value }];
  }
  return [{ mode: "new", ...evidence }];
}

function submitSelection() {
  localError.value = "";
  if (!reason.value.trim()) {
    localError.value = "请填写修改理由";
    return;
  }
  const id = originalSelectionId.value;
  let operation;
  if (props.selection.kind === "timepoint") {
    if (action.value === "insert") {
      const selected = props.selection.item || {};
      const prevId = selected.prevId ?? selected.prev_id ?? null;
      const succId = selected.succId ?? selected.succ_id ?? null;
      operation = {
        action: "insert", target_table: "Timepoints",
        after: {
          entity_id: props.selection.entityId,
          ...timeForm,
          prev_id: insertPosition.value === "after" ? id : prevId,
          succ_id: insertPosition.value === "after" ? succId : id,
        },
      };
    } else {
      operation = {
        action: action.value, target_table: "Timepoints", target_id: id,
        ...(action.value === "update" ? { after: { ...timeForm } } : {}),
      };
    }
  } else {
    operation = {
      action: action.value, target_table: "Relationships", target_id: id,
      ...(action.value === "update" ? { after: { ...relationForm } } : {}),
    };
  }
  operation.evidence = evidencePayload();
  emit("add-operation", {
    label: `${action.value === "insert" ? "新增" : action.value === "delete" ? "删除" : "修改"}${props.selection.kind === "timepoint" ? "时间点" : "演变关系"}`,
    reason: reason.value,
    operations: [operation],
  });
}

function swapRelation() {
  [relationForm.subject_id, relationForm.object_id] = [relationForm.object_id, relationForm.subject_id];
}

function submitConnection() {
  if (!connectReason.value.trim()) {
    localError.value = "请填写修改理由";
    return;
  }
  emit("add-connection", {
    label: "新增前后演变关系",
    reason: connectReason.value,
    operations: [{
      action: "insert",
      target_table: "Relationships",
      after: {
        subject_id: originalPointId(props.connectSource),
        object_id: originalPointId(props.connectTarget),
        quotation: connectQuotation.value || connectEvidence.quotation,
      },
      evidence: [{ mode: "new", ...connectEvidence }],
    }],
  });
}

function originalPointId(point) {
  return point?.item?._revision_original_id ?? point?.item?.revisionOriginalId ?? point?.id;
}

function manualCount(group) {
  return (group.operations || []).filter((item) => !item.automatic).length;
}

function automaticCount(group) {
  return (group.operations || []).filter((item) => item.automatic).length;
}

const fieldNames = {
  time: "纪年", event: "事件", event_type: "事件类型", lifecycle_effect: "存废影响",
  attr_category: "属性分类",
  attr_officer_type: "官员类型", attr_grade: "品级", quotation: "逐字引文",
  subject_id: "来源端点", object_id: "目标端点", prev_id: "前序指针",
  succ_id: "后继指针", raw_time: "标准化原文", year_start: "起始年", year_end: "结束年",
};

function operationLabel(operation) {
  const actionName = { insert: "新增", update: "修改", delete: "删除" }[operation.action] || operation.action;
  const tableName = { Timepoints: "时间点", Relationships: "演变关系", Citations: "引用", NormalizedTimes: "标准化时间" }[operation.target_table] || operation.target_table;
  return `${actionName}${tableName} #${operation.target_id}`;
}

function fieldLabel(field) {
  return fieldNames[field] || field;
}

function fieldChanges(operation) {
  const before = operation.before || {};
  const after = operation.after || {};
  const ignored = new Set(["id", "timepoint_id", "entity_id", "target_id", "target_table"]);
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((field) => !ignored.has(field) && JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null))
    .map((field) => ({ field, before: before[field], after: after[field] }));
}

function valueText(value) {
  if (value === null || value === undefined || value === "") return "空";
  return String(value);
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
</script>

<style scoped>
.revision-ui { position: absolute; inset: 0; pointer-events: none; z-index: 20; color: var(--ink); }
button, input, textarea, select { font: inherit; letter-spacing: 0; }
button { color: inherit; }
.revision-toolbar { position: absolute; top: 18px; right: 24px; display: flex; height: 34px; border: 1px solid rgba(86,57,5,.62); background: transparent; box-shadow: none; pointer-events: auto; }
.toolbar-command { position: relative; border: 0; border-right: 1px solid rgba(86,57,5,.28); padding: 0 12px; background: transparent; cursor: pointer; white-space: nowrap; }
.toolbar-command:last-child { border-right: 0; }
.toolbar-command:hover { color: var(--taupe); }
.toolbar-command.active::after { position: absolute; right: 8px; bottom: 2px; left: 8px; height: 2px; background: var(--ink-2); content: ""; }
.toolbar-command:focus-visible { outline: 1px dashed rgba(86,57,5,.78); outline-offset: -4px; }
.toolbar-command:disabled { opacity: .45; cursor: not-allowed; }
.command-mark { display: inline-grid; place-items: center; width: 18px; height: 18px; margin-right: 6px; border: 1px solid currentColor; font-size: 11px; }
.draft-count { display: inline-grid; min-width: 16px; height: 16px; margin-left: 7px; place-items: center; border: 1px solid currentColor; border-radius: 0; background: transparent; color: inherit; font-size: 9px; }
.revision-lock, .connection-guide { position: absolute; top: 60px; right: 24px; pointer-events: auto; }
.revision-lock { max-width: 440px; padding: 8px 12px; border-left: 3px solid #a0432e; background: rgba(245,243,236,.97); color: #7b2f20; }
.connection-guide { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border: 1px solid rgba(86,57,5,.45); background: rgba(245,243,236,.96); }
.connection-step { opacity: .48; }
.connection-step.done { opacity: 1; color: #4a765c; }
.guide-line { width: 25px; border-top: 1px dashed var(--ink-2); }
.selection-editor, .connection-editor, .revision-drawer {
  position: absolute;
  left: var(--revision-panel-left, 4.2708%);
  top: var(--revision-panel-top, 13.4259%);
  right: auto;
  bottom: auto;
  width: var(--revision-panel-width, 20.4688%);
  height: var(--revision-panel-height, 31.2963%);
  max-height: none;
  overflow: hidden;
  border: 0;
  background: transparent;
  box-shadow: none;
  pointer-events: auto;
  scrollbar-color: rgba(86,57,5,.48) transparent;
  scrollbar-width: thin;
}
.selection-editor { padding: 0; }
.connection-editor { padding: 0; overflow: hidden; }
.editor-frame {
  display: flex;
  min-width: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0 10px 8px;
  flex-direction: column;
  border: 1px solid rgba(86,57,5,.78);
  border-radius: 0;
  background: transparent;
}
.editor-frame > .editor-heading {
  box-sizing: border-box;
  width: min(92%, max-content);
  max-width: calc(100% - 22px);
  margin-left: 9px;
  padding: 0 8px;
  border: 0;
}
.editor-frame > .editor-frame-title { width: max-content; }
.editor-frame-scroll {
  flex: 1 1 auto;
  min-height: 0;
  padding: 0 2px 2px;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-color: rgba(86,57,5,.48) transparent;
  scrollbar-width: thin;
}
.editor-heading, .drawer-heading { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; padding-bottom: 10px; border-bottom: 1px solid rgba(86,57,5,.32); }
.editor-context-heading { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; padding: 2px 0 9px; border-bottom: 1px solid rgba(86,57,5,.32); }
.editor-context-heading > div { display: grid; gap: 3px; min-width: 0; }
.editor-context-heading strong { overflow-wrap: anywhere; font-size: 15px; font-weight: 500; }
.editor-heading div, .drawer-heading div { display: grid; gap: 3px; min-width: 0; }
.editor-heading strong, .drawer-heading strong { overflow-wrap: anywhere; font-size: 15px; font-weight: 500; }
.editor-kicker, .drawer-heading span { color: var(--taupe); font-size: 10px; }
.icon-command { width: 26px; height: 26px; border: 0; background: transparent; cursor: pointer; font-size: 18px; }
.icon-command:hover { background: rgba(145,128,105,.16); }
.icon-command:disabled { opacity: .28; cursor: not-allowed; }
.editor-tabs { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; margin: 10px 0; border-bottom: 1px solid rgba(86,57,5,.26); }
.editor-tabs button { border: 0; border-bottom: 2px solid transparent; padding: 6px; background: transparent; cursor: pointer; }
.editor-tabs button.active { border-bottom-color: var(--ink-2); }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.field { display: grid; gap: 4px; min-width: 0; }
.field-wide { grid-column: 1 / -1; }
.field > span { color: var(--taupe); font-size: 10px; }
.field input, .field textarea, .field select { width: 100%; min-width: 0; border: 1px solid rgba(86,57,5,.42); border-radius: 0; padding: 6px 7px; background: transparent; color: var(--ink); resize: vertical; }
.field input:focus, .field textarea:focus, .field select:focus { outline: 1px solid var(--ink-2); outline-offset: 1px; }
.normalized-time { display: grid; gap: 2px; padding: 6px 8px; border-left: 1px solid var(--olive); background: transparent; font-size: 11px; }
.normalized-time small { color: var(--taupe); line-height: 1.35; }
.evidence-section { display: grid; gap: 8px; margin-top: 10px; padding-top: 10px; border-top: 1px dashed rgba(86,57,5,.35); }
.evidence-mode { display: flex; gap: 14px; font-size: 11px; }
.evidence-mode label { display: flex; align-items: center; gap: 4px; }
.impact-copy { margin: 12px 0; color: var(--taupe); font-size: 12px; line-height: 1.6; }
.relation-endpoints { display: grid; gap: 7px; }
.swap-command { justify-self: center; border: 0; padding: 4px 8px; background: transparent; cursor: pointer; color: var(--taupe); }
.editor-footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 11px; }
.form-error { color: #a0432e; font-size: 10px; }
.primary-command { border: 1px solid var(--ink-2); padding: 7px 12px; background: var(--ink-2); color: var(--paper); cursor: pointer; white-space: nowrap; }
.primary-command:disabled { opacity: .4; cursor: not-allowed; }
.text-command { border: 0; border-bottom: 1px solid currentColor; padding: 2px 0; background: transparent; cursor: pointer; font-size: 11px; }
.revision-drawer { display: flex; flex-direction: column; padding: 13px 10px 8px; overflow: hidden; }
.drawer-heading { flex: 0 0 auto; }
.workspace-controls { display: flex; gap: 6px; align-items: center; padding: 10px 0; border-bottom: 1px solid rgba(86,57,5,.22); }
.connect-command { margin-left: auto; }
.drawer-empty { margin: auto; max-width: 230px; color: var(--taupe); text-align: center; line-height: 1.7; }
.draft-list, .history-list { flex: 1 1 auto; min-height: 0; overflow: auto; margin: 0; padding: 0; list-style: none; }
.draft-list li, .history-list li { padding: 12px 2px; border-bottom: 1px solid rgba(86,57,5,.2); }
.draft-list li.inactive { opacity: .35; }
.draft-line, .history-line { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
.draft-line strong, .history-line strong { font-size: 13px; font-weight: 500; }
.draft-list p, .history-list p { margin: 5px 0; color: var(--taupe); font-size: 11px; line-height: 1.5; }
.operation-summary { display: flex; gap: 12px; color: var(--taupe); font-size: 10px; }
.group-differences { margin-top: 8px; border-top: 1px dashed rgba(86,57,5,.25); padding-top: 7px; }
.group-differences summary { width: max-content; color: var(--taupe); font-size: 10px; cursor: pointer; }
.operation-detail { margin-top: 8px; padding-left: 8px; border-left: 2px solid #946628; }
.operation-detail.automatic { border-left-color: var(--olive); }
.operation-title { display: flex; gap: 7px; align-items: baseline; }
.operation-title span { color: var(--taupe); font-size: 9px; }
.operation-title strong { font-size: 10px; font-weight: 500; }
.field-differences { display: grid; grid-template-columns: 58px minmax(0,1fr); gap: 3px 7px; margin: 6px 0 0; font-size: 9px; }
.field-differences dt { color: var(--taupe); }
.field-differences dd { display: grid; grid-template-columns: minmax(0,1fr) auto minmax(0,1fr); gap: 4px; margin: 0; min-width: 0; }
.field-differences del, .field-differences ins { overflow-wrap: anywhere; text-decoration: none; }
.field-differences del { opacity: .52; }
.field-differences ins { color: #4a765c; }
.group-evidence { display: grid; gap: 5px; margin-top: 9px; padding-top: 7px; border-top: 1px solid rgba(86,57,5,.18); font-size: 9px; }
.group-evidence > span { color: var(--taupe); }
.group-evidence blockquote { display: grid; gap: 2px; margin: 0; padding-left: 8px; border-left: 1px solid var(--olive); line-height: 1.45; }
.group-evidence cite { color: var(--taupe); font-style: normal; }
.commit-section { flex: 0 0 auto; display: grid; gap: 9px; padding-top: 12px; border-top: 1px solid rgba(86,57,5,.35); }
.history-line code { color: var(--taupe); font-size: 10px; }
.history-actions { display: flex; align-items: center; gap: 12px; }
.danger-command { color: #8a3c2a; }
.danger-command:disabled { opacity: .35; cursor: not-allowed; }
.history-list li.head { border-left: 2px solid #4a765c; padding-left: 9px; }
.revision-toast { position: absolute; left: 50%; bottom: 24px; transform: translateX(-50%); max-width: 520px; padding: 9px 14px; border: 1px solid #a0432e; background: rgba(245,243,236,.98); color: #7b2f20; pointer-events: auto; }
@media (max-width: 1100px) {
  .revision-toolbar { right: 12px; }
}
</style>
