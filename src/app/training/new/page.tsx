import { createClient } from "@/lib/supabase/server";
import CourseForm from "./CourseForm";

interface 课程分类 {
  id: string;
  name: string;
  parent_id: string | null;
}

interface 知识文章 {
  id: string;
  title: string;
}

interface 专题 {
  id: string;
  name: string;
}

export default async function NewCoursePage() {
  const supabase = await createClient();

  const { data: categoriesData } = await supabase
    .from("training_categories")
    .select("id, name, parent_id")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  const { data: articlesData } = await supabase
    .from("knowledge_articles")
    .select("id, title")
    .order("created_at", { ascending: false });

  const { data: topicsData } = await supabase
    .from("training_topics")
    .select("id, name")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  const categories: 课程分类[] = (categoriesData || []).map((item) => ({
    id: String(item.id),
    name: String(item.name),
    parent_id: item.parent_id ? String(item.parent_id) : null,
  }));

  const articles: 知识文章[] = (articlesData || []).map((item) => ({
    id: String(item.id),
    title: String(item.title),
  }));

  const topics: 专题[] = (topicsData || []).map((item) => ({
    id: String(item.id),
    name: String(item.name),
  }));

  return (
    <CourseForm
      initialCategories={categories}
      initialArticles={articles}
      initialTopics={topics}
    />
  );
}
