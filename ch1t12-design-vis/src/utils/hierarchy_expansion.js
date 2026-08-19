export function mergeExpansionPaths(currentIds, nextPath, spaceAware) {
  if (!spaceAware) return [...nextPath];
  return [...new Set([...currentIds, ...nextPath])];
}

export function removeExpandedSubtree(currentIds, subtreeIds) {
  const removed = new Set(subtreeIds);
  return currentIds.filter((id) => !removed.has(id));
}

export function expansionAfterLayout({
  candidateIds,
}) {
  return [...candidateIds];
}

export function expansionAnchorId(expandedIds, spaceAware) {
  return spaceAware ? null : expandedIds[0] ?? null;
}

export function toggleInstitutionGroupIds(currentIds, clickedId, spaceAware) {
  if (currentIds.includes(clickedId)) {
    return currentIds.filter((id) => id !== clickedId);
  }
  return spaceAware ? [...currentIds, clickedId] : [clickedId];
}

export function institutionGroupsAfterLayout({
  candidateIds,
}) {
  return [...candidateIds];
}

export function hierarchyPathAfterInstitutionGroupToggle(currentIds, spaceAware) {
  return spaceAware ? [...currentIds] : [];
}

export function collapseInstitutionGroups(expandedIds, lastExpandedId) {
  const focusId = expandedIds.includes(lastExpandedId)
    ? lastExpandedId
    : expandedIds.at(-1);
  return focusId ? [focusId] : [];
}

export function compositionDetailButtonVisible({
  isVirtual,
  isExpanded,
  isSelected,
  isDetailOpen,
}) {
  return !isVirtual && !isDetailOpen && (isExpanded || isSelected);
}

export function compositionViewButtonVisible({
  isVirtual,
  isSelected,
}) {
  return !isVirtual && isSelected;
}
