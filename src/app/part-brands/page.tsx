import { createClient } from "@/lib/supabase/server";
import PartBrandsContent from "./PartBrandsContent";

export default async function PartBrandsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("part_brands")
    .select("*, part_name_brands(part_names(id, name, part_categories(name)))")
    .order("usage_count", { ascending: false });

  return <PartBrandsContent initialBrands={data || []} />;
}
