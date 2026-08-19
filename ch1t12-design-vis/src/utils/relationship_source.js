function relationIdFromKey(key) {
  const match = /^R(\d+)$/.exec(String(key || ""));
  return match ? Number(match[1]) : null;
}

export function relationshipSourceOriginal(data = {}, evidenceKeys = []) {
  const relationIds = [...new Set(
    (evidenceKeys || []).map(relationIdFromKey).filter((id) => id != null),
  )];
  if (!relationIds.length) {
    return {
      status: "unavailable",
      count: 0,
      text: "当前变化没有可追溯的关系记录。",
    };
  }

  const sources = data.relationshipSources || {};
  if (relationIds.some((id) => !Object.prototype.hasOwnProperty.call(sources, String(id)))) {
    return {
      status: "loading",
      count: 0,
      text: "正在读取该关系的来源词条原文…",
    };
  }

  const records = relationIds.flatMap((id) => sources[String(id)] || []);
  const seenEntries = new Set();
  const originals = [];
  records.forEach((record) => {
    (record.entries || []).forEach((entry) => {
      const text = String(entry.originalText || entry.text || "").trim();
      if (!text) return;
      const key = `${entry.id || ""}|${entry.title || ""}|${entry.page || ""}|${text}`;
      if (seenEntries.has(key)) return;
      seenEntries.add(key);
      const page = entry.page == null || entry.page === "" ? "" : `（第${entry.page}页）`;
      originals.push(`《宋代官制辞典》“${entry.title || "未题名词条"}”${page}\n${text}`);
    });
  });
  if (originals.length) {
    return {
      status: "matched",
      count: originals.length,
      text: originals.map((text, index) => (
        `【来源词条${index + 1}】\n${text}`
      )).join("\n\n———————— 下一条来源词条 ————————\n\n"),
    };
  }

  const sourceLabels = [...new Set(records.map((record) => {
    const page = record.sourcePage ? `（第${record.sourcePage}页）` : "";
    return `${record.sourceEntry || "未标题来源"}${page}`;
  }))];
  return {
    status: "unmatched",
    count: 0,
    text: sourceLabels.length
      ? `构建记录标注来源为${sourceLabels.join("、")}，但未匹配到可展示的完整辞典词条原文。`
      : "该关系没有 BuildRecords 来源记录，无法展示完整词条原文。",
  };
}
