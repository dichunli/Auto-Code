import { describe, it, expect } from "vitest";
import { base64转Blob } from "./base64ToBlob";

describe("base64转Blob", () => {
  it("正常转换带 MIME 类型的 base64 Data URL", () => {
    /* "Hello World" 的 base64 编码 */
    const base64 = "data:image/jpeg;base64,SGVsbG8gV29ybGQ=";
    const blob = base64转Blob(base64);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("image/jpeg");
  });

  it("无 MIME 类型时默认使用 image/jpeg", () => {
    const base64 = "data:base64,SGVsbG8gV29ybGQ=";
    const blob = base64转Blob(base64);
    expect(blob.type).toBe("image/jpeg");
  });

  it("转换 png 类型的 Data URL", () => {
    const base64 = "data:image/png;base64,iVBORw0KGgo=";
    const blob = base64转Blob(base64);
    expect(blob.type).toBe("image/png");
  });
});
