import { NextRequest, NextResponse } from "next/server";
import { fetchLinkPreviewTitle } from "@/lib/link-preview";

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url")?.trim() ?? "";
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  try {
    const preview = await fetchLinkPreviewTitle(url);
    return NextResponse.json({ preview });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
