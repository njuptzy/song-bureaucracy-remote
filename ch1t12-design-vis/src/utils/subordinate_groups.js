export const THREE_DEPARTMENTS_GROUP_NAMES = [
  "三部与本司",
  "勾院与帐籍审核",
  "库藏与粮料",
  "营造与场务",
  "财税贸易与专务",
];

const THREE_DEPARTMENTS_GROUP_BY_TITLE = new Map([
  ...[
    "三司使厅", "盐铁", "度支", "户部", "留守司三司", "行在三司", "随驾三司",
  ].map((title) => [title, "三部与本司"]),
  ...[
    "三司二十四案", "三司催驱司", "三司勾凿司", "三司勾院", "三司发放司",
    "三司受事司", "三司度支勾院", "三司开拆司", "三司户部勾院",
    "三司承受御宝凭由司", "三司拘收司", "三司盐铁勾院", "三司都主辖支收司",
    "三司都凭由司", "三司都勾院", "三司都理欠、凭由司", "三司都理欠司",
    "三司都磨勘司", "三部凭由司", "勾簿司", "右计勾院", "左计勾院", "征欠司",
    "盐铁、户部勾院", "蠲纳司", "提举三司帐司、勾院磨勘司",
  ].map((title) => [title, "勾院与帐籍审核"]),
  ...[
    "在京粮料院", "左藏库", "布库", "步军粮料院", "祗候库", "粮料院",
    "马军粮料院", "诸司粮料院", "金耀门书库",
  ].map((title) => [title, "库藏与粮料"]),
  ...[
    "三司河渠司", "东、西八作司", "东、西窑务", "东水碾磨务", "东西退材场",
    "事材场", "京西河洛抽税竹木务", "作坊物料库", "南、北作坊", "四园苑",
    "大通门水磨务", "弓弩院", "水碾磨务", "西染院", "西水碾磨务",
  ].map((title) => [title, "营造与场务"]),
  ...[
    "三司推勘院", "三司衙司", "在京斗秤务", "课利司", "都商税院", "都提举市易司",
  ].map((title) => [title, "财税贸易与专务"]),
]);

export function subordinateGroupId(parentId, group) {
  return `subordinate-group:${parentId}:${group}`;
}

export function subordinateGroupFor(parentTitle, childTitle) {
  if (parentTitle !== "三司") return null;
  return THREE_DEPARTMENTS_GROUP_BY_TITLE.get(childTitle) || "财税贸易与专务";
}

export function buildSubordinateGroupNodes({
  parent,
  childIds,
  entityMap,
  expandedGroupIds = [],
  treeForChild,
}) {
  if (parent?.title !== "三司") return null;
  const grouped = new Map(THREE_DEPARTMENTS_GROUP_NAMES.map((group) => [group, []]));
  for (const childId of childIds) {
    const group = subordinateGroupFor(parent.title, entityMap.get(childId)?.title);
    grouped.get(group).push(childId);
  }
  const expanded = new Set(expandedGroupIds);
  return THREE_DEPARTMENTS_GROUP_NAMES
    .filter((group) => grouped.get(group).length)
    .map((group) => {
      const groupedChildIds = grouped.get(group);
      const id = subordinateGroupId(parent.id, group);
      const isExpanded = expanded.has(id);
      return {
        id,
        title: group,
        childCount: groupedChildIds.length,
        hiddenCount: isExpanded ? 0 : groupedChildIds.length,
        memberEntityIds: [...groupedChildIds],
        isVirtual: true,
        isSubordinateGroup: true,
        children: isExpanded
          ? groupedChildIds.map(treeForChild).filter(Boolean)
          : [],
      };
    });
}
