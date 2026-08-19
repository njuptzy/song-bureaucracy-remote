import { classifyEventType } from "../../../shared/entity_lifecycle.js";

const DEFAULT_YEAR_MIN = 960;
const DEFAULT_YEAR_MAX = 1279;
const SOURCE_ROLES = new Set(["source", "giver", "subject", "来源", "给予者"]);
const TARGET_ROLES = new Set(["target", "receiver", "object", "后继", "接受者"]);
const LIFECYCLE_EFFECTS = new Set(["activate", "preserve", "deactivate", "ignore"]);

const RELATION_LABELS = new Map([
  ["演变·改称", "演变·改称"],
  ["演变·改置", "演变·改置"],
  ["演变·分拆", "演变·分拆"],
  ["演变·合并", "演变·合并"],
  ["演变·并入", "演变·并入"],
  ["职掌·移交", "职掌·移交"],
  ["前后演变", "前后演变（未分类）"],
]);

function firstDefined(source, keys) {
  for (const key of keys) {
    if (source?.[key] !== undefined && source[key] !== null && source[key] !== "") {
      return source[key];
    }
  }
  return null;
}

function normalizeId(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value;
}

function finiteYear(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function explicitLifecycleEffect(source) {
  const value = String(source?.lifecycle_effect ?? source?.lifecycleEffect ?? "");
  return LIFECYCLE_EFFECTS.has(value) ? value : "ignore";
}

function normalizedTimeType(item) {
  const explicit = firstDefined(item, ["time_type", "timeType", "time_kind", "timeKind"]);
  if (explicit) return String(explicit);
  return finiteYear(firstDefined(item, ["year_start", "yearStart"])) == null
    ? "undated"
    : "exact";
}

function effectiveYear(item) {
  const timeType = normalizedTimeType(item);
  if (["pre_song", "undated", "unresolved"].includes(timeType)) return null;
  const start = finiteYear(firstDefined(item, ["year_start", "yearStart"]));
  const end = finiteYear(firstDefined(item, ["year_end", "yearEnd"]));
  return timeType === "bounded" ? (end ?? start) : start;
}

export function eventGlyphType(eventType) {
  if (["establish", "restore"].includes(eventType)) return "establish";
  if (eventType === "abolish") return "abolish";
  if (eventType === "affiliation_change") return "affiliation_change";
  return "record";
}

function normalizeTimepoints(data, entityMap) {
  const byId = new Map();
  const byEntity = new Map();
  const sourceGroups = [data?.timepoints || {}, data?.preSongTimepoints || {}];
  for (const [entityIdText, sourceItems] of sourceGroups.flatMap((group) => Object.entries(group))) {
    for (const source of sourceItems || []) {
      if (byId.has(normalizeId(source.id))) continue;
      const entityId = normalizeId(source.entity_id ?? source.entityId ?? entityIdText);
      const entity = entityMap.get(entityId) || { id: entityId, title: "", type: "" };
      const timeType = normalizedTimeType(source);
      const yearStart = finiteYear(firstDefined(source, ["year_start", "yearStart"]));
      const yearEnd = finiteYear(firstDefined(source, ["year_end", "yearEnd"])) ?? yearStart;
      const eventType = source.event_type || source.eventType || classifyEventType(source.event);
      const item = {
        ...source,
        id: normalizeId(source.id),
        entityId,
        prevId: normalizeId(source.prev_id ?? source.prevId),
        succId: normalizeId(source.succ_id ?? source.succId),
        rawTime: String(source.time ?? source.raw_time ?? source.rawTime ?? ""),
        timeType,
        yearStart,
        yearEnd,
        effectiveYear: effectiveYear({ time_type: timeType, year_start: yearStart, year_end: yearEnd }),
        revisionStatus: source._revision_status || source.revisionStatus || "",
        eventType,
        iconType: eventGlyphType(eventType),
        effect: ["before", "deleted"].includes(source._revision_status || source.revisionStatus)
          ? "ignore"
          : explicitLifecycleEffect(source),
      };
      byId.set(item.id, item);
      if (!byEntity.has(entityId)) byEntity.set(entityId, []);
      byEntity.get(entityId).push(item);
    }
  }
  return { byId, byEntity };
}

function compareTimepointOrder(a, b) {
  const aYear = a.effectiveYear ?? Number.POSITIVE_INFINITY;
  const bYear = b.effectiveYear ?? Number.POSITIVE_INFINITY;
  return aYear - bYear
    || (a.yearEnd ?? Number.POSITIVE_INFINITY) - (b.yearEnd ?? Number.POSITIVE_INFINITY)
    || String(a.id).localeCompare(String(b.id), "zh", { numeric: true });
}

function buildChains(entityId, timepoints) {
  const anomalies = [];
  const byId = new Map(timepoints.map((item) => [item.id, item]));
  const predecessors = new Map(timepoints.map((item) => [item.id, new Set()]));
  const successors = new Map(timepoints.map((item) => [item.id, new Set()]));
  const checkedDirections = new Set();

  const link = (sourceId, targetId, field, ownerId) => {
    if (sourceId == null || targetId == null) return;
    if (!byId.has(sourceId) || !byId.has(targetId)) {
      anomalies.push({
        type: "dangling_chain_link",
        entityId,
        timepointId: ownerId,
        field,
        referencedTimepointId: field === "prev_id" ? sourceId : targetId,
      });
      return;
    }
    successors.get(sourceId).add(targetId);
    predecessors.get(targetId).add(sourceId);
    const directionKey = `${sourceId}->${targetId}`;
    if (!checkedDirections.has(directionKey)) {
      checkedDirections.add(directionKey);
      const sourceYear = finiteYear(byId.get(sourceId)?.effectiveYear);
      const targetYear = finiteYear(byId.get(targetId)?.effectiveYear);
      if (sourceYear != null && targetYear != null && sourceYear > targetYear) {
        anomalies.push({
          type: "chronology_direction_conflict",
          entityId,
          sourceTimepointId: sourceId,
          targetTimepointId: targetId,
          sourceYear,
          targetYear,
        });
      }
    }
  };

  for (const item of timepoints) {
    link(item.prevId, item.id, "prev_id", item.id);
    link(item.id, item.succId, "succ_id", item.id);
  }

  // prev/succ 是可选的局部顺序证据；一旦两端都声明，就必须互相确认。
  for (const item of timepoints) {
    if (item.prevId != null && byId.has(item.prevId)) {
      const previous = byId.get(item.prevId);
      if (previous.succId !== item.id) {
        anomalies.push({
          type: "nonreciprocal_chain_link",
          entityId,
          timepointId: item.id,
          field: "prev_id",
          linkedTimepointId: item.prevId,
          reciprocalField: "succ_id",
          reciprocalValue: previous.succId,
        });
      }
    }
    if (item.succId != null && byId.has(item.succId)) {
      const next = byId.get(item.succId);
      if (next.prevId !== item.id) {
        anomalies.push({
          type: "nonreciprocal_chain_link",
          entityId,
          timepointId: item.id,
          field: "succ_id",
          linkedTimepointId: item.succId,
          reciprocalField: "prev_id",
          reciprocalValue: next.prevId,
        });
      }
    }
  }

  for (const item of timepoints) {
    const nextIds = successors.get(item.id);
    if (nextIds.size > 1) {
      anomalies.push({
        type: "branching_timeline",
        entityId,
        timepointId: item.id,
        successorIds: [...nextIds],
      });
    }
    const previousIds = predecessors.get(item.id);
    if (previousIds.size > 1) {
      anomalies.push({
        type: "merging_timeline",
        entityId,
        timepointId: item.id,
        predecessorIds: [...previousIds],
      });
    }
  }

  const sortIds = (ids) => [...ids].sort((a, b) => compareTimepointOrder(byId.get(a), byId.get(b)));
  const heads = sortIds(timepoints.filter((item) => predecessors.get(item.id).size === 0).map((item) => item.id));

  const pending = [...heads];
  const visited = new Set();
  const chains = [];
  const walk = (startId, cycle = false) => {
    const items = [];
    let currentId = startId;
    while (currentId != null && !visited.has(currentId)) {
      visited.add(currentId);
      items.push(byId.get(currentId));
      const candidates = sortIds(
        [...successors.get(currentId)].filter((id) => !visited.has(id))
      );
      if (candidates.length > 1) pending.push(...candidates.slice(1));
      currentId = candidates[0] ?? null;
    }
    if (items.length) {
      chains.push({
        id: `${entityId}:${startId}`,
        entityId,
        headId: startId,
        cycle,
        timepoints: items,
      });
    }
  };

  while (pending.length) {
    const startId = pending.shift();
    if (!visited.has(startId)) walk(startId);
  }
  for (const startId of sortIds(timepoints.map((item) => item.id).filter((id) => !visited.has(id)))) {
    if (visited.has(startId)) continue;
    anomalies.push({ type: "timeline_cycle", entityId, timepointId: startId });
    walk(startId, true);
  }

  return { chains, anomalies };
}

function memberRole(value, fallback) {
  const role = String(value || fallback || "").trim();
  if (SOURCE_ROLES.has(role)) return "source";
  if (TARGET_ROLES.has(role)) return "target";
  return fallback;
}

function normalizeMember(source, role, relationSource, timepointById) {
  const raw = source && typeof source === "object" ? source : {};
  const scalarEntityId = source && typeof source !== "object" ? source : null;
  const endpointTime = firstDefined(relationSource, [
    `${role}_time`, `${role}Time`,
    role === "source" ? "subject_time" : "object_time",
    role === "source" ? "subjectTime" : "objectTime",
  ]) || {};
  const timepointId = normalizeId(firstDefined(raw, [
    "timepoint_id", "timepointId", `${role}_timepoint_id`, `${role}TimepointId`,
    role === "source" ? "subject_timepoint_id" : "object_timepoint_id",
  ]));
  const timepoint = timepointById.get(timepointId);
  const entityId = normalizeId(firstDefined(raw, [
    "entity_id", "entityId", `${role}_entity_id`, `${role}EntityId`,
    role === "source" ? "subject_entity_id" : "object_entity_id",
  ]) ?? scalarEntityId ?? timepoint?.entityId);
  const fallbackType = normalizedTimeType(relationSource || {});
  const timeType = firstDefined(raw, ["time_type", "timeType", "time_kind", "timeKind"])
    || timepoint?.timeType
    || firstDefined(endpointTime, ["time_type", "timeType", "time_kind", "timeKind"])
    || fallbackType;
  const yearStart = finiteYear(firstDefined(raw, ["year_start", "yearStart"]))
    ?? timepoint?.yearStart
    ?? finiteYear(firstDefined(endpointTime, ["year_start", "yearStart"]))
    ?? finiteYear(firstDefined(relationSource, ["year_start", "yearStart"]));
  const yearEnd = finiteYear(firstDefined(raw, ["year_end", "yearEnd"]))
    ?? timepoint?.yearEnd
    ?? finiteYear(firstDefined(endpointTime, ["year_end", "yearEnd"]))
    ?? finiteYear(firstDefined(relationSource, ["year_end", "yearEnd"]))
    ?? yearStart;
  return {
    role: memberRole(raw.role, role),
    entityId,
    timepointId,
    iconType: timepoint?.iconType || null,
    timeType,
    yearStart,
    yearEnd,
    effectiveYear: effectiveYear({ time_type: timeType, year_start: yearStart, year_end: yearEnd }),
    rawTime: String(firstDefined(raw, ["raw_time", "rawTime", "time"])
      ?? timepoint?.rawTime
      ?? firstDefined(endpointTime, ["raw_time", "rawTime", "time"])
      ?? firstDefined(relationSource, ["raw_time", "rawTime", "time"])
      ?? ""),
  };
}

function relationTypeOf(source, fallback = "前后演变") {
  return String(firstDefined(source, ["relation_subtype", "relationSubtype"])
    || firstDefined(source, ["relation_type", "relationType", "type"])
    || fallback);
}

function relationLabel(relationType) {
  return RELATION_LABELS.get(relationType) || relationType;
}

function explicitGroupId(source) {
  return firstDefined(source, [
    "relation_group_id",
    "relationGroupId",
    "group_id",
    "groupId",
  ]);
}

function assignRepeatedChangeEventGroups(relations) {
  const counts = new Map();
  for (const relation of relations) {
    if (relation.groupId != null || relation.changeEventId == null) continue;
    counts.set(relation.changeEventId, (counts.get(relation.changeEventId) || 0) + 1);
  }
  return relations.map((relation) => (
    relation.groupId == null
      && relation.changeEventId != null
      && counts.get(relation.changeEventId) > 1
      ? { ...relation, groupId: relation.changeEventId }
      : relation
  ));
}

function normalizedRelation({ source, state = null, index, fallback = false }, timepointById) {
  const value = { ...source, ...(state || {}) };
  const relationType = fallback ? "前后演变" : relationTypeOf(value);
  const relationSubtype = firstDefined(value, ["relation_subtype", "relationSubtype"]);
  const displayRelationType = firstDefined(value, ["display_relation_type", "displayRelationType"]);
  const classificationStatus = firstDefined(value, ["classification_status", "classificationStatus"]);
  const relationId = normalizeId(firstDefined(value, ["id", "relation_id", "relationId"])
    ?? firstDefined(source, ["id", "relation_id", "relationId"])
    ?? `relation:${index}`);
  const rawMembers = firstDefined(value, ["members", "relation_members", "relationMembers"]);
  let members = [];
  if (Array.isArray(rawMembers)) {
    members = rawMembers.map((member) => normalizeMember(
      member,
      memberRole(member?.role, null),
      value,
      timepointById,
    )).filter((member) => member.role && member.entityId != null);
  } else {
    const sourceRaw = firstDefined(value, ["source_member", "sourceMember"])
      ?? {
        entity_id: firstDefined(value, ["source", "source_entity_id", "sourceEntityId", "subject_entity_id"]),
        timepoint_id: firstDefined(value, ["source_timepoint_id", "sourceTimepointId", "subject_timepoint_id"]),
      };
    const targetRaw = firstDefined(value, ["target_member", "targetMember"])
      ?? {
        entity_id: firstDefined(value, ["target", "target_entity_id", "targetEntityId", "object_entity_id"]),
        timepoint_id: firstDefined(value, ["target_timepoint_id", "targetTimepointId", "object_timepoint_id"]),
      };
    members = [
      normalizeMember(sourceRaw, "source", value, timepointById),
      normalizeMember(targetRaw, "target", value, timepointById),
    ].filter((member) => member.entityId != null || member.timepointId != null);
  }
  const sourceMembers = members.filter((member) => member.role === "source");
  const targetMembers = members.filter((member) => member.role === "target");
  return {
    id: relationId,
    key: `${relationId}:${index}`,
    relationType,
    relationSubtype,
    displayRelationType,
    classificationStatus,
    label: fallback
      ? "前后演变（未分类）"
      : String(displayRelationType || relationSubtype || relationLabel(relationType)),
    groupId: explicitGroupId(value) ?? explicitGroupId(source) ?? null,
    changeEventId: firstDefined(value, ["change_event_id", "changeEventId"])
      ?? firstDefined(source, ["change_event_id", "changeEventId"]),
    implementationStatus: firstDefined(value, ["implementation_status", "implementationStatus"])
      ?? classificationStatus,
    evidenceKey: firstDefined(value, ["evidence_key", "evidenceKey"]),
    quotation: String(value.quotation ?? source.quotation ?? ""),
    revisionStatus: firstDefined(value, ["_revision_status", "revisionStatus"])
      ?? firstDefined(source, ["_revision_status", "revisionStatus"])
      ?? "",
    revisionOriginalId: firstDefined(value, ["_revision_original_id", "revisionOriginalId"])
      ?? firstDefined(source, ["_revision_original_id", "revisionOriginalId"])
      ?? null,
    members,
    sourceMembers,
    targetMembers,
    sourceEntityId: sourceMembers[0]?.entityId ?? null,
    targetEntityId: targetMembers[0]?.entityId ?? null,
    sourceTimepointId: sourceMembers[0]?.timepointId ?? null,
    targetTimepointId: targetMembers[0]?.timepointId ?? null,
    sourceYear: sourceMembers[0]?.effectiveYear ?? null,
    targetYear: targetMembers[0]?.effectiveYear ?? null,
  };
}

function normalizeRelations(data, timepointById) {
  const relations = [];
  if (Array.isArray(data?.changeRelations)) {
    data.changeRelations.forEach((source, sourceIndex) => {
      const states = Array.isArray(source.states) && source.states.length ? source.states : [null];
      states.forEach((state, stateIndex) => {
        relations.push(normalizedRelation({
          source,
          state,
          index: `${sourceIndex}:${stateIndex}`,
        }, timepointById));
      });
    });
    return assignRepeatedChangeEventGroups(relations);
  }

  (data?.evolutionEdges || []).forEach((source, sourceIndex) => {
    const states = Array.isArray(source.states) && source.states.length ? source.states : [null];
    states.forEach((state, stateIndex) => {
      relations.push(normalizedRelation({
        source,
        state,
        index: `${sourceIndex}:${stateIndex}`,
        fallback: true,
      }, timepointById));
    });
  });
  return assignRepeatedChangeEventGroups(relations);
}

function hierarchyStateYear(state, timepointById) {
  const explicit = finiteYear(firstDefined(state, ["effective_year", "effectiveYear"]));
  if (explicit != null) return explicit;
  const years = [state.subject_timepoint_id, state.object_timepoint_id]
    .map((id) => timepointById.get(normalizeId(id))?.effectiveYear)
    .filter((year) => year != null);
  return years.length ? Math.max(...years) : null;
}

function hierarchyChangeRecords(data, timepointById) {
  const histories = new Map();
  for (const edge of data?.hierarchyEdges || []) {
    const states = edge.states?.length
      ? edge.states
      : (edge.periods || []).map((period) => ({ effective_year: period.start }));
    for (const state of states) {
      const year = hierarchyStateYear(state, timepointById);
      if (year == null || edge.child == null || edge.parent == null) continue;
      if (!histories.has(edge.child)) histories.set(edge.child, []);
      histories.get(edge.child).push({
        year,
        parentId: normalizeId(edge.parent),
        relationId: normalizeId(state.id ?? edge.id),
        parentTimepointId: normalizeId(state.subject_timepoint_id),
        childTimepointId: normalizeId(state.object_timepoint_id),
      });
    }
  }

  const changes = [];
  for (const [childId, records] of histories) {
    records.sort((first, second) => first.year - second.year
      || String(first.relationId).localeCompare(String(second.relationId), "zh", { numeric: true }));
    const recordsByYear = new Map();
    for (const record of records) {
      if (!recordsByYear.has(record.year)) recordsByYear.set(record.year, []);
      recordsByYear.get(record.year).push(record);
    }
    let previous = null;
    for (const yearRecords of recordsByYear.values()) {
      const parentIds = new Set(yearRecords.map((record) => record.parentId));
      if (parentIds.size !== 1) {
        previous = null;
        continue;
      }
      const record = yearRecords.at(-1);
      if (!previous) {
        previous = record;
        continue;
      }
      if (record.parentId === previous.parentId) {
        previous = record;
        continue;
      }
      changes.push({
        key: `reparent:${childId}:${record.year}:${previous.parentId}:${record.parentId}`,
        childId: normalizeId(childId),
        previousParentId: previous.parentId,
        nextParentId: record.parentId,
        year: record.year,
        previousRelationId: previous.relationId,
        relationId: record.relationId,
        childTimepointId: record.childTimepointId,
      });
      previous = record;
    }
  }
  return changes;
}

function hierarchyRoleEvent(change, role, entityMap, timepointById) {
  const child = entityMap.get(change.childId);
  const previousParent = entityMap.get(change.previousParentId);
  const nextParent = entityMap.get(change.nextParentId);
  const timepoint = timepointById.get(change.childTimepointId);
  const entityId = role === "subject"
    ? change.childId
    : role === "former_parent" ? change.previousParentId : change.nextParentId;
  const event = role === "subject"
    ? `改隶事件：${previousParent?.title || `#${change.previousParentId}`} → ${nextParent?.title || `#${change.nextParentId}`}`
    : role === "former_parent"
      ? `下属迁出：${child?.title || `#${change.childId}`} → ${nextParent?.title || `#${change.nextParentId}`}`
      : `下属迁入：${child?.title || `#${change.childId}`} ← ${previousParent?.title || `#${change.previousParentId}`}`;
  return {
    id: `hierarchy:${change.key}:${role}`,
    entityId,
    rawTime: timepoint?.rawTime || `${change.year}年`,
    time: timepoint?.rawTime || `${change.year}年`,
    timeType: timepoint?.timeType || "exact",
    yearStart: timepoint?.yearStart ?? change.year,
    yearEnd: timepoint?.yearEnd ?? change.year,
    effectiveYear: change.year,
    event,
    eventType: "affiliation_change",
    iconType: eventGlyphType("affiliation_change"),
    effect: "preserve",
    quotation: timepoint?.quotation || "",
    relationEndpoint: false,
    expanded: true,
    structuralHierarchyChange: true,
    syntheticHierarchyChange: true,
    hierarchyRole: role,
    hierarchyChange: { ...change },
    hierarchyChangeLabel: event,
    evidenceKeys: [...new Set([
      change.previousRelationId != null ? `R${change.previousRelationId}` : null,
      change.relationId != null ? `R${change.relationId}` : null,
      change.childTimepointId != null ? `T${change.childTimepointId}` : null,
    ].filter(Boolean))],
    chainId: `hierarchy:${change.key}`,
    chainIndex: Number.MAX_SAFE_INTEGER,
    eventIndex: role === "subject" ? 0 : role === "former_parent" ? 1 : 2,
  };
}

function appendHierarchyChangeEvents(lanes, data, entityMap, timepointById, yearMin, yearMax) {
  const eventsByEntity = new Map();
  const append = (event) => {
    if (!entityMap.has(event.entityId)) return;
    if (!eventsByEntity.has(event.entityId)) eventsByEntity.set(event.entityId, []);
    eventsByEntity.get(event.entityId).push(event);
  };
  for (const change of hierarchyChangeRecords(data, timepointById)) {
    const child = entityMap.get(change.childId);
    if (child?.type !== "机构") continue;
    append(hierarchyRoleEvent(change, "subject", entityMap, timepointById));
    append(hierarchyRoleEvent(change, "former_parent", entityMap, timepointById));
    append(hierarchyRoleEvent(change, "new_parent", entityMap, timepointById));
  }
  for (const lane of lanes) {
    const events = (eventsByEntity.get(lane.entityId) || [])
      .filter((event) => event.effectiveYear >= yearMin && event.effectiveYear <= yearMax);
    for (const event of events) {
      const existing = event.hierarchyRole === "subject"
        ? lane.events.find((item) => (
          item.id === event.hierarchyChange.childTimepointId
          && item.eventType === "affiliation_change"
        ))
        : null;
      if (!existing) {
        lane.events.push(event);
        continue;
      }
      Object.assign(existing, {
        structuralHierarchyChange: true,
        hierarchyRole: event.hierarchyRole,
        hierarchyChange: event.hierarchyChange,
        hierarchyChangeLabel: event.hierarchyChangeLabel,
        evidenceKeys: [...new Set([
          ...(existing.evidenceKeys || []),
          ...event.evidenceKeys,
        ])],
      });
    }
    lane.events.sort((first, second) => first.effectiveYear - second.effectiveYear
      || first.chainIndex - second.chainIndex
      || first.eventIndex - second.eventIndex);
  }
}

function endpointEntityIds(relation) {
  return relation.members.map((member) => member.entityId).filter((id) => id != null);
}

/**
 * Lane ordering by barycenter sweeps (StoryFlow-style crossing reduction).
 * Focus lanes keep their leading positions; every relation-derived lane is
 * pulled toward the average position of the lanes it shares relations with,
 * so tightly connected entities end up adjacent and cross-lane relation lines
 * stay short. Ordering is deterministic: ties fall back to discovery order,
 * and sweeps stop early once the order stabilizes.
 */
function orderLanesByRelations(lanes, relations, focusIds) {
  if (lanes.length <= 2) return lanes;
  const neighbors = new Map(lanes.map((lane) => [lane.entityId, new Set()]));
  for (const relation of relations) {
    const ids = [...new Set(endpointEntityIds(relation))].filter((id) => neighbors.has(id));
    for (const first of ids) {
      for (const second of ids) {
        if (first === second) continue;
        neighbors.get(first).add(second);
        neighbors.get(second).add(first);
      }
    }
  }
  const focusSet = new Set(focusIds);
  const fixed = lanes.filter((lane) => focusSet.has(lane.entityId));
  const free = lanes.filter((lane) => !focusSet.has(lane.entityId));
  if (!free.length) return lanes;
  const position = new Map(fixed.map((lane, index) => [lane.entityId, index]));
  free.forEach((lane, index) => position.set(lane.entityId, fixed.length + index));
  const discoveryOrder = new Map(free.map((lane, index) => [lane.entityId, index]));
  const barycenter = (lane) => {
    const related = [...neighbors.get(lane.entityId)]
      .map((id) => position.get(id))
      .filter(Number.isFinite);
    if (!related.length) return null;
    return related.reduce((sum, value) => sum + value, 0) / related.length;
  };
  let current = free;
  for (let round = 0; round < 8; round += 1) {
    const sorted = [...current].sort((first, second) => {
      const firstCenter = barycenter(first);
      const secondCenter = barycenter(second);
      if (firstCenter == null && secondCenter == null) {
        return discoveryOrder.get(first.entityId) - discoveryOrder.get(second.entityId);
      }
      if (firstCenter == null) return 1;
      if (secondCenter == null) return -1;
      return firstCenter - secondCenter
        || discoveryOrder.get(first.entityId) - discoveryOrder.get(second.entityId);
    });
    sorted.forEach((lane, index) => position.set(lane.entityId, fixed.length + index));
    const unchanged = sorted.every((lane, index) => lane === current[index]);
    current = sorted;
    if (unchanged) break;
  }
  return [...fixed, ...current];
}

function relevantRelationsForFocus(relations, focusIds) {
  if (!focusIds.length) return [];
  const focusSet = new Set(focusIds);
  const directlyRelevant = relations.filter((relation) => (
    endpointEntityIds(relation).some((id) => focusSet.has(id))
  ));
  const relevantGroupIds = new Set(
    directlyRelevant.map((relation) => relation.groupId).filter((id) => id != null)
  );
  const selected = relations.filter((relation) => (
    directlyRelevant.includes(relation)
      || (relation.groupId != null && relevantGroupIds.has(relation.groupId))
  ));
  // 补全:可见实体彼此之间的关系也要展示——只收"端点含焦点"会把视图压成
  // 星形,丢掉邻居车道之间真实存在的演变边(如总计司→盐铁/度支/户部)。
  // 补全只加边、不引入新实体,因此可见集合一次计算即收敛。
  const visibleIds = new Set(focusIds);
  for (const relation of selected) {
    for (const id of endpointEntityIds(relation)) visibleIds.add(id);
  }
  const selectedKeys = new Set(selected.map((relation) => relation.key ?? relation.id));
  return relations.filter((relation) => {
    if (selectedKeys.has(relation.key ?? relation.id)) return true;
    const ids = endpointEntityIds(relation);
    return ids.length > 0 && ids.every((id) => visibleIds.has(id));
  });
}

function buildRelationGroups(relations, anomalies) {
  const grouped = new Map();
  for (const relation of relations) {
    if (relation.groupId == null) continue;
    if (!grouped.has(relation.groupId)) {
      grouped.set(relation.groupId, {
        id: relation.groupId,
        groupId: relation.groupId,
        relationType: relation.relationType,
        label: relation.label,
        relationIds: [],
        members: [],
        sourceMembers: [],
        targetMembers: [],
      });
    }
    const group = grouped.get(relation.groupId);
    if (group.relationType !== relation.relationType) {
      anomalies.push({
        type: "mixed_relation_group_types",
        groupId: relation.groupId,
        relationTypes: [...new Set([group.relationType, relation.relationType])],
      });
    }
    group.relationIds.push(relation.id);
    group.members.push(...relation.members.map((member) => ({ ...member, relationId: relation.id })));
    group.sourceMembers.push(...relation.sourceMembers.map((member) => ({ ...member, relationId: relation.id })));
    group.targetMembers.push(...relation.targetMembers.map((member) => ({ ...member, relationId: relation.id })));
  }
  for (const group of grouped.values()) {
    const dedupe = (members) => [...new Map(members.map((member) => [
      `${member.role}:${member.entityId}:${member.timepointId ?? ""}`,
      member,
    ])).values()];
    group.members = dedupe(group.members);
    group.sourceMembers = dedupe(group.sourceMembers);
    group.targetMembers = dedupe(group.targetMembers);
  }
  return [...grouped.values()];
}

function lifecycleSegments(chain, yearMin, yearMax) {
  const segments = [];
  const chronological = chain.timepoints
    .map((timepoint, chainIndex) => ({ ...timepoint, chainIndex }))
    .filter((timepoint) => timepoint.effectiveYear != null)
    .sort((a, b) => a.effectiveYear - b.effectiveYear || a.chainIndex - b.chainIndex);

  // null 表示此前没有足以判断存废状态的记录。首个 preserve 能证明
  // 机构在该时点存在，但不能把已经明确罢废的机构自动恢复。
  let active = null;
  let inferredStart = false;
  for (const timepoint of chain.timepoints) {
    if (timepoint.timeType !== "pre_song") continue;
    if (timepoint.effect === "activate") {
      if (active !== true) {
        active = true;
        inferredStart = false;
      }
    }
    else if (timepoint.effect === "preserve" && active === null) {
      active = true;
      inferredStart = true;
    }
    else if (timepoint.effect === "deactivate") {
      active = false;
      inferredStart = false;
    }
  }

  let startYear = active ? yearMin : null;
  let startEventId = null;
  let openStart = Boolean(active);
  for (const event of chronological) {
    const year = event.effectiveYear;
    if (year < yearMin) {
      if (event.effect === "activate") {
        if (active !== true) {
          active = true;
          inferredStart = false;
        }
      }
      else if (event.effect === "preserve" && active === null) {
        active = true;
        inferredStart = true;
      }
      else if (event.effect === "deactivate") {
        active = false;
        inferredStart = false;
      }
      startYear = active ? yearMin : null;
      startEventId = null;
      openStart = Boolean(active);
      continue;
    }
    if (year > yearMax) break;
    if (event.effect === "ignore") continue;
    if (event.effect === "preserve") {
      if (active === null) {
        active = true;
        startYear = year;
        startEventId = event.id;
        openStart = true;
        inferredStart = true;
      }
      continue;
    }
    if (event.effect === "activate") {
      if (active !== true) {
        active = true;
        startYear = year;
        startEventId = event.id;
        openStart = false;
        inferredStart = false;
      }
      continue;
    }
    if (event.effect === "deactivate") {
      if (active === true && startYear != null) {
        segments.push({
          id: `${chain.id}:${startEventId ?? "open"}-${event.id}`,
          chainId: chain.id,
          startYear,
          endYear: year,
          startEventId,
          endEventId: event.id,
          openStart,
          openEnd: false,
          inferredStart,
        });
      }
      active = false;
      startYear = null;
      startEventId = null;
      openStart = false;
      inferredStart = false;
      continue;
    }
  }
  if (active === true && startYear != null) {
    segments.push({
      id: `${chain.id}:${startEventId ?? "open"}-open`,
      chainId: chain.id,
      startYear,
      endYear: yearMax,
      startEventId,
      endEventId: null,
      openStart,
      openEnd: true,
      inferredStart,
    });
  }
  return segments;
}

function classifyOffAxis(timepoint, yearMin, yearMax) {
  if (timepoint.timeType === "pre_song") return "preSong";
  if (timepoint.timeType === "unresolved") return "unresolved";
  if (timepoint.timeType === "undated" || timepoint.effectiveYear == null) return "undated";
  if (timepoint.effectiveYear < yearMin || timepoint.effectiveYear > yearMax) return "outsideRange";
  return null;
}

function buildLane(entity, timepoints, endpointIds, yearMin, yearMax) {
  const { chains, anomalies } = buildChains(entity.id, timepoints);
  const events = [];
  const offAxisEvents = [];
  const segments = [];
  for (const [chainIndex, chain] of chains.entries()) {
    segments.push(...lifecycleSegments(chain, yearMin, yearMax));
    chain.timepoints.forEach((timepoint, eventIndex) => {
      const relationEndpoint = endpointIds.has(timepoint.id);
      const event = {
        ...timepoint,
        chainId: chain.id,
        chainIndex,
        eventIndex,
        relationEndpoint,
        expanded: relationEndpoint || ["activate", "deactivate"].includes(timepoint.effect),
      };
      const bucket = classifyOffAxis(event, yearMin, yearMax);
      if (bucket) offAxisEvents.push({ ...event, bucket });
      else events.push(event);
    });
  }
  events.sort((a, b) => a.effectiveYear - b.effectiveYear
    || a.chainIndex - b.chainIndex
    || a.eventIndex - b.eventIndex);
  return {
    entityId: entity.id,
    entity,
    title: entity.title,
    type: entity.type,
    chains: chains.map((chain) => ({
      id: chain.id,
      headId: chain.headId,
      cycle: chain.cycle,
      eventIds: chain.timepoints.map((timepoint) => timepoint.id),
    })),
    segments,
    events,
    offAxisEvents,
    anomalies,
  };
}

/**
 * Build the rendering-neutral data model for the institution/office evolution view.
 * Relationships annotate transitions but never alter lifecycle segments.
 */
export function buildEvolutionModel(data, focusEntityIds, options = {}) {
  const yearMin = finiteYear(options.yearMin) ?? DEFAULT_YEAR_MIN;
  const yearMax = finiteYear(options.yearMax) ?? DEFAULT_YEAR_MAX;
  if (yearMax < yearMin) throw new RangeError("yearMax must be greater than or equal to yearMin");

  const entityMap = new Map((data?.entities || []).map((entity) => [normalizeId(entity.id), {
    ...entity,
    id: normalizeId(entity.id),
  }]));
  const normalizedFocusIds = [];
  for (const value of focusEntityIds || []) {
    const id = normalizeId(value);
    if (entityMap.has(id) && !normalizedFocusIds.includes(id)) normalizedFocusIds.push(id);
    if (normalizedFocusIds.length === 4) break;
  }

  const { byId: timepointById, byEntity: timepointsByEntity } = normalizeTimepoints(data, entityMap);
  const allRelations = normalizeRelations(data, timepointById);
  const relations = relevantRelationsForFocus(allRelations, normalizedFocusIds);
  const visibleEntityIds = [...normalizedFocusIds];
  for (const relation of relations) {
    for (const id of endpointEntityIds(relation)) {
      if (entityMap.has(id) && !visibleEntityIds.includes(id)) visibleEntityIds.push(id);
    }
  }

  const anomalies = [];
  for (const relation of relations) {
    if (!relation.sourceMembers.length || !relation.targetMembers.length) {
      anomalies.push({ type: "incomplete_relation_endpoints", relationId: relation.id });
    }
    for (const member of relation.members) {
      if (member.entityId != null && !entityMap.has(member.entityId)) {
        anomalies.push({
          type: "missing_relation_entity",
          relationId: relation.id,
          entityId: member.entityId,
        });
      }
    }
  }
  const relationGroups = buildRelationGroups(relations, anomalies);
  const endpointIds = new Set(
    relations.flatMap((relation) => relation.members.map((member) => member.timepointId))
      .filter((id) => id != null)
  );
  const lanes = orderLanesByRelations(
    visibleEntityIds.map((entityId) => buildLane(
      entityMap.get(entityId),
      timepointsByEntity.get(entityId) || [],
      endpointIds,
      yearMin,
      yearMax,
    )),
    relations,
    normalizedFocusIds,
  );
  appendHierarchyChangeEvents(lanes, data, entityMap, timepointById, yearMin, yearMax);
  lanes.forEach((lane) => anomalies.push(...lane.anomalies));

  const offAxis = {
    undated: [],
    unresolved: [],
    preSong: [],
    outsideRange: [],
    relationEndpoints: [],
  };
  for (const lane of lanes) {
    for (const event of lane.offAxisEvents) offAxis[event.bucket].push(event);
  }
  for (const relation of relations) {
    for (const member of relation.members) {
      if (member.effectiveYear != null
        && member.effectiveYear >= yearMin
        && member.effectiveYear <= yearMax
        && member.timeType !== "pre_song") continue;
      offAxis.relationEndpoints.push({
        ...member,
        relationId: relation.id,
        relationKey: relation.key,
        relationType: relation.relationType,
        relationLabel: relation.label,
      });
    }
  }

  return {
    focusEntityIds: normalizedFocusIds,
    visibleEntityIds,
    lanes,
    relations,
    relationGroups,
    offAxis,
    anomalies,
    yearMin,
    yearMax,
  };
}

/**
 * 时间线树视图专用：为任意实体集合构建车道，保持调用方给定的顺序
 * （车道顺序由层级树决定，不做 StoryFlow 式重心重排），不做 4 个焦点
 * 实体的截断，也不按焦点过滤关系——只收两端实体都在集合内的关系。
 */
export function buildEvolutionLanes(data, entityIds, options = {}) {
  const yearMin = finiteYear(options.yearMin) ?? DEFAULT_YEAR_MIN;
  const yearMax = finiteYear(options.yearMax) ?? DEFAULT_YEAR_MAX;
  if (yearMax < yearMin) throw new RangeError("yearMax must be greater than or equal to yearMin");

  const entityMap = new Map((data?.entities || []).map((entity) => [normalizeId(entity.id), {
    ...entity,
    id: normalizeId(entity.id),
  }]));
  const orderedIds = [];
  for (const value of entityIds || []) {
    const id = normalizeId(value);
    if (entityMap.has(id) && !orderedIds.includes(id)) orderedIds.push(id);
  }

  const { byId: timepointById, byEntity: timepointsByEntity } = normalizeTimepoints(data, entityMap);
  const allRelations = normalizeRelations(data, timepointById);
  const visible = new Set(orderedIds);
  const relations = allRelations.filter((relation) => {
    const ids = endpointEntityIds(relation);
    return ids.length > 0 && ids.every((id) => visible.has(id));
  });

  const anomalies = [];
  for (const relation of relations) {
    if (!relation.sourceMembers.length || !relation.targetMembers.length) {
      anomalies.push({ type: "incomplete_relation_endpoints", relationId: relation.id });
    }
  }

  const endpointIds = new Set(
    relations.flatMap((relation) => relation.members.map((member) => member.timepointId))
      .filter((id) => id != null),
  );
  const lanes = orderedIds.map((entityId) => buildLane(
    entityMap.get(entityId),
    timepointsByEntity.get(entityId) || [],
    endpointIds,
    yearMin,
    yearMax,
  ));
  lanes.forEach((lane) => anomalies.push(...lane.anomalies));

  return {
    entityIds: orderedIds,
    lanes,
    relations,
    anomalies,
    yearMin,
    yearMax,
  };
}
