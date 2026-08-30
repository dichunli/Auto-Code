import { describe, it, expect } from "vitest";
import { getPartWorkflowStatus, WORKFLOW_STATUS_LABELS, type PartWorkflowContext } from "./partWorkflow";

/* 配件工作流状态判定：采购看板/工单配件的状态标签都靠它，判定错一步整个流转就乱 */
function 基线(覆盖: Partial<PartWorkflowContext> = {}): PartWorkflowContext {
  return {
    unit_cost: 100,
    unit_price: 150,
    customer_opinion: "agree",
    is_purchased: true,
    is_arrived: true,
    part_id: "p1",
    quantity: 2,
    inventoryQty: 10,
    pickedQty: 0,
    hasReturnRecords: false,
    hasPendingSupplierReturn: false,
    ...覆盖,
  };
}

describe("getPartWorkflowStatus 配件工作流状态判定", () => {
  it("供应商退货挂起 → 退货（最高优先）", () => {
    expect(getPartWorkflowStatus(基线({ hasPendingSupplierReturn: true, pickedQty: 2 }))).toBe("supplier_return");
  });

  it("领料数够 → 已领料", () => {
    expect(getPartWorkflowStatus(基线({ pickedQty: 2 }))).toBe("picked");
  });

  it("有退库记录且未领料 → 退库", () => {
    expect(getPartWorkflowStatus(基线({ hasReturnRecords: true, pickedQty: 0 }))).toBe("returned");
  });

  it("无进价 → 待询价", () => {
    expect(getPartWorkflowStatus(基线({ unit_cost: null }))).toBe("pending_inquiry");
  });

  it("有进价无销售价 → 待报价", () => {
    expect(getPartWorkflowStatus(基线({ unit_price: null }))).toBe("pending_quote");
  });

  it("有销售价但客户未确认 → 待确认", () => {
    expect(getPartWorkflowStatus(基线({ customer_opinion: "pending" }))).toBe("pending_confirm");
  });

  it("客户同意后未采购：有库存 → 待领料", () => {
    expect(getPartWorkflowStatus(基线({ is_purchased: false, part_id: "p1", inventoryQty: 5 }))).toBe("pending_picking");
  });

  it("客户同意后未采购：无库存/无关联配件 → 待采购", () => {
    expect(getPartWorkflowStatus(基线({ is_purchased: false, part_id: null, inventoryQty: 0 }))).toBe("pending_purchase");
    expect(getPartWorkflowStatus(基线({ is_purchased: false, part_id: "p1", inventoryQty: 0 }))).toBe("pending_purchase");
  });

  it("已采购未到货 → 待收货", () => {
    expect(getPartWorkflowStatus(基线({ is_arrived: false }))).toBe("pending_receipt");
  });

  it("已到货但还没关联库存配件 → 待入库", () => {
    expect(getPartWorkflowStatus(基线({ part_id: null }))).toBe("pending_inbound");
  });

  it("已到货已关联 → 待领料", () => {
    expect(getPartWorkflowStatus(基线())).toBe("pending_picking");
  });

  it("客户拒绝 → 回退待确认", () => {
    expect(getPartWorkflowStatus(基线({ customer_opinion: "reject" }))).toBe("pending_confirm");
  });

  it("每个状态都有中文标签", () => {
    const 状态们: PartWorkflowContext[] = [
      基线({ hasPendingSupplierReturn: true }),
      基线({ pickedQty: 2 }),
      基线({ hasReturnRecords: true }),
      基线({ unit_cost: null }),
      基线({ unit_price: null }),
      基线({ customer_opinion: "pending" }),
      基线({ is_purchased: false, inventoryQty: 0 }),
      基线({ is_arrived: false }),
      基线({ part_id: null }),
      基线(),
    ];
    for (const ctx of 状态们) {
      const s = getPartWorkflowStatus(ctx);
      expect(WORKFLOW_STATUS_LABELS[s], `状态 ${s} 缺标签`).toBeTruthy();
    }
  });
});
