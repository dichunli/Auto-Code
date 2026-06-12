import { createClient } from "@/lib/supabase/server";
import PartCategoriesContent from "./PartCategoriesContent";

export default async function PartCategoriesPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("part_categories")
    .select("*")
    .order("sort_order", { ascending: true });

  return <PartCategoriesContent initialCategories={data || []} />;
}
