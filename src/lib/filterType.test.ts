import { describe, it, expect } from "vitest";
import { 判断三滤类型, 三滤类型名称, 三滤类型全称, 精准三滤类型 } from "./filterType";

describe("判断三滤类型", () => {
  it("识别机油滤", () => {
    expect(判断三滤类型("机油滤清器")).toBe("oil");
    expect(判断三滤类型("机油滤")).toBe("oil");
    expect(判断三滤类型("Oil Filter")).toBe("oil");
    expect(判断三滤类型("ölfilter")).toBe("oil");
  });

  it("识别空气滤", () => {
    expect(判断三滤类型("空气滤清器")).toBe("air");
    expect(判断三滤类型("空气滤")).toBe("air");
    expect(判断三滤类型("Air Filter")).toBe("air");
    expect(判断三滤类型("Luftfilter")).toBe("air");
  });

  it("识别空调滤", () => {
    expect(判断三滤类型("空调滤清器")).toBe("cabin");
    expect(判断三滤类型("空调滤")).toBe("cabin");
    expect(判断三滤类型("Cabin Filter")).toBe("cabin");
    expect(判断三滤类型("花粉滤")).toBe("cabin");
    expect(判断三滤类型("粉尘滤")).toBe("cabin");
  });

  it("不认识其他名称", () => {
    expect(判断三滤类型("刹车片")).toBeNull();
    expect(判断三滤类型("火花塞")).toBeNull();
    expect(判断三滤类型("")).toBeNull();
  });
});

describe("三滤类型名称", () => {
  it("返回中文简称", () => {
    expect(三滤类型名称("oil")).toBe("机油滤");
    expect(三滤类型名称("air")).toBe("空气滤");
    expect(三滤类型名称("cabin")).toBe("空调滤");
  });
});

describe("三滤类型全称", () => {
  it("返回中文全称", () => {
    expect(三滤类型全称("oil")).toBe("机油滤清器");
    expect(三滤类型全称("air")).toBe("空气滤清器");
    expect(三滤类型全称("cabin")).toBe("空调滤清器");
  });
});

describe("精准三滤类型", () => {
  it("只匹配标准名称", () => {
    expect(精准三滤类型("机油滤")).toBe("oil");
    expect(精准三滤类型("机油滤清器")).toBe("oil");
    expect(精准三滤类型("空气滤")).toBe("air");
    expect(精准三滤类型("空调滤")).toBe("cabin");
  });

  it("不匹配模糊名称", () => {
    expect(精准三滤类型("机油滤清器滤芯")).toBeNull();
    expect(精准三滤类型("Oil Filter")).toBeNull();
    expect(精准三滤类型("")).toBeNull();
  });
});
