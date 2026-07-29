import { randomUUID } from "crypto";
import { SPREADSHEET_ID } from "./config";

const redisUrl =
  process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? "";
const redisToken =
  process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? "";
const prefix = `pj140:${SPREADSHEET_ID}`;

export function hasSharedCache(): boolean {
  return Boolean(redisUrl && redisToken);
}

/**
 * 共有キャッシュ（Redis/Upstash）が実際に到達可能かを確認する。
 * `KV_REST_API_URL` 等が未設定なら configured=false（PING は送らない）。
 * 設定済みでも認証情報が誤っている・ネットワーク不可の場合は reachable=false になる。
 * 診断用途（`/api/cache`）のみで使う軽量チェック。
 */
export async function checkSharedCacheHealth(): Promise<{
  configured: boolean;
  reachable: boolean;
}> {
  if (!hasSharedCache()) return { configured: false, reachable: false };
  const result = await command<string>(["PING"]);
  return { configured: true, reachable: result === "PONG" };
}

export function sharedCacheKey(
  domain: "struct" | "nav" | "row" | "wiki",
  sheetId: string,
  suffix?: string | number
): string {
  return `${prefix}:${domain}:${sheetId}${suffix === undefined ? "" : `:${suffix}`}`;
}

async function command<T>(args: Array<string | number>): Promise<T | null> {
  if (!hasSharedCache()) return null;
  try {
    const response = await fetch(redisUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${redisToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { result?: T };
    return data.result ?? null;
  } catch {
    // 共有キャッシュ障害時もローカルキャッシュ／Sheetsへフォールバックする。
    return null;
  }
}

export async function sharedGetJson<T>(key: string): Promise<T | null> {
  const value = await command<string>(["GET", key]);
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export async function sharedSetJson(
  key: string,
  value: unknown,
  ttlSeconds: number
): Promise<void> {
  await command(["SET", key, JSON.stringify(value), "EX", ttlSeconds]);
}

export async function sharedDelete(...keys: string[]): Promise<void> {
  if (keys.length) await command(["DEL", ...keys]);
}

export async function sharedHashSet(
  key: string,
  values: Record<string, unknown>
): Promise<void> {
  const args: Array<string | number> = ["HSET", key];
  for (const [field, value] of Object.entries(values)) {
    args.push(field, JSON.stringify(value));
  }
  if (args.length > 2) await command(args);
}

export async function sharedHashGetAll<T>(key: string): Promise<Record<string, T>> {
  const result = await command<string[] | Record<string, string>>(["HGETALL", key]);
  if (!result) return {};
  const raw: Record<string, string> = Array.isArray(result)
    ? Object.fromEntries(
        Array.from({ length: Math.floor(result.length / 2) }, (_, index) => [
          result[index * 2],
          result[index * 2 + 1],
        ])
      )
    : result;
  const parsed: Record<string, T> = {};
  for (const [field, value] of Object.entries(raw)) {
    try {
      parsed[field] = JSON.parse(value) as T;
    } catch {
      // 壊れたfieldだけ無視する。
    }
  }
  return parsed;
}

export async function acquireSharedLock(
  key: string,
  ttlMs = 30_000
): Promise<string | null> {
  if (!hasSharedCache()) return null;
  const token = randomUUID();
  const result = await command<string>(["SET", `${key}:lock`, token, "NX", "PX", ttlMs]);
  return result === "OK" ? token : "";
}

export async function releaseSharedLock(key: string, token: string): Promise<void> {
  if (!token) return;
  const script =
    "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end";
  await command(["EVAL", script, 1, `${key}:lock`, token]);
}

export async function waitForSharedJson<T>(
  key: string,
  attempts = 5,
  delayMs = 250
): Promise<T | null> {
  for (let i = 0; i < attempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    const value = await sharedGetJson<T>(key);
    if (value) return value;
  }
  return null;
}
