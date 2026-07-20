import { createClient } from "@/lib/supabase/server";
import TopicsContent from "./TopicsContent";

export const dynamic = "force-dynamic";

export default async function TopicsPage() {
  const supabase = await createClient();

  const { data } = await supabase
    .from("training_topics")
    .select("id, name, sort_order, is_active, created_at")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  const initialTopics = (data || []).map((item) => ({
    id: String(item.id),
    name: String(item.name),
    sort_order: Number(item.sort_order),
    is_active: Boolean(item.is_active),
    created_at: String(item.created_at),
  }));

  return <TopicsContent initialTopics={initialTopics} />;
}