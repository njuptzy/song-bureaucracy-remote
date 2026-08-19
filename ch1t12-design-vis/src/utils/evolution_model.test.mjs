import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildEvolutionLanes, buildEvolutionModel, eventGlyphType } from "./evolution_model.js";

function entity(id, title = `实体${id}`, type = "机构") {
  return { id, title, type };
}

function timepoint(id, year, event, overrides = {}) {
  const timeType = overrides.time_type || (year == null ? "undated" : "exact");
  const lifecycleEffect = /始置|复置|沿置/.test(event)
    ? "activate"
    : (/罢/.test(event) ? "deactivate" : "preserve");
  return {
    id,
    time: year == null ? "未知" : String(year),
    event,
    prev_id: null,
    succ_id: null,
    time_type: timeType,
    year_start: year,
    year_end: year,
    lifecycle_effect: lifecycleEffect,
    ...overrides,
  };
}

function link(items) {
  return items.map((item, index) => ({
    ...item,
    prev_id: index ? items[index - 1].id : null,
    succ_id: index < items.length - 1 ? items[index + 1].id : null,
  }));
}

describe("eventGlyphType", () => {
  it("事件点形状只由 event_type 决定", () => {
    assert.equal(eventGlyphType("establish"), "establish");
    assert.equal(eventGlyphType("restore"), "establish");
    assert.equal(eventGlyphType("abolish"), "abolish");
    assert.equal(eventGlyphType("affiliation_change"), "affiliation_change");
    assert.equal(eventGlyphType("unknown_event_type"), "record");
    assert.equal(eventGlyphType("duty_transfer"), "record");
  });
});

describe("buildEvolutionModel hierarchy changes", () => {
  const hierarchyData = {
    entities: [
      entity(1, "甲司"),
      entity(2, "乙司"),
      entity(3, "丙署"),
    ],
    timepoints: {
      1: [timepoint(11, 1000, "甲司统属丙署")],
      2: [timepoint(21, 1050, "乙司统属丙署")],
      3: link([
        timepoint(31, 1000, "隶甲司"),
        timepoint(32, 1050, "改隶乙司", { quotation: "丙署自甲司改隶乙司" }),
      ]),
    },
    hierarchyEdges: [
      {
        id: 101,
        parent: 1,
        child: 3,
        states: [{ id: 101, subject_timepoint_id: 11, object_timepoint_id: 31 }],
      },
      {
        id: 102,
        parent: 2,
        child: 3,
        states: [{ id: 102, subject_timepoint_id: 21, object_timepoint_id: 32 }],
      },
    ],
    changeRelations: [],
  };

  function hierarchyEvents(focusId) {
    const model = buildEvolutionModel(hierarchyData, [focusId], { yearMin: 960, yearMax: 1279 });
    assert.deepEqual(model.visibleEntityIds, [focusId]);
    return model.lanes[0].events.filter((event) => event.structuralHierarchyChange);
  }

  it("被改隶机构显示原上级与新上级", () => {
    const [event] = hierarchyEvents(3);
    assert.equal(event.eventType, "affiliation_change");
    assert.equal(event.iconType, "affiliation_change");
    assert.equal(event.effectiveYear, 1050);
    assert.equal(event.hierarchyRole, "subject");
    assert.equal(event.event, "改隶乙司");
    assert.equal(event.hierarchyChangeLabel, "改隶事件：甲司 → 乙司");
    assert.equal(event.syntheticHierarchyChange, undefined);
    assert.deepEqual(event.evidenceKeys, ["R101", "R102", "T32"]);
  });

  it("原上级和新上级分别显示下属迁出与迁入", () => {
    const [former] = hierarchyEvents(1);
    const [next] = hierarchyEvents(2);
    assert.equal(former.hierarchyRole, "former_parent");
    assert.equal(former.event, "下属迁出：丙署 → 乙司");
    assert.equal(next.hierarchyRole, "new_parent");
    assert.equal(next.event, "下属迁入：丙署 ← 甲司");
  });

  it("同一年存在多个上级时不推断改隶", () => {
    const data = {
      entities: [
        entity(1, "甲司"),
        entity(2, "乙司"),
        entity(3, "丙署"),
        entity(4, "丁院"),
      ],
      timepoints: {
        1: [timepoint(11, 1000, "甲司统属丁院")],
        2: [timepoint(21, 1050, "乙司统属丁院")],
        3: [timepoint(31, 1050, "丙署统属丁院")],
        4: link([
          timepoint(41, 1000, "隶甲司"),
          timepoint(42, 1050, "同年有两项上下级记载"),
        ]),
      },
      hierarchyEdges: [
        { id: 101, parent: 1, child: 4, states: [{ id: 101, subject_timepoint_id: 11, object_timepoint_id: 41 }] },
        { id: 102, parent: 2, child: 4, states: [{ id: 102, subject_timepoint_id: 21, object_timepoint_id: 42 }] },
        { id: 103, parent: 3, child: 4, states: [{ id: 103, subject_timepoint_id: 31, object_timepoint_id: 42 }] },
      ],
      changeRelations: [],
    };

    for (const focusId of [1, 2, 3, 4]) {
      const model = buildEvolutionModel(data, [focusId], { yearMin: 960, yearMax: 1279 });
      assert.equal(
        model.lanes[0].events.some((event) => event.structuralHierarchyChange),
        false,
      );
    }
  });
});

describe("buildEvolutionModel lifecycle", () => {
  it("事件点形状与存续线状态使用各自字段", () => {
    const model = buildEvolutionModel({
      entities: [entity(1, "甲司")],
      timepoints: {
        1: [timepoint(11, 1082, "甲司被记为罢废事件", {
          event_type: "abolish",
          lifecycle_effect: "preserve",
        })],
      },
      changeRelations: [],
    }, [1], { yearMin: 960, yearMax: 1279 });

    assert.equal(model.lanes[0].events[0].iconType, "abolish");
    assert.equal(model.lanes[0].events[0].effect, "preserve");
    assert.deepEqual(
      model.lanes[0].segments.map(({ startYear, endYear, openStart, inferredStart }) => ({
        startYear, endYear, openStart, inferredStart,
      })),
      [{ startYear: 1082, endYear: 1279, openStart: true, inferredStart: true }],
    );
  });

  it("首个 preserve 证明当时已存在，并创建开放起点存续线", () => {
    const model = buildEvolutionModel({
      entities: [entity(1, "无始置记录司")],
      timepoints: {
        1: [timepoint(11, 1000, "元丰三年见于制度记载")],
      },
      changeRelations: [],
    }, [1], { yearMin: 960, yearMax: 1279 });

    assert.deepEqual(
      model.lanes[0].segments.map(({ startYear, endYear, openStart, openEnd, inferredStart }) => ({
        startYear, endYear, openStart, openEnd, inferredStart,
      })),
      [{ startYear: 1000, endYear: 1279, openStart: true, openEnd: true, inferredStart: true }],
    );
  });

  it("范围外的 activate 让存续线从视图左边界继续", () => {
    const model = buildEvolutionModel({
      entities: [entity(1, "后置司")],
      timepoints: {
        1: link([
          timepoint(11, 900, "沿革记载", { time_type: "pre_song" }),
          timepoint(12, 950, "始置"),
          timepoint(13, 1000, "普通记载"),
        ]),
      },
      changeRelations: [],
    }, [1], { yearMin: 960, yearMax: 1279 });

    const segment = model.lanes[0].segments[0];
    assert.equal(segment.startYear, 960);
    assert.equal(segment.openStart, true);
    assert.equal(segment.inferredStart, true);
  });

  it("此前 preserve 已证明存在，后续 activate 不会丢掉早期存续段", () => {
    const model = buildEvolutionModel({
      entities: [entity(1, "后明置司")],
      timepoints: {
        1: link([
          timepoint(11, 990, "普通记载"),
          timepoint(12, 1000, "始置"),
          timepoint(13, 1010, "罢后明置司"),
        ]),
      },
      changeRelations: [],
    }, [1], { yearMin: 960, yearMax: 1279 });

    assert.deepEqual(
      model.lanes[0].segments.map(({ startYear, endYear, inferredStart }) => ({
        startYear, endYear, inferredStart,
      })),
      [{ startYear: 990, endYear: 1010, inferredStart: true }],
    );
  });

  it("deactivate 后的 preserve 不会自动复活", () => {
    const model = buildEvolutionModel({
      entities: [entity(1, "已罢司")],
      timepoints: {
        1: link([
          timepoint(11, 1000, "普通记载"),
          timepoint(12, 1010, "罢已罢司"),
          timepoint(13, 1020, "后续记载"),
        ]),
      },
      changeRelations: [],
    }, [1], { yearMin: 960, yearMax: 1279 });

    assert.deepEqual(
      model.lanes[0].segments.map(({ startYear, endYear }) => ({ startYear, endYear })),
      [{ startYear: 1000, endYear: 1010 }],
    );
  });

  it("太常寺式：宋前 preserve 使存续线贯穿主时间轴", () => {
    const model = buildEvolutionModel({
      entities: [entity(174, "太常寺")],
      timepoints: {
        174: [timepoint(1742, 1000, "宋初记载", { prev_id: 1741 })],
      },
      preSongTimepoints: {
        174: [timepoint(1741, null, "宋前记载", {
          time: "宋前",
          time_type: "pre_song",
          lifecycle_effect: "preserve",
          succ_id: 1742,
        })],
      },
      changeRelations: [],
    }, [174], { yearMin: 960, yearMax: 1279 });

    assert.deepEqual(
      model.lanes[0].segments.map(({ startYear, endYear, openStart, openEnd }) => ({
        startYear, endYear, openStart, openEnd,
      })),
      [{ startYear: 960, endYear: 1279, openStart: true, openEnd: true }],
    );
  });

  it("光禄寺式：preserve、罢废、复置、再罢废产生两段存续线", () => {
    const model = buildEvolutionModel({
      entities: [entity(1992, "光禄寺")],
      timepoints: {
        1992: link([
          timepoint(19921, 960, "宋前期"),
          timepoint(19922, 1129, "并归礼部", { lifecycle_effect: "deactivate" }),
          timepoint(19923, 1153, "复置", { lifecycle_effect: "activate" }),
          timepoint(19924, 1163, "并入太常寺", { lifecycle_effect: "deactivate" }),
        ]),
      },
      changeRelations: [],
    }, [1992], { yearMin: 960, yearMax: 1279 });

    assert.deepEqual(
      model.lanes[0].segments.map(({ startYear, endYear }) => ({ startYear, endYear })),
      [
        { startYear: 960, endYear: 1129 },
        { startYear: 1153, endYear: 1163 },
      ],
    );
  });

  it("缺失或非法的 lifecycle_effect 不回退事件文字推断", () => {
    const model = buildEvolutionModel({
      entities: [entity(1, "字段缺失司")],
      timepoints: {
        1: [
          timepoint(11, 1000, "始置", { lifecycle_effect: undefined }),
          timepoint(12, 1010, "罢字段缺失司", { lifecycle_effect: "非法值" }),
        ],
      },
      changeRelations: [],
    }, [1]);

    assert.equal(model.lanes[0].events[0].effect, "ignore");
    assert.equal(model.lanes[0].events[1].effect, "ignore");
    assert.deepEqual(model.lanes[0].segments, []);
  });

  it("罢废后的普通记载不复活，明确复置才重开，bounded 在上界生效", () => {
    const points = link([
      timepoint(11, 970, "始置"),
      timepoint(12, 980, "罢甲司"),
      timepoint(13, 990, "普通记载"),
      timepoint(14, 1000, "复置"),
      timepoint(15, 1008, "罢甲司", {
        time: "1008至1010年间",
        time_type: "bounded",
        year_start: 1008,
        year_end: 1010,
      }),
      timepoint(16, 1020, "又有记载"),
    ]);
    const model = buildEvolutionModel({
      entities: [entity(1, "甲司")],
      timepoints: { 1: points },
      changeRelations: [],
    }, [1]);

    const lane = model.lanes[0];
    assert.deepEqual(
      lane.segments.map(({ startYear, endYear, openEnd }) => ({ startYear, endYear, openEnd })),
      [
        { startYear: 970, endYear: 980, openEnd: false },
        { startYear: 1000, endYear: 1010, openEnd: false },
      ],
    );
    assert.equal(lane.events.length, 6);
    assert.equal(lane.events.find((item) => item.id === 15).effectiveYear, 1010);
    assert.equal(lane.events.find((item) => item.id === 13).expanded, false);
    assert.equal(lane.events.find((item) => item.id === 14).expanded, true);
    assert.equal(lane.events.find((item) => item.id === 15).expanded, true);
  });

  it("宋前点不进入主轴，undated 与 unresolved 分桶且数据仍保留", () => {
    const points = link([
      timepoint(21, 900, "沿置", { time_type: "pre_song" }),
      timepoint(22, null, "年代未明记载", { time_type: "undated" }),
      timepoint(23, null, "时间待核查", { time_type: "unresolved" }),
      timepoint(24, 1000, "宋代记载"),
    ]);
    const model = buildEvolutionModel({
      entities: [entity(1)],
      timepoints: { 1: points.slice(1) },
      preSongTimepoints: { 1: points.slice(0, 1) },
      changeRelations: [],
    }, [1]);

    assert.deepEqual(model.lanes[0].events.map((item) => item.id), [24]);
    assert.deepEqual(model.offAxis.preSong.map((item) => item.id), [21]);
    assert.deepEqual(model.offAxis.undated.map((item) => item.id), [22]);
    assert.deepEqual(model.offAxis.unresolved.map((item) => item.id), [23]);
    assert.equal(model.lanes[0].segments[0].startYear, 960);
    assert.equal(model.lanes[0].segments[0].openStart, true);
    assert.equal(model.anomalies.some((item) => item.type === "dangling_chain_link"), false);
  });

  it("多个链头作为可选的局部顺序保留，不再视为异常", () => {
    const model = buildEvolutionModel({
      entities: [entity(1, "断链司")],
      timepoints: {
        1: [
          ...link([timepoint(31, 970, "始置"), timepoint(32, 980, "罢断链司")]),
          ...link([timepoint(33, 990, "复置"), timepoint(34, 1000, "罢断链司")]),
        ],
      },
      changeRelations: [],
    }, [1]);

    assert.equal(model.lanes[0].chains.length, 2);
    assert.deepEqual(
      model.lanes[0].segments.map(({ startYear, endYear }) => [startYear, endYear]),
      [[970, 980], [990, 1000]],
    );
    assert.equal(
      model.anomalies.some((item) => item.type === "multiple_chain_heads"),
      false,
    );
  });

  it("只警告不互认的链指针和违背明确年代的方向", () => {
    const model = buildEvolutionModel({
      entities: [entity(1, "逆序司")],
      timepoints: {
        1: [
          timepoint(41, 1010, "后期记载", { succ_id: 42 }),
          timepoint(42, 1000, "前期记载"),
        ],
      },
      changeRelations: [],
    }, [1]);

    const types = model.anomalies.map((item) => item.type);
    assert.ok(types.includes("nonreciprocal_chain_link"));
    assert.ok(types.includes("chronology_direction_conflict"));
  });
});

describe("buildEvolutionModel relations", () => {
  it("关系端点继承时间点图形类型以预留箭头间隔", () => {
    const model = buildEvolutionModel({
      entities: [entity(1), entity(2)],
      timepoints: {
        1: [timepoint(11, 1000, "普通记载")],
        2: [timepoint(21, 1010, "罢废", { event_type: "abolish" })],
      },
      changeRelations: [{
        id: 1,
        relation_type: "前后演变",
        source: 1,
        target: 2,
        source_timepoint_id: 11,
        target_timepoint_id: 21,
      }],
    }, [1]);

    assert.equal(model.relations[0].sourceMembers[0].iconType, "record");
    assert.equal(model.relations[0].targetMembers[0].iconType, "abolish");
  });

  it("changeRelations 优先，不猜关系子型，只对显式事件组字段分组", () => {
    const entities = Array.from({ length: 7 }, (_, index) => entity(index + 1));
    const timepoints = Object.fromEntries(entities.map(({ id }) => [
      id,
      link([
        timepoint(id * 10 + 1, 970, "始置"),
        timepoint(id * 10 + 2, 1100, "普通记载"),
      ]),
    ]));
    const model = buildEvolutionModel({
      entities,
      timepoints,
      changeRelations: [
        {
          id: 101,
          relation_type: "职掌·移交",
          source: 1,
          target: 5,
          source_timepoint_id: 12,
          target_timepoint_id: 52,
          quotation: "文字中即使出现改称，也不能据此改写子型",
        },
        {
          id: 102,
          relation_type: "演变·分拆",
          relation_group_id: "group-a",
          source: 2,
          target: 6,
          source_timepoint_id: 22,
          target_timepoint_id: 62,
        },
        {
          id: 103,
          relation_type: "演变·分拆",
          relation_group_id: "group-a",
          source: 2,
          target: 7,
          source_timepoint_id: 22,
          target_timepoint_id: 72,
        },
      ],
      evolutionEdges: [{ id: 999, source: 1, target: 3 }],
    }, [1, 2, 3, 4, 5]);

    assert.deepEqual(model.focusEntityIds, [1, 2, 3, 4]);
    assert.deepEqual(model.visibleEntityIds, [1, 2, 3, 4, 5, 6, 7]);
    assert.deepEqual(model.relations.map((item) => item.id), [101, 102, 103]);
    assert.equal(model.relations[0].relationType, "职掌·移交");
    assert.equal(model.relations[0].label, "职掌·移交");
    assert.equal(model.relationGroups.length, 1);
    assert.equal(model.relationGroups[0].groupId, "group-a");
    assert.deepEqual(model.relationGroups[0].relationIds, [102, 103]);
    assert.equal(model.relationGroups[0].targetMembers.length, 2);
    assert.equal(model.lanes.find((lane) => lane.entityId === 1).segments[0].openEnd, true);
    assert.equal(model.lanes.find((lane) => lane.entityId === 1).events.find((item) => item.id === 12).expanded, true);
  });

  it("可见实体彼此之间的演变关系被补全,但不引入新实体", () => {
    const entities = Array.from({ length: 4 }, (_, index) => entity(index + 1));
    const timepoints = Object.fromEntries(entities.map(({ id }) => [
      id,
      [timepoint(id * 10 + 1, 1000, "始置")],
    ]));
    const model = buildEvolutionModel({
      entities,
      timepoints,
      changeRelations: [
        { id: 1, relation_type: "前后演变", source: 1, target: 2, source_timepoint_id: 11, target_timepoint_id: 21 },
        { id: 2, relation_type: "前后演变", source: 1, target: 3, source_timepoint_id: 11, target_timepoint_id: 31 },
        // 邻居 2 与邻居 3 之间的关系:两端都不含焦点,但都在可见集合内
        { id: 3, relation_type: "前后演变", source: 2, target: 3, source_timepoint_id: 21, target_timepoint_id: 31 },
        // 端点含集合外实体 9 的关系不补全
        { id: 4, relation_type: "前后演变", source: 2, target: 9, source_timepoint_id: 21, target_timepoint_id: 91 },
      ],
    }, [1]);
    assert.deepEqual(model.relations.map((item) => item.id).sort(), [1, 2, 3]);
    assert.deepEqual(new Set(model.visibleEntityIds), new Set([1, 2, 3]));
    assert.equal(model.lanes.length, 3);
  });

  it("车道按演变关系做重心排序：互相关联的实体聚到相邻位置", () => {
    const entities = Array.from({ length: 6 }, (_, index) => entity(index + 1));
    const timepoints = Object.fromEntries(entities.map(({ id }) => [
      id,
      [timepoint(id * 10 + 1, 1000, "始置")],
    ]));
    const input = (changeRelations) => ({
      entities,
      timepoints,
      changeRelations,
    });
    // 2/3/4 既直连焦点又互相关联成一簇;5 只与焦点 1 相连(叶子)
    const relations = [
      { id: 1, relation_type: "前后演变", source: 1, target: 5, source_timepoint_id: 11, target_timepoint_id: 51 },
      { id: 2, relation_type: "前后演变", source: 1, target: 2, source_timepoint_id: 11, target_timepoint_id: 21 },
      { id: 3, relation_type: "前后演变", source: 1, target: 3, source_timepoint_id: 11, target_timepoint_id: 31 },
      { id: 4, relation_type: "前后演变", source: 1, target: 4, source_timepoint_id: 11, target_timepoint_id: 41 },
      { id: 5, relation_type: "前后演变", source: 2, target: 3, source_timepoint_id: 21, target_timepoint_id: 31 },
      { id: 6, relation_type: "前后演变", source: 3, target: 4, source_timepoint_id: 31, target_timepoint_id: 41 },
      { id: 7, relation_type: "前后演变", source: 2, target: 4, source_timepoint_id: 21, target_timepoint_id: 41 },
    ];
    const model = buildEvolutionModel(input(relations), [1]);
    const order = model.lanes.map((lane) => lane.entityId);

    // 焦点车道固定在首位;只连焦点的叶子 5 紧邻焦点(连线最短);
    // 互相关联的 2/3/4 占据连续位置
    assert.equal(order[0], 1);
    assert.equal(order[1], 5);
    assert.deepEqual(new Set(order.slice(2)), new Set([2, 3, 4]));
    // 同输入重排结果稳定
    const again = buildEvolutionModel(input(relations), [1]);
    assert.deepEqual(again.lanes.map((lane) => lane.entityId), order);
  });

  it("多个焦点车道保持用户给定顺序且不被排序移动", () => {
    const entities = Array.from({ length: 4 }, (_, index) => entity(index + 1));
    const timepoints = Object.fromEntries(entities.map(({ id }) => [
      id,
      [timepoint(id * 10 + 1, 1000, "始置")],
    ]));
    const model = buildEvolutionModel({
      entities,
      timepoints,
      changeRelations: [
        { id: 1, relation_type: "前后演变", source: 4, target: 3, source_timepoint_id: 41, target_timepoint_id: 31 },
        { id: 2, relation_type: "前后演变", source: 1, target: 4, source_timepoint_id: 11, target_timepoint_id: 41 },
      ],
    }, [3, 1]);
    assert.deepEqual(model.lanes.map((lane) => lane.entityId).slice(0, 2), [3, 1]);
  });

  it("缺少 relation_group_id 时使用显式 change_event_id 合成同一事件组", () => {
    const model = buildEvolutionModel({
      entities: [entity(1), entity(2), entity(3)],
      timepoints: {
        1: [timepoint(11, 1000, "始置")],
        2: [timepoint(21, 1000, "始置")],
        3: [timepoint(31, 1000, "始置")],
      },
      changeRelations: [
        {
          id: 201,
          relation_type: "演变·分拆",
          change_event_id: 88,
          source: 1,
          target: 2,
          source_timepoint_id: 11,
          target_timepoint_id: 21,
        },
        {
          id: 202,
          relation_type: "演变·分拆",
          change_event_id: 88,
          source: 1,
          target: 3,
          source_timepoint_id: 11,
          target_timepoint_id: 31,
        },
        {
          id: 203,
          relation_type: "演变·改置",
          change_event_id: 99,
          source: 2,
          target: 3,
          source_timepoint_id: 21,
          target_timepoint_id: 31,
        },
      ],
    }, [1, 2]);

    assert.equal(model.relationGroups.length, 1);
    assert.equal(model.relationGroups[0].groupId, 88);
    assert.deepEqual(model.relationGroups[0].relationIds, [201, 202]);
    assert.equal(model.relations.find((relation) => relation.id === 203).groupId, null);
  });

  it("缺少 changeRelations 时旧 evolutionEdges 仅作为未分类前后演变", () => {
    const model = buildEvolutionModel({
      entities: [entity(1), entity(2)],
      timepoints: {
        1: [timepoint(11, 980, "始置")],
        2: [timepoint(21, 990, "始置")],
      },
      evolutionEdges: [{
        id: 88,
        source: 1,
        target: 2,
        states: [{ id: 88, subject_timepoint_id: 11, object_timepoint_id: 21 }],
      }],
    }, [1]);

    assert.equal(model.relations.length, 1);
    assert.equal(model.relations[0].relationType, "前后演变");
    assert.equal(model.relations[0].label, "前后演变（未分类）");
    assert.equal(model.relationGroups.length, 0);
    assert.deepEqual(model.visibleEntityIds, [1, 2]);
  });

  it("关系两端保留各自年份，无年端进入 offAxis，关系不改变生命周期", () => {
    const model = buildEvolutionModel({
      entities: [entity(1, "来源司"), entity(2, "接收司")],
      timepoints: {
        1: link([timepoint(11, 970, "始置"), timepoint(12, 980, "普通记载")]),
        2: [timepoint(21, null, "年代未明", { time_type: "undated" })],
      },
      changeRelations: [{
        id: 77,
        relation_type: "职掌·移交",
        source: 1,
        target: 2,
        source_timepoint_id: 12,
        target_timepoint_id: 21,
      }],
    }, [1]);

    const relation = model.relations[0];
    assert.equal(relation.sourceYear, 980);
    assert.equal(relation.targetYear, null);
    assert.equal(model.offAxis.relationEndpoints.length, 1);
    assert.equal(model.offAxis.relationEndpoints[0].role, "target");
    assert.equal(model.lanes.find((lane) => lane.entityId === 1).segments[0].endYear, 1279);
    assert.equal(model.lanes.find((lane) => lane.entityId === 1).segments[0].openEnd, true);
  });

  it("读取后端显式关系子型和被作用域过滤端点的独立时间", () => {
    const model = buildEvolutionModel({
      entities: [entity(1, "宋前旧司"), entity(2, "宋代新司")],
      timepoints: {
        1: [],
        2: [],
      },
      changeRelations: [{
        id: 91,
        relation_type: "前后演变",
        relation_subtype: "演变·合并",
        display_relation_type: "合并",
        classification_status: "classified",
        evidence_key: "R91",
        source: 1,
        target: 2,
        source_timepoint_id: 11,
        target_timepoint_id: 21,
        source_time: {
          time_type: "pre_song",
          year_start: 900,
          year_end: 900,
          raw_time: "唐末",
        },
        target_time: {
          time_type: "exact",
          year_start: 980,
          year_end: 980,
          raw_time: "太平兴国五年",
        },
      }],
    }, [2]);

    const relation = model.relations[0];
    assert.equal(relation.relationType, "演变·合并");
    assert.equal(relation.relationSubtype, "演变·合并");
    assert.equal(relation.label, "合并");
    assert.equal(relation.implementationStatus, "classified");
    assert.equal(relation.evidenceKey, "R91");
    assert.equal(relation.sourceMembers[0].timeType, "pre_song");
    assert.equal(relation.sourceMembers[0].yearStart, 900);
    assert.equal(relation.sourceMembers[0].effectiveYear, null);
    assert.equal(relation.sourceMembers[0].rawTime, "唐末");
    assert.equal(relation.targetMembers[0].rawTime, "太平兴国五年");
    assert.equal(model.offAxis.relationEndpoints[0].timeType, "pre_song");
  });
});

describe("buildEvolutionLanes（时间线树专用）", () => {
  const laneTimepoint = (id, entityId, year) => ({
    id,
    entity_id: entityId,
    time: String(year),
    event: `事件${id}`,
    prev_id: null,
    succ_id: null,
    time_type: "exact",
    year_start: year,
    year_end: year,
    lifecycle_effect: "preserve",
  });

  it("实体数量不受 4 个上限截断，车道保持输入顺序", () => {
    const entities = [1, 2, 3, 4, 5, 6].map((id) => entity(id, `机构${id}`));
    const model = buildEvolutionLanes({
      entities,
      timepoints: Object.fromEntries(
        entities.map(({ id }) => [id, [laneTimepoint(id * 10 + 1, id, 1000 + id)]]),
      ),
      changeRelations: [],
    }, [6, 4, 2, 5, 1, 3], { yearMin: 960, yearMax: 1279 });
    assert.deepEqual(model.lanes.map((lane) => lane.entityId), [6, 4, 2, 5, 1, 3]);
  });

  it("只保留两端实体都在集合内的关系", () => {
    const model = buildEvolutionLanes({
      entities: [entity(1, "甲司"), entity(2, "乙司"), entity(3, "丙司")],
      timepoints: {
        1: [laneTimepoint(11, 1, 1000)],
        2: [laneTimepoint(21, 2, 1010)],
        3: [laneTimepoint(31, 3, 1020)],
      },
      changeRelations: [
        {
          id: 91,
          relation_type: "前后演变",
          source: 1,
          target: 2,
          source_timepoint_id: 11,
          target_timepoint_id: 21,
        },
        {
          id: 92,
          relation_type: "前后演变",
          source: 2,
          target: 3,
          source_timepoint_id: 21,
          target_timepoint_id: 31,
        },
      ],
    }, [1, 2], { yearMin: 960, yearMax: 1279 });
    assert.deepEqual(model.relations.map((relation) => relation.id), [91]);
    assert.ok(model.lanes[0].events[0].relationEndpoint);
  });
});
