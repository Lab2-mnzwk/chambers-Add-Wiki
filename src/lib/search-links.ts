/** 名称テキストで Google 検索を開く URL */
export function googleSearchUrl(query: string): string {
  const q = query.trim();
  if (!q || q === "—") return "https://www.google.com/";
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}
