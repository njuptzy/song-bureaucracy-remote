const CHANGE_TYPE_ORDER = new Map([
  ["evolve", 0],
  ["unclassified", 1],
  ["reparent", 2],
  ["reorganize", 3],
  ["restore", 4],
  ["create", 5],
  ["remove", 6],
  ["move", 7],
]);

export const CHANGE_TYPE_LABELS = Object.freeze({
  move: "位置变化",
  reparent: "隶属变化",
  reorganize: "改置",
  create: "新设",
  remove: "撤销",
  restore: "恢复",
  evolve: "前后演变",
  unclassified: "未分类演变",
});

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeId(value) {
  const numeric = finiteNumber(value);
  return numeric ?? value ?? null;
}

function endpointYear(source) {
  if (!source) return null;
  const timeType = String(source.time_type ?? source.timeType ?? "");
  if (["pre_song", "undated", "unresolved"].includes(timeType)) return null;
  const start = finiteNumber(source.year_start ?? source.yearStart);
  const end = finiteNumber(source.year_end ?? source.yearEnd);
  return timeType === "bounded" ? (end ?? start) : (start ?? end);
}

function relationYear(relation, timepointById) {
  const explicit = finiteNumber(
    relation.effective_year ?? relation.effectiveYear ?? relation.year,
  );
  if (explicit != null) return explicit;
  const sourceTime = relation.source_time ?? relation.sourceTime;
  const targetTime = relation.target_time ?? relation.targetTime;
  const years = [
    endpointYear(sourceTime),
    endpointYear(targetTime),
    endpointYear(timepointById.get(normalizeId(
      relation.source_timepoint_id ?? relation.sourceTimepointId
        ?? relation.subject_timepoint_id,
    ))),
    endpointYear(timepointById.get(normalizeId(
      relation.target_timepoint_id ?? relation.targetTimepointId
        ?? relation.object_timepoint_id,
    ))),
  ].filter((year) => year != null);
  return years.length ? Math.max(...years) : null;
}

function relationMembers(relation, timepointById) {
  if (Array.isArray(relation.members) && relation.members.length) {
    return relation.members.map((member) => ({
      role: ["target", "receiver", "object", "后继", "接受者"].includes(member.role)
        ? "target"
        : "source",
      entityId: normalizeId(member.entity_id ?? member.entityId),
      timepointId: normalizeId(member.timepoint_id ?? member.timepointId),
      year: endpointYear(member)
        ?? endpointYear(timepointById.get(normalizeId(member.timepoint_id ?? member.timepointId))),
      rawTime: String(member.raw_time ?? member.rawTime ?? member.time ?? ""),
    })).filter((member) => member.entityId != null);
  }
  const sourceTimepointId = normalizeId(
    relation.source_timepoint_id ?? relation.sourceTimepointId
      ?? relation.subject_timepoint_id,
  );
  const targetTimepointId = normalizeId(
    relation.target_timepoint_id ?? relation.targetTimepointId
      ?? relation.object_timepoint_id,
  );
  return [
    {
      role: "source",
      entityId: normalizeId(
        relation.source ?? relation.source_entity_id ?? relation.sourceEntityId
          ?? relation.subject_entity_id,
      ),
      timepointId: sourceTimepointId,
      year: endpointYear(relation.source_time ?? relation.sourceTime)
        ?? endpointYear(timepointById.get(sourceTimepointId)),
      rawTime: String(
        relation.source_time?.raw_time ?? relation.sourceTime?.rawTime
          ?? timepointById.get(sourceTimepointId)?.time ?? "",
      ),
    },
    {
      role: "target",
      entityId: normalizeId(
        relation.target ?? relation.target_entity_id ?? relation.targetEntityId
          ?? relation.object_entity_id,
      ),
      timepointId: targetTimepointId,
      year: endpointYear(relation.target_time ?? relation.targetTime)
        ?? endpointYear(timepointById.get(targetTimepointId)),
      rawTime: String(
        relation.target_time?.raw_time ?? relation.targetTime?.rawTime
          ?? timepointById.get(targetTimepointId)?.time ?? "",
      ),
    },
  ].filter((member) => member.entityId != null);
}

function citationValues(data, keys) {
  const seen = new Set();
  return keys.flatMap((key) => data?.citations?.[key] || []).filter((item) => {
    const identity = item.id ?? `${item.citation || ""}:${item.quotation || ""}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function makeChange(data, source) {
  const citationKeys = [...new Set((source.citationKeys || []).filter(Boolean))];
  return {
    type: source.type,
    sourceIds: [...new Set(source.sourceIds || [])],
    targetIds: [...new Set(source.targetIds || [])],
    fromYear: source.fromYear ?? source.year,
    toYear: source.toYear ?? source.year,
    eventYear: source.year,
    eventTime: source.eventTime || (source.year != null ? `${source.year}年` : "时间未明"),
    eventText: source.eventText || CHANGE_TYPE_LABELS[source.type] || "结构变化",
    citationKeys,
    citations: citationValues(data, citationKeys),
    quotation: source.quotation || "",
    certainty: source.certainty || "structural",
    focusEntityId: source.focusEntityId ?? source.targetIds?.[0] ?? source.sourceIds?.[0] ?? null,
    relationId: source.relationId ?? null,
    relationGroupId: source.relationGroupId ?? null,
    previousParentId: source.previousParentId ?? null,
    nextParentId: source.nextParentId ?? null,
    key: source.key,
  };
}

function addChange(byEntity, change) {
  const ids = new Set([...change.sourceIds, ...change.targetIds]);
  if (change.type === "reparent") {
    ids.add(change.previousParentId);
    ids.add(change.nextParentId);
  }
  for (const entityId of ids) {
    if (entityId == null) continue;
    if (!byEntity.has(entityId)) byEntity.set(entityId, []);
    byEntity.get(entityId).push(change);
  }
}

function changeEventText(timepoint, fallback) {
  return String(timepoint.event || timepoint.quotation || fallback);
}

function relationGroupKey(relation, index) {
  const explicit = relation.relation_group_id ?? relation.relationGroupId
    ?? relation.change_event_id ?? relation.changeEventId;
  return explicit != null ? `group:${explicit}` : `relation:${relation.id ?? index}`;
}

function normalizeExplicitRelations(data, timepointById) {
  const sources = Array.isArray(data?.changeRelations)
    ? data.changeRelations
    : (data?.evolutionEdges || []);
  const groups = new Map();
  sources.forEach((relation, index) => {
    const key = relationGroupKey(relation, index);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ relation, index });
  });
  return [...groups.entries()].map(([groupKey, members]) => {
    const relationMembersList = members.flatMap(({ relation }) => (
      relationMembers(relation, timepointById)
    ));
    const sourceIds = relationMembersList
      .filter((member) => member.role === "source")
      .map((member) => member.entityId);
    const targetIds = relationMembersList
      .filter((member) => member.role === "target")
      .map((member) => member.entityId);
    const years = members
      .map(({ relation }) => relationYear(relation, timepointById))
      .filter((year) => year != null);
    const memberTimes = relationMembersList
      .map((member) => member.rawTime)
      .filter(Boolean);
    const first = members[0].relation;
    const relationIds = members.map(({ relation }) => relation.id).filter((id) => id != null);
    const classification = String(
      first.classification_status ?? first.classificationStatus ?? "",
    );
    const unclassified = classification === "unclassified"
      || String(first.relation_type ?? first.relationType) === "前后演变"
      || sourceIds.length !== 1
      || targetIds.length !== 1;
    const year = years.length ? Math.max(...years) : null;
    return makeChange(data, {
      type: unclassified ? "unclassified" : "evolve",
      sourceIds,
      targetIds,
      year,
      eventTime: [...new Set(memberTimes)].join(" / ") || (year != null ? `${year}年` : "时间未明"),
      eventText: String(
        first.display_relation_type ?? first.displayRelationType
          ?? first.relation_subtype ?? first.relationSubtype
          ?? first.relation_type ?? first.relationType ?? "前后演变",
      ),
      citationKeys: relationIds.map((id) => `R${id}`),
      quotation: members.map(({ relation }) => relation.quotation).filter(Boolean).join("；"),
      certainty: "explicit",
      relationId: relationIds.length === 1 ? relationIds[0] : null,
      relationGroupId: groupKey,
      key: `explicit:${groupKey}`,
    });
  }).filter((change) => change.eventYear != null);
}

function hierarchyStateYear(state, timepointById) {
  const explicit = finiteNumber(state.effective_year ?? state.effectiveYear);
  if (explicit != null) return explicit;
  const years = [state.subject_timepoint_id, state.object_timepoint_id]
    .map((id) => endpointYear(timepointById.get(normalizeId(id))))
    .filter((year) => year != null);
  return years.length ? Math.max(...years) : null;
}

function normalizeHierarchyChanges(data, timepointById, entityById) {
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
        parentId: edge.parent,
        relationId: state.id ?? edge.id,
        timepointId: state.object_timepoint_id,
      });
    }
  }
  const changes = [];
  for (const [entityId, records] of histories) {
    records.sort((a, b) => a.year - b.year || Number(a.relationId) - Number(b.relationId));
    const recordsByYear = new Map();
    for (const record of records) {
      if (!recordsByYear.has(record.year)) recordsByYear.set(record.year, []);
      recordsByYear.get(record.year).push(record);
    }
    let previousRecord = null;
    for (const yearRecords of recordsByYear.values()) {
      const parentIds = new Set(yearRecords.map((record) => record.parentId));
      if (parentIds.size !== 1) {
        previousRecord = null;
        continue;
      }
      const record = yearRecords.at(-1);
      if (!previousRecord) {
        previousRecord = record;
        continue;
      }
      if (record.parentId === previousRecord.parentId) {
        previousRecord = record;
        continue;
      }
      const timepoint = timepointById.get(normalizeId(record.timepointId)) || {};
      changes.push(makeChange(data, {
        type: "reparent",
        sourceIds: [entityId],
        targetIds: [entityId],
        year: record.year,
        eventTime: timepoint.time || `${record.year}年`,
        eventText: changeEventText(
          timepoint,
          `由${entityById.get(previousRecord.parentId)?.title || `#${previousRecord.parentId}`}改隶`
            + `${entityById.get(record.parentId)?.title || `#${record.parentId}`}`,
        ),
        citationKeys: [
          record.relationId != null ? `R${record.relationId}` : null,
          record.timepointId != null ? `T${record.timepointId}` : null,
        ],
        focusEntityId: entityId,
        relationId: record.relationId,
        previousParentId: previousRecord.parentId,
        nextParentId: record.parentId,
        key: `reparent:${entityId}:${record.year}:${previousRecord.parentId}:${record.parentId}`,
      }));
      previousRecord = record;
    }
  }
  return changes;
}

function normalizeLifecycleChanges(data, timepointById) {
  const changes = [];
  for (const [entityIdText, items] of Object.entries(data?.timepoints || {})) {
    const entityId = normalizeId(entityIdText);
    const ordered = [...items]
      .map((item) => ({ item, year: endpointYear(item) }))
      .filter(({ year }) => year != null)
      .sort((a, b) => a.year - b.year || Number(a.item.id) - Number(b.item.id));
    let deactivated = false;
    for (const { item, year } of ordered) {
      const effect = String(item.lifecycle_effect ?? item.lifecycleEffect ?? "preserve");
      if (effect !== "activate" && effect !== "deactivate") continue;
      const type = effect === "deactivate" ? "remove" : deactivated ? "restore" : "create";
      changes.push(makeChange(data, {
        type,
        sourceIds: effect === "deactivate" ? [entityId] : [],
        targetIds: effect === "activate" ? [entityId] : [],
        year,
        eventTime: item.time || `${year}年`,
        eventText: changeEventText(item, CHANGE_TYPE_LABELS[type]),
        citationKeys: item.id != null ? [`T${item.id}`] : [],
        quotation: item.quotation || "",
        focusEntityId: entityId,
        key: `lifecycle:${entityId}:${item.id ?? year}:${type}`,
      }));
      deactivated = effect === "deactivate";
    }
  }
  return changes;
}

function claimedTimepointIds(changes) {
  return new Set((changes || []).flatMap((change) => (
    (change.citationKeys || [])
      .filter((key) => String(key).startsWith("T"))
      .map((key) => normalizeId(String(key).slice(1)))
  )));
}

function normalizeRecordedStructuralChanges(data, timepointById, claimedIds = new Set()) {
  const changes = [];
  for (const timepoint of timepointById.values()) {
    const eventType = String(timepoint.event_type ?? timepoint.eventType ?? "");
    const type = eventType === "reorganize"
      ? "reorganize"
      : eventType === "affiliation_change"
        ? "reparent"
        : null;
    const year = endpointYear(timepoint);
    const entityId = normalizeId(timepoint.entity_id ?? timepoint.entityId);
    if (!type || year == null || entityId == null || claimedIds.has(normalizeId(timepoint.id))) {
      continue;
    }
    changes.push(makeChange(data, {
      type,
      sourceIds: [entityId],
      targetIds: [entityId],
      year,
      eventTime: timepoint.time || `${year}年`,
      eventText: changeEventText(timepoint, CHANGE_TYPE_LABELS[type]),
      citationKeys: timepoint.id != null ? [`T${timepoint.id}`] : [],
      quotation: timepoint.quotation || "",
      certainty: "explicit",
      focusEntityId: entityId,
      key: `recorded-structure:${entityId}:${timepoint.id ?? year}:${type}`,
    }));
  }
  return changes;
}

function compareChanges(a, b) {
  return a.eventYear - b.eventYear
    || (CHANGE_TYPE_ORDER.get(a.type) ?? 99) - (CHANGE_TYPE_ORDER.get(b.type) ?? 99)
    || String(a.key).localeCompare(String(b.key), "zh", { numeric: true });
}

export function buildStructuralChangeIndex(data) {
  const entityById = new Map((data?.entities || []).map((entity) => [entity.id, entity]));
  const timepointById = new Map();
  for (const [entityIdText, items] of Object.entries(data?.timepoints || {})) {
    for (const item of items || []) {
      timepointById.set(normalizeId(item.id), {
        ...item,
        entity_id: normalizeId(item.entity_id ?? item.entityId ?? entityIdText),
      });
    }
  }
  const explicitChanges = normalizeExplicitRelations(data, timepointById);
  const hierarchyChanges = normalizeHierarchyChanges(data, timepointById, entityById);
  const lifecycleChanges = normalizeLifecycleChanges(data, timepointById);
  const recordedStructuralChanges = normalizeRecordedStructuralChanges(
    data,
    timepointById,
    claimedTimepointIds([...hierarchyChanges, ...lifecycleChanges]),
  );
  const changes = [
    ...explicitChanges,
    ...hierarchyChanges,
    ...recordedStructuralChanges,
    ...lifecycleChanges,
  ].sort(compareChanges);
  const byEntity = new Map();
  changes.forEach((change) => addChange(byEntity, change));
  for (const items of byEntity.values()) items.sort(compareChanges);
  return { changes, byEntity, entityById, timepointById };
}

export function changesForEntity(index, entityId) {
  return index?.byEntity?.get(normalizeId(entityId)) || [];
}

export function changesForEntities(index, entityIds) {
  const keys = new Set();
  const changes = [];
  for (const entityId of entityIds || []) {
    for (const change of changesForEntity(index, entityId)) {
      if (keys.has(change.key)) continue;
      keys.add(change.key);
      changes.push(change);
    }
  }
  return changes.sort(compareChanges);
}

export function changeSummaryForEntities(index, entityIds, year) {
  const keys = new Set();
  const changes = [];
  for (const entityId of entityIds || []) {
    for (const change of changesForEntity(index, entityId)) {
      if (keys.has(change.key)) continue;
      keys.add(change.key);
      changes.push(change);
    }
  }
  const pastChanges = changes.filter((change) => change.eventYear < year);
  const currentChanges = changes.filter((change) => change.eventYear === year);
  const futureChanges = changes.filter((change) => change.eventYear > year);
  const pastYear = pastChanges.length
    ? Math.max(...pastChanges.map((change) => change.eventYear))
    : null;
  const futureYear = futureChanges.length
    ? Math.min(...futureChanges.map((change) => change.eventYear))
    : null;
  return {
    past: pastYear == null ? null : {
      year: pastYear,
      distance: year - pastYear,
      count: pastChanges.filter((change) => change.eventYear === pastYear).length,
    },
    current: currentChanges.length ? { year, distance: 0, count: currentChanges.length } : null,
    future: futureYear == null ? null : {
      year: futureYear,
      distance: futureYear - year,
      count: futureChanges.filter((change) => change.eventYear === futureYear).length,
    },
    total: changes.length,
  };
}

export function changeSummaryForEntity(index, entityId, year) {
  return changeSummaryForEntities(index, [entityId], year);
}

function parentMap(snapshot) {
  return new Map((snapshot?.hierarchyEdges || []).map((edge) => [edge.child, edge.parent]));
}

function yearInTransition(year, fromYear, toYear) {
  if (fromYear < toYear) return year > fromYear && year <= toYear;
  if (fromYear > toYear) return year >= toYear && year < fromYear;
  return year === fromYear;
}

export function buildSnapshotTransition({
  data,
  index = buildStructuralChangeIndex(data),
  fromSnapshot,
  toSnapshot,
  fromYear,
  toYear,
  focusEntityId = null,
}) {
  const fromIds = fromSnapshot?.entityIds || new Set();
  const toIds = toSnapshot?.entityIds || new Set();
  const oldParents = parentMap(fromSnapshot);
  const newParents = parentMap(toSnapshot);
  const changes = [];
  const explicitEndpointIds = new Set();
  for (const change of index.changes) {
    if (!["evolve", "unclassified"].includes(change.type)) continue;
    if (!yearInTransition(change.eventYear, fromYear, toYear)) continue;
    changes.push({ ...change, fromYear, toYear, focusEntityId: focusEntityId ?? change.focusEntityId });
    [...change.sourceIds, ...change.targetIds].forEach((id) => explicitEndpointIds.add(id));
  }
  for (const entityId of fromIds) {
    if (!toIds.has(entityId)) {
      if (!explicitEndpointIds.has(entityId)) {
        const lifecycle = changesForEntity(index, entityId).find((change) => (
          change.type === "remove" && yearInTransition(change.eventYear, fromYear, toYear)
        ));
        changes.push(lifecycle
          ? { ...lifecycle, fromYear, toYear, focusEntityId: focusEntityId ?? entityId }
          : makeChange(data, {
            type: "remove",
            sourceIds: [entityId],
            targetIds: [],
            year: toYear,
            fromYear,
            toYear,
            eventText: "目标年份中已不再出现",
            focusEntityId: focusEntityId ?? entityId,
            key: `snapshot-remove:${entityId}:${fromYear}:${toYear}`,
          }));
      }
      continue;
    }
    const previousParentId = oldParents.get(entityId) ?? null;
    const nextParentId = newParents.get(entityId) ?? null;
    if (previousParentId === nextParentId) continue;
    changes.push(makeChange(data, {
      type: "reparent",
      sourceIds: [entityId],
      targetIds: [entityId],
      year: toYear,
      fromYear,
      toYear,
      eventText: "层级归属发生变化",
      focusEntityId: focusEntityId ?? entityId,
      previousParentId,
      nextParentId,
      key: `snapshot:${entityId}:${fromYear}:${toYear}`,
    }));
  }
  for (const entityId of toIds) {
    if (fromIds.has(entityId) || explicitEndpointIds.has(entityId)) continue;
    const lifecycle = changesForEntity(index, entityId).find((change) => (
      ["create", "restore"].includes(change.type)
        && yearInTransition(change.eventYear, fromYear, toYear)
    ));
    changes.push(lifecycle
      ? { ...lifecycle, fromYear, toYear, focusEntityId: focusEntityId ?? entityId }
      : makeChange(data, {
        type: "create",
        sourceIds: [],
        targetIds: [entityId],
        year: toYear,
        fromYear,
        toYear,
        eventText: "来源未定；在目标位置出现",
        focusEntityId: focusEntityId ?? entityId,
        key: `snapshot-create:${entityId}:${fromYear}:${toYear}`,
      }));
  }
  return changes.sort(compareChanges);
}

export function resolveTransitionSelection({
  changes,
  currentEntityId,
  targetSnapshot,
  fromYear,
  toYear,
}) {
  const currentId = normalizeId(currentEntityId);
  if (currentId == null) return { entityId: null, reason: "none", change: null };
  if (targetSnapshot?.entityIds?.has(currentId)) {
    return { entityId: currentId, reason: "same-entity", change: null };
  }
  const forward = toYear >= fromYear;
  const matches = (changes || []).filter((change) => {
    if (!["evolve", "unclassified"].includes(change.type)) return false;
    const originIds = forward ? change.sourceIds : change.targetIds;
    const destinationIds = forward ? change.targetIds : change.sourceIds;
    return originIds.length === 1
      && destinationIds.length === 1
      && originIds[0] === currentId
      && targetSnapshot?.entityIds?.has(destinationIds[0]);
  });
  if (matches.length === 1) {
    const change = matches[0];
    return {
      entityId: forward ? change.targetIds[0] : change.sourceIds[0],
      reason: "one-to-one-evolution",
      change,
    };
  }
  return { entityId: currentId, reason: "context-only", change: matches[0] || null };
}
