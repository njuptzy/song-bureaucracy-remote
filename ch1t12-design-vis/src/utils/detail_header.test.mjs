import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detailHeaderLayout } from "./detail_header.js";

describe("detailHeaderLayout", () => {
  it("短标题保留原有年份起点", () => {
    const layout = detailHeaderLayout({ titleWidth: 64, yearWidth: 126 });

    assert.equal(layout.yearX, 189.74);
    assert.equal(layout.yearY, 502.91);
    assert.equal(layout.stacked, false);
  });

  it("长标题按自然字宽把年份向右推，不压缩字形", () => {
    const layout = detailHeaderLayout({ titleWidth: 175, yearWidth: 82 });

    assert.equal(layout.yearX, 286.85);
    assert.equal(layout.yearY, 502.91);
    assert.equal(layout.stacked, false);
  });

  it("同排空间不足时把年份移到下一行", () => {
    const layout = detailHeaderLayout({ titleWidth: 240, yearWidth: 150 });

    assert.equal(layout.yearX, 99.85);
    assert.equal(layout.yearY, 525);
    assert.equal(layout.stacked, true);
  });

  it("顶边缺口不越过面板右边界", () => {
    const layout = detailHeaderLayout({ titleWidth: 330, yearWidth: 180 });

    assert.ok(layout.borderStartX <= 475.49);
  });
});
