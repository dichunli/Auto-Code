import { createClient } from "@/lib/supabase/server";
import ReworkRecordsContent from "./ReworkRecordsContent";

interface 员工 {
  id: string;
  full_name: string;
}

interface 返工记录 {
  id: string;
  employee_name: string;
  work_order_no: string | null;
  description: string;
  loss_amount: number;
  recorded_at: string;
}

/* 首屏数据在服务端查询（原客户端 useEffect 加载会闪空白），
 * 增删改后的客户端重查逻辑在 ReworkRecordsContent 内保持不变 */
export default async function ReworkRecordsPage() {
  const supabase = await createClient();
  const [{ data: empData }, { data: recordData }] = await Promise.all([
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    supabase
      .from("rework_records")
      .select("id, description, loss_amount, recorded_at, profiles!rework_records_employee_id_fkey(full_name), work_orders!rework_records_work_order_id_fkey(order_no)")
      .order("recorded_at", { ascending: false })
      .limit(50),
  ]);

  const employees: 员工[] = (empData as 员工[] | null) || [];

  const records: 返工记录[] = (recordData || []).map((r: unknown) => {
    const rec = r as {
      id: string;
      description: string;
      loss_amount: number;
      recorded_at: string;
      profiles: { full_name: string }[] | { full_name: string } | null;
      work_orders: { order_no: string }[] | { order_no: string } | null;
    };
    const profile = Array.isArray(rec.profiles) ? rec.profiles[0] : rec.profiles;
    const wo = Array.isArray(rec.work_orders) ? rec.work_orders[0] : rec.work_orders;
    return {
      id: rec.id,
      employee_name: profile?.full_name || "",
      work_order_no: wo?.order_no || null,
      description: rec.description,
      loss_amount: rec.loss_amount,
      recorded_at: rec.recorded_at,
    };
  });

  return <ReworkRecordsContent initialEmployees={employees} initialRecords={records} />;
}
