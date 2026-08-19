import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evolutionEventVisualYear, layoutEvolutionModel } from "./evolution_layout.js";
import { buildEvolutionModel } from "./evolution_model.js";

const entity = (id, title = `实体${id}`) => ({ id, title, type: "机构" });
const timepoint = (id, year, event = "普通记载", overrides = {}) => ({
  id,
  time: year == null ? "未知" : String(year),
  event,
  prev_id: null,
  succ_id: null,
  time_type: year == null ? "undated" : "exact",
  year_start: year,
  year_end: year,
  lifecycle_effect: /始置|复置|沿置/.test(event)
    ? "activate"
    : (/罢/.test(event) ? "deactivate" : "preserve"),
  ...overrides,
});

describe("layoutEvolutionModel", () => {
  it("明确与模糊区间事件的图标锚在区间中点而不冒充端点", () => {
    assert.equal(evolutionEventVisualYear({
      timeType: "range", yearStart: 1000, yearEnd: 1020, effectiveYear: 1000,
    }), 1010);
    assert.equal(evolutionEventVisualYear({
      timeType: "bounded", yearStart: 1100, yearEnd: 1130, effectiveYear: 1130,
    }), 1115);
    assert.equal(evolutionEventVisualYear({
      timeType: "exact", yearStart: 1200, yearEnd: 1200, effectiveYear: 1200,
    }), 1200);

    const model = buildEvolutionModel({
      entities: [entity(1)],
      timepoints: {
        1: [
          timepoint(11, 1000, "时段记载", {
            time_type: "range", year_start: 1000, year_end: 1020,
          }),
          timepoint(12, 1130, "模糊时段记载", {
            time_type: "bounded", year_start: 1100, year_end: 1130,
          }),
        ],
      },
      changeRelations: [],
    }, [1]);
    const layout = layoutEvolutionModel(model);
    const xOf = (year) => layout.yearScale.range[0]
      + (year - layout.yearScale.domain[0])
        / (layout.yearScale.domain[1] - layout.yearScale.domain[0])
        * (layout.yearScale.range[1] - layout.yearScale.range[0]);
    const range = layout.lanes[0].events.find((event) => event.id === 11);
    const bounded = layout.lanes[0].events.find((event) => event.id === 12);

    assert.equal(range.effectiveYear, 1000);
    assert.equal(range.visualYear, 1010);
    assert.equal(range.baseX, xOf(1010));
    assert.equal(bounded.effectiveYear, 1130);
    assert.equal(bounded.visualYear, 1115);
    assert.equal(bounded.baseX, xOf(1115));
  });

  it("所有轨道、标签、事件和存续段都留在给定边界内", () => {
    const model = buildEvolutionModel({
      entities: [entity(1), entity(2), entity(3)],
      timepoints: {
        1: [timepoint(11, 960, "始置"), timepoint(12, 1279)],
        2: [timepoint(21, 1000, "始置"), timepoint(22, 1100)],
        3: [timepoint(31, 1050, "始置"), timepoint(32, 1200)],
      },
      changeRelations: [
        { id: 1, relation_type: "前后演变", source: 1, target: 2, source_timepoint_id: 12, target_timepoint_id: 21 },
        { id: 2, relation_type: "前后演变", source: 1, target: 3, source_timepoint_id: 12, target_timepoint_id: 31 },
      ],
    }, [1]);
    const bounds = { x: 560, y: 190, width: 1228, height: 630 };
    const layout = layoutEvolutionModel(model, bounds);

    assert.deepEqual(layout.yearScale.domain, [960, 1279]);
    for (const lane of layout.lanes) {
      assert.ok(lane.y >= bounds.y && lane.y <= bounds.y + bounds.height);
      assert.ok(lane.labelX >= bounds.x);
      assert.ok(lane.labelX + lane.labelMaxWidth <= layout.plotBounds.x);
      assert.ok(lane.trackStartX >= bounds.x);
      assert.ok(lane.trackEndX <= bounds.x + bounds.width);
      for (const event of lane.events) {
        assert.ok(event.baseX >= layout.plotBounds.x && event.baseX <= layout.plotBounds.right);
        assert.ok(event.displayX >= layout.plotBounds.x && event.displayX <= layout.plotBounds.right);
        assert.ok(event.y >= bounds.y && event.y <= bounds.y + bounds.height);
      }
      for (const segment of lane.segments) {
        assert.ok(segment.startX >= layout.plotBounds.x);
        assert.ok(segment.endX <= layout.plotBounds.right);
      }
    }
  });

  it("同年事件保留共同时间锚点，并在锚点周围二维错层", () => {
    const model = buildEvolutionModel({
      entities: [entity(1)],
      timepoints: {
        1: [
          timepoint(11, 1000, "始置", { succ_id: 12 }),
          timepoint(12, 1000, "普通记载", { prev_id: 11, succ_id: 13 }),
          timepoint(13, 1000, "又一记载", { prev_id: 12 }),
        ],
      },
      changeRelations: [],
    }, [1]);
    const layout = layoutEvolutionModel(model);
    const events = layout.lanes[0].events;

    assert.equal(new Set(events.map((item) => item.baseX)).size, 1);
    assert.equal(new Set(events.map((item) => `${item.displayX}:${item.displayY}`)).size, 3);
    assert.ok(events.some((item) => item.offsetY !== 0));
    for (const event of events) {
      assert.equal(event.displayX, event.baseX + event.offsetX);
      assert.equal(event.displayY, event.baseY + event.offsetY);
    }
    for (let index = 0; index < events.length; index += 1) {
      for (let otherIndex = index + 1; otherIndex < events.length; otherIndex += 1) {
        const deltaX = Math.abs(events[index].displayX - events[otherIndex].displayX);
        const deltaY = Math.abs(events[index].displayY - events[otherIndex].displayY);
        assert.ok(deltaX >= 16 || deltaY >= 16);
      }
    }
  });

  it("同年罢废三角优先留在真实年份与机构轨道的交点", () => {
    const model = buildEvolutionModel({
      entities: [entity(1)],
      timepoints: {
        1: [
          timepoint(11, 1082, "普通记载", { succ_id: 12 }),
          timepoint(12, 1082, "罢废", {
            prev_id: 11,
            event_type: "abolish",
            lifecycle_effect: "deactivate",
          }),
        ],
      },
      changeRelations: [],
    }, [1]);
    const events = layoutEvolutionModel(model).lanes[0].events;
    const record = events.find((event) => event.id === 11);
    const abolish = events.find((event) => event.id === 12);

    assert.equal(abolish.displayX, abolish.baseX);
    assert.equal(abolish.displayY, abolish.baseY);
    assert.equal(record.displayX, record.baseX);
    assert.notEqual(record.displayY, record.baseY);
  });

  it("邻近年份像素距离不足时也会错层，稀疏年份仍留在基线", () => {
    const model = buildEvolutionModel({
      entities: [entity(1)],
      timepoints: {
        1: [
          timepoint(11, 1000, "始置", { succ_id: 12 }),
          timepoint(12, 1001, "普通记载", { prev_id: 11, succ_id: 13 }),
          timepoint(13, 1002, "又一记载", { prev_id: 12, succ_id: 14 }),
          timepoint(14, 1100, "远期记载", { prev_id: 13 }),
        ],
      },
      changeRelations: [],
    }, [1]);
    const layout = layoutEvolutionModel(model);
    const events = layout.lanes[0].events;
    const denseEvents = events.filter((event) => event.effectiveYear <= 1002);
    const sparseEvent = events.find((event) => event.effectiveYear === 1100);

    assert.ok(denseEvents.some((event) => event.displaced));
    for (let index = 0; index < denseEvents.length; index += 1) {
      for (let otherIndex = index + 1; otherIndex < denseEvents.length; otherIndex += 1) {
        const deltaX = Math.abs(denseEvents[index].displayX - denseEvents[otherIndex].displayX);
        const deltaY = Math.abs(denseEvents[index].displayY - denseEvents[otherIndex].displayY);
        assert.ok(deltaX >= 16 || deltaY >= 16);
      }
    }
    assert.equal(sparseEvent.displayX, sparseEvent.baseX);
    assert.equal(sparseEvent.displayY, sparseEvent.baseY);
    assert.equal(sparseEvent.displaced, false);
  });

  it("关系端点按各自年份落位，异年显式关系组没有伪造共同时间", () => {
    const model = buildEvolutionModel({
      entities: [entity(1), entity(2)],
      timepoints: {
        1: [timepoint(11, 980, "始置")],
        2: [timepoint(21, 1000, "始置")],
      },
      changeRelations: [{
        id: 7,
        relation_type: "演变·改置",
        relation_group_id: "g7",
        source: 1,
        target: 2,
        source_timepoint_id: 11,
        target_timepoint_id: 21,
      }],
    }, [1]);
    const layout = layoutEvolutionModel(model);
    const relation = layout.relations[0];
    const group = layout.relationGroups[0];

    assert.notEqual(relation.sourcePoints[0].baseX, relation.targetPoints[0].baseX);
    assert.equal(group.junctionX, null);
    assert.equal(group.divergentEndpointYears, true);
    assert.equal(group.renderMode, "individual");
    assert.ok(Number.isFinite(relation.labelX));
    assert.ok(relation.leader);
    assert.equal(relation.labelVisible, true);
    assert.equal(relation.labelOverflow, false);
    assert.equal(group.labelVisible, false);
  });

  it("同年显式组标签与普通关系标签共同占位", () => {
    const model = buildEvolutionModel({
      entities: [entity(1), entity(2)],
      timepoints: {
        1: [timepoint(11, 1000, "始置")],
        2: [timepoint(21, 1000, "始置")],
      },
      changeRelations: [
        {
          id: 40,
          relation_type: "演变·分拆",
          relation_group_id: "g40",
          source: 1,
          target: 2,
          source_timepoint_id: 11,
          target_timepoint_id: 21,
        },
        {
          id: 41,
          relation_type: "演变·改称",
          source: 1,
          target: 2,
          source_timepoint_id: 11,
          target_timepoint_id: 21,
        },
      ],
    }, [1]);
    const layout = layoutEvolutionModel(model, { x: 10, y: 20, width: 320, height: 140 });
    const group = layout.relationGroups[0];
    const groupedRelation = layout.relations.find((relation) => relation.id === 40);
    const ordinaryRelation = layout.relations.find((relation) => relation.id === 41);

    assert.equal(group.renderMode, "group");
    assert.equal(group.labelVisible, true);
    assert.equal(groupedRelation.labelVisible, false);
    assert.equal(ordinaryRelation.labelVisible, true);
    const overlaps = group.labelBounds.x < ordinaryRelation.labelBounds.right
      && group.labelBounds.right > ordinaryRelation.labelBounds.x
      && group.labelBounds.y < ordinaryRelation.labelBounds.bottom
      && group.labelBounds.bottom > ordinaryRelation.labelBounds.y;
    assert.equal(overlaps, false);
  });

  it("共享端点的同标签关系归并为扇形，独立关系标签稳定且不重叠", () => {
    const relations = [
      { id: 20, relation_type: "前后演变", source: 1, target: 2, source_timepoint_id: 11, target_timepoint_id: 21 },
      { id: 21, relation_type: "前后演变", source: 1, target: 2, source_timepoint_id: 11, target_timepoint_id: 21 },
      { id: 22, relation_type: "前后演变", source: 1, target: 2, source_timepoint_id: 12, target_timepoint_id: 22 },
    ];
    const input = (changeRelations) => ({
      entities: [entity(1), entity(2)],
      timepoints: {
        1: [
          timepoint(11, 1000, "始置", { succ_id: 12 }),
          timepoint(12, 1001, "普通记载", { prev_id: 11 }),
        ],
        2: [
          timepoint(21, 1000, "始置", { succ_id: 22 }),
          timepoint(22, 1001, "普通记载", { prev_id: 21 }),
        ],
      },
      changeRelations,
    });
    const bounds = { x: 10, y: 20, width: 320, height: 140 };
    const first = layoutEvolutionModel(buildEvolutionModel(input(relations), [1]), bounds);
    const second = layoutEvolutionModel(buildEvolutionModel(input([...relations].reverse()), [1]), bounds);
    const ordinary = first.relations;

    // 完全共享源端点的 20/21 归并为一个扇形组，不再各占一个标签
    assert.equal(ordinary.length, 3);
    assert.equal(first.fanGroups.length, 1);
    const fan = first.fanGroups[0];
    assert.equal(fan.direction, "out");
    assert.deepEqual(fan.relations.map((relation) => relation.id).sort(), [20, 21]);
    const fanMemberIds = new Set(fan.relations.map((relation) => relation.id));
    for (const relation of ordinary) {
      if (fanMemberIds.has(relation.id)) {
        assert.equal(relation.labelVisible, false);
        continue;
      }
      assert.equal(relation.labelVisible, true);
      assert.equal(relation.labelOverflow, false);
      assert.ok(Number.isFinite(relation.labelX));
      assert.ok(Number.isFinite(relation.labelY));
      assert.ok(Number.isFinite(relation.leader.x1));
      assert.ok(Number.isFinite(relation.leader.y1));
      assert.equal(relation.leader.x1, relation.labelAnchorX);
      assert.equal(relation.leader.y1, relation.labelAnchorY);
      assert.ok(relation.labelBounds.x >= bounds.x);
      assert.ok(relation.labelBounds.right <= bounds.x + bounds.width);
      assert.ok(relation.labelBounds.y >= bounds.y);
      assert.ok(relation.labelBounds.bottom <= bounds.y + bounds.height);
    }

    // 扇形标签唯一、在界内，且不与独立关系标签重叠
    assert.equal(fan.labelVisible, true);
    assert.ok(fan.labelBounds.x >= bounds.x);
    assert.ok(fan.labelBounds.right <= bounds.x + bounds.width);
    assert.ok(fan.labelBounds.y >= bounds.y);
    assert.ok(fan.labelBounds.bottom <= bounds.y + bounds.height);
    const lone = ordinary.find((relation) => !fanMemberIds.has(relation.id));
    const fanOverlaps = fan.labelBounds.x < lone.labelBounds.right
      && fan.labelBounds.right > lone.labelBounds.x
      && fan.labelBounds.y < lone.labelBounds.bottom
      && fan.labelBounds.bottom > lone.labelBounds.y;
    assert.equal(fanOverlaps, false);

    // 输入顺序不影响布局结果
    const placementsById = (layout) => Object.fromEntries(layout.relations.map((relation) => [
      relation.id,
      [relation.labelX, relation.labelY, relation.leader],
    ]));
    assert.deepEqual(placementsById(first), placementsById(second));
    const fanPlacements = (layout) => layout.fanGroups.map((item) => [
      item.direction,
      item.relations.map((relation) => relation.id).sort(),
      item.labelX,
      item.labelY,
    ]);
    assert.deepEqual(fanPlacements(first), fanPlacements(second));

    // 重复 id 的不同证据关系共享端点时也稳定归并
    const duplicateIds = [
      { ...relations[0], id: 30, evidence_key: "R30-A", display_relation_type: "甲" },
      { ...relations[0], id: 30, evidence_key: "R30-B", display_relation_type: "乙" },
    ];
    const duplicateFirst = layoutEvolutionModel(
      buildEvolutionModel(input(duplicateIds), [1]),
      bounds,
    );
    const duplicateSecond = layoutEvolutionModel(
      buildEvolutionModel(input([...duplicateIds].reverse()), [1]),
      bounds,
    );
    const fanEvidence = (layout) => layout.fanGroups.map((item) => [
      item.relations.map((relation) => relation.evidenceKey).sort(),
      item.labelX,
      item.labelY,
    ]);
    assert.deepEqual(fanEvidence(duplicateFirst), fanEvidence(duplicateSecond));
  });

  it("一源多目的同年关系渲染为一个扇形主干加一组辐条", () => {
    const input = (changeRelations) => ({
      entities: [entity(1), entity(2), entity(3), entity(4)],
      timepoints: {
        1: [timepoint(11, 997, "析置")],
        2: [timepoint(21, 997, "始置")],
        3: [timepoint(31, 997, "始置")],
        4: [timepoint(41, 997, "始置")],
      },
      changeRelations,
    });
    const relations = [
      { id: 1, relation_type: "前后演变", source: 1, target: 2, source_timepoint_id: 11, target_timepoint_id: 21 },
      { id: 2, relation_type: "前后演变", source: 1, target: 3, source_timepoint_id: 11, target_timepoint_id: 31 },
      { id: 3, relation_type: "前后演变", source: 1, target: 4, source_timepoint_id: 11, target_timepoint_id: 41 },
      { id: 4, relation_type: "前后演变", source: 2, target: 1, source_timepoint_id: 21, target_timepoint_id: 11 },
    ];
    const bounds = { x: 10, y: 20, width: 640, height: 280 };
    const layout = layoutEvolutionModel(buildEvolutionModel(input(relations), [1]), bounds);

    assert.equal(layout.fanGroups.length, 1);
    const fan = layout.fanGroups[0];
    assert.equal(fan.direction, "out");
    assert.deepEqual(fan.relations.map((relation) => relation.id).sort(), [1, 2, 3]);
    // 辐条端点保持在各自真实年份与车道上，主干只做视觉收拢
    assert.equal(fan.spokes.length, 3);
    assert.ok(fan.top <= fan.hub.y && fan.bottom >= fan.hub.y);
    for (const spoke of fan.spokes) {
      assert.ok(Number.isFinite(spoke.x));
      assert.notEqual(spoke.y, fan.hub.y);
    }
    // 扇成员不单独出标签；未共享端点的关系 4 保留自己的标签
    for (const relation of layout.relations) {
      assert.equal(relation.labelVisible, relation.id === 4);
    }
    assert.equal(fan.labelVisible, true);
    const lone = layout.relations.find((relation) => relation.id === 4);
    const fanOverlaps = fan.labelBounds.x < lone.labelBounds.right
      && fan.labelBounds.right > lone.labelBounds.x
      && fan.labelBounds.y < lone.labelBounds.bottom
      && fan.labelBounds.bottom > lone.labelBounds.y;
    assert.equal(fanOverlaps, false);

    const reversed = layoutEvolutionModel(
      buildEvolutionModel(input([...relations].reverse()), [1]),
      bounds,
    );
    assert.equal(reversed.fanGroups.length, 1);
    assert.equal(reversed.fanGroups[0].labelX, fan.labelX);
    assert.equal(reversed.fanGroups[0].labelY, fan.labelY);
  });

  it("空间不足时隐藏溢出关系标签，不再强制叠放", () => {
    // 端点两两不同（不触发扇形归并），标签数量远超可用空间
    const changeRelations = Array.from({ length: 12 }, (_, index) => ({
      id: 100 + index,
      relation_type: "演变·改称",
      display_relation_type: "改称",
      source: 1,
      target: 2,
      source_timepoint_id: 1000 + index,
      target_timepoint_id: 2000 + index,
    }));
    const model = buildEvolutionModel({
      entities: [entity(1), entity(2)],
      timepoints: {
        1: Array.from({ length: 12 }, (_, index) => timepoint(1000 + index, 1000 + index, "始置")),
        2: Array.from({ length: 12 }, (_, index) => timepoint(2000 + index, 1000 + index, "始置")),
      },
      changeRelations,
    }, [1]);
    const layout = layoutEvolutionModel(model, { x: 0, y: 0, width: 100, height: 40 });
    assert.equal(layout.fanGroups.length, 0);
    const visible = layout.relations.filter((relation) => relation.labelVisible);
    const hidden = layout.relations.filter((relation) => !relation.labelVisible);

    assert.ok(visible.length > 0);
    assert.ok(hidden.length > 0);
    for (const relation of hidden) {
      assert.equal(relation.labelOverflow, true);
      assert.equal(relation.labelX, null);
      assert.equal(relation.labelY, null);
      assert.equal(relation.labelBounds, null);
      assert.equal(relation.leader, null);
    }
    for (let index = 0; index < visible.length; index += 1) {
      for (let otherIndex = index + 1; otherIndex < visible.length; otherIndex += 1) {
        const firstBox = visible[index].labelBounds;
        const secondBox = visible[otherIndex].labelBounds;
        const overlaps = firstBox.x < secondBox.right
          && firstBox.right > secondBox.x
          && firstBox.y < secondBox.bottom
          && firstBox.bottom > secondBox.y;
        assert.equal(overlaps, false);
      }
    }
  });

  it("无年端进入轴外栏，仍可与有年端绘制关系", () => {
    const model = buildEvolutionModel({
      entities: [entity(1), entity(2)],
      timepoints: {
        1: [timepoint(11, 980, "始置")],
        2: [timepoint(21, null, "年代未明")],
      },
      changeRelations: [{
        id: 8,
        relation_type: "职掌·移交",
        source: 1,
        target: 2,
        source_timepoint_id: 11,
        target_timepoint_id: 21,
      }],
    }, [1]);
    const layout = layoutEvolutionModel(model, { x: 10, y: 20, width: 300, height: 180 });
    const target = layout.relations[0].targetPoints[0];

    assert.ok(layout.offAxisBounds);
    assert.equal(target.offAxis, true);
    assert.equal(target.detailOnly, false);
    assert.ok(target.x >= layout.offAxisBounds.x && target.x <= layout.offAxisBounds.right);
    assert.ok(target.y >= layout.bounds.y && target.y <= layout.bounds.bottom);
    assert.equal(layout.relations[0].drawable, true);
    assert.equal(layout.offAxis.relationEndpoints[0].x, target.x);
  });

  it("关系组含无年端时不伪造共同时间", () => {
    const model = buildEvolutionModel({
      entities: [entity(1), entity(2)],
      timepoints: {
        1: [timepoint(11, 980, "始置")],
        2: [timepoint(21, null, "年代未明")],
      },
      changeRelations: [{
        id: 51,
        relation_type: "演变·分拆",
        relation_group_id: "partial-time",
        source: 1,
        target: 2,
        source_timepoint_id: 11,
        target_timepoint_id: 21,
      }],
    }, [1]);

    const group = layoutEvolutionModel(model).relationGroups[0];
    assert.equal(group.junctionX, null);
    assert.equal(group.divergentEndpointYears, false);
    assert.equal(group.renderMode, "individual");
    assert.equal(group.relations[0].labelVisible, true);
  });

  it("极窄边界仍不让标签、轨道和轴外栏越界", () => {
    const model = buildEvolutionModel({
      entities: [entity(1), entity(2)],
      timepoints: {
        1: [timepoint(11, 1000, "始置"), timepoint(12, null)],
        2: [timepoint(21, null, "年代未明")],
      },
      changeRelations: [{
        id: 61,
        relation_type: "职掌·移交",
        source: 1,
        target: 2,
        source_timepoint_id: 11,
        target_timepoint_id: 21,
      }],
    }, [1]);
    const layout = layoutEvolutionModel(model, { x: 4, y: 6, width: 100, height: 40 });

    assert.ok(layout.labelBounds.x >= layout.bounds.x);
    assert.ok(layout.labelBounds.x + layout.labelBounds.width <= layout.bounds.right);
    assert.ok(layout.plotBounds.x >= layout.bounds.x);
    assert.ok(layout.plotBounds.right <= layout.bounds.right);
    assert.ok(layout.offAxisBounds.x >= layout.bounds.x);
    assert.ok(layout.offAxisBounds.right <= layout.bounds.right);
    assert.ok(layout.lanes[0].events[0].displayX <= layout.bounds.right);
    const relation = layout.relations[0];
    if (relation.labelVisible) {
      assert.equal(relation.labelOverflow, false);
      assert.ok(relation.labelBounds.x >= layout.bounds.x);
      assert.ok(relation.labelBounds.right <= layout.bounds.right);
      assert.ok(relation.labelBounds.y >= layout.bounds.y);
      assert.ok(relation.labelBounds.bottom <= layout.bounds.bottom);
    } else {
      assert.equal(relation.labelOverflow, true);
      assert.equal(relation.labelBounds, null);
    }

    const tiny = layoutEvolutionModel(model, { x: 2, y: 3, width: 30, height: 10 });
    assert.ok(tiny.plotBounds.x >= tiny.bounds.x);
    assert.ok(tiny.plotBounds.right <= tiny.bounds.right);
    assert.equal(tiny.relations[0].labelVisible, false);
    assert.equal(tiny.relations[0].labelOverflow, true);
    assert.equal(tiny.relations[0].labelBounds, null);
  });
});
