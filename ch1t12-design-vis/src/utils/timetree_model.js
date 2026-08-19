import { groupInstitutionRootIds, institutionGroupId } from "./central_groups.js";
import { compareInstitutionIdsBySourceOrder } from "./institution_order.js";

// 时间线树视图严格复用层级视图的“类别根 → 制度组虚拟层 → 机构层级边”
// 组织语义，仅把最终树坐标逆时针旋转 90°。

export function timetreeCategoryKey(category) {
  return `category:${category}`;
}

export function timetreeGroupKey(category, group) {
  return institutionGroupId(category, group);
}

export function timetreeEntityKey(entityId) {
  return `entity:${entityId}`;
}

function defaultCategory(entity) {
  return entity?.category || "中央机构";
}

/**
 * 为前序节点补充旋转树的纵向坐标。
 *
 * 叶节点按可见顺序依次占据纵向槽位；展开的父节点位于首尾子树中心。
 * 这等价于把原本“深度向下、兄弟横排”的层级树逆时针旋转 90°，而不是
 * 把前序遍历结果画成带缩进的列表。
 */
export function assignTimetreeLayoutIndices(rows = []) {
  const rowByKey = new Map(rows.map((row) => [row.key, row]));
  const childrenByKey = new Map();
  const roots = [];
  for (const row of rows) {
    if (row.parentKey && rowByKey.has(row.parentKey)) {
      if (!childrenByKey.has(row.parentKey)) childrenByKey.set(row.parentKey, []);
      childrenByKey.get(row.parentKey).push(row);
    } else {
      roots.push(row);
    }
  }

  let nextLeafIndex = 0;
  const place = (row) => {
    const children = childrenByKey.get(row.key) || [];
    if (!children.length) {
      row.layoutIndex = nextLeafIndex;
      nextLeafIndex += 1;
      return row.layoutIndex;
    }
    const childIndices = children.map(place);
    row.layoutIndex = (childIndices[0] + childIndices[childIndices.length - 1]) / 2;
    return row.layoutIndex;
  };
  roots.forEach(place);
  return rows;
}

/**
 * 构建时间线树的可见节点（数组顺序仍为前序遍历，几何位置由 layoutIndex 决定）。
 * 每个节点对应左侧层级树的一个节点；非虚拟节点同时在右侧时间线拥有一条车道。
 *
 * 返回节点对象：{ key, entityId, title, depth, rowIndex, layoutIndex, isVirtual, childCount, expanded }
 * - key：展开状态使用的稳定键（制度组用分组 id，实体用 entity:<id>）
 * - rowIndex：稳定的前序顺序；layoutIndex：旋转树实际使用的纵向槽位
 * - childCount：被收起的下级数量（展开时为 0）
 */
export function buildTimetreeRows({
  entities = [],
  hierarchyEdges = [],
  category = "中央机构",
  collectiveIds = [],
  activeEntityIds = null,
  groupNames = [],
  expandedIds = new Set(),
} = {}) {
  const entityMap = new Map(entities.map((entity) => [entity.id, entity]));
  const collectiveSet = new Set(collectiveIds);
  const activeSet = activeEntityIds instanceof Set ? activeEntityIds : null;
  const eligible = (entity) => entity
    && entity.type === "机构"
    && defaultCategory(entity) === category
    && (!activeSet || activeSet.has(entity.id))
    && !collectiveSet.has(entity.id);

  const childrenByParent = new Map();
  const childIds = new Set();
  for (const edge of hierarchyEdges || []) {
    const parent = entityMap.get(edge.parent);
    const child = entityMap.get(edge.child);
    if (!eligible(parent) || !eligible(child)) continue;
    if (!childrenByParent.has(edge.parent)) childrenByParent.set(edge.parent, []);
    childrenByParent.get(edge.parent).push(edge.child);
    childIds.add(edge.child);
  }
  for (const ids of childrenByParent.values()) {
    ids.sort((a, b) => compareInstitutionIdsBySourceOrder(entityMap, a, b));
  }

  const rootIds = entities
    .filter((entity) => eligible(entity) && !childIds.has(entity.id))
    .map((entity) => entity.id)
    .sort((a, b) => compareInstitutionIdsBySourceOrder(entityMap, a, b));

  const rows = [];
  const visitEntity = (entityId, depth, visiting, parentKey = null) => {
    const entity = entityMap.get(entityId);
    if (!entity || visiting.has(entityId)) return;
    const nextVisiting = new Set(visiting).add(entityId);
    const children = (childrenByParent.get(entityId) || [])
      .filter((childId) => !nextVisiting.has(childId));
    const key = timetreeEntityKey(entityId);
    const expanded = expandedIds.has(key);
    rows.push({
      key,
      entityId,
      parentKey,
      rowIndex: rows.length,
      title: entity.title || `#${entityId}`,
      depth,
      isVirtual: false,
      childCount: expanded ? 0 : children.length,
      totalChildren: children.length,
      expanded,
    });
    if (expanded) {
      for (const childId of children) visitEntity(childId, depth + 1, nextVisiting, key);
    }
  };

  const groups = groupNames.length
    ? groupInstitutionRootIds(rootIds, entityMap, category, groupNames)
    : [{ group: "", rootIds }];

  const categoryKey = timetreeCategoryKey(category);
  const categoryExpanded = expandedIds.has(categoryKey);
  const categoryChildCount = groupNames.length ? groups.length : rootIds.length;
  rows.push({
    key: categoryKey,
    entityId: null,
    parentKey: null,
    rowIndex: rows.length,
    title: category,
    depth: 0,
    isVirtual: true,
    isCategoryRoot: true,
    isInstitutionGroup: false,
    childCount: categoryExpanded ? 0 : categoryChildCount,
    totalChildren: categoryChildCount,
    expanded: categoryExpanded,
  });

  if (!categoryExpanded) return assignTimetreeLayoutIndices(rows);

  for (const { group, rootIds: groupedRootIds } of groups) {
    if (!group) {
      for (const rootId of groupedRootIds) visitEntity(rootId, 1, new Set(), categoryKey);
      continue;
    }
    const key = timetreeGroupKey(category, group);
    const expanded = expandedIds.has(key);
    rows.push({
      key,
      entityId: null,
      parentKey: categoryKey,
      rowIndex: rows.length,
      title: group,
      depth: 1,
      isVirtual: true,
      isCategoryRoot: false,
      isInstitutionGroup: true,
      childCount: expanded ? 0 : groupedRootIds.length,
      totalChildren: groupedRootIds.length,
      expanded,
    });
    if (expanded) {
      for (const rootId of groupedRootIds) visitEntity(rootId, 2, new Set(), key);
    }
  }
  return assignTimetreeLayoutIndices(rows);
}

/** 非虚拟行的实体 id，按行顺序——右侧时间线车道的构建顺序。 */
export function timetreeLaneEntityIds(rows) {
  return rows.filter((row) => !row.isVirtual && row.entityId != null)
    .map((row) => row.entityId);
}

/**
 * 与层次结构视图一致的单路径展开：制度组互斥，机构只保留当前祖先路径；
 * 收起节点时移除它及所有已展开后代。
 */
export function toggleTimetreeExpansion(rows = [], currentKeys = [], clickedKey) {
  const rowByKey = new Map(rows.map((row) => [row.key, row]));
  const clicked = rowByKey.get(clickedKey);
  if (!clicked) return [...currentKeys];
  const current = new Set(currentKeys);

  if (!current.has(clickedKey)) {
    const path = [];
    let cursor = clicked;
    while (cursor) {
      path.push(cursor.key);
      cursor = cursor.parentKey ? rowByKey.get(cursor.parentKey) : null;
    }
    return path.reverse();
  }

  const removed = new Set([clickedKey]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (!removed.has(row.key) && row.parentKey && removed.has(row.parentKey)) {
        removed.add(row.key);
        changed = true;
      }
    }
  }
  return currentKeys.filter((key) => !removed.has(key));
}

/** 默认只展开类别根；第二层制度组由用户点击后再展开。 */
export function defaultTimetreeExpandedKeys({
  category = "中央机构",
} = {}) {
  return [timetreeCategoryKey(category)];
}
