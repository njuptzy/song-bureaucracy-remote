const SNAPSHOT_TIME_TYPES = new Set(["exact", "range", "bounded"]);
import {
  classifyEntityLifecycle,
  classifyExistenceEffect,
  detachedHierarchyEntityIds,
  expandCollectiveInstanceTransitions,
  expandHistoricalHierarchyChildIds,
  evolutionDeactivationYears,
} from "../../../shared/entity_lifecycle.js";

export { classifyExistenceEffect } from "../../../shared/entity_lifecycle.js";

export function hierarchyEdgesWithoutCollectives(edges, collectiveEntityIds = []) {
  const collectiveIds = collectiveEntityIds instanceof Set
    ? collectiveEntityIds
    : new Set(collectiveEntityIds);
  return (edges || []).filter((edge) => (
    !collectiveIds.has(edge.parent) && !collectiveIds.has(edge.child)
  ));
}

function effectiveYear(timepoint) {
  if (!SNAPSHOT_TIME_TYPES.has(timepoint?.time_type) || timepoint?.year_start == null) return null;
  // “元祐初/熙宁末”等 bounded 纪年只知道事件落在一个区间内；到上界年后
  // 才能确定事件已经发生，避免把存废变化提前到区间起点。
  if (timepoint.time_type === "bounded") return timepoint.year_end ?? timepoint.year_start;
  return timepoint.year_start;
}

function isDated(timepoint) {
  return effectiveYear(timepoint) != null;
}

function temporaryEvidenceIntervals(entity, timepoints) {
  const singleEvidence = timepoints.some((timepoint) => (
    String(timepoint.attr_category || "").includes("单次存在证据")
  ));
  if (singleEvidence) {
    return timepoints.filter(isDated).map((timepoint) => ({
      start: timepoint.year_start,
      end: timepoint.year_end ?? timepoint.year_start,
    }));
  }
  if (!timepoints.some((timepoint) => String(timepoint.attr_category || "").includes("临时"))) {
    return null;
  }
  const dated = timepoints.filter(isDated).sort((a, b) => effectiveYear(a) - effectiveYear(b) || a.id - b.id);
  const intervals = [];
  let active = null;
  for (const timepoint of dated) {
    const start = timepoint.year_start;
    const end = timepoint.year_end ?? start;
    const effect = classifyExistenceEffect(timepoint, entity);
    if (effect === "activate") {
      if (active) intervals.push(active);
      active = { start, end };
    } else if (effect === "deactivate") {
      if (active) intervals.push({ ...active, end: Math.min(active.end, start - 1) });
      active = null;
    } else if (effect !== "ignore" && active) {
      active.end = Math.max(active.end, end);
    } else if (effect !== "ignore") {
      intervals.push({ start, end });
    }
  }
  if (active) intervals.push(active);
  return intervals;
}

function chainDepth(timepoint, byId) {
  let depth = 0;
  let current = timepoint;
  const seen = new Set();
  while (current?.prev_id != null && !seen.has(current.prev_id)) {
    seen.add(current.prev_id);
    const previous = byId.get(current.prev_id);
    if (!previous || previous.entity_id !== timepoint.entity_id) break;
    depth += 1;
    current = previous;
  }
  return depth;
}

function compareTimepoints(a, b, byId) {
  return (effectiveYear(a) - effectiveYear(b))
    || ((a.year_end ?? a.year_start) - (b.year_end ?? b.year_start))
    || (chainDepth(a, byId) - chainDepth(b, byId))
    || (a.id - b.id);
}

function compareKnownChainOrder(a, b, byId) {
  if (!a || !b || a.id === b.id || a.entity_id !== b.entity_id) return 0;
  let current = b;
  const seen = new Set();
  while (current?.prev_id != null && !seen.has(current.prev_id)) {
    seen.add(current.prev_id);
    current = byId.get(current.prev_id);
    if (!current || current.entity_id !== b.entity_id) break;
    if (current.id === a.id) return -1;
  }
  current = a;
  seen.clear();
  while (current?.prev_id != null && !seen.has(current.prev_id)) {
    seen.add(current.prev_id);
    current = byId.get(current.prev_id);
    if (!current || current.entity_id !== a.entity_id) break;
    if (current.id === b.id) return 1;
  }
  return 0;
}

function relationEffectiveYear(state, timepointById) {
  if (state.effective_year != null) return state.effective_year;
  const endpointYears = [state.subject_timepoint_id, state.object_timepoint_id]
    .map((id) => timepointById.get(id))
    .filter(isDated)
    .map(effectiveYear);
  return endpointYears.length ? Math.max(...endpointYears) : null;
}

function relationPresenceEvidence(data, year, timepointById) {
  const byEntity = new Map();
  const add = (entityId, evidenceYear, timepointId) => {
    if (entityId == null || evidenceYear == null || evidenceYear > year) return;
    if (!byEntity.has(entityId)) byEntity.set(entityId, []);
    const timepoint = timepointById.get(timepointId) || null;
    byEntity.get(entityId).push({
      effectiveYear: evidenceYear,
      // 关系另一端的宋代纪年可以证明实体在场，但不能把宋前端点本身
      // 当作宋代截面的当前事件展示。
      timepoint: isDated(timepoint) ? timepoint : null,
    });
  };
  for (const edge of [...(data.hierarchyEdges || []), ...(data.staffEdges || [])]) {
    const subjectEntityId = edge.parent ?? edge.org;
    const objectEntityId = edge.child ?? edge.official;
    if (edge.states?.length) {
      for (const state of edge.states) {
        const evidenceYear = relationEffectiveYear(state, timepointById);
        add(subjectEntityId, evidenceYear, state.subject_timepoint_id);
        add(objectEntityId, evidenceYear, state.object_timepoint_id);
      }
    } else {
      for (const period of edge.periods || []) {
        add(subjectEntityId, period.start, null);
        add(objectEntityId, period.start, null);
      }
    }
  }
  return byEntity;
}

function hierarchyParentTimepoints(data, year, timepointById) {
  const result = new Set();
  for (const edge of data.hierarchyEdges || []) {
    for (const state of edge.states || []) {
      const effectiveYear = relationEffectiveYear(state, timepointById);
      if (effectiveYear != null && effectiveYear <= year) {
        result.add(state.subject_timepoint_id);
      }
    }
  }
  return result;
}

function subdivisionKeepsParent(timepoint, entity, parentTimepointIds, timepointById) {
  const lifecycle = classifyEntityLifecycle(timepoint.event, entity);
  const deactivations = lifecycle.transitions.filter(({ effect }) => effect === "deactivate");
  if (deactivations.length !== 1
    || !/^当前实体(?:复分为|分为)其他实体$/.test(deactivations[0].reason)) return false;
  // 分设关系可能抽取在同一实体链的稍后节点（如“分三库”后下一节点详列四库）。
  // 只要同一链上同年或后继节点仍作为上下级关系父端，就证明这是“下设”，
  // 不是上级实体自身终止。
  for (const parentId of parentTimepointIds) {
    const parentState = timepointById.get(parentId);
    if (!parentState || parentState.entity_id !== timepoint.entity_id) continue;
    if (parentId === timepoint.id || compareKnownChainOrder(timepoint, parentState, timepointById) < 0) {
      return true;
    }
  }
  return false;
}

function selectRelationStates(
  edges, year, entityIds, timepointById, keyForEdge,
  { includeInactiveEndpoints = false } = {},
) {
  const candidatesByKey = new Map();
  for (const edge of edges) {
    const fallbackYears = (edge.periods || []).map((period) => period.start).filter(Number.isFinite);
    const states = edge.states?.length
      ? edge.states
      : fallbackYears.map((effectiveYear) => ({ id: edge.id, effective_year: effectiveYear }));
    for (const state of states) {
      const effectiveYear = relationEffectiveYear(state, timepointById);
      if (effectiveYear == null || effectiveYear > year) continue;
      const childEvent = edge.parent != null
        ? String(timepointById.get(state.object_timepoint_id)?.event || "")
        : "";
      // “附属机构”只说明新增一层附属或临时统领；没有“改隶、转隶”等
      // 替代性措辞时，不应覆盖已有的基本隶属关系。
      const additiveHierarchy = edge.parent != null
        && childEvent.includes("附属机构")
        && !/(?:改隶|转隶|改归)/.test(childEvent);
      const key = additiveHierarchy
        ? `${keyForEdge(edge)}:additive:${edge.parent}`
        : keyForEdge(edge);
      const current = candidatesByKey.get(key);
      if (!current || effectiveYear > current.effectiveYear) {
        candidatesByKey.set(key, { effectiveYear, items: [{ edge, state }] });
      } else if (effectiveYear === current.effectiveYear) {
        current.items.push({ edge, state });
      }
    }
  }
  const candidates = [...candidatesByKey.values()].flatMap(({ effectiveYear, items }) => items.map(({ edge, state }) => ({
    ...edge,
    id: state.id,
    effective_year: effectiveYear,
  })));
  const selected = candidates.filter((edge) => (
    includeInactiveEndpoints
      ? true
    // 先按关系对象选出当年最新状态，再检查端点是否仍存在。新上级退出后，
    // 不能因此回退到已经被改隶取代的旧上级；只有新的复隶状态才能恢复旧关系。
      : edge.parent != null
        ? entityIds.has(edge.parent) && entityIds.has(edge.child)
        : entityIds.has(edge.org) && entityIds.has(edge.official)
  ));
  const deduped = new Map();
  for (const edge of selected) {
    const key = edge.parent != null
      ? `${edge.parent}:${edge.child}`
      : `${edge.org}:${edge.official}:${edge.staff_quota || ""}:${edge.staff_type || ""}`;
    if (!deduped.has(key) || edge.id > deduped.get(key).id) deduped.set(key, edge);
  }
  return [...deduped.values()];
}

function collectiveMemberships(data, timepointById) {
  return (data.collectiveInstanceEdges || []).flatMap((edge) => {
    const states = edge.states?.length ? edge.states : [{
      subject_timepoint_id: null,
      object_timepoint_id: null,
      effective_year: (edge.periods || []).map((period) => period.start).find(Number.isFinite) ?? null,
    }];
    return states.map((state) => ({
      collectiveEntityId: edge.collective,
      instanceEntityId: edge.instance,
      effectiveYear: relationEffectiveYear(state, timepointById),
    }));
  });
}

function evolutionTransitions(data, timepointById, memberships) {
  const transitions = (data.evolutionEdges || []).flatMap((edge) => {
    const states = edge.states?.length ? edge.states : [{
      subject_timepoint_id: null,
      object_timepoint_id: null,
      effective_year: (edge.periods || []).map((period) => period.start).find(Number.isFinite) ?? null,
    }];
    return states.map((state) => ({
      sourceEntityId: edge.source,
      targetEntityId: edge.target,
      effectiveYear: relationEffectiveYear(state, timepointById),
    }));
  });
  return expandCollectiveInstanceTransitions(transitions, memberships);
}

export function buildYearSnapshot(data, year) {
  const hierarchyEdgesForSnapshot = hierarchyEdgesWithoutCollectives(
    data.hierarchyEdges,
    data.collectiveEntityIds,
  );
  const snapshotData = { ...data, hierarchyEdges: hierarchyEdgesForSnapshot };
  const entityById = new Map((data.entities || []).map((entity) => [entity.id, entity]));
  const timepointById = new Map();
  const timepointsByEntity = new Map();
  const currentTimepointByEntity = new Map();
  for (const [entityIdText, timepoints] of Object.entries(data.timepoints || {})) {
    const entityId = Number(entityIdText);
    const normalized = timepoints.map((timepoint) => ({ ...timepoint, entity_id: entityId }));
    timepointsByEntity.set(entityId, normalized);
    normalized.forEach((timepoint) => timepointById.set(timepoint.id, timepoint));
  }
  const presenceEvidenceByEntity = relationPresenceEvidence(snapshotData, year, timepointById);
  const hierarchyParentTimepointIds = hierarchyParentTimepoints(snapshotData, year, timepointById);
  for (const [entityId, entity] of entityById) {
    const eligible = (timepointsByEntity.get(entityId) || [])
      .filter((timepoint) => isDated(timepoint) && effectiveYear(timepoint) <= year)
      .map((timepoint) => ({ kind: "timepoint", effectiveYear: effectiveYear(timepoint), timepoint }));
    const relationEvidence = (presenceEvidenceByEntity.get(entityId) || [])
      .map((evidence) => ({ kind: "relation", ...evidence }));
    const evidenceTimeline = [...eligible, ...relationEvidence].sort((a, b) => (
      // 关系证据挂在实体自身的时间点上；若链已明确先后，就不能让一个宽泛
      // “熙宁间”关系按区间上界排到其后继的明确废罢事件之后，造成旧机构复活。
      compareKnownChainOrder(a.timepoint, b.timepoint, timepointById)
      || a.effectiveYear - b.effectiveYear
      // 同年关系先证明“这一年存在”，自身的明确罢废事件随后覆盖它。
      || (a.kind === b.kind ? 0 : a.kind === "relation" ? -1 : 1)
      || (a.kind === "timepoint" && b.kind === "timepoint"
        ? compareTimepoints(a.timepoint, b.timepoint, timepointById)
        : 0)
    ));
    let exists = null;
    let currentState = null;
    let explicitlyDeactivated = false;
    for (const evidence of evidenceTimeline) {
      if (evidence.kind === "relation") {
        // 关系只能补足“尚无明确存废结论”的存在证据。实体已经由自身时间点
        // 明确罢废后，旧关系或名义隶属不能把它重新复活；必须等实体自身出现
        // “复置、重建”等激活时间点。
        if (!explicitlyDeactivated) exists = true;
        if (!currentState && evidence.timepoint) currentState = evidence.timepoint;
        continue;
      }
      const { timepoint } = evidence;
      const effect = classifyExistenceEffect(timepoint, entity);
      if (effect === "activate") {
        exists = true;
        explicitlyDeactivated = false;
      }
      else if (effect === "deactivate") {
        // “分为四库”既可能表示原机构拆分终止，也可能表示仍存的上级下设四库。
        // 同一时间点若确实是上下级关系的父端，结构化关系证明后者成立。
        exists = subdivisionKeepsParent(timepoint, entity, hierarchyParentTimepointIds, timepointById);
        explicitlyDeactivated = !exists;
      }
      else if (effect === "ignore") {
        currentState = timepoint;
        continue;
      }
      // bounded 普通记载只能说明“事件发生在某段内”，不足以单独确定某一年的存在；
      // 但其中明确的设置/罢废转换仍会在区间上界年生效。
      else if (exists == null && timepoint.time_type !== "bounded") exists = true;
      currentState = timepoint;
    }
    const temporaryIntervals = temporaryEvidenceIntervals(entity, timepointsByEntity.get(entityId) || []);
    if (exists && temporaryIntervals
      && !temporaryIntervals.some((interval) => interval.start <= year && year <= interval.end)) exists = false;
    if (exists) currentTimepointByEntity.set(entityId, currentState);
  }

  const memberships = collectiveMemberships(data, timepointById);
  const evolutionDeactivations = evolutionDeactivationYears(
    evolutionTransitions(data, timepointById, memberships), year,
  );
  for (const [entityId, deactivationYear] of evolutionDeactivations) {
    const restoredLater = (timepointsByEntity.get(entityId) || []).some((timepoint) => (
      isDated(timepoint)
      && effectiveYear(timepoint) > deactivationYear
      && effectiveYear(timepoint) <= year
      && classifyExistenceEffect(timepoint, entityById.get(entityId)) === "activate"
    ));
    if (!restoredLater) currentTimepointByEntity.delete(entityId);
  }
  const entityIds = new Set(currentTimepointByEntity.keys());
  const latestHierarchyStates = selectRelationStates(
    hierarchyEdgesForSnapshot,
    year,
    entityIds,
    timepointById,
    (edge) => `hierarchy:${edge.child}`,
    { includeInactiveEndpoints: true },
  );
  const detachedEntityIds = detachedHierarchyEntityIds(
    latestHierarchyStates.map((edge) => ({ parentId: edge.parent, childId: edge.child })),
    entityIds,
    expandHistoricalHierarchyChildIds(
      new Set(hierarchyEdgesForSnapshot.map((edge) => edge.child)),
      memberships,
    ),
  );
  for (const entityId of detachedEntityIds) {
    entityIds.delete(entityId);
    currentTimepointByEntity.delete(entityId);
  }
  const hierarchyEdges = selectRelationStates(
    hierarchyEdgesForSnapshot,
    year,
    entityIds,
    timepointById,
    (edge) => `hierarchy:${edge.child}`
  );
  const staffEdges = selectRelationStates(
    data.staffEdges || [],
    year,
    entityIds,
    timepointById,
    // “令史”“驱使官”等通用吏职可以在同一年分别隶属多个机构；
    // 只按官职实体取最新状态会把其他机构的同期编制错误覆盖掉。
    // 同一机构内该官职的员额变化仍按时间取最新状态。
    (edge) => `staff:${edge.org}:${edge.official}`
  );
  return { year, currentTimepointByEntity, entityIds, hierarchyEdges, staffEdges };
}
