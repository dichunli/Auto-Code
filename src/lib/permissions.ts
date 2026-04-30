export type Permission =
  | "work_order:create"
  | "work_order:diagnose"
  | "work_order:quote"
  | "work_order:repair"
  | "work_order:quality_check"
  | "work_order:settle"
  | "work_order:deliver"
  | "inventory:manage"
  | "inventory:in"
  | "inventory:out"
  | "customer:manage"
  | "vehicle:manage"
  | "report:view"
  | "report:profit"
  | "report:performance"
  | "dashboard:all"
  | "payment:manage"
  | "*";

export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  admin: ["*"],
  boss: ["report:view", "report:profit", "report:performance", "dashboard:all", "customer:manage", "vehicle:manage"],
  receptionist: [
    "work_order:create",
    "work_order:quote",
    "work_order:settle",
    "work_order:deliver",
    "customer:manage",
    "vehicle:manage",
  ],
  mechanic: ["work_order:diagnose", "work_order:repair", "work_order:quality_check"],
  warehouse: ["inventory:manage", "inventory:in", "inventory:out"],
  accountant: ["payment:manage", "report:view", "report:profit"],
};

export function hasPermission(userRoles: string[], permission: Permission): boolean {
  for (const role of userRoles) {
    const perms = ROLE_PERMISSIONS[role] || [];
    if (perms.includes("*") || perms.includes(permission)) return true;
  }
  return false;
}
