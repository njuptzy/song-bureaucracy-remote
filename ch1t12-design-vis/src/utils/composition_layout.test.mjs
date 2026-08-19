import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMPOSITION_GEOMETRY,
  compositionDensityScale,
  fitCompositionBlock,
  layoutComposition,
  nestedRowCountFor,
  solveLabelTypography,
  staffTextCols,
} from "./composition_layout.js";

const leaf = (id, title, depth = 1, parentId = 3) => ({
  id,
  title,
  depth,
  parentId,
  pathKey: `${parentId}/${id}`,
  staff: [],
  staffItems: [],
  staffText: "编制未载",
  children: [],
});

const nested = leaf(5, "礼部贡院", 1, 3);
const gongyuanStaffTitles = [
  "编排官", "点检试卷官", "对读官", "封弥官", "覆考官", "监门官", "考官",
  "历程官", "判贡院事", "权知礼部贡举事", "誊录官", "同知礼部贡举事",
  "详定官", "巡捕官", "知礼部贡举事",
];
nested.staff = [{}];
nested.staffItems = gongyuanStaffTitles.map((text) => ({
  text,
  kind: "neutral",
  staffType: "",
}));
nested.staffText = gongyuanStaffTitles.join("，");
nested.children = [
  leaf(51, "礼部贡院试院", 2, 5),
  leaf(52, "礼部贡院封弥院", 2, 5),
  leaf(53, "礼部贡院誊录院", 2, 5),
  leaf(54, "礼部贡院编排所", 2, 5),
  leaf(55, "礼部贡院对读所", 2, 5),
  leaf(56, "礼部贡院别试所", 2, 5),
  leaf(57, "礼部贡院过落司", 2, 5),
];

const section = (id, title, columns) => ({
  id,
  title,
  depth: 0,
  parentId: 1,
  pathKey: `1/${id}`,
  staff: [],
  staffItems: [],
  staffText: "编制未载",
  children: columns,
  columns,
});

const staffed = (node, text) => ({
  ...node,
  staff: [{}],
  staffItems: [{ text, kind: "neutral", staffType: "" }],
  staffText: text,
});

const groupBy = (items, keyOf) => {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
};

const model = {
  focus: { id: 1, title: "尚书省" },
  selfColumn: {
    id: 1,
    title: "尚书省",
    staff: [{}],
    staffItems: [{ text: "主事六人", kind: "clerk", staffType: "吏" }],
    staffText: "主事六人",
  },
  focusDirectLeaves: [leaf(2, "尚书省左司", 0, 1), leaf(9, "尚书省右司", 0, 1)],
  sections: [
    section(10, "尚书省吏部", [1, 2, 3, 4, 5, 6, 7].map((id) => leaf(100 + id, `吏部司${id}`, 1, 10))),
    section(11, "尚书省户部", [leaf(201, "度支司", 1, 11), leaf(202, "金部司", 1, 11), leaf(203, "仓部司", 1, 11)]),
    section(12, "尚书省礼部", [
      staffed(leaf(301, "礼部司", 1, 12), "礼部郎中一人，礼部员外郎一人"),
      staffed(leaf(302, "祠部司", 1, 12), "判祠部司事一人，祠部司郎中一人"),
      staffed(leaf(303, "主客司", 1, 12), "主客司郎中一人，主客司员外郎一人"),
      staffed(leaf(304, "膳部司", 1, 12), "膳部司郎中一人，膳部司员外郎一人"),
      { ...nested, parentId: 12 },
    ]),
    section(13, "尚书省工部", [leaf(401, "工部司", 1, 13), leaf(402, "屯田司", 1, 13), leaf(403, "虞部司", 1, 13), leaf(404, "水部司", 1, 13)]),
    section(14, "尚书省兵部", [1, 2, 3, 4, 5].map((id) => leaf(500 + id, `兵部司${id}`, 1, 14))),
    section(15, "尚书省刑部", [1, 2, 3, 4].map((id) => leaf(600 + id, `刑部司${id}`, 1, 15))),
  ],
};

const sparseMinistryModel = {
  focus: { id: 1185, title: "尚书省工部" },
  selfColumn: staffed(
    { ...leaf(1185, "尚书省工部", -1, null), depth: -1 },
    "判尚书省工部事一人",
  ),
  focusDirectLeaves: [
    staffed(leaf(1186, "工部司", 1, 1185), "工部郎中一人，工部员外郎一人"),
    staffed(leaf(1187, "屯田司", 1, 1185), "屯田郎中一人，屯田员外郎一人"),
    staffed(leaf(1188, "虞部司", 1, 1185), "虞部郎中一人，虞部员外郎一人"),
    staffed(leaf(1189, "水部司", 1, 1185), "水部郎中一人，水部员外郎一人"),
  ],
  sections: [],
};

function assertMetricsInside(metrics, rect, title) {
  const titleLeft = metrics.titleXOffset - metrics.fontSize / 2;
  const titleRight = metrics.titleXOffset
    + (metrics.titleCols - 1) * metrics.titlePitch
    + metrics.fontSize / 2;
  assert.ok(titleLeft >= -1e-9, `${title} 标题越过左边界`);
  assert.ok(titleRight <= rect.width + 1e-9, `${title} 标题越过右边界`);
  for (const track of metrics.staffTracks) {
    assert.ok(
      metrics.staffYOffset + Array.from(track.text).length * metrics.staffFontSize
        <= rect.height - metrics.staffBottomPadding + 1e-9,
      `${title} 编制越过下边界`,
    );
  }
  if (!metrics.staffTracks.length) return;
  const staffLeft = metrics.staffRightmostXOffset
    - (metrics.staffTracks.length - 1) * metrics.staffTrackPitch
    - metrics.staffFontSize / 2;
  const staffRight = metrics.staffRightmostXOffset + metrics.staffFontSize / 2;
  assert.ok(staffLeft >= -1e-9, `${title} 编制越过左边界`);
  assert.ok(staffRight <= rect.width + 1e-9, `${title} 编制越过右边界`);
}

describe("staffTextCols", () => {
  it("按每列字数折算文本列数", () => {
    assert.equal(staffTextCols("郎中一人", COMPOSITION_GEOMETRY, 26), 1);
    assert.equal(staffTextCols("x".repeat(27), COMPOSITION_GEOMETRY, 26), 2);
    assert.equal(staffTextCols(""), 0);
  });
});

describe("fitCompositionBlock", () => {
  it("布局与画板同尺寸时保持稳定字号和线宽", () => {
    const bounds = { x: 503.48, y: 147.58, width: 1309.84, height: 717.85 };
    const fitted = fitCompositionBlock(bounds, bounds);
    assert.equal(fitted.scale, 1);
    assert.equal(fitted.translateX, 0);
    assert.equal(fitted.translateY, 0);
  });
});

describe("nestedRowCountFor", () => {
  it("九个深层机构在 116px 高区域分两行，避免压成 6px 极窄列", () => {
    const children = Array.from({ length: 9 }, (_, index) => leaf(950 + index, `医科${index}`));
    assert.equal(nestedRowCountFor(children, { width: 74.58, height: 116.54 }), 2);
    assert.equal(nestedRowCountFor(children, { width: 74.58, height: 40 }), 1);
    const caseChildren = Array.from({ length: 18 }, (_, index) => leaf(970 + index, `考功案${index}`));
    assert.equal(nestedRowCountFor(caseChildren, { width: 74.58, height: 116.54 }), 4);
  });
});

describe("layoutComposition", () => {
  const layout = layoutComposition(model);

  it("绘制一个总框，焦点标题位于总框内部左栏", () => {
    assert.deepEqual(layout.parentRect, layout.bounds);
    assert.ok(layout.focusLabel.rect.x >= layout.parentRect.x);
    assert.ok(layout.focusLabel.rect.x + layout.focusLabel.rect.width < layout.blocks[0].rect.x);
    assert.ok(layout.focusLabel.titlePlateRect.x >= layout.parentRect.x);
    assert.ok(layout.focusLabel.titlePlateRect.y >= layout.parentRect.y);
    assert.equal(layout.blocks.some((block) => block.id === 1), false);
  });

  it("六部采用原稿上四下二的顺序，直属叶合为一个附属列带", () => {
    const top = layout.blocks.filter((block) => block.rect.y === layout.blocks[0].rect.y);
    const bottomY = Math.max(...layout.blocks.map((block) => block.rect.y));
    const bottom = layout.blocks.filter((block) => block.rect.y === bottomY);
    assert.deepEqual(top.map((block) => block.id), [10, 11, 12, 13]);
    assert.deepEqual(bottom.map((block) => block.id), [14, 15, "attachments:1"]);
    const attachments = bottom.at(-1);
    assert.deepEqual(attachments.items.map((item) => item.id), [2, 9]);
  });

  it("部门块只包含直属机构，贡院七个下级嵌套在贡院列内", () => {
    const li = layout.blocks.find((block) => block.id === 12);
    assert.deepEqual(li.items.map((item) => item.id), [301, 302, 303, 304, 5]);
    const gongyuan = li.items.find((item) => item.id === 5);
    assert.equal(gongyuan.children.length, 7);
    for (const child of gongyuan.children) {
      assert.ok(child.rect.x >= gongyuan.rect.x);
      assert.ok(child.rect.y >= gongyuan.rect.y);
      assert.ok(child.rect.x + child.rect.width <= gongyuan.rect.x + gongyuan.rect.width + 1e-7);
      assert.ok(child.rect.y + child.rect.height <= gongyuan.rect.y + gongyuan.rect.height + 1e-7);
    }
  });

  it("四级标题使用原稿基线偏移，深层七字标题缩至单列安全字号", () => {
    const li = layout.blocks.find((block) => block.id === 12);
    const direct = li.items.find((item) => item.id === 301);
    const gongyuan = li.items.find((item) => item.id === 5);
    const longNested = gongyuan.children.find((item) => item.id === 52);
    assert.equal(layout.focusLabel.titleXOffset, COMPOSITION_GEOMETRY.focusTitleXOffset);
    assert.equal(li.label.titleXOffset, COMPOSITION_GEOMETRY.sectionTitleXOffset);
    assert.equal(direct.titleXOffset, COMPOSITION_GEOMETRY.columnTitleXOffset);
    assert.equal(longNested.titleXOffset, COMPOSITION_GEOMETRY.nestedTitleXOffset);
    assert.equal(longNested.fontSize, 13.5);
    assert.equal(longNested.titleCols, 1);
    assert.ok(
      longNested.titleYOffset
        + Array.from(longNested.title).length * longNested.fontSize
        + longNested.titleYOffset
      <= longNested.labelRect.height
    );
  });

  it("机构编制接在名称下方并围绕标题基线向左换列", () => {
    const li = layout.blocks.find((block) => block.id === 12);
    const gongyuan = li.items.find((item) => item.id === 5);
    assert.equal(gongyuan.staffMode, "below");
    assert.equal(gongyuan.staffTrackPitch, gongyuan.staffFontSize * 1.2);
    assert.ok(gongyuan.staffTracks.length >= 3);
    assert.equal(gongyuan.staffTracks.length, gongyuan.staffTrackCount);
    const trackCenter = gongyuan.staffRightmostXOffset
      - (gongyuan.staffTracks.length - 1) * gongyuan.staffTrackPitch / 2;
    assert.ok(Math.abs(trackCenter - gongyuan.titleXOffset) < 1e-9);
    assert.equal(
      gongyuan.staffYOffset,
      gongyuan.titleYOffset
        + gongyuan.titleLines * gongyuan.fontSize
        + COMPOSITION_GEOMETRY.columnStaffGap
    );
  });

  it("长编制按真实轨数扩宽父栏，不侵入右侧嵌套机构", () => {
    const li = layout.blocks.find((block) => block.id === 12);
    const gongyuan = li.items.find((item) => item.id === 5);
    assert.ok(gongyuan.labelRect.width > COMPOSITION_GEOMETRY.branchLabelMin);
    assert.ok(gongyuan.labelRect.width >= gongyuan.fullRequiredWidth - 1e-9);
    assert.equal(gongyuan.staffTracks.some((track) => track.text.endsWith("…")), false);
    const childLeft = Math.min(...gongyuan.children.map((child) => child.rect.x));
    assert.ok(
      childLeft >= gongyuan.labelRect.x
        + gongyuan.labelRect.width
        + COMPOSITION_GEOMETRY.nestedGap
        - 1e-9
    );
  });

  it("缺少编制时只显示机构名，不重复绘制占位文字", () => {
    const li = layout.blocks.find((block) => block.id === 12);
    const hu = layout.blocks.find((block) => block.id === 11);
    const directWithoutStaff = hu.items.find((item) => item.id === 201);
    const nestedWithoutStaff = li.items.find((item) => item.id === 5).children[0];
    assert.equal(directWithoutStaff.staffText, "编制未载");
    assert.equal(directWithoutStaff.staffTracks.length, 0);
    assert.equal(nestedWithoutStaff.staffTracks.length, 0);
  });

  it("标题与编制的测量边界都留在各自 labelRect 内", () => {
    for (const item of layout.items) {
      const titleLeft = item.titleXOffset - item.fontSize / 2;
      const titleRight = item.titleXOffset
        + (item.titleCols - 1) * item.titlePitch
        + item.fontSize / 2;
      assert.ok(titleLeft >= -1e-9, `${item.title} 标题越过左边界`);
      assert.ok(titleRight <= item.labelRect.width + 1e-9, `${item.title} 标题越过右边界`);
      for (const track of item.staffTracks) {
        assert.ok(
          item.staffYOffset + Array.from(track.text).length * item.staffFontSize
            <= item.labelRect.height - COMPOSITION_GEOMETRY.staffBottomPadding + 1e-9,
          `${item.title} 编制越过下边界`
        );
      }
      if (!item.staffTracks.length) continue;
      const staffLeft = item.staffRightmostXOffset
        - (item.staffTracks.length - 1) * item.staffTrackPitch
        - item.staffFontSize / 2;
      const staffRight = item.staffRightmostXOffset + item.staffFontSize / 2;
      assert.ok(staffLeft >= -1e-9, `${item.title} 编制越过左边界`);
      assert.ok(staffRight <= item.labelRect.width + 1e-9, `${item.title} 编制越过右边界`);
    }
  });

  it("宏观横带和每个部门内部行都填满右边界", () => {
    const parentRight = layout.parentRect.x + layout.parentRect.width - COMPOSITION_GEOMETRY.outerPadding;
    const byOuterY = groupBy(layout.blocks, (block) => block.rect.y);
    for (const blocks of byOuterY.values()) {
      const right = Math.max(...blocks.map((block) => block.rect.x + block.rect.width));
      assert.ok(Math.abs(right - parentRight) < 1e-6);
    }
    for (const block of layout.blocks.filter((item) => item.kind === "section")) {
      const byY = groupBy(block.items, (item) => item.rect.y);
      for (const items of byY.values()) {
        const right = Math.max(...items.map((item) => item.rect.x + item.rect.width));
        assert.ok(Math.abs(right - (block.rect.x + block.rect.width)) < 1e-6);
      }
    }
  });

  it("单行部门的机构列拉高填满部门，不保留固定211像素空带", () => {
    const hu = layout.blocks.find((block) => block.id === 11);
    for (const item of hu.items) {
      assert.equal(item.rect.y, hu.rect.y);
      assert.equal(item.rect.height, hu.rect.height);
    }
  });

  it("所有同层机构列之间保留原稿细缝", () => {
    const hu = layout.blocks.find((block) => block.id === 11);
    for (let index = 1; index < hu.items.length; index += 1) {
      const previousRight = hu.items[index - 1].rect.x + hu.items[index - 1].rect.width;
      assert.ok(Math.abs(hu.items[index].rect.x - previousRight - COMPOSITION_GEOMETRY.columnGap) < 1e-6);
    }
  });

  it("空模型返回 null", () => {
    assert.equal(layoutComposition(null), null);
  });
});

describe("编制文字自适应", () => {
  it("稀疏视图利用空间放大，密集视图正文仍保持可读基准", () => {
    const sparse = layoutComposition(sparseMinistryModel);
    const sparseLeaves = sparse.items.filter((item) => item.kind === "column");
    assert.equal(sparse.typographyScale, COMPOSITION_GEOMETRY.typographyMaxScale);
    assert.equal(sparseLeaves.length, 4);
    for (const item of sparseLeaves) {
      assert.ok(item.fontSize >= 29.5 && item.fontSize <= 29.6 + 1e-9);
      assert.ok(item.staffFontSize >= 12.9 && item.staffFontSize <= 13 + 1e-9);
      assert.equal(item.truncated, false);
      assert.equal(item.staffTracks.map((track) => track.text).join(""), item.staffText);
      assertMetricsInside(item, item.labelRect, item.title);
    }

    const dense = layoutComposition(model);
    const denseDirect = dense.blocks.find((block) => block.id === 12).items[0];
    const denseGongyuan = dense.blocks.find((block) => block.id === 12)
      .items.find((item) => item.id === 5);
    const denseNested = denseGongyuan.children.find((item) => item.id === 52);
    assert.equal(dense.typographyScale, 1);
    assert.equal(denseDirect.fontSize, COMPOSITION_GEOMETRY.columnTitleFontSize);
    assert.equal(denseDirect.staffFontSize, COMPOSITION_GEOMETRY.staffFontSize);
    assert.ok(denseDirect.staffFontSize >= 10);
    assertMetricsInside(denseDirect, denseDirect.labelRect, denseDirect.title);
    assert.equal(denseGongyuan.staffTracks.length, denseGongyuan.staffTrackCount);
    assert.equal(denseNested.fontSize, 13.5);
  });

  it("同一全文随可用宽高增加只会保持或放大", () => {
    const source = staffed(
      leaf(901, "提举都大仓草场司", 1, 1),
      "提举一人，同提举一人，干办公事二人，勾当公事二人",
    );
    const smallRect = { x: 0, y: 0, width: 58, height: 150 };
    const wideRect = { ...smallRect, width: 180 };
    const largeRect = { ...wideRect, height: 520 };
    const small = solveLabelTypography(source, { rect: smallRect, globalScale: 1.85 });
    const wide = solveLabelTypography(source, { rect: wideRect, globalScale: 1.85 });
    const large = solveLabelTypography(source, { rect: largeRect, globalScale: 1.85 });
    assert.ok(wide.fontSize >= small.fontSize);
    assert.ok(wide.staffFontSize >= small.staffFontSize);
    assert.ok(large.fontSize >= wide.fontSize);
    assert.ok(large.staffFontSize >= wide.staffFontSize);
    assertMetricsInside(small, smallRect, source.title);
    assertMetricsInside(wide, wideRect, source.title);
    assertMetricsInside(large, largeRect, source.title);
  });

  it("窄而高的长标题仍受横向边界约束，不会只按高度盲目放大", () => {
    const source = staffed(
      leaf(902, "特别长的机构标题测试", 1, 1),
      "郎中一人，员外郎一人，主事二人",
    );
    const rect = { x: 0, y: 0, width: 25, height: 700 };
    const metrics = solveLabelTypography(source, { rect, globalScale: 1.85 });
    assert.ok(metrics.fontSize < COMPOSITION_GEOMETRY.columnTitleFontSize * 1.85);
    assert.equal(metrics.truncated, false);
    assert.equal(metrics.staffTracks.map((track) => track.text).join(""), source.staffText);
    assertMetricsInside(metrics, rect, source.title);
  });

  it("只有极端狭小格才显式截断，普通完整适配不产生省略号", () => {
    const ordinary = staffed(
      leaf(903, "都司", 1, 1),
      "郎中一人，员外郎一人，主事二人",
    );
    const fullRect = { x: 0, y: 0, width: 80, height: 180 };
    const full = solveLabelTypography(ordinary, { rect: fullRect, globalScale: 1.85 });
    assert.equal(full.truncated, false);
    assert.equal(full.staffTracks.map((track) => track.text).join(""), ordinary.staffText);

    const extreme = staffed(
      leaf(904, "都司", 1, 1),
      "郎中一人，员外郎一人，主事二人，提举一人，同提举一人".repeat(5),
    );
    const tinyRect = { x: 0, y: 0, width: 18, height: 72 };
    const tiny = solveLabelTypography(extreme, { rect: tinyRect, globalScale: 1.85 });
    assert.equal(tiny.truncated, true);
    assert.ok(tiny.staffTracks.at(-1)?.text.endsWith("…"));
    assert.ok(tiny.staffTracks.every((track) => (
      Array.from(track.text).length <= tiny.charsPerStaffCol
    )));
    assertMetricsInside(tiny, tinyRect, extreme.title);

    const irreducible = solveLabelTypography(extreme, {
      rect: { x: 0, y: 0, width: 8, height: 16 },
      globalScale: 1.85,
    });
    assert.ok(irreducible);
    assert.equal(irreducible.truncated, true);

    const narrowCaseRect = { x: 0, y: 0, width: 2.88, height: 27 };
    const narrowCase = solveLabelTypography(
      leaf(905, "考功司五品案", 2, 1),
      { rect: narrowCaseRect, depth: 2, globalScale: 1 },
    );
    assert.ok(narrowCase);
    assert.ok(Number.isFinite(narrowCase.titleXOffset));
    assert.ok(Number.isFinite(narrowCase.titleYOffset));
    assertMetricsInside(narrowCase, narrowCaseRect, "考功司五品案");
  });

  it("整图密度上限同时受机构数量和格子面积约束", () => {
    const sparse = layoutComposition(sparseMinistryModel);
    assert.equal(compositionDensityScale(sparse.items), 1.85);
    const artificiallyCrowded = Array.from({ length: 12 }, (_, index) => ({
      kind: "column",
      depth: 1,
      labelRect: { x: index * 30, y: 0, width: 30, height: 100 },
    }));
    assert.equal(compositionDensityScale(artificiallyCrowded), 1);
  });
});
