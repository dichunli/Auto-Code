import { loadKnowledgeArticles } from "./actions";
import KnowledgeContent from "./KnowledgeContent";
import type { ComponentProps } from "react";

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const authorId = typeof sp.authorId === "string" ? sp.authorId : "";
  const authorName = typeof sp.authorName === "string" ? sp.authorName : "";

  const result = await loadKnowledgeArticles({
    keyword: "",
    category: "",
    page: 1,
    createdBy: authorId,
  });

  return (
    <KnowledgeContent
      initialArticles={(result.articles || []) as unknown as ComponentProps<typeof KnowledgeContent>["initialArticles"]}
      initialCategories={result.categories || []}
      initialTotal={result.total || 0}
      initialTotalPages={result.totalPages || 1}
      initialSegments={result.segments || []}
      currentUserId={result.currentUserId || ""}
      isAdmin={result.isAdmin || false}
      initialAuthorId={authorId}
      initialAuthorName={authorName}
    />
  );
}
