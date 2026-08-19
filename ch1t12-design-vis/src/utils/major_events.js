export const STATIC_MAJOR_EVENT_TITLES = Object.freeze([
  "陈桥兵变",
  "雍熙北伐",
  "渲渊之盟",
  "澶渊之盟",
  "庆历新政",
  "熙宁变法",
  "平夏城之战",
  "横山之战",
  "靖康之难",
  "绍兴和议",
  "隆兴和议",
  "绍熙内禅",
  "开禧北伐",
  "端平更化",
  "压山海战",
  "崖山海战",
]);

export const MAJOR_EVENTS = Object.freeze([
  {
    id: "chenqiao-mutiny",
    title: "陈桥兵变",
    kind: "point",
    year: 960,
    originalTime: "后周显德七年（宋建隆元年）",
    certainty: "exact",
    source: {
      title: "《宋史》卷一《太祖本纪》",
      url: "https://zh.wikisource.org/wiki/宋史/卷001",
    },
  },
  {
    id: "yongxi-northern-expedition",
    title: "雍熙北伐",
    kind: "point",
    year: 986,
    originalTime: "雍熙三年",
    certainty: "exact",
    source: {
      title: "《宋史》卷五《太宗本纪》",
      url: "https://zh.wikisource.org/wiki/宋史/卷005",
    },
  },
  {
    id: "chanyuan-treaty",
    title: "澶渊之盟",
    kind: "point",
    year: 1004,
    originalTime: "景德元年十二月",
    certainty: "exact",
    source: {
      title: "《宋史》卷七《真宗本纪》",
      url: "https://zh.wikisource.org/wiki/宋史/卷007",
    },
  },
  {
    id: "qingli-reforms",
    title: "庆历新政",
    kind: "range",
    startYear: 1043,
    endYear: 1045,
    originalTime: "庆历三年至庆历五年",
    certainty: "bounded",
    source: {
      title: "《宋史》卷三百一十四《范仲淹传》",
      url: "https://zh.wikisource.org/wiki/宋史/卷314",
    },
  },
  {
    id: "xining-reforms",
    title: "熙宁变法",
    kind: "range",
    startYear: 1069,
    endYear: 1085,
    originalTime: "熙宁二年至元丰八年",
    certainty: "bounded",
    source: {
      title: "《宋史》卷三百二十七《王安石传》",
      url: "https://zh.wikisource.org/wiki/宋史/卷327",
    },
  },
  {
    id: "yuanfeng-bureaucratic-reform",
    title: "元丰改制",
    kind: "point",
    year: 1082,
    originalTime: "元丰五年",
    certainty: "exact",
    note: "标示新官制正式施行的年份；元丰三年开始详定，不另画与熙宁变法重叠的区间。",
    source: {
      title: "《宋史》卷十六《神宗本纪》及《职官志》",
      url: "https://zh.wikisource.org/wiki/宋史/卷016",
    },
  },
  {
    id: "pingxia-battle",
    title: "平夏城之战",
    kind: "point",
    year: 1096,
    originalTime: "绍圣三年",
    certainty: "exact",
    source: {
      title: "《宋史》卷三百四十九《姚雄传》",
      url: "https://zh.wikisource.org/wiki/宋史/卷349",
    },
  },
  {
    id: "jingkang-crisis",
    title: "靖康之难",
    kind: "range",
    startYear: 1125,
    endYear: 1127,
    originalTime: "宣和七年至靖康二年",
    certainty: "bounded",
    source: {
      title: "《宋史》卷二十三至卷二十四《钦宗本纪》",
      url: "https://zh.wikisource.org/wiki/宋史/卷024",
    },
  },
  {
    id: "shaoxing-treaty",
    title: "绍兴和议",
    kind: "point",
    year: 1141,
    originalTime: "绍兴十一年",
    certainty: "exact",
    note: "和议于绍兴十一年议定；次年完成后续正式程序。",
    source: {
      title: "《宋史》卷二十九《高宗本纪》",
      url: "https://zh.wikisource.org/wiki/宋史/卷029",
    },
  },
  {
    id: "longxing-treaty",
    title: "隆兴和议",
    kind: "point",
    year: 1164,
    originalTime: "隆兴二年十二月",
    certainty: "exact",
    source: {
      title: "《宋史》卷三十三《孝宗本纪》",
      url: "https://zh.wikisource.org/wiki/宋史/卷033",
    },
  },
  {
    id: "shaoxi-abdication",
    title: "绍熙内禅",
    kind: "point",
    year: 1194,
    originalTime: "绍熙五年",
    certainty: "exact",
    source: {
      title: "《宋史》卷三十六《光宗本纪》",
      url: "https://zh.wikisource.org/wiki/宋史/卷036",
    },
  },
  {
    id: "kaixi-northern-expedition",
    title: "开禧北伐",
    kind: "range",
    startYear: 1206,
    endYear: 1208,
    originalTime: "开禧二年至嘉定元年",
    certainty: "bounded",
    source: {
      title: "《宋史》卷三十八《宁宗本纪》",
      url: "https://zh.wikisource.org/wiki/宋史/卷038",
    },
  },
  {
    id: "duanping-reforms",
    title: "端平更化",
    kind: "point",
    year: 1234,
    originalTime: "端平元年",
    certainty: "start-only",
    note: "只标示端平改元后的更化起点，不把尚未核定的结束年份画成区间。",
    source: {
      title: "《宋史》卷四十一《理宗本纪》",
      url: "https://zh.wikisource.org/wiki/宋史/卷041",
    },
  },
  {
    id: "yamen-battle",
    title: "崖山海战",
    kind: "point",
    year: 1279,
    originalTime: "祥兴二年二月",
    certainty: "exact",
    source: {
      title: "《宋史》卷四十七《二王附》",
      url: "https://zh.wikisource.org/wiki/宋史/卷047",
    },
  },
]);

function integerYear(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) ? numeric : null;
}

export function normalizeMajorEvents(events, { yearMin = -Infinity, yearMax = Infinity } = {}) {
  if (!Array.isArray(events)) return [];
  const min = Number(yearMin);
  const max = Number(yearMax);
  return events
    .map((event) => {
      const kind = event?.kind === "range" ? "range" : "point";
      const startYear = integerYear(kind === "range" ? event?.startYear : event?.year);
      const endYear = integerYear(kind === "range" ? event?.endYear : event?.year);
      if (!event?.id || !event?.title || startYear == null || endYear == null || startYear > endYear) {
        return null;
      }
      return {
        ...event,
        kind,
        startYear,
        endYear,
        anchorYear: kind === "range" ? (startYear + endYear + 1) / 2 : startYear,
      };
    })
    .filter((event) => event && event.endYear >= min && event.startYear <= max)
    .sort((left, right) => left.startYear - right.startYear || left.endYear - right.endYear);
}

export function layoutMajorEventLabels(events, yearToX, {
  fontSize = 10.86,
  collisionGap = 4,
} = {}) {
  if (!Array.isArray(events) || typeof yearToX !== "function") return [];
  const layouts = events.map((event, index) => {
    const x = Number(yearToX(event.anchorYear));
    const width = Math.max(fontSize, Array.from(event.title || "").length * fontSize);
    return {
      event,
      index,
      x,
      width,
      left: x - width / 2,
      right: x + width / 2,
      row: 0,
    };
  });
  const rowRightEdges = [];
  for (const layout of [...layouts].sort((left, right) => left.x - right.x)) {
    let row = rowRightEdges.findIndex(
      (rightEdge) => layout.left >= rightEdge + collisionGap,
    );
    if (row < 0) row = rowRightEdges.length;
    layout.row = row;
    rowRightEdges[row] = layout.right;
  }
  return layouts.sort((left, right) => left.index - right.index);
}

export function majorEventTooltip(event) {
  if (!event) return "";
  const lines = [
    `${event.title}：${event.originalTime || `${event.startYear}年`}`,
    event.note,
    event.source?.title ? `依据：${event.source.title}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}
