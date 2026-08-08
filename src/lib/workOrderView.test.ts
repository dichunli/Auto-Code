import { describe, it, expect } from "vitest";
import { buildWorkOrderView, type WorkOrderViewInput } from "./workOrderView";

// 构造一个最小可用的输入，测试时按需覆盖个别字段
function 造输入(覆盖: Partial<WorkOrderViewInput> = {}): WorkOrderViewInput {
  return {
    order: { id: "o1", status: "received", vehicles: null },
    requirements: [],
    items: [],
    itemMedia: [],
    itemMechanics: [],
    requirementMedia: [],
    knowledgeLinks: [],
    itemParts: [],
    partMedia: [],
    pickingRecords: [],
    pickRequests: null,
    returnRecords: [],
    supplierReturnRecords: [],
    partBatches: [],
    inspections: [],
    inspectionMedia: [],
    advancePaymentRecords: [],
    otherOrdersByType: [],
    ...覆盖,
  };
}

describe("预收款净额 advancePaymentTotal", () => {
  it("多笔预收款累加", () => {
    const v = buildWorkOrderView(造输入({
      advancePaymentRecords: [{ id: "a1", amount: 100 }, { id: "a2", amount: 50 }],
    }));
    expect(v.advancePaymentTotal).toBe(150);
  });

  it("扣除已退款金额", () => {
    const v = buildWorkOrderView(造输入({
      advancePaymentRecords: [{ id: "a1", amount: 200, refunded_amount: 80 }],
    }));
    expect(v.advancePaymentTotal).toBe(120);
  });

  it("空记录为0", () => {
    expect(buildWorkOrderView(造输入()).advancePaymentTotal).toBe(0);
  });
});

describe("配件库存聚合 inventoryByPart", () => {
  it("同一配件多批次累加", () => {
    const v = buildWorkOrderView(造输入({
      partBatches: [
        { part_id: "A", quantity: 10 },
        { part_id: "A", quantity: 5 },
        { part_id: "B", quantity: 3 },
      ],
    }));
    expect(v.inventoryByPart["A"]).toBe(15);
    expect(v.inventoryByPart["B"]).toBe(3);
  });
});

describe("领料/退库聚合", () => {
  it("领料按分支累加", () => {
    const v = buildWorkOrderView(造输入({
      pickingRecords: [
        { work_order_item_part_id: "p1", quantity: 2 },
        { work_order_item_part_id: "p1", quantity: 3 },
      ],
    }));
    expect(v.pickingByPart["p1"]).toBe(5);
  });

  it("退库按分支累加", () => {
    const v = buildWorkOrderView(造输入({
      returnRecords: [{ work_order_item_part_id: "p1", quantity: 1 }],
    }));
    expect(v.returnByPart["p1"]).toBe(1);
  });

  it("待处理供应商退货标记", () => {
    const v = buildWorkOrderView(造输入({
      supplierReturnRecords: [
        { work_order_item_part_id: "p1", status: "pending" },
        { work_order_item_part_id: "p2", status: "done" },
      ],
    }));
    expect(v.pendingSupplierReturnByPart["p1"]).toBe(true);
    expect(v.pendingSupplierReturnByPart["p2"]).toBeUndefined();
  });
});

describe("配件分组 partGroupsByItem", () => {
  it("同 part_name_id 的分支归为一组", () => {
    const v = buildWorkOrderView(造输入({
      itemParts: [
        { work_order_item_id: "item1", id: "b1", part_name_id: "机油", name: "机油", sort_order: 1 },
        { work_order_item_id: "item1", id: "b2", part_name_id: "机油", name: "机油", sort_order: 2 },
        { work_order_item_id: "item1", id: "b3", part_name_id: "滤芯", name: "滤芯", sort_order: 1 },
      ],
    }));
    const groups = v.partGroupsByItem.get("item1")!;
    expect(groups.length).toBe(2); // 机油组、滤芯组
    const 机油组 = groups.find((g) => g.name === "机油")!;
    expect(机油组.parts.length).toBe(2); // 两个分支
  });

  it("组内分支按 sort_order 排序，代表为第一条", () => {
    const v = buildWorkOrderView(造输入({
      itemParts: [
        { work_order_item_id: "item1", id: "b2", part_name_id: "机油", name: "机油", sort_order: 2 },
        { work_order_item_id: "item1", id: "b1", part_name_id: "机油", name: "机油", sort_order: 1 },
      ],
    }));
    const 机油组 = v.partGroupsByItem.get("item1")!.find((g) => g.name === "机油")!;
    expect(机油组.repId).toBe("b1"); // sort_order 最小的作代表
    expect(机油组.parts[0].id).toBe("b1");
  });

  it("无 part_name_id 的分支各自独立成组", () => {
    const v = buildWorkOrderView(造输入({
      itemParts: [
        { work_order_item_id: "item1", id: "b1", name: "临时件1" },
        { work_order_item_id: "item1", id: "b2", name: "临时件2" },
      ],
    }));
    expect(v.partGroupsByItem.get("item1")!.length).toBe(2);
  });
});

describe("工单锁定状态 isLocked", () => {
  it("已结算/已交付/待结算为锁定", () => {
    expect(buildWorkOrderView(造输入({ order: { id: "o1", status: "settled", vehicles: null } })).isLocked).toBe(true);
    expect(buildWorkOrderView(造输入({ order: { id: "o1", status: "delivered", vehicles: null } })).isLocked).toBe(true);
    expect(buildWorkOrderView(造输入({ order: { id: "o1", status: "pending_settlement", vehicles: null } })).isLocked).toBe(true);
  });

  it("施工中等状态不锁定", () => {
    expect(buildWorkOrderView(造输入({ order: { id: "o1", status: "received", vehicles: null } })).isLocked).toBe(false);
  });
});

describe("检查记录分组", () => {
  it("按类型分成接车检查和车况检查", () => {
    const v = buildWorkOrderView(造输入({
      inspections: [
        { id: "i1", inspection_type: "reception" },
        { id: "i2", inspection_type: "inspection" },
        { id: "i3", inspection_type: "inspection" },
      ],
    }));
    expect(v.receptionInspections.length).toBe(1);
    expect(v.conditionInspections.length).toBe(2);
  });
});

describe("未关联需求的项目 orphanItems", () => {
  it("筛出没有 requirement_id 的项目", () => {
    const v = buildWorkOrderView(造输入({
      items: [
        { id: "it1", requirement_id: "req1" },
        { id: "it2", requirement_id: null },
        { id: "it3" },
      ],
    }));
    expect(v.orphanItems.map((i) => i.id).sort()).toEqual(["it2", "it3"]);
  });
});

