import { createClient } from "@/lib/supabase/server";
import ServiceCategoriesContent from "./ServiceCategoriesContent";

export default async function ServiceCategoriesPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("service_categories")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  return <ServiceCategoriesContent initialCategories={data || []} />;
}
