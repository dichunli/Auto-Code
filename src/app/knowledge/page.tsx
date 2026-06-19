import { loadKnowledgeArticles } from "./actions";
import KnowledgeContent from "./KnowledgeContent";

export default async function KnowledgePage() {
  const result = await loadKnowledgeArticles({ keyword: "", category: "", page: 1 });
  return <KnowledgeContent
    initialArticles={result.articles || []}
    initialCategories={result.categories || []}
    initialReadCounts={result.readCounts || {}}
    initialTotal={result.total || 0}
    initialTotalPages={result.totalPages || 1}
    initialSegments={result.segments || []}
    currentUserId={result.currentUserId || ""}
    isAdmin={result.isAdmin || false}
  />;
}
