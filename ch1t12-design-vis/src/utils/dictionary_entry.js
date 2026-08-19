const ORIGINAL_SECTION_ORDER = [
  ["origin", "职源与沿革"],
  ["duty", "职掌"],
  ["rank", "品位"],
  ["composition", "编制"],
  ["aliases", "简称与别名"],
  ["children", "下级机构"],
  ["office", "衙署"],
];

export function dictionaryEntryText(dictionary = {}) {
  const parts = [];
  const head = String(dictionary.text || "").trim();
  if (head) parts.push(head);
  for (const [key, label] of ORIGINAL_SECTION_ORDER) {
    const value = String(dictionary[key] || "").trim();
    if (value) parts.push(`${label}：${value}`);
  }
  return parts.join("\n");
}
