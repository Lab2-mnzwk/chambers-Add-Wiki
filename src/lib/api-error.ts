import { NextResponse } from "next/server";

/** 再ログインを促す共通メッセージ。 */
export const REAUTH_MESSAGE =
  "Google 認証の有効期限が切れました。再ログインしてください。";

/** 権限エラー（スコープ不足・共有設定・トークン等）時のメッセージ。原因は断定しない。 */
export const PERMISSION_MESSAGE =
  "権限に問題が生じています。一度ログアウトし、再ログインをお試しください。解決しない場合はご連絡ください。";

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

/**
 * Google API 由来の「権限不足」系エラーかどうか（403）。
 * 対象シートが未共有、または付与スコープ不足のときに発生する
 * "Insufficient Permission" / "The caller does not have permission" /
 * "Request had insufficient authentication scopes" 等。
 * 別アカウントでの再ログインで解決し得るため、ログイン導線へ誘導する。
 */
export function isPermissionError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes("insufficient permission") ||
    message.includes("insufficient authentication scopes") ||
    message.includes("insufficient_scope") ||
    message.includes("permission_denied") ||
    message.includes("does not have permission") ||
    message.includes("forbidden")
  );
}

export function apiErrorResponse(error: unknown): NextResponse {
  const raw = error instanceof Error ? error.message : String(error);
  const credential = isCredentialError(raw);
  const permission = !credential && isPermissionError(raw);
  const authRequired =
    credential ||
    permission ||
    raw.includes("ログイン") ||
    raw.includes("認証の有効期限");
  const message = credential
    ? REAUTH_MESSAGE
    : permission
      ? PERMISSION_MESSAGE
      : raw;

  // 資格情報・権限以外（=500）はサーバーログに原因を残す（候補生成失敗などの調査用）。
  if (!authRequired) {
    console.error("[apiError]", error);
  }

  return NextResponse.json(
    { error: message },
    { status: credential ? 401 : permission ? 403 : 500 }
  );
}
