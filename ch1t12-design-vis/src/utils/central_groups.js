export const CENTRAL_GROUP_NAMES = [
  "宰辅与决策中枢",
  "三省六部与馆阁",
  "礼仪宗室与宫廷事务",
  "财赋农政与马政",
  "五监与工程教育",
  "司法监察",
  "寺监制度统称",
];

export function otherInstitutionGroup(category) {
  return `其他${category}`;
}

export function institutionGroupId(category, group) {
  return `institution-group:${category}:${group}`;
}

export function entityInstitutionGroup(entity, category) {
  return entity?.institution_group
    || (category === "中央机构" ? entity?.central_group : "")
    || otherInstitutionGroup(category);
}

export function groupInstitutionRootIds(rootIds, entityMap, category, groupNames = []) {
  const grouped = new Map();
  for (const entityId of rootIds) {
    const group = entityInstitutionGroup(entityMap.get(entityId), category);
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group).push(entityId);
  }
  const known = groupNames.filter((group) => grouped.has(group));
  const extra = [...grouped.keys()]
    .filter((group) => !groupNames.includes(group))
    .sort((a, b) => a.localeCompare(b, "zh"));
  return [...known, ...extra].map((group) => ({ group, rootIds: grouped.get(group) }));
}

export function buildInstitutionGroupNodes({
  rootIds,
  entityMap,
  category,
  groupNames,
  expandedGroupId,
  expandedGroupIds,
  treeForRoot,
}) {
  const expandedIds = new Set(expandedGroupIds ?? (expandedGroupId ? [expandedGroupId] : []));
  return groupInstitutionRootIds(rootIds, entityMap, category, groupNames)
    .map(({ group, rootIds: groupedRootIds }) => {
      const id = institutionGroupId(category, group);
      const expanded = expandedIds.has(id);
      return {
        id,
        title: group,
        childCount: groupedRootIds.length,
        hiddenCount: expanded ? 0 : groupedRootIds.length,
        memberEntityIds: [...groupedRootIds],
        isVirtual: true,
        isInstitutionGroup: true,
        children: expanded ? groupedRootIds.map(treeForRoot).filter(Boolean) : [],
      };
    });
}
