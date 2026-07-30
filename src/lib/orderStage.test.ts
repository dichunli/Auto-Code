import { describe, it, expect } from "vitest";
import {
  getItemStageKey,
  computeBoardStages,
  readyToClose,
  type 项目状态输入,
  type 工单状态输入,
} from "./orderStage";

/* 快捷构造：labor 项目（默认客户已同意，便于聚焦其它维度） */
function 项目(覆盖: Partial<项目状态输入> = {}): 项目状态输入 {
  return {
    item_type: "labor",
    status: "pending",
    require_qc: false,
    qc_status: "none",
    customer_opinion: "agree",
    已派工: false,
    ...覆盖,
  };
}

function 工单(覆盖: Partial<工单状态输入> = {}): 工单状态输入 {
  return {
    status: "repairing",
    有未指派需求: false,
    项目列表: [],
    配件列表: [],
    ...覆盖,
  };
}

describe("getItemStageKey 项目状态", () => {
  it("未派工 → 待派工", () => {
    expect(getItemStageKey(项目({ 已派工: false }))).toBe("pending_dispatch");
  });

  it("已派工未开始 → 待施工", () => {
    expect(getItemStageKey(项目({ 已派工: true }))).toBe("pending_construction");
  });

  it("质检不合格被打回（pending+已派工+failed）→ 待施工", () => {
    expect(getItemStageKey(项目({ 已派工: true, qc_status: "failed" }))).toBe("pending_construction");
  });

  it("客户意见未填（pending）→ 待确认（最优先，未派工也先显示待确认）", () => {
    expect(getItemStageKey(项目({ customer_opinion: "pending", 已派工: false }))).toBe("pending_confirm");
    expect(getItemStageKey(项目({ customer_opinion: "pending", 已派工: true }))).toBe("pending_confirm");
    expect(getItemStageKey(项目({ customer_opinion: null, 已派工: true }))).toBe("pending_confirm");
  });

  it("客户否决（reject）→ null（不进入任何阶段）", () => {
    expect(getItemStageKey(项目({ customer_opinion: "reject", 已派工: true }))).toBeNull();
    expect(getItemStageKey(项目({ customer_opinion: "reject", status: "completed" }))).toBeNull();
  });

  it("已完工项目不受客户意见 pending 影响（完工即完工）", () => {
    expect(getItemStageKey(项目({ status: "completed", customer_opinion: "pending", 已派工: true }))).toBe("completed");
  });

  it("施工中 / 已中断", () => {
    expect(getItemStageKey(项目({ status: "in_progress", 已派工: true }))).toBe("in_progress");
    expect(getItemStageKey(项目({ status: "paused", 已派工: true }))).toBe("paused");
  });

  it("完工+须质检+未检 → 待质检", () => {
    expect(getItemStageKey(项目({ status: "completed", require_qc: true, qc_status: "none", 已派工: true }))).toBe("pending_qc");
  });

  it("完工+不须质检 → 已完工（质检非必走）", () => {
    expect(getItemStageKey(项目({ status: "completed", require_qc: false, 已派工: true }))).toBe("completed");
  });

  it("完工+须质检+已合格 → 已完工", () => {
    expect(getItemStageKey(项目({ status: "completed", require_qc: true, qc_status: "passed", 已派工: true }))).toBe("completed");
  });

  it("非 labor 项目 → null（不算施工状态）", () => {
    expect(getItemStageKey(项目({ item_type: "part", 已派工: true }))).toBeNull();
  });
});

describe("readyToClose 待结单判定（唯一通道：全部派工+配件全出库）", () => {
  it("全部完工已派工+无配件 → true（无配件只看全部派工）", () => {
    expect(readyToClose(工单({
      项目列表: [项目({ status: "completed", 已派工: true })],
    }))).toBe(true);
  });

  it("全部完工+须质检已合格+无配件 → true", () => {
    expect(readyToClose(工单({
      项目列表: [项目({ status: "completed", require_qc: true, qc_status: "passed", 已派工: true })],
    }))).toBe(true);
  });

  it("新规则核心：全部完工+质检合格但配件未出库 → false（完工不再单独放行）", () => {
    expect(readyToClose(工单({
      项目列表: [项目({ status: "completed", require_qc: true, qc_status: "passed", 已派工: true })],
      配件列表: [{ is_selected: true, quantity: 1, 净出库: 0 }],
    }))).toBe(false);
  });

  it("全部完工不须质检但配件出库不足 → false", () => {
    expect(readyToClose(工单({
      项目列表: [项目({ status: "completed", 已派工: true })],
      配件列表: [{ is_selected: true, quantity: 2, 净出库: 1 }],
    }))).toBe(false);
  });

  it("须质检未检+配件未出库 → false", () => {
    expect(readyToClose(工单({
      项目列表: [项目({ status: "completed", require_qc: true, qc_status: "none", 已派工: true })],
      配件列表: [{ is_selected: true, quantity: 1, 净出库: 0 }],
    }))).toBe(false);
  });

  it("全部已派工+配件全出库，未完工未质检也 → true", () => {
    expect(readyToClose(工单({
      项目列表: [项目({ status: "pending", 已派工: true })],
      配件列表: [{ is_selected: true, quantity: 2, 净出库: 2 }],
    }))).toBe(true);
  });

  it("配件出库不足 → false", () => {
    expect(readyToClose(工单({
      项目列表: [项目({ status: "pending", 已派工: true })],
      配件列表: [{ is_selected: true, quantity: 2, 净出库: 1 }],
    }))).toBe(false);
  });

  it("有项目未派工 → false", () => {
    expect(readyToClose(工单({
      项目列表: [项目({ 已派工: false })],
      配件列表: [],
    }))).toBe(false);
  });

  it("未选中配件分支不参与出库判定", () => {
    expect(readyToClose(工单({
      项目列表: [项目({ status: "pending", 已派工: true })],
      配件列表: [{ is_selected: false, quantity: 5, 净出库: 0 }],
    }))).toBe(true);
  });

  it("空工单（无项目无配件）→ false（防空单直接可结单）", () => {
    expect(readyToClose(工单({}))).toBe(false);
  });

  it("reject 项目不阻塞结单：否决项目不算未派工 → true", () => {
    expect(readyToClose(工单({
      项目列表: [
        项目({ status: "completed", 已派工: true }),
        项目({ customer_opinion: "reject", status: "pending", 已派工: false }),
      ],
    }))).toBe(true);
  });

  it("全部项目被否决+无配件 → false（等于没有可结单内容）", () => {
    expect(readyToClose(工单({
      项目列表: [项目({ customer_opinion: "reject" })],
      配件列表: [],
    }))).toBe(false);
  });
});

describe("computeBoardStages 工单多徽章", () => {
  it("已结算/已交车 → [已结算]", () => {
    expect(computeBoardStages(工单({ status: "settled" }))).toEqual(["settled"]);
    expect(computeBoardStages(工单({ status: "delivered" }))).toEqual(["settled"]);
  });

  it("待结算 → [待结算]", () => {
    expect(computeBoardStages(工单({ status: "pending_settlement" }))).toEqual(["pending_settlement"]);
  });

  it("无项目 → [待诊断]", () => {
    expect(computeBoardStages(工单({ status: "pending_diagnosis" }))).toEqual(["pending_diagnosis"]);
  });

  it("有需求未指派 → 含待诊断（规则1）", () => {
    expect(computeBoardStages(工单({
      有未指派需求: true,
      项目列表: [项目({ 已派工: true })],
    }))).toContain("pending_diagnosis");
  });

  it("多阶段同时显示：施工中+待派工（用户拍板）", () => {
    const stages = computeBoardStages(工单({
      项目列表: [
        项目({ status: "in_progress", 已派工: true }),
        项目({ status: "pending", 已派工: false }),
      ],
    }));
    expect(stages).toContain("in_progress");
    expect(stages).toContain("pending_dispatch");
    /* 顺序按流程：待派工 在 施工中 前 */
    expect(stages.indexOf("pending_dispatch")).toBeLessThan(stages.indexOf("in_progress"));
  });

  it("待质检+快速通道命中 → 待质检与待结单同时显示", () => {
    const stages = computeBoardStages(工单({
      项目列表: [项目({ status: "completed", require_qc: true, qc_status: "none", 已派工: true })],
      配件列表: [],
    }));
    expect(stages).toContain("pending_qc");
    expect(stages).toContain("pending_close");
  });

  it("全部完工（不须质检）→ 已完工与待结单同时显示（已完工徽章回归）", () => {
    const stages = computeBoardStages(工单({
      项目列表: [项目({ status: "completed", 已派工: true })],
    }));
    expect(stages).toEqual(["completed", "pending_close"]);
  });

  it("部分完工：已完工与施工中同时显示（用户需求6：已完工页面可见）", () => {
    const stages = computeBoardStages(工单({
      项目列表: [
        项目({ status: "completed", 已派工: true }),
        项目({ status: "in_progress", 已派工: true }),
      ],
    }));
    expect(stages).toContain("completed");
    expect(stages).toContain("in_progress");
  });

  it("意见 pending 的项目 → 工单显示待确认；reject 项目不产生任何徽章", () => {
    const stages = computeBoardStages(工单({
      项目列表: [
        项目({ customer_opinion: "pending", 已派工: false }),
        项目({ customer_opinion: "reject" }),
      ],
    }));
    expect(stages).toContain("pending_confirm");
    expect(stages).not.toContain("pending_dispatch");
  });

  it("存储态 pending_close 直达，忽略项目细节", () => {
    expect(computeBoardStages(工单({
      status: "pending_close",
      项目列表: [项目({ status: "in_progress", 已派工: true })],
    }))).toEqual(["pending_close"]);
  });
});
