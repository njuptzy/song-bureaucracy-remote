import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildTimetreeRows,
  defaultTimetreeExpandedKeys,
  timetreeCategoryKey,
  timetreeEntityKey,
  timetreeGroupKey,
  timetreeLaneEntityIds,
  toggleTimetreeExpansion,
} from "./timetree_model.js";

const CENTRAL_GROUPS = ["决策中枢", "行政执行"];

function entity(id, title, overrides = {}) {
  return { id, title, type: "机构", category: "中央机构", ...overrides };
}

describe("buildTimetreeRows", () => {
  it("年度快照只保留当年存在的机构和层级边", () => {
    const rows = buildTimetreeRows({
      entities: [
        entity(1, "中书门下", { source_order: 10 }),
        entity(2, "枢密院", { source_order: 30 }),
        entity(3, "后世新增机构", { source_order: 40 }),
        entity(4, "中书门下属司", { source_order: 20 }),
      ],
      hierarchyEdges: [
        { parent: 1, child: 4 },
        { parent: 3, child: 4 },
      ],
      category: "中央机构",
      activeEntityIds: new Set([1, 2, 4]),
      expandedIds: new Set([
        timetreeCategoryKey("中央机构"),
        timetreeEntityKey(1),
      ]),
    });
    assert.deepEqual(
      rows.filter((row) => row.entityId != null).map((row) => row.entityId),
      [1, 4, 2],
    );
    assert.equal(rows.some((row) => row.entityId === 3), false);
    assert.equal(rows.find((row) => row.entityId === 4)?.parentKey, timetreeEntityKey(1));
  });

  it("无制度组配置时类别根位于第 0 层、机构位于第 1 层", () => {
    const rows = buildTimetreeRows({
      entities: [entity(1, "甲司"), entity(2, "乙司")],
      hierarchyEdges: [],
      category: "中央机构",
      groupNames: [],
      expandedIds: new Set([timetreeCategoryKey("中央机构")]),
    });
    assert.deepEqual(
      rows.map((row) => [row.entityId, row.depth]),
      [[null, 0], [1, 1], [2, 1]],
    );
  });

  it("制度组作为虚拟行参与排序，收起时带下级计数", () => {
    const rows = buildTimetreeRows({
      entities: [
        entity(1, "甲司", { central_group: "决策中枢" }),
        entity(2, "乙司", { central_group: "行政执行" }),
        entity(3, "丙司", { central_group: "行政执行" }),
      ],
      hierarchyEdges: [],
      category: "中央机构",
      groupNames: CENTRAL_GROUPS,
      expandedIds: new Set([timetreeCategoryKey("中央机构")]),
    });
    assert.deepEqual(rows.map((row) => row.title), ["中央机构", "决策中枢", "行政执行"]);
    assert.ok(rows.every((row) => row.isVirtual));
    assert.deepEqual(rows.map((row) => row.childCount), [0, 1, 2]);
    assert.equal(rows[1].parentKey, timetreeCategoryKey("中央机构"));
    assert.equal(rows[2].parentKey, timetreeCategoryKey("中央机构"));
  });

  it("展开制度组后按前序输出机构行，展开机构显示下级", () => {
    const rows = buildTimetreeRows({
      entities: [
        entity(1, "甲司", { central_group: "决策中枢" }),
        entity(2, "乙司", { central_group: "行政执行" }),
        entity(3, "丙司"),
      ],
      hierarchyEdges: [{ parent: 2, child: 3 }],
      category: "中央机构",
      groupNames: CENTRAL_GROUPS,
      expandedIds: new Set([
        timetreeCategoryKey("中央机构"),
        timetreeGroupKey("中央机构", "行政执行"),
        timetreeEntityKey(2),
      ]),
    });
    assert.deepEqual(
      rows.map((row) => [row.title, row.depth, row.isVirtual]),
      [
        ["中央机构", 0, true],
        ["决策中枢", 1, true],
        ["行政执行", 1, true],
        ["乙司", 2, false],
        ["丙司", 3, false],
      ],
    );
  });

  it("根节点与同层下级都按辞典出现顺序排列", () => {
    const rows = buildTimetreeRows({
      entities: [
        entity(1, "甲根", { source_order: 90 }),
        entity(2, "乙根", { source_order: 10 }),
        entity(3, "甲下级", { source_order: 70 }),
        entity(4, "乙下级", { source_order: 30 }),
      ],
      hierarchyEdges: [
        { parent: 2, child: 3 },
        { parent: 2, child: 4 },
      ],
      category: "中央机构",
      groupNames: [],
      expandedIds: new Set([
        timetreeCategoryKey("中央机构"),
        timetreeEntityKey(2),
      ]),
    });
    assert.deepEqual(
      rows.filter((row) => row.entityId != null).map((row) => row.entityId),
      [2, 4, 3, 1],
    );
  });

  it("旋转后父节点位于多个子节点的纵向中心", () => {
    const rows = buildTimetreeRows({
      entities: [entity(1, "中枢"), entity(2, "甲司"), entity(3, "乙司"), entity(4, "丙司")],
      hierarchyEdges: [
        { parent: 1, child: 2 },
        { parent: 1, child: 3 },
        { parent: 1, child: 4 },
      ],
      category: "中央机构",
      groupNames: [],
      expandedIds: new Set([timetreeCategoryKey("中央机构"), timetreeEntityKey(1)]),
    });
    const byTitle = new Map(rows.map((row) => [row.title, row]));
    assert.equal(byTitle.get("中枢").layoutIndex, 1);
    assert.deepEqual(
      ["甲司", "乙司", "丙司"]
        .map((title) => byTitle.get(title).layoutIndex)
        .sort((a, b) => a - b),
      [0, 1, 2],
    );
  });

  it("多层旋转树保持各级父节点对子树居中", () => {
    const rows = buildTimetreeRows({
      entities: [
        entity(1, "根"), entity(2, "左支"), entity(3, "右支"),
        entity(4, "左一"), entity(5, "左二"), entity(6, "右一"),
      ],
      hierarchyEdges: [
        { parent: 1, child: 2 }, { parent: 1, child: 3 },
        { parent: 2, child: 4 }, { parent: 2, child: 5 },
        { parent: 3, child: 6 },
      ],
      category: "中央机构",
      groupNames: [],
      expandedIds: new Set([
        timetreeCategoryKey("中央机构"),
        timetreeEntityKey(1), timetreeEntityKey(2), timetreeEntityKey(3),
      ]),
    });
    const byTitle = new Map(rows.map((row) => [row.title, row]));
    assert.equal(
      byTitle.get("左支").layoutIndex,
      (byTitle.get("左一").layoutIndex + byTitle.get("左二").layoutIndex) / 2,
    );
    assert.equal(byTitle.get("右支").layoutIndex, byTitle.get("右一").layoutIndex);
    assert.equal(
      byTitle.get("根").layoutIndex,
      (byTitle.get("左支").layoutIndex + byTitle.get("右支").layoutIndex) / 2,
    );
    assert.notEqual(byTitle.get("左一").layoutIndex, byTitle.get("左二").layoutIndex);
  });

  it("层级边成环时不死循环", () => {
    const rows = buildTimetreeRows({
      entities: [entity(1, "甲司"), entity(2, "乙司")],
      hierarchyEdges: [
        { parent: 1, child: 2 },
        { parent: 2, child: 1 },
      ],
      category: "中央机构",
      groupNames: [],
      expandedIds: new Set([
        timetreeCategoryKey("中央机构"), timetreeEntityKey(1), timetreeEntityKey(2),
      ]),
    });
    assert.ok(rows.length <= 2);
  });

  it("统称实体与其他分类不进入行", () => {
    const rows = buildTimetreeRows({
      entities: [
        entity(1, "甲司"),
        entity(2, "统称甲"),
        entity(3, "州县甲", { category: "州县机构" }),
        entity(4, "某官", { type: "官职" }),
      ],
      hierarchyEdges: [],
      category: "中央机构",
      collectiveIds: [2],
      groupNames: [],
      expandedIds: new Set([timetreeCategoryKey("中央机构")]),
    });
    assert.deepEqual(rows.filter((row) => !row.isVirtual).map((row) => row.entityId), [1]);
  });

  it("车道实体列表只含非虚拟行且保持行序", () => {
    const rows = buildTimetreeRows({
      entities: [
        entity(1, "甲司", { central_group: "决策中枢" }),
        entity(2, "乙司", { central_group: "行政执行" }),
      ],
      hierarchyEdges: [],
      category: "中央机构",
      groupNames: CENTRAL_GROUPS,
      expandedIds: new Set([
        timetreeCategoryKey("中央机构"),
        ...CENTRAL_GROUPS.map((group) => timetreeGroupKey("中央机构", group)),
      ]),
    });
    assert.deepEqual(timetreeLaneEntityIds(rows), [1, 2]);
  });

  it("制度组展开与层次结构一样互斥", () => {
    const rows = [
      { key: "category:中央机构", isVirtual: true, parentKey: null },
      { key: "group:a", isVirtual: true, parentKey: "category:中央机构" },
      { key: "group:b", isVirtual: true, parentKey: "category:中央机构" },
    ];
    assert.deepEqual(
      toggleTimetreeExpansion(rows, ["category:中央机构", "group:a"], "group:b"),
      ["category:中央机构", "group:b"],
    );
    assert.deepEqual(
      toggleTimetreeExpansion(rows, ["category:中央机构", "group:a"], "group:a"),
      ["category:中央机构"],
    );
  });

  it("机构展开只保留当前祖先路径，收起时移除后代", () => {
    const rows = [
      { key: "category:中央机构", isVirtual: true, parentKey: null },
      { key: "group:a", isVirtual: true, parentKey: "category:中央机构" },
      { key: "entity:1", isVirtual: false, parentKey: "group:a" },
      { key: "entity:2", isVirtual: false, parentKey: "entity:1" },
      { key: "entity:3", isVirtual: false, parentKey: "group:a" },
    ];
    assert.deepEqual(
      toggleTimetreeExpansion(
        rows,
        ["category:中央机构", "group:a", "entity:3"],
        "entity:2",
      ),
      ["category:中央机构", "group:a", "entity:1", "entity:2"],
    );
    assert.deepEqual(
      toggleTimetreeExpansion(
        rows,
        ["category:中央机构", "group:a", "entity:1", "entity:2"],
        "entity:1",
      ),
      ["category:中央机构", "group:a"],
    );
  });
});

describe("defaultTimetreeExpandedKeys", () => {
  it("默认只展开类别根，第二层制度组全部保持收起", () => {
    const keys = defaultTimetreeExpandedKeys({
      entities: [
        entity(1, "甲司", { central_group: "决策中枢" }),
        entity(2, "乙司", { central_group: "行政执行" }),
      ],
      category: "中央机构",
      groupNames: CENTRAL_GROUPS,
    });
    assert.deepEqual(keys, [timetreeCategoryKey("中央机构")]);
  });

  it("无制度组配置时默认展开类别根、具体机构保持收起", () => {
    assert.deepEqual(defaultTimetreeExpandedKeys({
      entities: [entity(1, "甲司")],
      category: "路级机构",
      groupNames: [],
    }), [timetreeCategoryKey("路级机构")]);
  });
});
