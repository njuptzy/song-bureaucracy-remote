export function timelineSelectionForEvolutionItem(kind, effectiveYear, fullRange) {
  const range = Array.isArray(fullRange) ? [...fullRange] : [];
  if (kind === "timepoint" && Number.isFinite(effectiveYear)) {
    return { active: true, range: [effectiveYear, effectiveYear] };
  }
  return { active: false, range };
}

export function evolutionComparisonAfterAdd(entityIds, entityId, limit = 4) {
  const maxItems = Math.max(1, Math.floor(Number(limit) || 4));
  const current = [...new Set((entityIds || []).filter((id) => id != null))]
    .filter((id) => id !== entityId);
  return {
    mode: "compare",
    entityIds: [...current.slice(0, maxItems - 1), entityId],
    activeEntityId: entityId,
  };
}

export function evolutionSelectionAnchors(selectedItem) {
  const item = selectedItem?.item;
  if (!item) return [];

  const candidates = selectedItem.kind === "timepoint"
    ? [{
      year: item.effectiveYear,
      x: item.baseX,
      y: item.baseY ?? item.y,
    }]
    : [...(item.sourcePoints || []), ...(item.targetPoints || [])].map((point) => ({
      year: point.effectiveYear,
      x: point.baseX,
      y: point.y,
    }));

  const byYear = new Map();
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.year)
      || !Number.isFinite(candidate.x)
      || !Number.isFinite(candidate.y)) continue;
    const previous = byYear.get(candidate.year);
    if (!previous || candidate.y > previous.y) byYear.set(candidate.year, candidate);
  }
  return [...byYear.values()].sort((first, second) => first.year - second.year);
}

export function evolutionSelectionFocus(selectedItem) {
  if (!selectedItem?.item) {
    return { active: false, relationId: null, timepointIds: [] };
  }
  if (selectedItem.kind === "timepoint") {
    return {
      active: true,
      relationId: null,
      timepointIds: selectedItem.id == null ? [] : [selectedItem.id],
    };
  }
  if (selectedItem.kind !== "relation") {
    return { active: false, relationId: null, timepointIds: [] };
  }
  const relation = selectedItem.item;
  const timepointIds = [...new Set(
    [...(relation.sourcePoints || []), ...(relation.targetPoints || [])]
      .map((point) => point.timepointId)
      .filter(Number.isFinite),
  )].sort((first, second) => first - second);
  return {
    active: true,
    relationId: selectedItem.id,
    timepointIds,
  };
}
