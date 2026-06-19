/** 名称テキストで Google 検索を開く URL */
export function googleSearchUrl(query: string): string {
  const q = query.trim();
  if (!q || q === "—") return "https://www.google.com/";
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

/**
 * 文脈検索 URL。出来事（イベント名）の文脈で名称に該当する Wiki 記事を探す。
 * クエリ例: 出来事「{eventName}」における「{name}」に該当するWiki記事は？
 */
export function contextSearchUrl(eventName: string, name: string): string {
  const ev = eventName.trim();
  const nm = name.trim();
  if (!nm || nm === "—") return "https://www.google.com/";
  const query = ev
    ? `出来事「${ev}」における「${nm}」に該当するWiki記事は？`
    : `「${nm}」に該当するWiki記事は？`;
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}
