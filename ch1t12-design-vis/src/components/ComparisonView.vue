<template>
  <section class="comparison-view" aria-label="层级与演变对照视图">
    <DesignTemplateCanvas
      :data="data"
      :initial-state="initialState"
      fixed-view-mode="comparison"
      :comparison-scale="comparisonScale"
      :revision-panel-active="revisionPanelActive"
      @state-change="$emit('state-change', $event)"
      @selection-change="$emit('selection-change', $event)"
    />
    <button class="comparison-exit" type="button" @click="$emit('exit-comparison')">
      返回单视图
    </button>
    <div class="comparison-scale-control" aria-label="对照视图显示比例">
      <span class="comparison-scale-label">显示比例</span>
      <input
        v-model.number="comparisonScale"
        type="range"
        min="0.7"
        max="2"
        step="0.05"
        aria-label="调整对照视图显示比例"
      >
      <output>{{ Math.round(comparisonScale * 100) }}%</output>
      <button
        class="comparison-scale-reset"
        type="button"
        :disabled="comparisonScale === 1"
        @click="comparisonScale = 1"
      >
        适配
      </button>
    </div>
  </section>
</template>

<script setup>
import { ref } from "vue";
import DesignTemplateCanvas from "./DesignTemplateCanvas.vue";

defineProps({
  data: { type: Object, required: true },
  initialState: { type: Object, default: null },
  revisionPanelActive: { type: Boolean, default: false },
});
defineEmits(["state-change", "selection-change", "exit-comparison"]);

// 初始留出放大余量；100% 是两块内容完整适配当前区域的上限。
const comparisonScale = ref(0.7);
</script>

<style scoped>
.comparison-view {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #f5f3ec;
}

.comparison-view :deep(.design-template) {
  width: 100%;
  height: 100%;
}

.comparison-exit {
  position: absolute;
  z-index: 8;
  top: 10px;
  left: 50%;
  padding: 4px 10px;
  transform: translateX(-50%);
  border: 1px solid rgba(86, 57, 5, 0.42);
  background: rgba(245, 243, 236, 0.9);
  color: #563905;
  font: inherit;
  font-size: 11px;
  letter-spacing: 1px;
  cursor: pointer;
}

.comparison-exit:hover,
.comparison-exit:focus-visible {
  background: rgba(145, 128, 105, 0.14);
  outline: none;
}

.comparison-scale-control {
  position: absolute;
  z-index: 8;
  /* 修订工具栏固定在 top:18px；缩放控件放到其下方的独立带，不能抢占同一行。 */
  top: 62px;
  right: 18px;
  display: grid;
  grid-template-columns: auto minmax(112px, 150px) auto auto;
  align-items: center;
  gap: 8px;
  min-height: 26px;
  padding: 4px 9px;
  border: 1px solid rgba(86, 57, 5, 0.36);
  background: rgba(245, 243, 236, 0.92);
  color: #563905;
  font: inherit;
  font-size: 11px;
  letter-spacing: 1px;
}

.comparison-scale-control input {
  width: 100%;
  margin: 0;
  accent-color: #563905;
}

.comparison-scale-label {
  white-space: nowrap;
}

.comparison-scale-control output {
  min-width: 34px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.comparison-scale-reset {
  min-width: 32px;
  padding: 2px 5px;
  border: 1px solid rgba(86, 57, 5, 0.28);
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 10px;
  letter-spacing: 0.5px;
  cursor: pointer;
}

.comparison-scale-reset:hover:not(:disabled),
.comparison-scale-reset:focus-visible:not(:disabled) {
  background: rgba(86, 57, 5, 0.08);
  outline: none;
}

.comparison-scale-reset:disabled {
  opacity: 0.42;
  cursor: default;
}
</style>
