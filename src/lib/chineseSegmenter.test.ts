import { describe, it, expect } from "vitest";
import { 中文分词 } from "./chineseSegmenter";

describe("中文分词", () => {
  it("应正确分词汽修领域连续中文", () => {
    expect(中文分词("捷达点烟器")).toEqual(["捷达", "点烟器"]);
    expect(中文分词("发动机异响")).toEqual(["发动机", "异响"]);
    expect(中文分词("刹车片更换")).toEqual(["刹车片", "更换"]);
  });

  it("应正确处理中英文混合", () => {
    expect(中文分词("捷达A5点烟器")).toEqual(["捷达", "A5", "点烟器"]);
    expect(中文分词("ABS泵故障")).toEqual(["ABS", "泵", "故障"]);
    expect(中文分词("ECU匹配")).toEqual(["ECU", "匹配"]);
  });

  it("应忽略空格", () => {
    expect(中文分词("捷达 点烟器")).toEqual(["捷达", "点烟器"]);
    expect(中文分词("  发动机   异响  ")).toEqual(["发动机", "异响"]);
  });

  it("对词库未覆盖的中文词应单字切分，特殊符号应忽略", () => {
    expect(中文分词("@#$%")).toEqual([]);
    // 假设"逍遥"不在词库中
    expect(中文分词("逍遥")).toEqual(["逍", "遥"]);
  });

  it("支持传入自定义扩展词库", () => {
    const 无自定义 = 中文分词("碳罐电磁阀保养");
    const 有自定义 = 中文分词("碳罐电磁阀保养", ["碳罐电磁阀"]);
    expect(有自定义).toEqual(["碳罐电磁阀", "保养"]);
    expect(无自定义).not.toEqual(["碳罐电磁阀", "保养"]);
  });
});
