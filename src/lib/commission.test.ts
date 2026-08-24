import { describe, it, expect } from "vitest";
import {
  calculateCommission,
  extractCommission,
  calculateItemCommission,
  calculatePartCommission,
  calculateDispatchClaimCommission,
  getDispatchClaimCommission,
  formatCommission,
} from "./commission";

describe("calculateCommission", () => {
  it("营收百分比按营业额计算", () => {
    expect(calculateCommission("revenue_pct", 10, 1000)).toBe(100);
  });

  it("营收百分比保留2位小数", () => {
    /* 33.3333... 应四舍五入为 33.33 */
    expect(calculateCommission("revenue_pct", 10, 333.333)).toBe(33.33);
  });

  it("利润百分比按（营收-成本）计算", () => {
    expect(calculateCommission("profit_pct", 50, 1000, 600)).toBe(200);
  });

  it("利润为负时按 0 计算，不提成", () => {
    expect(calculateCommission("profit_pct", 50, 100, 200)).toBe(0);
  });

  it("固定金额直接返回", () => {
    expect(calculateCommission("fixed", 88, 1000)).toBe(88);
  });

  it("无类型或无数值返回 0", () => {
    expect(calculateCommission(null, 10, 1000)).toBe(0);
    expect(calculateCommission("revenue_pct", null, 1000)).toBe(0);
    expect(calculateCommission(undefined, 10, 1000)).toBe(0);
  });

  it("未知类型返回 0", () => {
    expect(calculateCommission("unknown_type", 10, 1000)).toBe(0);
  });
});

describe("extractCommission", () => {
  it("从对象提取类型和数值", () => {
    const result = extractCommission(
      { sales_commission_type: "revenue_pct", sales_commission_value: 10 },
      "sales"
    );
    expect(result).toEqual({ type: "revenue_pct", value: 10 });
  });

  it("缺类型或缺数值返回 undefined", () => {
    expect(extractCommission({ sales_commission_value: 10 }, "sales")).toBeUndefined();
    expect(extractCommission({ sales_commission_type: "fixed" }, "sales")).toBeUndefined();
  });

  it("对象为空返回 undefined", () => {
    expect(extractCommission(null, "sales")).toBeUndefined();
    expect(extractCommission(undefined, "sales")).toBeUndefined();
  });
});

describe("calculateItemCommission", () => {
  const serviceItem = {
    repair_commission_type: "fixed",
    repair_commission_value: 100,
    sales_commission_type: "revenue_pct",
    sales_commission_value: 5,
  };
  const serviceName = {
    diagnosis_commission_type: "profit_pct",
    diagnosis_commission_value: 50,
  };
  const category = {
    qc_commission_type: "fixed",
    qc_commission_value: 30,
  };

  it("按优先级 service_item → service_name → category 取提成", () => {
    const result = calculateItemCommission(
      {},
      serviceItem,
      serviceName,
      category,
      1000,
      600
    );
    /* repair 走 serviceItem（固定 100），sales 走 serviceItem（营收 5%），
       diagnosis 走 serviceName（利润 50%），qc 走 category（固定 30） */
    expect(result).toEqual({
      diagnosis: 200,
      repair: 100,
      sales: 50,
      qc: 30,
    });
  });

  it("无任何来源时全为 0", () => {
    expect(calculateItemCommission(null, null, null, null, 1000)).toEqual({
      diagnosis: 0,
      repair: 0,
      sales: 0,
      qc: 0,
    });
  });
});

describe("calculatePartCommission", () => {
  it("按优先级 part → part_name 取提成", () => {
    const part = { sales_commission_type: "fixed", sales_commission_value: 20 };
    const partName = {
      sales_commission_type: "revenue_pct",
      sales_commission_value: 3,
      picking_commission_type: "fixed",
      picking_commission_value: 10,
    };
    const result = calculatePartCommission(part, partName, 1000, 0);
    /* sales 走 part（固定 20），picking 走 part_name（固定 10），其余为 0 */
    expect(result).toEqual({
      sales: 20,
      repair: 0,
      diagnosis: 0,
      qc: 0,
      picking: 10,
    });
  });

  it("无来源时全为 0", () => {
    expect(calculatePartCommission(null, null, 1000)).toEqual({
      sales: 0,
      repair: 0,
      diagnosis: 0,
      qc: 0,
      picking: 0,
    });
  });
});

describe("calculateDispatchClaimCommission", () => {
  it("营收百分比计算", () => {
    expect(calculateDispatchClaimCommission("revenue_pct", 10, 1000)).toBe(100);
  });

  it("利润百分比按营收计算（无成本参数）", () => {
    expect(calculateDispatchClaimCommission("profit_pct", 10, 1000)).toBe(100);
  });

  it("固定金额直接返回", () => {
    expect(calculateDispatchClaimCommission("fixed", 50, 1000)).toBe(50);
  });

  it("无类型或无数值返回 0", () => {
    expect(calculateDispatchClaimCommission(null, 10, 1000)).toBe(0);
    expect(calculateDispatchClaimCommission("fixed", null, 1000)).toBe(0);
  });
});

describe("getDispatchClaimCommission", () => {
  it("从对象提取并计算", () => {
    const obj = { dispatch_commission_type: "revenue_pct", dispatch_commission_value: 5 };
    expect(getDispatchClaimCommission(obj, "dispatch", 1000)).toBe(50);
  });

  it("无来源返回 0", () => {
    expect(getDispatchClaimCommission(null, "dispatch", 1000)).toBe(0);
    expect(getDispatchClaimCommission({}, "dispatch", 1000)).toBe(0);
  });
});

describe("formatCommission", () => {
  it("营收百分比", () => {
    expect(formatCommission("revenue_pct", 10)).toBe("营收10%");
  });

  it("利润百分比", () => {
    expect(formatCommission("profit_pct", 20)).toBe("利润20%");
  });

  it("固定金额", () => {
    expect(formatCommission("fixed", 88)).toBe("88元");
  });

  it("空值返回空字符串", () => {
    expect(formatCommission(null, 10)).toBe("");
    expect(formatCommission("fixed", null)).toBe("");
  });

  it("未知类型返回空字符串", () => {
    expect(formatCommission("unknown", 10)).toBe("");
  });
});
