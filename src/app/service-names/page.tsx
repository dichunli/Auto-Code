import { createClient } from "@/lib/supabase/server";
import ServiceNamesContent from "./ServiceNamesContent";

export default async function ServiceNamesPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("service_names")
    .select("*, service_categories(name), service_name_part_names(count)")
    .order("created_at", { ascending: false });
  return <ServiceNamesContent initialData={(data || [])} />;
}
