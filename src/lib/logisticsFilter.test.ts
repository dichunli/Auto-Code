import { describe, it, expect } from "vitest";
import {
  filterLogisticsByRegion,
  filterLogisticsBySupplierName,
  filterLogisticsBySupplierId,
  supplierNeedsLogistics,
  REGION_LABELS,
} from "./logisticsFilter";

interface 测试物流公司 {
  id: string;
  name: string;
  scopes?: string[] | null;
}

const 物流公司列表: 测试物流公司[] = [
  { id: "1", name: "哈市物流", scopes: ["harbin"] },
  { id: "2", name: "外阜物流", scopes: ["outside"] },
  { id: "3", name: "全区域物流", scopes: ["harbin", "outside"] },
  { id: "4", name: "未标注范围", scopes: [] },
];

describe("filterLogisticsByRegion", () => {
  it("本地供应商返回空数组（送货上门无需物流）", () => {
    expect(filterLogisticsByRegion(物流公司列表, "local")).toEqual([]);
  });

  it("哈市只显示服务哈市的公司", () => {
    const result = filterLogisticsByRegion(物流公司列表, "harbin");
    const ids = result.map((c) => c.id);
    expect(ids).toEqual(["1", "3", "4"]);
  });

  it("外阜只显示服务外阜的公司", () => {
    const result = filterLogisticsByRegion(物流公司列表, "outside");
    const ids = result.map((c) => c.id);
    expect(ids).toEqual(["2", "3"]);
  });

  it("未知区域返回全部", () => {
    expect(filterLogisticsByRegion(物流公司列表, undefined)).toEqual(物流公司列表);
    expect(filterLogisticsByRegion(物流公司列表, null)).toEqual(物流公司列表);
  });
});

describe("filterLogisticsBySupplierName", () => {
  const 供应商列表 = [
    { id: "a", name: "哈尔滨供应商", region: "harbin" },
    { id: "b", name: "本地供应商", region: "local" },
  ];

  it("按供应商名称找到区域并过滤", () => {
    const result = filterLogisticsBySupplierName(物流公司列表, "哈尔滨供应商", 供应商列表);
    const ids = result.map((c) => c.id);
    expect(ids).toEqual(["1", "3", "4"]);
  });

  it("无供应商名称返回全部", () => {
    expect(filterLogisticsBySupplierName(物流公司列表, null, 供应商列表)).toEqual(物流公司列表);
  });

  it("找不到供应商返回全部", () => {
    expect(filterLogisticsBySupplierName(物流公司列表, "不存在的供应商", 供应商列表)).toEqual(物流公司列表);
  });
});

describe("filterLogisticsBySupplierId", () => {
  const 供应商列表 = [
    { id: "a", name: "外阜供应商", region: "outside" },
  ];

  it("按供应商 ID 找到区域并过滤", () => {
    const result = filterLogisticsBySupplierId(物流公司列表, "a", 供应商列表);
    const ids = result.map((c) => c.id);
    expect(ids).toEqual(["2", "3"]);
  });

  it("无供应商 ID 返回全部", () => {
    expect(filterLogisticsBySupplierId(物流公司列表, undefined, 供应商列表)).toEqual(物流公司列表);
  });
});

describe("supplierNeedsLogistics", () => {
  it("本地不需要物流", () => {
    expect(supplierNeedsLogistics("local")).toBe(false);
  });

  it("哈市、外阜、未知都需要物流", () => {
    expect(supplierNeedsLogistics("harbin")).toBe(true);
    expect(supplierNeedsLogistics("outside")).toBe(true);
    expect(supplierNeedsLogistics(null)).toBe(true);
  });
});

describe("REGION_LABELS", () => {
  it("区域文案正确", () => {
    expect(REGION_LABELS.local).toBe("本地");
    expect(REGION_LABELS.harbin).toBe("哈市");
    expect(REGION_LABELS.outside).toBe("外阜");
  });
});
