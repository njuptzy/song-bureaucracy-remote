export function resolveHierarchyContext(entityId, hierarchyEdges, entityMap) {
  const path = [entityId];
  const visited = new Set(path);
  let currentId = entityId;
  while (true) {
    const parentEdge = hierarchyEdges
      .filter((edge) => edge.child === currentId && entityMap.has(edge.parent))
      .sort((a, b) => (a.id ?? Number.MAX_SAFE_INTEGER) - (b.id ?? Number.MAX_SAFE_INTEGER))[0];
    if (!parentEdge || visited.has(parentEdge.parent)) break;
    currentId = parentEdge.parent;
    visited.add(currentId);
    path.push(currentId);
  }
  path.reverse();
  return {
    root: entityMap.get(path[0]) || entityMap.get(entityId) || null,
    path,
  };
}

export function resolveVisibleSelection(selected, activeEntityIds, categoryFallback) {
  if (!selected) return null;
  if (selected && (!activeEntityIds || activeEntityIds.has(selected.id))) return selected;
  return categoryFallback || null;
}
