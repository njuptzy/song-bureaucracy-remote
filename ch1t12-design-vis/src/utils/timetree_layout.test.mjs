import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clampTimetreeScroll,
  fitTimetreeCapsuleLabel,
  layoutTimetreeEvents,
  layoutTimetreeRelations,
  layoutTimetreeSegments,
  TIMETREE_GEOMETRY,
  timetreeAlignedHalfWidths,
  timetreeLayoutSpan,
  timetreeLaneLinkSpan,
  timetreeNodeColumns,
  timetreeEventsForLane,
  timetreeRelationEndpointIds,
  timetreeRelationsForEntity,
  timetreeVirtualBusGeometry,
  timetreeNodeX,
  timetreeRowY,
  timetreeYearToX,
} from "./timetree_layout.js";

describe("timetreeYearToX", () => {
  it("起止年映射到时间区两端", () => {
    assert.equal(timetreeYearToX(960, 960, 1279), TIMETREE_GEOMETRY.plot.x0);
    assert.equal(timetreeYearToX(1279, 960, 1279), TIMETREE_GEOMETRY.plot.x1);
  });
});

describe("时间线树分区与机构名适配", () => {
  it("层级树与时间线各占中央内容区的一半", () => {
    const leftWidth = TIMETREE_GEOMETRY.dividerX - TIMETREE_GEOMETRY.content.x0;
    const rightWidth = TIMETREE_GEOMETRY.content.x1 - TIMETREE_GEOMETRY.dividerX;
    assert.equal(leftWidth, rightWidth);
    assert.ok(TIMETREE_GEOMETRY.tree.x0 - 108 >= TIMETREE_GEOMETRY.content.x0);
    assert.ok(TIMETREE_GEOMETRY.tree.maxX < TIMETREE_GEOMETRY.dividerX);
    assert.ok(TIMETREE_GEOMETRY.plot.x0 > TIMETREE_GEOMETRY.dividerX);
  });

  it("行视口利用到底部时间选择控件之前且不与其重叠", () => {
    assert.equal(TIMETREE_GEOMETRY.rowsBottom, 892);
    assert.ok(TIMETREE_GEOMETRY.rowsBottom + 16 < 913);
  });

  it("中等长度机构名优先缩小字号完整显示", () => {
    const fitted = fitTimetreeCapsuleLabel("都大提举在京仓草场司", 126.85);
    assert.equal(fitted.text, "都大提举在京仓草场司");
    assert.ok(fitted.fontSize >= 9.8 && fitted.fontSize < 17.14);
  });

  it("极端超长名称才在最小可读字号下省略", () => {
    const fitted = fitTimetreeCapsuleLabel("一二三四五六七八九十甲乙丙丁戊己庚辛", 126.85);
    assert.ok(fitted.text.endsWith("…"));
    assert.equal(fitted.fontSize, 9.8);
  });
});

describe("clampTimetreeScroll", () => {
  it("行数不足一屏时锁死在 0", () => {
    assert.equal(clampTimetreeScroll(50, 3), 0);
  });

  it("超长内容钳制在最大偏移内", () => {
    const maxOffset = 100 * TIMETREE_GEOMETRY.rowPitch
      - (TIMETREE_GEOMETRY.rowsBottom - TIMETREE_GEOMETRY.rowsTop);
    assert.equal(clampTimetreeScroll(99999, 100), maxOffset);
    assert.equal(clampTimetreeScroll(-5, 100), 0);
  });

  it("按旋转树的实际纵向跨度而不是前序节点总数计算", () => {
    const rows = [
      { rowIndex: 0, layoutIndex: 1 },
      { rowIndex: 1, layoutIndex: 0 },
      { rowIndex: 2, layoutIndex: 1 },
      { rowIndex: 3, layoutIndex: 2 },
    ];
    assert.equal(timetreeLayoutSpan(rows), 3);
    assert.equal(clampTimetreeScroll(50, rows), 0);
  });
});

describe("timetreeRowY / timetreeNodeX", () => {
  it("行 y 随滚动偏移线性移动", () => {
    const base = timetreeRowY(0, 0);
    assert.equal(base, TIMETREE_GEOMETRY.rowsTop + TIMETREE_GEOMETRY.rowPitch / 2);
    assert.equal(timetreeRowY(0, 20), base - 20);
    assert.equal(timetreeRowY(3, 0), base + 3 * TIMETREE_GEOMETRY.rowPitch);
    assert.equal(timetreeRowY(1.5, 0), base + 1.5 * TIMETREE_GEOMETRY.rowPitch);
  });

  it("树节点 x 随深度右移且不超过树区右界", () => {
    assert.equal(timetreeNodeX(0), TIMETREE_GEOMETRY.tree.x0);
    assert.ok(timetreeNodeX(99) <= TIMETREE_GEOMETRY.tree.maxX);
  });
});

describe("timetreeLaneLinkSpan", () => {
  it("从具体节点右侧跨过分区边界并接到时间车道起点", () => {
    const span = timetreeLaneLinkSpan(900);
    assert.equal(span.x0, 905);
    assert.equal(span.x1, TIMETREE_GEOMETRY.plot.x0);
    assert.ok(span.x0 < TIMETREE_GEOMETRY.dividerX);
    assert.ok(span.x1 > TIMETREE_GEOMETRY.dividerX);
  });

  it("深层节点接近时间区时仍保留最短可见连接", () => {
    const span = timetreeLaneLinkSpan(TIMETREE_GEOMETRY.plot.x0 + 20);
    assert.equal(span.x0, TIMETREE_GEOMETRY.plot.x0 - 4);
    assert.equal(span.x1 - span.x0, 4);
  });
});

describe("timetreeVirtualBusGeometry", () => {
  it("不同宽度子节点共用一根位于全部外框左侧的竖向总线", () => {
    const parent = { right: 170, y: 200 };
    const children = [
      { left: 186, y: 120 },
      { left: 218, y: 200 },
      { left: 268, y: 280 },
    ];
    const bus = timetreeVirtualBusGeometry(parent, children);
    assert.equal(bus.busX, 178);
    assert.equal(bus.y0, 120);
    assert.equal(bus.y1, 280);
    assert.ok(children.every((child) => bus.busX < child.left));
    assert.ok(bus.children.every((branch) => branch.x0 === bus.busX));
  });

  it("单个子节点也只生成同一套父干、总线和支线", () => {
    const bus = timetreeVirtualBusGeometry(
      { right: 100, y: 50 },
      [{ left: 140, y: 50 }],
    );
    assert.equal(bus.busX, 120);
    assert.equal(bus.y0, 50);
    assert.equal(bus.y1, 50);
    assert.deepEqual(bus.children, [{ x0: 120, x1: 140, y: 50 }]);
  });
});

describe("timetreeNodeColumns", () => {
  it("长制度组不会与类别根重叠，分叉总线拥有独立空隙", () => {
    const rows = [
      { key: "category", depth: 0 },
      { key: "long-group", depth: 1 },
      { key: "short-group", depth: 1 },
    ];
    const halfWidths = new Map([
      ["category", 46.3],
      ["long-group", 97.7],
      ["short-group", 45],
    ]);
    const columns = timetreeNodeColumns(rows, halfWidths);
    const parentRight = columns.get(0) + halfWidths.get("category");
    const nearestChildLeft = columns.get(1) - halfWidths.get("long-group");
    assert.ok(nearestChildLeft - parentRight >= 12);
  });

  it("右侧不足时整体左移但不破坏层间安全距离", () => {
    const geometry = {
      ...TIMETREE_GEOMETRY,
      content: { x0: 500, x1: 900 },
      tree: { x0: 610, depthGap: 145, maxX: 850 },
      dividerX: 900,
    };
    const rows = [
      { key: "root", depth: 0 },
      { key: "group", depth: 1 },
      { key: "entity", depth: 2 },
    ];
    const halfWidths = new Map([
      ["root", 45],
      ["group", 90],
      ["entity", 50],
    ]);
    const columns = timetreeNodeColumns(rows, halfWidths, geometry);
    assert.ok(columns.get(1) - 90 - (columns.get(0) + 45) >= 12);
    assert.ok(columns.get(2) - 50 - (columns.get(1) + 90) >= 12);
    assert.ok(columns.get(0) - 45 >= geometry.content.x0 + 8);
  });
});

describe("timetreeAlignedHalfWidths", () => {
  it("同一类别下的制度组统一为最长标题宽度，类别根保持原尺寸", () => {
    const rows = [
      { key: "category", parentKey: null, isVirtual: true },
      { key: "group-a", parentKey: "category", isVirtual: true },
      { key: "group-b", parentKey: "category", isVirtual: true },
      { key: "group-c", parentKey: "category", isVirtual: true },
    ];
    const natural = new Map([
      ["category", 46],
      ["group-a", 70],
      ["group-b", 98],
      ["group-c", 45],
    ]);
    const aligned = timetreeAlignedHalfWidths(rows, natural);
    assert.equal(aligned.get("category"), 46);
    assert.equal(aligned.get("group-a"), 98);
    assert.equal(aligned.get("group-b"), 98);
    assert.equal(aligned.get("group-c"), 98);
  });

  it("真实机构不参与虚拟制度组的统一宽度", () => {
    const rows = [
      { key: "group", parentKey: "category", isVirtual: true },
      { key: "entity", parentKey: "group", isVirtual: false },
    ];
    const aligned = timetreeAlignedHalfWidths(rows, new Map([
      ["group", 92],
      ["entity", 51],
    ]));
    assert.equal(aligned.get("group"), 92);
    assert.equal(aligned.get("entity"), 51);
  });
});

describe("timetreeEventsForLane", () => {
  const events = [
    { id: 1, expanded: false, event: "普通记载" },
    { id: 2, expanded: true, event: "建置" },
    { id: 3, expanded: true, event: "演变关系端点" },
    { id: 4, expanded: false, event: "属性记载" },
  ];

  it("未选机构只显示关键时间点", () => {
    assert.deepEqual(timetreeEventsForLane(events).map(({ id }) => id), [2, 3]);
  });

  it("选中机构展开自己的全部时间点", () => {
    assert.deepEqual(
      timetreeEventsForLane(events, { active: true }).map(({ id }) => id),
      [1, 2, 3, 4],
    );
  });

  it("其他机构只保留与选中机构直接相连的关系端点", () => {
    assert.deepEqual(
      timetreeEventsForLane(events, { linkedEndpointIds: new Set([3]) }).map(({ id }) => id),
      [3],
    );
  });
});

describe("时间线树关系焦点", () => {
  const relations = [
    { id: 11, members: [{ entityId: 1, timepointId: 101 }, { entityId: 2, timepointId: 201 }] },
    { id: 12, members: [{ entityId: 2, timepointId: 202 }, { entityId: 3, timepointId: 301 }] },
  ];

  it("只保留直接涉及选中机构的关系", () => {
    const focused = timetreeRelationsForEntity(relations, 1);
    assert.deepEqual(focused.map(({ id }) => id), [11]);
    assert.deepEqual([...timetreeRelationEndpointIds(focused)], [101, 201]);
  });

  it("没有明确机构选择时保留总览关系", () => {
    assert.equal(timetreeRelationsForEntity(relations, null), relations);
  });
});

describe("layoutTimetreeEvents", () => {
  const xOf = (year) => timetreeYearToX(year, 960, 1279);

  it("事件 displayX 锚在真实年份上，密集点错层", () => {
    const events = layoutTimetreeEvents([
      { id: 1, effectiveYear: 1000, yearStart: 1000, yearEnd: 1000, timeType: "exact" },
      { id: 2, effectiveYear: 1000.5, yearStart: 1000, yearEnd: 1001, timeType: "bounded" },
      { id: 3, effectiveYear: 1100, yearStart: 1100, yearEnd: 1100, timeType: "exact" },
    ], xOf);
    assert.equal(events[0].baseX, xOf(1000));
    assert.equal(events[0].dy, 0);
    assert.notEqual(events[1].dy, 0);
    assert.ok(events[1].displaced);
    assert.equal(events[2].dy, 0);
  });

  it("离轴事件（无有效年份）不参与布局", () => {
    const events = layoutTimetreeEvents([
      { id: 1, effectiveYear: null, timeType: "undated" },
    ], xOf);
    assert.equal(events.length, 0);
  });
});

describe("layoutTimetreeSegments / layoutTimetreeRelations", () => {
  const xOf = (year) => timetreeYearToX(year, 960, 1279);

  it("存续段映射为 x 区间", () => {
    const [segment] = layoutTimetreeSegments([
      { id: "s1", startYear: 1000, endYear: 1100, openStart: false, openEnd: true },
    ], xOf);
    assert.equal(segment.x0, xOf(1000));
    assert.equal(segment.x1, xOf(1100));
  });

  it("关系端点定位到已布局事件；缺端点的关系不可画", () => {
    const positions = new Map([
      [11, { x: 100, y: 200, iconType: "record" }],
      [12, { x: 300, y: 300, iconType: "establish" }],
    ]);
    const [ok, missing] = layoutTimetreeRelations([
      {
        id: 1,
        sourceMembers: [{ timepointId: 11, entityId: 1 }],
        targetMembers: [{ timepointId: 12, entityId: 2 }],
      },
      {
        id: 2,
        sourceMembers: [{ timepointId: 99, entityId: 3 }],
        targetMembers: [{ timepointId: 12, entityId: 2 }],
      },
    ], positions);
    assert.ok(ok.drawable);
    assert.equal(ok.sourcePoints[0].x, 100);
    assert.equal(ok.targetPoints[0].y, 300);
    assert.ok(!missing.drawable);
  });
});
