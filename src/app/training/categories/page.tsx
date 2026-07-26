import { createClient } from "@/lib/supabase/server";
import TrainingCategoriesContent from "./TrainingCategoriesContent";

interface 课程分类 {
  id: string;
  name: string;
  code: string | null;
  parent_id: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export default async function TrainingCategoriesPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("training_categories")
    .select("id, name, code, parent_id, sort_order, is_active, created_at")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  const categories: 课程分类[] = (data || []).map((item) => ({
    id: String(item.id),
    name: String(item.name),
    code: item.code ? String(item.code) : null,
    parent_id: item.parent_id ? String(item.parent_id) : null,
    sort_order: Number(item.sort_order),
    is_active: Boolean(item.is_active),
    created_at: String(item.created_at),
  }));

  return <TrainingCategoriesContent initialCategories={categories} />;
}
