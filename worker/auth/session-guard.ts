import type { Env } from "../index";

export type SessionRole = "CUSTOMER" | "STAFF" | "OWNER";

export type AuthSession = {
  sessionId: string;
  userId: string;
  role: SessionRole;
  expiresAt: string;
};

type SessionRow = {
  session_id: string;
  user_id: string;
  role: SessionRole;
  expires_at: string;
};

export function extractBearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const match = authorization.trim().match(/^Bearer\s+([A-Za-z0-9_-]{20,256})$/i);
  return match ? match[1] : null;
}

export function requireRole(session: AuthSession | null, allowedRoles: SessionRole[]): boolean {
  return !!session && allowedRoles.includes(session.role);
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function getSession(request: Request, env: Env): Promise<AuthSession | null> {
  const token = extractBearerToken(request.headers.get("Authorization"));
  if (!token) return null;
  const tokenHash = await hashToken(token);
  const row = await env.DB.prepare(`
    SELECT session_id, user_id, role, expires_at
    FROM auth_sessions
    WHERE token_hash = ?
      AND revoked_at IS NULL
      AND expires_at > ?
    LIMIT 1
  `).bind(tokenHash, new Date().toISOString()).first<SessionRow>();
  if (!row) return null;
  const expires = Date.parse(row.expires_at);
  if (!Number.isFinite(expires) || expires <= Date.now()) return null;
  return { sessionId: row.session_id, userId: row.user_id, role: row.role, expiresAt: row.expires_at };
}

export async function requireSession(request: Request, env: Env, allowedRoles: SessionRole[]): Promise<AuthSession | null> {
  const session = await getSession(request, env);
  return requireRole(session, allowedRoles) ? session : null;
}
