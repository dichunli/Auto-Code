import { createClient } from "@/lib/supabase/server";
import BorrowRecordsContent, { type 借用记录, type 归还照片 } from "./BorrowRecordsContent";

/* 工具借还记录 — Server Component
 * 首屏数据（记录列表含借用人/归还人姓名、归还照片）在服务端查询，
 * 避免 SPA 软导航时客户端 session 未就绪导致空白 */

export default async function BorrowRecordsPage() {
  const supabase = await createClient();

  const { data } = await supabase
    .from("tool_borrow_records")
    .select("*, tools(code, name)")
    .order("borrowed_at", { ascending: false })
    .limit(500);

  let records = (data || []) as 借用记录[];

  /* 加载借用人 / 归还人姓名 */
  const userIds = [...new Set(records.flatMap((r) => [r.borrower_id, r.returner_id].filter(Boolean)))] as string[];
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", userIds);
    const map = new Map((profiles || []).map((p) => [p.id, p]));
    records = records.map((r) => ({
      ...r,
      borrower_profile: (r.borrower_id ? map.get(r.borrower_id) : null) as { full_name: string } | null,
      returner_profile: (r.returner_id ? map.get(r.returner_id) : null) as { full_name: string } | null,
    }));
  }

  /* 加载归还照片 */
  const photoEntries: [string, 归还照片[]][] = [];
  const recordIds = records.map((r) => r.id);
  if (recordIds.length > 0) {
    const { data: photos } = await supabase
      .from("tool_return_photos")
      .select("id, borrow_record_id, photo_url")
      .in("borrow_record_id", recordIds)
      .order("created_at", { ascending: true });
    const photoMap = new Map<string, 归还照片[]>();
    (photos || []).forEach((p) => {
      const arr = photoMap.get(p.borrow_record_id) || [];
      arr.push(p as 归还照片);
      photoMap.set(p.borrow_record_id, arr);
    });
    photoMap.forEach((value, key) => photoEntries.push([key, value]));
  }

  return <BorrowRecordsContent initialRecords={records} initialPhotoEntries={photoEntries} />;
}
