const clientCache = new Map<string, string>();

/** クライアントから /api/link-preview 経由でページタイトルを取得（メモリキャッシュ付き） */
export async function fetchLinkPreviewTitleClient(url: string): Promise<string> {
  const trimmed = url.trim();
  if (!trimmed) return "";

  const cached = clientCache.get(trimmed);
  if (cached !== undefined) return cached;

  try {
    const response = await fetch(
      `/api/link-preview?url=${encodeURIComponent(trimmed)}`
    );
    if (!response.ok) {
      clientCache.set(trimmed, "");
      return "";
    }
    const data = (await response.json()) as { preview?: string };
    const title = data.preview ?? "";
    clientCache.set(trimmed, title);
    return title;
  } catch {
    clientCache.set(trimmed, "");
    return "";
  }
}
