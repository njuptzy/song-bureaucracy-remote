import assert from "node:assert/strict";
import test from "node:test";

import {
  buildYearSnapshot,
  classifyExistenceEffect,
  hierarchyEdgesWithoutCollectives,
} from "./snapshot.js";

function timepoint(id, year, event, extra = {}) {
  return {
    id,
    year_start: year,
    year_end: year,
    time_type: "exact",
    event,
    prev_id: null,
    ...extra,
  };
}

function dataFor(entity, timepoints, hierarchyEdges = []) {
  return {
    entities: [entity, { id: 2, title: "下级机构", type: "机构" }],
    timepoints: {
      [entity.id]: timepoints,
      2: [timepoint(20, 1000, "始置")],
    },
    hierarchyEdges,
    staffEdges: [],
    evolutionEdges: [],
    collectiveInstanceEdges: [],
  };
}

test("统称实体即使被误建为层级端点也不进入机构树", () => {
  const edges = [
    { id: 30, parent: 1, child: 2 },
    { id: 31, parent: 2, child: 3 },
    { id: 32, parent: 3, child: 4 },
  ];
  assert.deepEqual(
    hierarchyEdgesWithoutCollectives(edges, [2]),
    [{ id: 32, parent: 3, child: 4 }],
  );
});

test("罢废后的普通记载不会自动复活实体", () => {
  const entity = { id: 1, title: "朝集院", type: "机构" };
  const snapshot = buildYearSnapshot(dataFor(entity, [
    timepoint(10, 1001, "始置于京师朱雀门外，房舍百余区，旋罢"),
    timepoint(11, 1071, "朝集院房舍陆续拨归太学、律学、医学"),
  ]), 1071);
  assert.equal(snapshot.entityIds.has(1), false);
});

test("已有数值年的宋前时间仍不进入宋代截面", () => {
  const entity = { id: 1, title: "唐代机构", type: "机构" };
  const preSong = {
    ...timepoint(10, 618, "唐初设置"),
    time_type: "pre_song",
  };
  assert.equal(buildYearSnapshot(dataFor(entity, [preSong]), 1080).entityIds.has(1), false);
});

test("关系另一端有宋代年份时也不展示宋前端点", () => {
  const entity = { id: 1, title: "沿革机构", type: "机构" };
  const preSong = {
    ...timepoint(10, 618, "唐初设置"),
    time_type: "pre_song",
  };
  const hierarchyEdges = [{
    id: 30,
    parent: 1,
    child: 2,
    periods: [],
    states: [{ id: 30, subject_timepoint_id: 10, object_timepoint_id: 20 }],
  }];
  const snapshot = buildYearSnapshot(dataFor(entity, [preSong], hierarchyEdges), 1080);
  assert.equal(snapshot.entityIds.has(1), true);
  assert.equal(snapshot.currentTimepointByEntity.get(1), null);
});

test("前序模糊时间点上的关系证据不能越过后继废罢事件复活实体", () => {
  const entity = { id: 1, title: "编修所", type: "机构" };
  const hierarchyEdges = [{
    id: 30,
    parent: 1,
    child: 2,
    periods: [],
    states: [{ id: 30, subject_timepoint_id: 10, object_timepoint_id: 20 }],
  }];
  const data = dataFor(entity, [
    {
      ...timepoint(10, 1069, "编修法令"),
      year_end: 1077,
      time_type: "bounded",
      succ_id: 11,
    },
    timepoint(11, 1075, "废罢", { prev_id: 10 }),
  ], hierarchyEdges);
  assert.equal(buildYearSnapshot(data, 1074).entityIds.has(1), false);
  assert.equal(buildYearSnapshot(data, 1080).entityIds.has(1), false);
});

test("明确复置会重新激活此前罢废的实体", () => {
  const entity = { id: 1, title: "某院", type: "机构" };
  const snapshot = buildYearSnapshot(dataFor(entity, [
    timepoint(10, 1000, "始置"),
    timepoint(11, 1010, "罢"),
    timepoint(12, 1020, "复置"),
  ]), 1020);
  assert.equal(snapshot.entityIds.has(1), true);
});

test("复置行在机构会恢复原机构", () => {
  const entity = { id: 1, title: "同文馆", type: "机构" };
  const data = dataFor(entity, [
    timepoint(10, 1074, "创置"),
    timepoint(11, 1129, "罢废"),
    timepoint(12, 1133, "复置行在同文馆"),
  ]);
  assert.equal(buildYearSnapshot(data, 1129).entityIds.has(1), false);
  assert.equal(buildYearSnapshot(data, 1133).entityIds.has(1), true);
});

test("由旧名复改称为当前实体会重新激活", () => {
  const entity = { id: 1, title: "国子监", type: "机构" };
  const snapshot = buildYearSnapshot(dataFor(entity, [
    timepoint(10, 989, "改称国子学"),
    timepoint(11, 994, "由国子学复改称国子监", { prev_id: 10 }),
  ]), 1080);
  assert.equal(snapshot.entityIds.has(1), true);
});

test("分设机构重新合并仍为当前实体时会恢复", () => {
  const entity = { id: 1, title: "崇文院", type: "机构" };
  assert.equal(
    classifyExistenceEffect(timepoint(10, 1031, "内外院合并，仍为崇文院"), entity),
    "activate",
  );
});

test("新实体名称只含旧实体后缀时不能把旧实体激活", () => {
  const entity = { id: 1, title: "茶库", type: "机构" };
  assert.equal(
    classifyExistenceEffect(timepoint(10, 1003, "废罢，二库合并为都茶库"), entity),
    "deactivate",
  );
});

test("拟复置未果不会重新激活实体", () => {
  const entity = { id: 1, title: "某院", type: "机构" };
  const snapshot = buildYearSnapshot(dataFor(entity, [
    timepoint(10, 1000, "始置"),
    timepoint(11, 1010, "罢"),
    timepoint(12, 1020, "诏拟复置，因台官谏阻未果"),
  ]), 1020);
  assert.equal(snapshot.entityIds.has(1), false);
});

test("不复置等否定表达不能被内部的复置字样误判为恢复", () => {
  const entity = { id: 1, title: "某院", type: "机构" };
  assert.equal(classifyExistenceEffect(timepoint(10, 1020, "此后不复置"), entity), "deactivate");
  assert.notEqual(classifyExistenceEffect(timepoint(11, 1020, "未设置专门机构"), entity), "activate");
});

test("模糊时段的存废变化到区间上界才保守生效", () => {
  const entity = { id: 1, title: "某院", type: "机构" };
  const data = dataFor(entity, [
    timepoint(10, 1000, "始置"),
    {
      ...timepoint(11, 1010, "消亡"),
      year_end: 1015,
      time_type: "bounded",
    },
  ]);
  assert.equal(buildYearSnapshot(data, 1014).entityIds.has(1), true);
  assert.equal(buildYearSnapshot(data, 1015).entityIds.has(1), false);
});

test("单独一条模糊时段普通记载不足以断言实体存在", () => {
  const entity = { id: 1, title: "某院", type: "机构" };
  const data = dataFor(entity, [{
    ...timepoint(10, 1010, "掌管文书收发"),
    year_end: 1015,
    time_type: "bounded",
  }]);
  assert.equal(buildYearSnapshot(data, 1015).entityIds.has(1), false);
});

test("首次普通的同时代记载仍可作为存在证据", () => {
  const entity = { id: 1, title: "某院", type: "机构" };
  const snapshot = buildYearSnapshot(dataFor(entity, [
    timepoint(10, 1000, "掌管文书收发"),
  ]), 1000);
  assert.equal(snapshot.entityIds.has(1), true);
});

test("罢内部官职但机构之名犹存时不误杀机构", () => {
  const entity = { id: 1, title: "起居院", type: "机构" };
  assert.equal(
    classifyExistenceEffect(
      timepoint(10, 1082, "新官制下罢起居院同修起居注，但起居院之名犹存"),
      entity,
    ),
    "activate",
  );
});

test("罢下属机构不能终止上级机构", () => {
  const entity = { id: 1, title: "三司", type: "机构" };
  assert.equal(
    classifyExistenceEffect(timepoint(10, 1080, "罢帐司勾院磨勘提举司"), entity),
    "preserve",
  );
  assert.equal(
    classifyExistenceEffect(timepoint(11, 1082, "罢三司，职事归户部"), entity),
    "deactivate",
  );
});

test("不复置内部官职不能终止所属机构", () => {
  const entity = { id: 1, title: "太常寺", type: "机构" };
  assert.equal(
    classifyExistenceEffect(timepoint(10, 1052, "不复置职事主簿"), entity),
    "preserve",
  );
  assert.equal(
    classifyExistenceEffect(timepoint(11, 1052, "此后不复置"), entity),
    "deactivate",
  );
});

test("实体名只是内部官职前缀时不能视为实体自身被罢", () => {
  const entity = { id: 1, title: "太仆寺", type: "机构" };
  assert.equal(
    classifyExistenceEffect(timepoint(10, 1120, "罢太仆寺主簿一员，复为一员"), entity),
    "preserve",
  );
  assert.equal(
    classifyExistenceEffect(timepoint(11, 1121, "罢太仆寺，职事并归兵部驾部"), entity),
    "deactivate",
  );
});

test("下属机构改名不终止上级，省略主语的自身改制才终止", () => {
  const entity = { id: 1, title: "三司", type: "机构" };
  assert.equal(
    classifyExistenceEffect(timepoint(10, 1022, "征欠司改为蠲纳司"), entity),
    "preserve",
  );
  assert.equal(
    classifyExistenceEffect(timepoint(11, 993, "改为总计司"), entity),
    "deactivate",
  );
});

test("接收并入对象不会被当成接收方自身终止", () => {
  const entity = { id: 1, title: "审官院", type: "机构" };
  assert.equal(
    classifyExistenceEffect(timepoint(10, 993, "接收并入的差遣院"), entity),
    "preserve",
  );
});

test("端点实体罢废后对应关系也退出快照", () => {
  const entity = { id: 1, title: "上级机构", type: "机构" };
  const hierarchyEdges = [{
    id: 30,
    parent: 1,
    child: 2,
    periods: [],
    states: [{ id: 30, subject_timepoint_id: 10, object_timepoint_id: 20 }],
  }];
  const data = dataFor(entity, [
    timepoint(10, 1000, "始置"),
    timepoint(11, 1010, "罢", { prev_id: 10 }),
    timepoint(12, 1020, "旧址改作仓库", { prev_id: 11 }),
  ], hierarchyEdges);
  assert.equal(buildYearSnapshot(data, 1005).hierarchyEdges.length, 1);
  assert.equal(buildYearSnapshot(data, 1020).hierarchyEdges.length, 0);
});

test("有纪年的关系状态可证明无纪年上级在当年存在", () => {
  const parent = { id: 1, title: "上级机构", type: "机构" };
  const undatedParent = {
    id: 10,
    year_start: null,
    year_end: null,
    time_type: "undated",
    event: "下级机构的上级",
    prev_id: null,
  };
  const hierarchyEdges = [{
    id: 30,
    parent: 1,
    child: 2,
    periods: [],
    states: [{ id: 30, subject_timepoint_id: 10, object_timepoint_id: 20 }],
  }];
  const snapshot = buildYearSnapshot(dataFor(parent, [undatedParent], hierarchyEdges), 1000);
  assert.equal(snapshot.entityIds.has(1), true);
  assert.equal(snapshot.hierarchyEdges.length, 1);
});

test("关系存在证据不能越过同年或更晚的明确罢废", () => {
  const parent = { id: 1, title: "上级机构", type: "机构" };
  const hierarchyEdges = [{
    id: 30,
    parent: 1,
    child: 2,
    periods: [],
    states: [{ id: 30, subject_timepoint_id: 10, object_timepoint_id: 20 }],
  }];
  const data = dataFor(parent, [
    timepoint(10, 1000, "罢"),
  ], hierarchyEdges);
  assert.equal(buildYearSnapshot(data, 1000).entityIds.has(1), false);
});

test("明确罢废后更晚的旧关系证据也不能复活实体", () => {
  const parent = { id: 1, title: "名存实废机构", type: "机构" };
  const hierarchyEdges = [{
    id: 30,
    parent: 1,
    child: 2,
    periods: [],
    states: [{ id: 30, subject_timepoint_id: 12, object_timepoint_id: 20 }],
  }];
  const data = dataFor(parent, [
    timepoint(10, 960, "实体官署实废"),
    timepoint(12, 1009, "旧名义隶属记载", { prev_id: 10 }),
  ], hierarchyEdges);
  assert.equal(buildYearSnapshot(data, 1080).entityIds.has(1), false);
});

test("明确复置后关系证据可继续证明实体存在", () => {
  const parent = { id: 1, title: "重建机构", type: "机构" };
  const hierarchyEdges = [{
    id: 30,
    parent: 1,
    child: 2,
    periods: [],
    states: [{ id: 30, subject_timepoint_id: 12, object_timepoint_id: 20 }],
  }];
  const data = dataFor(parent, [
    timepoint(10, 960, "实体官署实废"),
    timepoint(11, 1070, "复置", { prev_id: 10 }),
    timepoint(12, 1071, "统领下属", { prev_id: 11 }),
  ], hierarchyEdges);
  assert.equal(buildYearSnapshot(data, 1080).entityIds.has(1), true);
  assert.equal(buildYearSnapshot(data, 1080).hierarchyEdges.length, 1);
});

test("临时机构只在原文明载的活动时间窗内显示", () => {
  const entity = { id: 1, title: "临时编修所", type: "机构" };
  const data = dataFor(entity, [
    timepoint(10, 1050, "始置", { attr_category: "临时机构" }),
    timepoint(11, 1053, "继续参定", { prev_id: 10, attr_category: "临时机构" }),
  ]);
  assert.equal(buildYearSnapshot(data, 1052).entityIds.has(1), true);
  assert.equal(buildYearSnapshot(data, 1080).entityIds.has(1), false);
});

test("临时机构多次开设之间的空档不被连成连续存在期", () => {
  const entity = { id: 1, title: "临时实录院", type: "机构" };
  const data = dataFor(entity, [
    timepoint(10, 998, "临时开设", { attr_category: "临时机构" }),
    timepoint(11, 1082, "遇修实录临时开设", { prev_id: 10, attr_category: "临时机构" }),
  ]);
  assert.equal(buildYearSnapshot(data, 998).entityIds.has(1), true);
  assert.equal(buildYearSnapshot(data, 1080).entityIds.has(1), false);
  assert.equal(buildYearSnapshot(data, 1082).entityIds.has(1), true);
});

test("单次存在证据只证明机构在记载年份存在，不作为持续创建时间", () => {
  const entity = { id: 1, title: "接收机构", type: "机构" };
  const data = dataFor(entity, [
    timepoint(10, 1071, "接收某院职事", { attr_category: "办事机构；单次存在证据" }),
  ]);
  assert.equal(buildYearSnapshot(data, 1070).entityIds.has(1), false);
  assert.equal(buildYearSnapshot(data, 1071).entityIds.has(1), true);
  assert.equal(buildYearSnapshot(data, 1080).entityIds.has(1), false);
});

test("罢废和废罢复合词明确终止当前实体", () => {
  const entity = { id: 1, title: "某司", type: "机构" };
  assert.equal(classifyExistenceEffect(timepoint(10, 1058, "废罢，归其他机构兼领"), entity), "deactivate");
  assert.equal(classifyExistenceEffect(timepoint(11, 1071, "罢废，职事归某寺"), entity), "deactivate");
});

test("复置若干日后又罢以最后的终止动作生效", () => {
  const entity = { id: 1, title: "鸿胪寺", type: "机构" };
  assert.equal(
    classifyExistenceEffect(timepoint(10, 1155, "复置十七日后又罢，此后不再置司"), entity),
    "deactivate",
  );
});

test("制度背景和终止语气后的罢置仍以当前实体为省略主语", () => {
  const entity = { id: 1, title: "提举司天监公事所", type: "机构" };
  assert.equal(classifyExistenceEffect(timepoint(10, 1082, "元丰改制后罢置"), entity), "deactivate");
  assert.equal(classifyExistenceEffect(timepoint(11, 1082, "新官制下罢置"), entity), "deactivate");
  assert.equal(classifyExistenceEffect(timepoint(12, 1082, "正式罢置"), entity), "deactivate");
  assert.equal(classifyExistenceEffect(timepoint(13, 1082, "随司天监罢置"), entity), "deactivate");
});

test("其他官职罢置不能误判为当前上级机构终止", () => {
  const entity = { id: 1, title: "太常寺", type: "机构" };
  assert.equal(classifyExistenceEffect(timepoint(10, 1129, "太常寺丞罢置"), entity), "preserve");
});

test("省略当前主语的合并和复分会终止来源实体", () => {
  const entity = { id: 1, title: "内剥马务", type: "机构" };
  assert.equal(
    classifyExistenceEffect(timepoint(10, 1072, "与外剥马务合为皮剥所"), entity),
    "deactivate",
  );
  assert.equal(
    classifyExistenceEffect(timepoint(11, 988, "复分为马军、步军粮料院"), entity),
    "deactivate",
  );
});

test("逗号后与其他子库合并沿用前句主语而不终止上级", () => {
  const entity = { id: 1, title: "左藏库", type: "机构" };
  assert.equal(
    classifyExistenceEffect(
      timepoint(10, 1009, "钱库、金银库、丝绵库合并，与生色匹库、杂色匹库合为三库"),
      entity,
    ),
    "preserve",
  );
});

test("分设下级时同一父端关系证明上级继续存在", () => {
  const entity = { id: 1, title: "内藏库", type: "机构" };
  const hierarchyEdges = [{
    id: 30,
    parent: 1,
    child: 2,
    periods: [],
    states: [{ id: 30, subject_timepoint_id: 10, object_timepoint_id: 20 }],
  }];
  const snapshot = buildYearSnapshot(dataFor(entity, [
    timepoint(10, 1015, "分为金银、珠玉香药、锦帛、钱四库"),
  ], hierarchyEdges), 1080);
  assert.equal(snapshot.entityIds.has(1), true);
  assert.equal(snapshot.entityIds.has(2), true);
  assert.equal(snapshot.hierarchyEdges.length, 1);
});

test("分设关系补在同一链后继节点时上级仍继续存在", () => {
  const entity = { id: 1, title: "左藏库", type: "机构" };
  const hierarchyEdges = [{
    id: 30,
    parent: 1,
    child: 2,
    periods: [],
    states: [{ id: 30, subject_timepoint_id: 11, object_timepoint_id: 20 }],
  }];
  const snapshot = buildYearSnapshot(dataFor(entity, [
    timepoint(10, 977, "分为三库", { succ_id: 11 }),
    timepoint(11, 993, "下分四类库藏", { prev_id: 10 }),
  ], hierarchyEdges), 1080);
  assert.equal(snapshot.entityIds.has(1), true);
  assert.equal(snapshot.hierarchyEdges.length, 1);
});

test("统一改称和避讳改为会终止旧实体", () => {
  const entity = { id: 1, title: "旧机构", type: "机构" };
  assert.equal(classifyExistenceEffect(timepoint(10, 1005, "统一改称监"), entity), "deactivate");
  assert.equal(classifyExistenceEffect(timepoint(11, 960, "避讳改为昭文馆"), entity), "deactivate");
  assert.equal(classifyExistenceEffect(timepoint(12, 994, "复改称国子监"), entity), "deactivate");
});

test("明确写实体官署实废时不被后续名号记载保留", () => {
  const entity = { id: 1, title: "进奏院", type: "机构" };
  assert.equal(
    classifyExistenceEffect(timepoint(10, 982, "诸州进奏院归并都进奏院，实体官署实废但各州朱记名仍存"), entity),
    "deactivate",
  );
});

test("空存其名的机构不显示，正式建置后恢复", () => {
  const entity = { id: 1, title: "尚食局", type: "机构" };
  assert.equal(classifyExistenceEffect(timepoint(10, 960, "空存其名，职事归御厨"), entity), "deactivate");
  assert.equal(classifyExistenceEffect(timepoint(11, 1103, "正式建置，供御膳羞"), entity), "activate");
});

test("有纪年后继生效后前序名称沿演变链全部退出", () => {
  const data = {
    entities: [
      { id: 1, title: "病坊", type: "机构" },
      { id: 2, title: "安乐坊", type: "机构" },
      { id: 3, title: "安济坊", type: "机构" },
    ],
    timepoints: {
      1: [timepoint(10, 1089, "始置")],
      2: [{ id: 20, year_start: null, year_end: null, time_type: "undated", event: "由病坊改名", prev_id: null }],
      3: [timepoint(30, 1104, "由安乐坊赐名")],
    },
    hierarchyEdges: [],
    staffEdges: [],
    evolutionEdges: [
      { source: 1, target: 2, states: [{ subject_timepoint_id: 11, object_timepoint_id: 20 }] },
      { source: 2, target: 3, states: [{ subject_timepoint_id: 21, object_timepoint_id: 30 }] },
    ],
  };
  assert.deepEqual([...buildYearSnapshot(data, 1089).entityIds], [1]);
  assert.deepEqual([...buildYearSnapshot(data, 1104).entityIds], [3]);
});

test("前序实体在演变后有更晚明确复置时可以恢复", () => {
  const data = dataFor({ id: 1, title: "旧名机构", type: "机构" }, [
    timepoint(10, 1000, "始置"),
    timepoint(11, 1020, "复置"),
  ]);
  data.entities.push({ id: 3, title: "后继机构", type: "机构" });
  data.timepoints[3] = [timepoint(30, 1010, "改置后成立")];
  data.evolutionEdges = [{
    source: 1,
    target: 3,
    states: [{ subject_timepoint_id: 10, object_timepoint_id: 30 }],
  }];
  assert.equal(buildYearSnapshot(data, 1010).entityIds.has(1), false);
  assert.equal(buildYearSnapshot(data, 1020).entityIds.has(1), true);
});

test("有纪年演变形成复归循环时不会在恢复当年再次删除原实体", () => {
  const data = {
    entities: [
      { id: 1, title: "三司", type: "机构" },
      { id: 2, title: "盐铁", type: "机构" },
    ],
    timepoints: {
      1: [
        timepoint(10, 960, "沿旧制设置"),
        timepoint(11, 983, "分为盐铁等三部", { prev_id: 10 }),
        timepoint(12, 1003, "三部重合为三司", { prev_id: 11 }),
      ],
      2: [
        timepoint(20, 983, "三司分部时置"),
        timepoint(21, 1003, "重合为三司", { prev_id: 20 }),
      ],
    },
    hierarchyEdges: [],
    staffEdges: [],
    evolutionEdges: [
      { source: 1, target: 2, states: [{ subject_timepoint_id: 11, object_timepoint_id: 20 }] },
      { source: 2, target: 1, states: [{ subject_timepoint_id: 21, object_timepoint_id: 12 }] },
    ],
  };
  assert.equal(buildYearSnapshot(data, 983).entityIds.has(1), false);
  assert.equal(buildYearSnapshot(data, 1003).entityIds.has(1), true);
  assert.equal(buildYearSnapshot(data, 1080).entityIds.has(1), true);
});

test("改隶后的新上级罢废时不会自动回退到旧上级，断档下级暂不显示", () => {
  const data = {
    entities: [
      { id: 1, title: "旧上级", type: "机构" },
      { id: 2, title: "新上级", type: "机构" },
      { id: 3, title: "下级机构", type: "机构" },
    ],
    timepoints: {
      1: [timepoint(10, 1000, "始置")],
      2: [
        timepoint(20, 1010, "始置"),
        timepoint(21, 1020, "废罢", { prev_id: 20 }),
      ],
      3: [timepoint(30, 1000, "始置")],
    },
    hierarchyEdges: [
      { id: 40, parent: 1, child: 3, periods: [], states: [{ id: 40, subject_timepoint_id: 10, object_timepoint_id: 30 }] },
      { id: 41, parent: 2, child: 3, periods: [], states: [{ id: 41, subject_timepoint_id: 20, object_timepoint_id: 30 }] },
    ],
    staffEdges: [],
    evolutionEdges: [],
  };
  assert.equal(buildYearSnapshot(data, 1005).hierarchyEdges[0]?.parent, 1);
  assert.equal(buildYearSnapshot(data, 1015).hierarchyEdges[0]?.parent, 2);
  const detached = buildYearSnapshot(data, 1020);
  assert.equal(detached.hierarchyEdges.length, 0);
  assert.equal(detached.entityIds.has(3), false);
  assert.equal(detached.entityIds.has(1), true);
});

test("层级断档会递归隐藏依附机构，但不影响从未有上级的中央机构", () => {
  const data = {
    entities: [
      { id: 1, title: "临时上级", type: "机构" },
      { id: 2, title: "断档下级", type: "机构" },
      { id: 3, title: "下下级", type: "机构" },
      { id: 4, title: "独立中央机构", type: "机构" },
    ],
    timepoints: {
      1: [
        timepoint(10, 1000, "始置"),
        timepoint(11, 1010, "废罢", { prev_id: 10 }),
      ],
      2: [timepoint(20, 1000, "始置")],
      3: [timepoint(30, 1000, "始置")],
      4: [timepoint(40, 1000, "始置")],
    },
    hierarchyEdges: [
      { id: 50, parent: 1, child: 2, periods: [], states: [{ id: 50, subject_timepoint_id: 10, object_timepoint_id: 20 }] },
      { id: 51, parent: 2, child: 3, periods: [], states: [{ id: 51, subject_timepoint_id: 20, object_timepoint_id: 30 }] },
    ],
    staffEdges: [],
    evolutionEdges: [],
  };
  const snapshot = buildYearSnapshot(data, 1010);
  assert.equal(snapshot.entityIds.has(1), false);
  assert.equal(snapshot.entityIds.has(2), false);
  assert.equal(snapshot.entityIds.has(3), false);
  assert.equal(snapshot.entityIds.has(4), true);
});

test("同一通用官职可以同时作为多个机构的编制", () => {
  const data = {
    entities: [
      { id: 1, title: "尚书省", type: "机构" },
      { id: 2, title: "中书省", type: "机构" },
      { id: 3, title: "驱使官", type: "官职" },
    ],
    timepoints: {
      1: [timepoint(10, 960, "宋前期设置")],
      2: [timepoint(20, 960, "宋前期设置")],
      3: [
        timepoint(30, 960, "尚书省驱使官三人"),
        timepoint(31, 960, "中书省驱使官三人"),
      ],
    },
    hierarchyEdges: [],
    staffEdges: [
      {
        id: 40,
        org: 1,
        official: 3,
        staff_quota: 3,
        staff_type: "吏",
        periods: [],
        states: [{ id: 40, subject_timepoint_id: 10, object_timepoint_id: 30 }],
      },
      {
        id: 41,
        org: 2,
        official: 3,
        staff_quota: 3,
        staff_type: "吏",
        periods: [],
        states: [{ id: 41, subject_timepoint_id: 20, object_timepoint_id: 31 }],
      },
    ],
    evolutionEdges: [],
    collectiveInstanceEdges: [],
  };
  const snapshot = buildYearSnapshot(data, 1080);
  assert.deepEqual(
    snapshot.staffEdges.map((edge) => [edge.org, edge.official]).sort(),
    [[1, 3], [2, 3]],
  );
});

test("新上级关系生效后，层级断档机构自动恢复显示", () => {
  const data = {
    entities: [
      { id: 1, title: "旧上级", type: "机构" },
      { id: 2, title: "下级机构", type: "机构" },
      { id: 3, title: "新上级", type: "机构" },
    ],
    timepoints: {
      1: [
        timepoint(10, 1000, "始置"),
        timepoint(11, 1010, "废罢", { prev_id: 10 }),
      ],
      2: [
        timepoint(20, 1000, "始置"),
        timepoint(21, 1020, "改隶新上级", { prev_id: 20 }),
      ],
      3: [timepoint(30, 1020, "始置")],
    },
    hierarchyEdges: [
      { id: 40, parent: 1, child: 2, periods: [], states: [{ id: 40, subject_timepoint_id: 10, object_timepoint_id: 20 }] },
      { id: 41, parent: 3, child: 2, periods: [], states: [{ id: 41, subject_timepoint_id: 30, object_timepoint_id: 21 }] },
    ],
    staffEdges: [],
    evolutionEdges: [],
  };
  assert.equal(buildYearSnapshot(data, 1015).entityIds.has(2), false);
  const restored = buildYearSnapshot(data, 1020);
  assert.equal(restored.entityIds.has(2), true);
  assert.equal(restored.hierarchyEdges[0]?.parent, 3);
});

test("存在未来上级关系的机构在关系生效前不提升为中央根节点", () => {
  const data = {
    entities: [
      { id: 1, title: "中央机构", type: "机构" },
      { id: 2, title: "待归属机构", type: "机构" },
      { id: 3, title: "未来上级", type: "机构" },
    ],
    timepoints: {
      1: [timepoint(10, 1000, "始置")],
      2: [timepoint(20, 1000, "始置")],
      3: [timepoint(30, 1020, "始置")],
    },
    hierarchyEdges: [
      { id: 40, parent: 3, child: 2, periods: [], states: [{ id: 40, subject_timepoint_id: 30, object_timepoint_id: 20 }] },
    ],
    staffEdges: [],
    evolutionEdges: [],
  };
  const beforeAffiliation = buildYearSnapshot(data, 1015);
  assert.equal(beforeAffiliation.entityIds.has(1), true);
  assert.equal(beforeAffiliation.entityIds.has(2), false);
  assert.equal(beforeAffiliation.entityIds.has(3), false);

  const affiliated = buildYearSnapshot(data, 1020);
  assert.equal(affiliated.entityIds.has(2), true);
  assert.equal(affiliated.hierarchyEdges[0]?.parent, 3);
});

test("附属机构关系叠加于基本隶属且随临时上级退出", () => {
  const data = {
    entities: [
      { id: 1, title: "基本上级", type: "机构" },
      { id: 2, title: "临时提举司", type: "机构" },
      { id: 3, title: "催驱司", type: "机构" },
    ],
    timepoints: {
      1: [timepoint(10, 1000, "始置")],
      2: [
        timepoint(20, 1010, "始置"),
        timepoint(21, 1020, "废罢", { prev_id: 20 }),
      ],
      3: [
        timepoint(30, 1000, "隶基本上级"),
        timepoint(31, 1010, "提举司附属机构", { prev_id: 30 }),
      ],
    },
    hierarchyEdges: [
      { id: 40, parent: 1, child: 3, periods: [], states: [{ id: 40, subject_timepoint_id: 10, object_timepoint_id: 30 }] },
      { id: 41, parent: 2, child: 3, periods: [], states: [{ id: 41, subject_timepoint_id: 20, object_timepoint_id: 31 }] },
    ],
    staffEdges: [],
    evolutionEdges: [],
  };
  assert.deepEqual(
    buildYearSnapshot(data, 1015).hierarchyEdges.map((edge) => edge.parent).sort(),
    [1, 2],
  );
  assert.deepEqual(
    buildYearSnapshot(data, 1020).hierarchyEdges.map((edge) => edge.parent),
    [1],
  );
});

test("演变分出后以仍为当前实体复归时重新进入截面", () => {
  const data = {
    entities: [
      { id: 1, title: "崇文院", type: "机构" },
      { id: 2, title: "崇文内院", type: "机构" },
    ],
    timepoints: {
      1: [
        timepoint(10, 978, "始以三馆为崇文院"),
        timepoint(11, 1015, "火灾后分建崇文内院", { prev_id: 10 }),
        timepoint(12, 1031, "内外院合并，仍为崇文院", { prev_id: 11 }),
      ],
      2: [
        timepoint(20, 1015, "始置"),
        timepoint(21, 1031, "并回崇文院", { prev_id: 20 }),
      ],
    },
    hierarchyEdges: [],
    staffEdges: [],
    evolutionEdges: [
      { source: 1, target: 2, states: [{ subject_timepoint_id: 11, object_timepoint_id: 20 }] },
      { source: 2, target: 1, states: [{ subject_timepoint_id: 21, object_timepoint_id: 12 }] },
    ],
  };
  assert.equal(buildYearSnapshot(data, 1020).entityIds.has(1), false);
  assert.equal(buildYearSnapshot(data, 1031).entityIds.has(1), true);
  assert.equal(buildYearSnapshot(data, 1080).entityIds.has(1), true);
});

test("统称改名时旧实例同步退出而新实例按自身时间点进入", () => {
  const data = {
    entities: [
      { id: 1, title: "南、北作坊", type: "机构" },
      { id: 2, title: "北作坊", type: "机构" },
      { id: 3, title: "东、西作坊", type: "机构" },
      { id: 4, title: "西作坊", type: "机构" },
    ],
    timepoints: {
      1: [timepoint(10, 976, "由作坊分为南作坊、北作坊"), timepoint(11, 1070, "改称东、西作坊", { prev_id: 10 })],
      2: [timepoint(20, 976, "由作坊分置")],
      3: [timepoint(30, 1070, "由南、北作坊改称")],
      4: [timepoint(40, 1070, "东、西作坊所指实例")],
    },
    hierarchyEdges: [],
    staffEdges: [],
    evolutionEdges: [
      { source: 1, target: 3, states: [{ subject_timepoint_id: 11, object_timepoint_id: 30 }] },
    ],
    collectiveInstanceEdges: [
      { collective: 1, instance: 2, states: [{ subject_timepoint_id: 10, object_timepoint_id: 20 }] },
      { collective: 3, instance: 4, states: [{ subject_timepoint_id: 30, object_timepoint_id: 40 }] },
    ],
  };
  assert.equal(buildYearSnapshot(data, 1069).entityIds.has(2), true);
  const renamed = buildYearSnapshot(data, 1070);
  assert.equal(renamed.entityIds.has(2), false);
  assert.equal(renamed.entityIds.has(4), true);
});

test("实例不继承统称的层级边，按自身证据作为独立节点保留", () => {
  const data = {
    entities: [
      { id: 1, title: "军器监", type: "机构" },
      { id: 2, title: "东、西作坊", type: "机构" },
      { id: 3, title: "西作坊", type: "机构" },
    ],
    timepoints: {
      1: [timepoint(10, 1082, "元丰新制")],
      2: [timepoint(20, 1070, "始称"), timepoint(21, 1082, "隶军器监", { prev_id: 20 })],
      3: [timepoint(30, 1070, "东、西作坊所指实例")],
    },
    hierarchyEdges: [
      { id: 40, parent: 1, child: 2, states: [{ subject_timepoint_id: 10, object_timepoint_id: 21 }] },
    ],
    staffEdges: [],
    evolutionEdges: [],
    collectiveEntityIds: [2],
    collectiveInstanceEdges: [
      { collective: 2, instance: 3, states: [{ subject_timepoint_id: 20, object_timepoint_id: 30 }] },
    ],
  };
  assert.equal(buildYearSnapshot(data, 1080).entityIds.has(3), true);
  const affiliated = buildYearSnapshot(data, 1082);
  assert.equal(affiliated.entityIds.has(2), true);
  assert.equal(affiliated.entityIds.has(3), true);
  assert.equal(affiliated.hierarchyEdges.length, 0);
});
