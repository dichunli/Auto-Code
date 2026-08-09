import { createClient } from "@/lib/supabase/server";
import LossRecordsContent from "./LossRecordsContent";

interface 员工 {
  id: string;
  full_name: string;
}

interface 损失记录 {
  id: string;
  employee_name: string;
  loss_type: string;
  description: string;
  loss_amount: number;
  recorded_at: string;
}

/* 首屏数据在服务端查询（原客户端 useEffect 加载会闪空白），
 * 增删改后的客户端重查逻辑在 LossRecordsContent 内保持不变 */
export default async function LossRecordsPage() {
  const supabase = await createClient();
  const [{ data: empData }, { data: recordData }] = await Promise.all([
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    supabase
      .from("daily_loss_records")
      .select("id, loss_type, description, loss_amount, recorded_at, profiles!daily_loss_records_employee_id_fkey(full_name)")
      .order("recorded_at", { ascending: false })
      .limit(50),
  ]);

  const employees: 员工[] = (empData as 员工[] | null) || [];

  const records: 损失记录[] = (recordData || []).map((r: unknown) => {
    const rec = r as {
      id: string;
      loss_type: string;
      description: string;
      loss_amount: number;
      recorded_at: string;
      profiles: { full_name: string }[] | { full_name: string } | null;
    };
    const profile = Array.isArray(rec.profiles) ? rec.profiles[0] : rec.profiles;
    return {
      id: rec.id,
      employee_name: profile?.full_name || "",
      loss_type: rec.loss_type,
      description: rec.description,
      loss_amount: rec.loss_amount,
      recorded_at: rec.recorded_at,
    };
  });

  return <LossRecordsContent initialEmployees={employees} initialRecords={records} />;
}
