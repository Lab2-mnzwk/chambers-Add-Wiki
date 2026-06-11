const FETCH_HEADERS = {
  "User-Agent": "WikiWorkApp/1.0 (Next.js row editor)",
};

const PAGE_TITLE_SUFFIX_RE = /\s*[-–|｜]\s*Wikipedia.*$/i;
const CACHE_TTL_MS = 86_400_000;

const previewCache = new Map<string, { value: string; expires: number }>();

function wikipediaLangFromHost(netloc: string): string {
  const host = netloc.toLowerCase();
  const prefix = host.split(".", 1)[0];
  if (prefix === "wikipedia" || prefix === "m") return "en";
  return prefix;
}

function wikipediaSlugFromUrl(pathname: string): string {
  if (!pathname.includes("/wiki/")) return "";
  const slug = pathname.split("/wiki/", 2)[1] ?? "";
  const cleaned = decodeURIComponent(slug.split("#", 1)[0]?.split("?", 1)[0] ?? "");
  return cleaned.replace(/_/g, " ").trim();
}

async function fetchWikipediaTitle(url: URL): Promise<string> {
  const slug = wikipediaSlugFromUrl(url.pathname);
  if (!slug) return "";

  const lang = wikipediaLangFromHost(url.hostname);
  const apiUrl =
    `https://${lang}.wikipedia.org/w/api.php` +
    `?action=query&format=json&redirects=1&titles=${encodeURIComponent(slug)}`;

  try {
    const response = await fetch(apiUrl, {
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return slug;
    const payload = (await response.json()) as {
      query?: { pages?: Record<string, { title?: string; pageid?: number }> };
    };
    for (const page of Object.values(payload.query?.pages ?? {})) {
      if (page.title && String(page.pageid ?? "") !== "-1") {
        return page.title;
      }
    }
  } catch {
    // fall through
  }
  return slug;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function fetchHttpPageTitle(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return "";
    const html = (await response.text()).slice(0, 65_536);
    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (!match?.[1]) return "";
    const raw = decodeHtmlEntities(match[1].trim());
    const cleaned = raw.replace(PAGE_TITLE_SUFFIX_RE, "").trim();
    return cleaned || raw;
  } catch {
    return "";
  }
}

/** リンク先ページのタイトル（ホバープレビュー用）。URLごとに1日キャッシュ。 */
export async function fetchLinkPreviewTitle(url: string): Promise<string> {
  const trimmed = url.trim();
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    return "";
  }

  const cached = previewCache.get(trimmed);
  if (cached && cached.expires > Date.now()) {
    return cached.value;
  }

  let preview = "";
  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname.toLowerCase().includes("wikipedia.org")) {
      preview = await fetchWikipediaTitle(parsed);
    }
    if (!preview) {
      preview = await fetchHttpPageTitle(trimmed);
    }
  } catch {
    preview = "";
  }

  previewCache.set(trimmed, {
    value: preview,
    expires: Date.now() + CACHE_TTL_MS,
  });
  return preview;
}
