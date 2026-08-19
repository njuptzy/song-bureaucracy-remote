const DEFAULT_MAX_LANES = 8;

function positiveInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 1) return fallback;
  return Math.floor(numeric);
}

function relationEndpointIds(relation) {
  const sourceIds = (relation?.sourceMembers || [])
    .map((member) => member?.entityId)
    .filter((id) => id != null);
  const targetIds = (relation?.targetMembers || [])
    .map((member) => member?.entityId)
    .filter((id) => id != null);
  if (!sourceIds.length && relation?.sourceEntityId != null) {
    sourceIds.push(relation.sourceEntityId);
  }
  if (!targetIds.length && relation?.targetEntityId != null) {
    targetIds.push(relation.targetEntityId);
  }
  return { sourceIds, targetIds };
}

function relationVisible(relation, visibleEntityIds) {
  const { sourceIds, targetIds } = relationEndpointIds(relation);
  return sourceIds.length > 0
    && targetIds.length > 0
    && sourceIds.every((id) => visibleEntityIds.has(id))
    && targetIds.every((id) => visibleEntityIds.has(id));
}

function filterGroupMembers(members, visibleRelationIds, visibleEntityIds) {
  return (members || []).filter((member) => (
    (member?.relationId == null || visibleRelationIds.has(member.relationId))
    && member?.entityId != null
    && visibleEntityIds.has(member.entityId)
  ));
}

function filterRelationGroups(groups, relations, visibleEntityIds) {
  const visibleRelationIds = new Set(relations.map((relation) => relation.id));
  return (groups || []).flatMap((group) => {
    const originalRelationIds = group.relationIds || [];
    const relationIds = originalRelationIds.filter((id) => visibleRelationIds.has(id));
    // A split/merge glyph is only truthful when every group member is visible.
    if (!relationIds.length || relationIds.length !== originalRelationIds.length) return [];
    return [{
      ...group,
      relationIds,
      members: filterGroupMembers(group.members, visibleRelationIds, visibleEntityIds),
      sourceMembers: filterGroupMembers(
        group.sourceMembers,
        visibleRelationIds,
        visibleEntityIds,
      ),
      targetMembers: filterGroupMembers(
        group.targetMembers,
        visibleRelationIds,
        visibleEntityIds,
      ),
    }];
  });
}

function filterOffAxis(offAxis, visibleEntityIds, relations) {
  const visibleRelationIds = new Set(relations.map((relation) => relation.id));
  const visibleRelationKeys = new Set(relations.map((relation) => relation.key).filter(Boolean));
  return Object.fromEntries(Object.entries(offAxis || {}).map(([key, value]) => {
    if (!Array.isArray(value)) return [key, value];
    const filtered = value.filter((item) => {
      if (item?.entityId != null && !visibleEntityIds.has(item.entityId)) return false;
      if (item?.relationKey != null) return visibleRelationKeys.has(item.relationKey);
      if (item?.relationId != null) return visibleRelationIds.has(item.relationId);
      return item?.entityId != null;
    });
    return [key, filtered];
  }));
}

/**
 * Project a complete buildEvolutionModel result into one renderable lane page.
 * Focus lanes stay visible on every page; only relation-derived lanes paginate.
 */
export function windowEvolutionModel(
  model,
  requestedPage = 1,
  requestedMaxLanes = DEFAULT_MAX_LANES,
) {
  let pageValue = requestedPage;
  let maxLanesValue = requestedMaxLanes;
  if (requestedPage && typeof requestedPage === "object") {
    pageValue = requestedPage.page ?? 1;
    maxLanesValue = requestedPage.maxLanes ?? DEFAULT_MAX_LANES;
  }

  const lanes = model?.lanes || [];
  const focusIds = new Set(model?.focusEntityIds || []);
  const focusLanes = lanes.filter((lane) => focusIds.has(lane.entityId));
  const relatedLanes = lanes.filter((lane) => !focusIds.has(lane.entityId));
  const maxLanes = positiveInteger(maxLanesValue, DEFAULT_MAX_LANES);
  const relatedCapacity = Math.max(0, maxLanes - focusLanes.length);
  const pageCount = relatedCapacity > 0 && relatedLanes.length > 0
    ? Math.ceil(relatedLanes.length / relatedCapacity)
    : 1;
  const page = Math.min(pageCount, positiveInteger(pageValue, 1));
  const pageStart = relatedCapacity > 0 ? (page - 1) * relatedCapacity : 0;
  const visibleRelatedLanes = relatedCapacity > 0
    ? relatedLanes.slice(pageStart, pageStart + relatedCapacity)
    : [];
  const pageRelatedIds = new Set(visibleRelatedLanes.map((lane) => lane.entityId));
  const visibleLanes = lanes.filter((lane) => (
    focusIds.has(lane.entityId) || pageRelatedIds.has(lane.entityId)
  ));
  const visibleEntityIds = new Set(visibleLanes.map((lane) => lane.entityId));
  const relations = (model?.relations || []).filter((relation) => (
    relationVisible(relation, visibleEntityIds)
  ));
  const relationGroups = filterRelationGroups(
    model?.relationGroups,
    relations,
    visibleEntityIds,
  );
  const offAxis = filterOffAxis(model?.offAxis, visibleEntityIds, relations);

  return {
    ...model,
    visibleEntityIds: [...visibleEntityIds],
    lanes: visibleLanes,
    relations,
    relationGroups,
    offAxis,
    laneWindow: {
      page,
      pageCount,
      totalLanes: lanes.length,
      visibleLanes: visibleLanes.length,
      hiddenLanes: lanes.length - visibleLanes.length,
    },
  };
}
