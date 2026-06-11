import { NextResponse } from "next/server";

export function apiErrorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : String(error);
  const authRequired =
    message.includes("ログイン") || message.includes("認証の有効期限");
  return NextResponse.json(
    { error: message },
    { status: authRequired ? 401 : 500 }
  );
}
