import { NextResponse } from "next/server";

/** 再ログインを促す共通メッセージ。 */
export const REAUTH_MESSAGE =
  "Google 認証の有効期限が切れました。再ログインしてください。";

/**
 * Google API / OAuth 由来の「資格情報が無効」系エラーかどうか。
 * access token の期限切れ・失効や refresh 失敗を再ログイン要求として扱うために使う。
 */
export function isCredentialError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes("invalid credentials") ||
    message.includes("invalid_grant") ||
    message.includes("invalid_token") ||
    message.includes("invalid authentication credentials") ||
    message.includes("unauthorized")
  );
}

export function apiErrorResponse(error: unknown): NextResponse {
  const raw = error instanceof Error ? error.message : String(error);
  const credential = isCredentialError(raw);
  const authRequired =
    credential || raw.includes("ログイン") || raw.includes("認証の有効期限");
  const message = credential ? REAUTH_MESSAGE : raw;

  return NextResponse.json(
    { error: message },
    { status: authRequired ? 401 : 500 }
  );
}
