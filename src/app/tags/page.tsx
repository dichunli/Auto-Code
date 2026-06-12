import { createClient } from "@/lib/supabase/server";
import TagsContent from "./TagsContent";

interface Tag {
  id: string;
  name: string;
  color: string;
}

export default async function TagsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tags")
    .select("id, name, color")
    .order("created_at", { ascending: false });

  return <TagsContent initialTags={(data || []) as Tag[]} />;
}
