import { decode } from "@auth/core/jwt";
import { cookies } from "next/headers";
import { auth, isOAuthConfigured } from "@/auth";

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

  if (!token?.accessToken || token.error) return null;
  return token.accessToken as string;
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
