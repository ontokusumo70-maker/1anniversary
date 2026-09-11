import type { Env } from "../index";
import { requireSession } from "../auth/session-guard";
import { writeAuditSafe } from "../audit/logger";

function json(data: unknown, status = 200): Response { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } }); }
function errorResponse(error: string, message: string, status: number): Response { return json({ ok: false, error, message }, status); }

export async function handleOwnerRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "GET" || url.pathname !== "/owner/overview") return errorResponse("NOT_FOUND", "Owner endpoint not found.", 404);
  const owner = await requireSession(request, env, ["OWNER"]);
  if (!owner) return errorResponse("UNAUTHORIZED", "Owner authentication is required.", 401);
  const [customers, plays, rewards, pool, audit] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS count FROM customers`).first<{count:number}>(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM plays`).first<{count:number}>(),
    env.DB.prepare(`SELECT status, COUNT(*) AS count FROM rewards GROUP BY status ORDER BY status`).all<{status:string;count:number}>(),
    env.DB.prepare(`SELECT reward_type, quota_total, quota_used, active FROM reward_pool ORDER BY reward_type`).all<{reward_type:string;quota_total:number;quota_used:number;active:number}>(),
    env.DB.prepare(`SELECT action, result, COUNT(*) AS count FROM audit_log GROUP BY action, result ORDER BY action, result`).all<{action:string;result:string;count:number}>(),
  ]);
  return json({ ok:true, customers: Number(customers?.count??0), plays: Number(plays?.count??0), rewards: rewards.results??[], rewardPool: pool.results??[], auditSummary: audit.results??[] });
}
