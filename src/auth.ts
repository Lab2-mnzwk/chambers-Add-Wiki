import NextAuth, { type Session } from "next-auth";
import Google from "next-auth/providers/google";
import type { JWT } from "next-auth/jwt";

const GOOGLE_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

export function isOAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.AUTH_SECRET
  );
}

/**
 * refresh token で Google access token を再取得する低レベル関数。
 * 成功で {accessToken, expiresAt(epoch秒)}、失敗で null。
 * jwt コールバックとサーバー側のトークン取得（google-session）の両方から使う。
 */
export async function fetchRefreshedGoogleAccessToken(
  refreshToken: string | undefined
): Promise<{ accessToken: string; expiresAt: number } | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret || !refreshToken) {
    return null;
  }

  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    const payload = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
    };

    if (!response.ok || !payload.access_token) {
      return null;
    }

    return {
      accessToken: payload.access_token,
      expiresAt: Math.floor(Date.now() / 1000) + (payload.expires_in ?? 3600),
    };
  } catch {
    return null;
  }
}

async function refreshGoogleAccessToken(token: JWT): Promise<JWT> {
  const refreshToken = token.refreshToken as string | undefined;
  if (!refreshToken) {
    return { ...token, error: "RefreshTokenMissing" };
  }

  const refreshed = await fetchRefreshedGoogleAccessToken(refreshToken);
  if (!refreshed) {
    return { ...token, error: "RefreshAccessTokenError" };
  }

  return {
    ...token,
    accessToken: refreshed.accessToken,
    expiresAt: refreshed.expiresAt,
    error: undefined,
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: process.env.AUTH_SECRET,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          scope: `openid email profile ${GOOGLE_SHEETS_SCOPE}`,
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          expiresAt:
            account.expires_at ??
            Math.floor(Date.now() / 1000) + (account.expires_in ?? 3600),
        };
      }

      const expiresAt = token.expiresAt as number | undefined;
      if (expiresAt && Date.now() / 1000 < expiresAt - 60) {
        return token;
      }

      return refreshGoogleAccessToken(token);
    },
    async session({ session, token }): Promise<Session> {
      if (session.user) {
        session.user.email = token.email ?? session.user.email;
        session.user.name = token.name ?? session.user.name;
        session.user.image = (token.picture as string | undefined) ?? session.user.image;
      }
      session.error = token.error as string | undefined;
      return session;
    },
  },
  pages: {
    signIn: "/",
  },
});
