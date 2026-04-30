"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { hasPermission, type Permission } from "@/lib/permissions";

interface PermissionGateProps {
  permission: Permission;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function PermissionGate({ permission, children, fallback }: PermissionGateProps) {
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchRoles() {
      const supabase = createClient();
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        setLoading(false);
        return;
      }
      const { data } = await supabase
        .from("profile_roles")
        .select("roles(name)")
        .eq("profile_id", userData.user.id);

      const names = (data || []).map((d: any) => d.roles?.name).filter(Boolean);
      setRoles(names);
      setLoading(false);
    }
    fetchRoles();
  }, []);

  if (loading) return null;
  if (hasPermission(roles, permission)) return <>{children}</>;
  return <>{fallback || null}</>;
}
