import { createClient } from "@/lib/supabase/server";
import ToolManagementContent, { type 工具, type 借用记录 } from "./ToolManagementContent";

/* 工具管理 — Server Component
 * 首屏数据（工具列表/知识库标题/未归还记录/管理员身份）在服务端查询，
 * 避免 SPA 软导航时客户端 session 未就绪导致页面空白；
 * 搜索、借还操作后客户端仍自行加载 */

interface 知识文章 {
  id: string;
  title: string;
}

export default async function ToolManagementPage() {
  const supabase = await createClient();

  /* 与客户端 加载数据 无搜索词时完全一致的查询 */
  const { data: 工具数据, error: 工具错误 } = await supabase
    .from("tools")
    .select("*")
    .order("created_at", { ascending: false });

  if (工具错误) {
    console.error("加载工具列表失败:", 工具错误);
  }
  const tools = ((工具数据 as 工具[] | null) || []);

  /* 加载知识库标题 */
  let knowledgeEntries: [string, string][] = [];
  const knowledgeIds = tools.map((t) => t.knowledge_article_id).filter(Boolean) as string[];
  if (knowledgeIds.length > 0) {
    const { data: kData } = await supabase
      .from("knowledge_articles")
      .select("id, title")
      .in("id", [...new Set(knowledgeIds)]);
    knowledgeEntries = (((kData as 知识文章[] | null) || [])).map((k) => [k.id, k.title]);
  }

  /* 加载未归还记录 */
  let unreturnedRecords: 借用记录[] = [];
  if (tools.length > 0) {
    try {
      const { data: 记录数据, error: 记录错误 } = await supabase
        .from("tool_borrow_records")
        .select("*")
        .in(
          "tool_id",
          tools.map((t) => t.id)
        );
      if (!记录错误) {
        unreturnedRecords = (((记录数据 as 借用记录[] | null) || [])).filter(
          (r) => r.returned_at === null
        );
      } else {
        console.log("未归还记录查询失败，继续执行", 记录错误);
      }
    } catch (e) {
      console.log("查询错误，继续执行", e);
    }
  }

  /* 检查当前用户是否为管理员（通过 profile_roles） */
  let isAdmin = false;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const { data: roleData } = await supabase
      .from("profile_roles")
      .select("roles(name)")
      .eq("profile_id", user.id);
    interface 角色关联 {
      roles: { name: string } | null;
    }
    const roleNames = ((roleData || []) as unknown as 角色关联[])
      .map((r) => r.roles?.name)
      .filter(Boolean) as string[];
    isAdmin = roleNames.includes("admin");
  }

  return (
    <ToolManagementContent
      initialTools={tools}
      initialKnowledgeEntries={knowledgeEntries}
      initialUnreturnedRecords={unreturnedRecords}
      initialIsAdmin={isAdmin}
    />
  );
}
