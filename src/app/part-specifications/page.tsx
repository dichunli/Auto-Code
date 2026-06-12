import { createClient } from "@/lib/supabase/server";
import PartSpecificationsContent from "./PartSpecificationsContent";

export default async function PartSpecificationsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("part_specifications")
    .select("*, part_name_specifications(part_names(id, name, part_categories(name)))")
    .order("usage_count", { ascending: false });
  return <PartSpecificationsContent initialSpecs={data || []} />;
}
