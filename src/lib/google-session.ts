import { decode } from "@auth/core/jwt";
import { cookies } from "next/headers";
import { auth, fetchRefreshedGoogleAccessToken, isOAuthConfigured } from "@/auth";

function sessionCookieName(): string {
  return process.env.NODE_ENV === "production"
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";
}

/** OAuth 有効時に JWT から Google access token を取得（クライアントへは返さない） */
export async function getGoogleAccessToken(): Promise<string | null> {
  if (!isOAuthConfigured()) return null;

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(sessionCookieName());
  if (!sessionCookie?.value) return null;

  const token = await decode({
    token: sessionCookie.value,
    secret: process.env.AUTH_SECRET!,
    salt: sessionCookieName(),
  });

  if (!token) return null;

  const accessToken = token.accessToken as string | undefined;
  const refreshToken = token.refreshToken as string | undefined;
  const expiresAt = token.expiresAt as number | undefined;

  // クッキー内のトークンが有効期限内（60秒の余裕）ならそのまま使う。
  const stillValid =
    accessToken && expiresAt && Date.now() / 1000 < expiresAt - 60;
  if (stillValid) return accessToken;

  // 期限切れ・期限間近のときはここで refresh する。
  // jwt コールバックでの refresh はルートハンドラだとクッキーへ書き戻らず、
  // 古い access token のまま Sheets API に渡って "Invalid Credentials" になるため、
  // トークン取得経路でも確実に最新化する（セーフティネット）。
  const refreshed = await fetchRefreshedGoogleAccessToken(refreshToken);
  if (refreshed) return refreshed.accessToken;

  // refresh 不可（refresh token 無し等）。期限内トークンが無ければ再ログインが必要。
  if (accessToken && !token.error) return accessToken;
  return null;
}

export async function requireGoogleAccessToken(): Promise<string> {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Google ログインが必要です。");
  }
  if (session.error) {
    throw new Error("Google 認証の有効期限が切れました。再ログインしてください。");
  }

  const accessToken = await getGoogleAccessToken();
  if (!accessToken) {
    throw new Error("Google ログインが必要です。");
  }
  return accessToken;
}

export async function getAuthUserEmail(): Promise<string | null> {
  const session = await auth();
  return session?.user?.email ?? null;
}
