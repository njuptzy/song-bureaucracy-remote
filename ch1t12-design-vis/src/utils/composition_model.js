// 编制视图（画板 4-02）的数据 join 模型。
// 设计稿语义：焦点机构只作为全图大号标题，不生成重复外框；它的直属机构
// （如尚书省吏部）各自成框，每列描边框 = 一个更下级机构，列内是竖排
// 机构名与按官职类型分轨的编制文本（如“郎中一人，书令史三十五人”）。
// 本模块只做纯数据组装，不碰 DOM、不算坐标（坐标见 composition_layout.js）。

// 分节的制度次序：吏户礼兵刑工优先，其余按中文标题排序。
// 画板 4-02 的空间阅读顺序：上排吏、户、礼、工，下排兵、刑。
const SECTION_ORDER_HINTS = ["吏部", "户部", "礼部", "工部", "兵部", "刑部"];

// staff_type 中属于"吏"序列的值，排序时排在官序列之后（设计稿先官额后吏额）。
const CLERK_TYPES = new Set(["吏", "公吏"]);

const CN_DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

export function quotaLabel(quota) {
  if (quota == null || quota === "") return "";
  const num = Number(quota);
  if (Number.isInteger(num) && num >= 1 && num <= 10) return `${CN_DIGITS[num]}人`;
  if (Number.isInteger(num) && num > 10) return `${num}人`;
  const text = String(quota).trim();
  if (!text) return "";
  return /员|人$/.test(text) ? text : `${text}人`;
}

// 原设计稿右下角只定义了四种官职视觉编码。数据库里大量 staff_type 仅写作
// “官”或直接写具体差遣名称，不能擅自把它们归为职事官；无法从原值确认时
// 使用 neutral，仍显示原始文字，但不冒充四类中的任何一类。
export function officialKindOf(staffType) {
  const value = String(staffType || "").trim();
  if (!value) return "neutral";
  if (/胥|吏/.test(value)) return "clerk";
  if (/差遣/.test(value)) return "dispatch";
  if (/阶官|散官|寄禄/.test(value)) return "rank";
  if (/职事官/.test(value)) return "duty";
  return "neutral";
}

function sectionOrderKey(title) {
  const index = SECTION_ORDER_HINTS.findIndex((hint) => String(title).includes(hint));
  return index < 0 ? SECTION_ORDER_HINTS.length : index;
}

// 同一官职可能因多个时间点出现多条编制隶属边：一个官职只占一个槽，
// 优先保留带员额的边（与 DesignTemplateCanvas.displayStaffFor 同规则）。
export function dedupeStaffEdges(edges, entityMap) {
  const byOfficial = new Map();
  for (const edge of edges || []) {
    const official = entityMap.get(edge.official);
    if (!official?.title?.trim() || official.type !== "官职") continue;
    const current = byOfficial.get(edge.official);
    if (!current || (!current.staff_quota && edge.staff_quota)) {
      byOfficial.set(edge.official, edge);
    }
  }
  return [...byOfficial.values()];
}

function compareStaffEdges(entityMap, titleOf) {
  return (a, b) => {
    const clerkA = CLERK_TYPES.has(a.staff_type) ? 1 : 0;
    const clerkB = CLERK_TYPES.has(b.staff_type) ? 1 : 0;
    if (clerkA !== clerkB) return clerkA - clerkB;
    const quotaA = Number(a.staff_quota);
    const quotaB = Number(b.staff_quota);
    const numA = Number.isFinite(quotaA) ? quotaA : -1;
    const numB = Number.isFinite(quotaB) ? quotaB : -1;
    if (numA !== numB) return numB - numA;
    return titleOf(a.official).localeCompare(titleOf(b.official), "zh");
  };
}

export function staffTextOf(edges, entityMap, titleOf, emptyText = "编制未载") {
  const staff = dedupeStaffEdges(edges, entityMap).sort(compareStaffEdges(entityMap, titleOf));
  const items = staff.map((edge) => {
    const quota = quotaLabel(edge.staff_quota);
    return {
      officialId: edge.official,
      title: titleOf(edge.official),
      quota,
      text: `${titleOf(edge.official)}${quota}`,
      kind: officialKindOf(edge.staff_type),
      staffType: edge.staff_type || "",
    };
  });
  return {
    staff,
    items,
    text: items.length ? items.map((item) => item.text).join("，") : emptyText,
  };
}

// focus 机构的编制视图模型：
// - selfColumn：focus 自身的直属编制（有编制才出现，设计稿里紧随大号标题）；
// - focusDirectLeaves：没有下级的直属机构，进入焦点主体的附属列带；
// - sections：有下级的直属机构，每个分节只把直接孩子作为 columns；
// - column.children：更深后代递归保留在直接父列内部，绝不 DFS 展平为同层列。
// 同一实体只进入第一个命中的层级位置（与 hierarchyLevels 的去重规则一致）。
export function buildCompositionModel({
  focusId,
  entityMap,
  childrenFor,
  staffFor,
  titleOf,
  emptyStaffText = "编制未载",
}) {
  const focus = entityMap.get(focusId);
  if (!focus) return null;

  const columnOf = (id) => {
    const { staff, items, text } = staffTextOf(
      staffFor(id), entityMap, titleOf, emptyStaffText
    );
    return { id, title: titleOf(id), staff, staffItems: items, staffText: text };
  };

  const childEdgesOf = (id) => {
    const byChild = new Map();
    for (const edge of childrenFor(id) || []) {
      const child = entityMap.get(edge.child);
      if (child?.type !== "机构" || byChild.has(edge.child)) continue;
      byChild.set(edge.child, edge);
    }
    return [...byChild.values()];
  };

  const sections = [];
  const focusDirectLeaves = [];

  const buildInstitutionNode = (edge, depth, parentId, parentPathKey, ancestors) => {
    const id = edge.child;
    if (ancestors.has(id)) return null;
    const pathKey = `${parentPathKey}/${edge.id ?? `${parentId}-${id}`}`;
    const node = {
      ...columnOf(id),
      edgeId: edge.id ?? null,
      depth,
      parentId,
      parentPathKey,
      pathKey,
      children: [],
    };
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(id);
    for (const childEdge of childEdgesOf(id)) {
      const child = buildInstitutionNode(childEdge, depth + 1, id, pathKey, nextAncestors);
      if (child) node.children.push(child);
    }
    return node;
  };

  const focusPathKey = `focus:${focusId}`;
  for (const childEdge of childEdgesOf(focusId)) {
    const node = buildInstitutionNode(
      childEdge, 0, focusId, focusPathKey, new Set([focusId])
    );
    if (!node) continue;
    if (!node.children.length) {
      focusDirectLeaves.push(node);
      continue;
    }
    sections.push({
      ...node,
      columns: node.children,
    });
  }

  sections.sort((a, b) => (
    sectionOrderKey(a.title) - sectionOrderKey(b.title)
    || a.title.localeCompare(b.title, "zh")
  ));

  const selfStaff = staffTextOf(staffFor(focusId), entityMap, titleOf, emptyStaffText);
  const selfColumn = selfStaff.staff.length
    ? {
      id: focusId,
      title: focus.title,
      staff: selfStaff.staff,
      staffItems: selfStaff.items,
      staffText: selfStaff.text,
    }
    : null;

  return {
    focus: { id: focusId, title: focus.title },
    selfColumn,
    focusDirectLeaves,
    // 兼容旧调用方读取；语义已改为焦点附属列，不再各自生成机构块。
    looseColumns: focusDirectLeaves,
    sections,
  };
}
