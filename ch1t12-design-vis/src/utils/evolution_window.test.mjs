import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { windowEvolutionModel } from "./evolution_window.js";

function lane(entityId) {
  return { entityId, title: `实体${entityId}`, events: [], offAxisEvents: [] };
}

function member(entityId, relationId, role) {
  return { entityId, relationId, role, timepointId: entityId * 10 };
}

function relation(id, sourceEntityId, targetEntityId, groupId = null) {
  const source = member(sourceEntityId, id, "source");
  const target = member(targetEntityId, id, "target");
  return {
    id,
    key: `relation:${id}`,
    groupId,
    sourceEntityId,
    targetEntityId,
    members: [source, target],
    sourceMembers: [source],
    targetMembers: [target],
  };
}

function model({ focusEntityIds, laneIds, relations = [], relationGroups = [], offAxis = {} }) {
  return {
    focusEntityIds,
    visibleEntityIds: laneIds,
    lanes: laneIds.map(lane),
    relations,
    relationGroups,
    offAxis: {
      undated: [],
      unresolved: [],
      preSong: [],
      outsideRange: [],
      relationEndpoints: [],
      ...offAxis,
    },
    anomalies: [],
    yearMin: 960,
    yearMax: 1279,
  };
}

describe("windowEvolutionModel lane pagination", () => {
  it("单体模型保持原轨道并返回一页元数据", () => {
    const input = model({ focusEntityIds: [1], laneIds: [1] });
    const result = windowEvolutionModel(input);

    assert.deepEqual(result.lanes.map((item) => item.entityId), [1]);
    assert.deepEqual(result.laneWindow, {
      page: 1,
      pageCount: 1,
      totalLanes: 1,
      visibleLanes: 1,
      hiddenLanes: 0,
    });
    assert.equal(input.laneWindow, undefined);
  });

  it("四个焦点固定保留，剩余关联轨道使用剩余容量分页", () => {
    const input = model({
      focusEntityIds: [1, 2, 3, 4],
      laneIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    });

    const first = windowEvolutionModel(input, 1, 8);
    const second = windowEvolutionModel(input, { page: 2, maxLanes: 8 });

    assert.deepEqual(first.lanes.map((item) => item.entityId), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(second.lanes.map((item) => item.entityId), [1, 2, 3, 4, 9, 10]);
    assert.deepEqual(second.laneWindow, {
      page: 2,
      pageCount: 2,
      totalLanes: 10,
      visibleLanes: 6,
      hiddenLanes: 4,
    });
  });

  it("页码越界时夹到有效范围，焦点占满容量时隐藏全部关联轨道", () => {
    const input = model({
      focusEntityIds: [1, 2, 3, 4],
      laneIds: [1, 2, 3, 4, 5, 6],
    });

    assert.equal(windowEvolutionModel(input, -3, 5).laneWindow.page, 1);
    assert.equal(windowEvolutionModel(input, 99, 5).laneWindow.page, 2);

    const focusOnly = windowEvolutionModel(input, 99, 4);
    assert.deepEqual(focusOnly.lanes.map((item) => item.entityId), [1, 2, 3, 4]);
    assert.deepEqual(focusOnly.laneWindow, {
      page: 1,
      pageCount: 1,
      totalLanes: 6,
      visibleLanes: 4,
      hiddenLanes: 2,
    });
  });
});

describe("windowEvolutionModel dependent data", () => {
  it("只保留两端均在当前页的关系、对应关系组和离轴数据", () => {
    const relations = [
      relation(101, 1, 3, "group-a"),
      relation(102, 1, 4, "group-a"),
      relation(103, 2, 5),
      relation(104, 5, 3),
    ];
    const groupMembers = relations.slice(0, 2).flatMap((item) => item.members);
    const input = model({
      focusEntityIds: [1, 2],
      laneIds: [1, 2, 3, 4, 5, 6],
      relations,
      relationGroups: [{
        id: "group-a",
        groupId: "group-a",
        relationIds: [101, 102],
        members: groupMembers,
        sourceMembers: groupMembers.filter((item) => item.role === "source"),
        targetMembers: groupMembers.filter((item) => item.role === "target"),
      }],
      offAxis: {
        undated: [{ id: 11, entityId: 1 }, { id: 31, entityId: 3 }, { id: 51, entityId: 5 }],
        unresolved: [{ id: 41, entityId: 4 }],
        relationEndpoints: [
          { entityId: 3, relationId: 101, relationKey: "relation:101" },
          { entityId: 4, relationId: 102, relationKey: "relation:102" },
          { entityId: 5, relationId: 103, relationKey: "relation:103" },
        ],
      },
    });

    const first = windowEvolutionModel(input, 1, 4);
    assert.deepEqual(first.lanes.map((item) => item.entityId), [1, 2, 3, 4]);
    assert.deepEqual(first.relations.map((item) => item.id), [101, 102]);
    assert.deepEqual(first.relationGroups[0].relationIds, [101, 102]);
    assert.deepEqual(first.offAxis.undated.map((item) => item.id), [11, 31]);
    assert.deepEqual(first.offAxis.unresolved.map((item) => item.id), [41]);
    assert.deepEqual(
      first.offAxis.relationEndpoints.map((item) => item.relationId),
      [101, 102],
    );

    const second = windowEvolutionModel(input, 2, 4);
    assert.deepEqual(second.lanes.map((item) => item.entityId), [1, 2, 5, 6]);
    assert.deepEqual(second.relations.map((item) => item.id), [103]);
    assert.deepEqual(second.relationGroups, []);
    assert.deepEqual(second.offAxis.undated.map((item) => item.id), [11, 51]);
    assert.deepEqual(second.offAxis.unresolved, []);
    assert.deepEqual(second.offAxis.relationEndpoints.map((item) => item.relationId), [103]);
  });

  it("关系组跨页时退回原子关系，不绘制残缺的组合 glyph", () => {
    const relations = [relation(201, 1, 3, "split"), relation(202, 1, 4, "split")];
    const members = relations.flatMap((item) => item.members);
    const input = model({
      focusEntityIds: [1],
      laneIds: [1, 3, 4],
      relations,
      relationGroups: [{
        id: "split",
        groupId: "split",
        relationIds: [201, 202],
        members,
        sourceMembers: members.filter((item) => item.role === "source"),
        targetMembers: members.filter((item) => item.role === "target"),
      }],
    });

    const first = windowEvolutionModel(input, 1, 2);
    assert.deepEqual(first.relations.map((item) => item.id), [201]);
    assert.deepEqual(first.relationGroups, []);

    const second = windowEvolutionModel(input, 2, 2);
    assert.deepEqual(second.relations.map((item) => item.id), [202]);
    assert.deepEqual(second.relationGroups, []);
  });
});
