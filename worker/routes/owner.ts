import type { Env } from "../index";
import { requireSession } from "../auth/session-guard";
import { writeAuditSafe } from "../audit/logger";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
function errorResponse(error: string, message: string, status: number): Response {
  return json({ ok: false, error, message }, status);
}

async function handleOwnerOverview(request: Request, env: Env): Promise<Response> {
  const owner = await requireSession(request, env, ["OWNER"]);
  if (!owner) return errorResponse("UNAUTHORIZED", "Owner authentication is required.", 401);
  const [customers, plays, rewards, pool, audit] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS count FROM customers`).first<{count:number}>(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM plays`).first<{count:number}>(),
    env.DB.prepare(`SELECT status, COUNT(*) AS count FROM rewards GROUP BY status ORDER BY status`).all<{status:string;count:number}>(),
    env.DB.prepare(`SELECT reward_type, quota_total, quota_used, active FROM reward_pool ORDER BY reward_type`).all<{reward_type:string;quota_total:number;quota_used:number;active:number}>(),
    env.DB.prepare(`SELECT action, result, COUNT(*) AS count FROM audit_log GROUP BY action, result ORDER BY action, result`).all<{action:string;result:string;count:number}>(),
  ]);
  return json({ ok:true, customers:Number(customers?.count??0), plays:Number(plays?.count??0), rewards:rewards.results??[], rewardPool:pool.results??[], auditSummary:audit.results??[] });
}

async function handleCustomerTrace(request: Request, env: Env, customerId: string): Promise<Response> {
  const owner = await requireSession(request, env, ["OWNER"]);
  if (!owner) return errorResponse("UNAUTHORIZED", "Owner authentication is required.", 401);
  const id = customerId.trim();
  if (!id || id.length > 128) return errorResponse("INVALID_REQUEST", "Customer ID is required.", 400);

  const customer = await env.DB.prepare(`SELECT customer_id, phone_masked, created_at FROM customers WHERE customer_id = ? LIMIT 1`).bind(id).first<{customer_id:string;phone_masked:string;created_at:string}>();
  if (!customer) return errorResponse("CUSTOMER_NOT_FOUND", "Customer was not found.", 404);
  const [transactions, plays, rewards, audit] = await Promise.all([
    env.DB.prepare(`SELECT transaction_id, service_type, amount, created_at FROM transactions WHERE customer_id = ? ORDER BY created_at DESC`).bind(id).all(),
    env.DB.prepare(`SELECT play_id, transaction_id, session_id, status, created_at, finished_at FROM plays WHERE customer_id = ? ORDER BY created_at DESC`).bind(id).all(),
    env.DB.prepare(`SELECT reward_id, play_id, type, status, created_at, claimed_at, redeemed_at, used_at FROM rewards WHERE customer_id = ? ORDER BY created_at DESC`).bind(id).all(),
    env.DB.prepare(`SELECT timestamp, entity_type, entity_id, action, result FROM audit_log WHERE actor = ? ORDER BY timestamp DESC LIMIT 100`).bind(id).all(),
  ]);
  await writeAuditSafe(env, { entityType:"CUSTOMER", entityId:id, action:"TRACE", actor:owner.userId, result:"SUCCESS" });
  return json({ ok:true, customer, transactions:transactions.results??[], plays:plays.results??[], rewards:rewards.results??[], audit:audit.results??[] });
}

export async function handleOwnerRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "GET") return errorResponse("NOT_FOUND", "Owner endpoint not found.", 404);
  if (url.pathname === "/owner/overview") return handleOwnerOverview(request, env);
  const match = url.pathname.match(/^\/owner\/customer\/([^/]+)$/);
  if (match) return handleCustomerTrace(request, env, decodeURIComponent(match[1]));
  return errorResponse("NOT_FOUND", "Owner endpoint not found.", 404);
}
