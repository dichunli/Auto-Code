import { createClient } from "@/lib/supabase/server";
import PartSpecificationsContent from "./PartSpecificationsContent";

/* 首屏只取第一页（原来全表拉取，规格库涨后整页渲染卡顿） */
const 每页数 = 20;

export default async function PartSpecificationsPage() {
  const supabase = await createClient();
  const { data, count } = await supabase
    .from("part_specifications")
    .select("*, part_name_specifications(part_names(id, name, part_categories(name)))", { count: "exact" })
    .order("usage_count", { ascending: false })
    .range(0, 每页数 - 1);
  return <PartSpecificationsContent initialSpecs={data || []} initialTotal={count || 0} 每页数={每页数} />;
}
