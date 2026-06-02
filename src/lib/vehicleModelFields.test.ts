import { describe, it, expect } from "vitest";
import { 车型库字段, 构建车型库查询字段, 车型库完整字段, 车型库匹配字段, 车型库展示字段 } from "./vehicleModelFields";

describe("车型库字段", () => {
  it("所有字段名都是中文（id除外）", () => {
    expect(车型库字段.id).toBe("id");
    expect(车型库字段.品牌).toBe("品牌");
    expect(车型库字段.车系).toBe("车系");
    expect(车型库字段.车型).toBe("车型");
    expect(车型库字段.年款).toBe("年款");
    expect(车型库字段.发动机型号).toBe("发动机型号");
  });

  it("构建查询字段返回逗号分隔的字符串", () => {
    const result = 构建车型库查询字段(["id", "品牌", "车系", "车型"]);
    expect(result).toBe("id, 品牌, 车系, 车型");
  });

  it("完整字段包含所有核心字段", () => {
    expect(车型库完整字段).toContain("品牌");
    expect(车型库完整字段).toContain("车系");
    expect(车型库完整字段).toContain("车型");
    expect(车型库完整字段).toContain("年款");
    expect(车型库完整字段).toContain("发动机型号");
  });

  it("匹配字段只包含匹配需要的字段", () => {
    expect(车型库匹配字段).toBe("id, 品牌, 车系, 车型, 年款, 发动机型号");
  });

  it("展示字段包含所有展示用字段", () => {
    expect(车型库展示字段).toContain("厂商");
    expect(车型库展示字段).toContain("排量");
    expect(车型库展示字段).toContain("燃油类型");
  });
});
