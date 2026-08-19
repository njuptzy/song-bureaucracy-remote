// 宋代年号按年末截面归属；交界年取该年后段已经生效的年号。
const SONG_ERA_RANGES = [
  ["建隆", 960, 963], ["乾德", 963, 968], ["开宝", 968, 976],
  ["太平兴国", 976, 984], ["雍熙", 984, 987], ["端拱", 988, 989],
  ["淳化", 990, 994], ["至道", 995, 997], ["咸平", 998, 1003],
  ["景德", 1004, 1007], ["大中祥符", 1008, 1016], ["天禧", 1017, 1021],
  ["乾兴", 1022, 1022], ["天圣", 1023, 1032], ["明道", 1032, 1033],
  ["景祐", 1034, 1038], ["宝元", 1038, 1040], ["康定", 1040, 1041],
  ["庆历", 1041, 1048], ["皇祐", 1049, 1054], ["至和", 1054, 1056],
  ["嘉祐", 1056, 1063], ["治平", 1064, 1067], ["熙宁", 1068, 1077],
  ["元丰", 1078, 1085], ["元祐", 1086, 1094], ["绍圣", 1094, 1098],
  ["元符", 1098, 1100], ["建中靖国", 1101, 1101], ["崇宁", 1102, 1106],
  ["大观", 1107, 1110], ["政和", 1111, 1118], ["重和", 1118, 1118],
  ["宣和", 1119, 1125], ["靖康", 1126, 1127], ["建炎", 1127, 1130],
  ["绍兴", 1131, 1162], ["隆兴", 1163, 1164], ["乾道", 1165, 1173],
  ["淳熙", 1174, 1189], ["绍熙", 1190, 1194], ["庆元", 1195, 1200],
  ["嘉泰", 1201, 1204], ["开禧", 1205, 1207], ["嘉定", 1208, 1224],
  ["宝庆", 1225, 1227], ["绍定", 1228, 1233], ["端平", 1234, 1236],
  ["嘉熙", 1237, 1240], ["淳祐", 1241, 1252], ["宝祐", 1253, 1258],
  ["开庆", 1259, 1259], ["景定", 1260, 1264], ["咸淳", 1265, 1274],
  ["德祐", 1275, 1276], ["景炎", 1276, 1278], ["祥兴", 1278, 1279],
];

export function songEraForYear(year, eras = null) {
  const numericYear = Number(year);
  if (!Number.isFinite(numericYear)) return "年代未明";
  const ranges = Array.isArray(eras) && eras.length
    ? eras
      .map((era) => [String(era?.name ?? "").trim(), Number(era?.start), Number(era?.end)])
      .filter(([, start, end]) => Number.isFinite(start) && Number.isFinite(end) && start <= end)
    : SONG_ERA_RANGES;
  const matches = ranges.filter(([, start, end]) => numericYear >= start && numericYear <= end);
  return matches.at(-1)?.[0] || "年代未明";
}

export function formatSongYearLabel(year, eras = null) {
  const numericYear = Number(year);
  if (!Number.isFinite(numericYear)) return "年代未明";
  return `${songEraForYear(numericYear, eras)}（${Math.round(numericYear)}年）`;
}
