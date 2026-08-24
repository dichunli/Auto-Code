import { describe, it, expect } from "vitest";
import { hasPermission, ROLE_PERMISSIONS } from "./permissions";

describe("hasPermission", () => {
  it("admin 通配符拥有全部权限", () => {
    expect(hasPermission(["admin"], "work_order:delete")).toBe(true);
    expect(hasPermission(["admin"], "payment:manage")).toBe(true);
  });

  it("角色拥有指定权限", () => {
    expect(hasPermission(["mechanic"], "work_order:repair")).toBe(true);
    expect(hasPermission(["warehouse"], "inventory:in")).toBe(true);
    expect(hasPermission(["accountant"], "report:profit")).toBe(true);
  });

  it("角色不拥有其他权限", () => {
    expect(hasPermission(["mechanic"], "payment:manage")).toBe(false);
    expect(hasPermission(["warehouse"], "work_order:create")).toBe(false);
  });

  it("多角色时任一角色拥有即可", () => {
    expect(hasPermission(["mechanic", "accountant"], "payment:manage")).toBe(true);
  });

  it("未知角色返回 false", () => {
    expect(hasPermission(["ghost"], "work_order:repair")).toBe(false);
  });

  it("空角色列表返回 false", () => {
    expect(hasPermission([], "work_order:repair")).toBe(false);
  });
});

describe("ROLE_PERMISSIONS", () => {
  it("每个角色都配置了权限", () => {
    const 角色列表 = Object.keys(ROLE_PERMISSIONS);
    expect(角色列表).toContain("admin");
    expect(角色列表).toContain("boss");
    expect(角色列表).toContain("receptionist");
    expect(角色列表).toContain("mechanic");
    expect(角色列表).toContain("warehouse");
    expect(角色列表).toContain("accountant");
  });

  it("只有 admin 拥有通配符", () => {
    for (const [角色, 权限列表] of Object.entries(ROLE_PERMISSIONS)) {
      if (角色 === "admin") {
        expect(权限列表).toContain("*");
      } else {
        expect(权限列表).not.toContain("*");
      }
    }
  });
});
