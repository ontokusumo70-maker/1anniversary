import type { Env } from "../index";
import { requireSession } from "../auth/session-guard";
import { writeAuditSafe } from "../audit/logger";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function errorResponse(error: string, message: string, status: number): Response {
  return json({ ok: false, error, message }, status);
}

function isNonEmptyString(value: unknown, max = 255): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;
}

function parsePositiveInteger(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 1_000_000) return null;
  return number;
}

function eventStatus(startsAt: string, endsAt: string, active: number, now = Date.now()): "UPCOMING" | "ACTIVE" | "ENDED" | "INACTIVE" {
  if (active !== 1) return "INACTIVE";
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "INACTIVE";
  if (now < start) return "UPCOMING";
  if (now >= end) return "ENDED";
  return "ACTIVE";
}

async function requireOwner(request: Request, env: Env) {
  return requireSession(request, env, ["OWNER"]);
}

async function handleOwnerOverview(request: Request, env: Env): Promise<Response> {
  const owner = await requireOwner(request, env);
  if (!owner) return errorResponse("UNAUTHORIZED", "Owner authentication is required.", 401);

  const now = new Date();
  const nowIso = now.toISOString();
  const wibOffset = 7 * 60 * 60 * 1000;
  const local = new Date(now.getTime() + wibOffset);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  const day = local.getUTCDate();
  const dayOfWeek = local.getUTCDay();
  const daysFromMonday = (dayOfWeek + 6) % 7;
  const dayStart = new Date(Date.UTC(year, month, day) - wibOffset);
  const weekStart = new Date(dayStart.getTime() - daysFromMonday * 86400000);
  const monthStart = new Date(Date.UTC(year, month, 1) - wibOffset);
  const yearStart = new Date(Date.UTC(year, 0, 1) - wibOffset);

  const releaseExpired = env.DB.prepare(`
    UPDATE machines
    SET status = 'IDLE', started_at = NULL, expected_end_at = NULL, activated_by = NULL
    WHERE status = 'IN_USE' AND expected_end_at IS NOT NULL AND expected_end_at <= ?
  `).bind(nowIso);

  const metrics = env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM customers) AS participants,
      (SELECT COUNT(*) FROM plays) AS play_count,
      (SELECT COUNT(*) FROM rewards WHERE status = 'WON') AS won_count,
      (SELECT COUNT(*) FROM rewards WHERE status = 'CLAIMED') AS claimed_count,
      (SELECT COUNT(*) FROM rewards WHERE status = 'REDEEMED') AS redeemed_count,
      (SELECT COUNT(*) FROM rewards WHERE status = 'USED') AS used_count,
      (SELECT COUNT(*) FROM rewards WHERE status NOT IN ('WON','CLAIMED','REDEEMED','USED')) AS unclaimed_count,
      (SELECT COUNT(*) FROM audit_log WHERE result IN ('FAILED','REJECTED')) AS error_retry_count
  `);

  const rewardStatus = env.DB.prepare(`
    SELECT status, COUNT(*) AS count FROM rewards GROUP BY status ORDER BY status
  `);

  const pools = env.DB.prepare(`
    SELECT reward_type, quota_total, quota_used, active
    FROM reward_pool ORDER BY reward_type ASC
  `);

  const machines = env.DB.prepare(`
    SELECT machine_id, machine_type, machine_number, status, started_at, expected_end_at
    FROM machines
    ORDER BY CASE WHEN machine_type = 'WASHER' THEN 1 ELSE 2 END, machine_number ASC
  `);

  const operations = [dayStart, weekStart, monthStart, yearStart].map((start) =>
    env.DB.prepare(`
      SELECT machine_type, COALESCE(SUM(duration_seconds),0) AS total_seconds
      FROM machine_operations WHERE started_at >= ? GROUP BY machine_type
    `).bind(start.toISOString()),
  );

  const events = env.DB.prepare(`
    SELECT event_id, title, starts_at, ends_at, reward_type, reward_quantity, active
    FROM events
    ORDER BY starts_at DESC, event_id DESC
    LIMIT 50
  `);

  const [released, metricResult, rewardResult, poolResult, machineResult, daily, weekly, monthly, yearly, eventResult] =
    await env.DB.batch([
      releaseExpired,
      metrics,
      rewardStatus,
      pools,
      machines,
      ...operations,
      events,
    ]);

  const metric = metricResult.results?.[0] as Record<string, number> | undefined;
  const statusMap = new Map<string, number>();
  for (const row of (rewardResult.results ?? []) as Array<{ status: string; count: number }>) {
    statusMap.set(row.status, Number(row.count));
  }

  const mapOperations = (result: D1Result<Record<string, unknown>>) => {
    let washer = 0;
    let dryer = 0;
    for (const row of result.results ?? []) {
      const seconds = Number(row.total_seconds ?? 0);
      if (row.machine_type === "WASHER") washer = seconds;
      if (row.machine_type === "DRYER") dryer = seconds;
    }
    return { washer, dryer };
  };

  const machineRows = (machineResult.results ?? []) as Array<{
    machine_id: string; machine_type: "WASHER" | "DRYER"; machine_number: number;
    status: "IDLE" | "IN_USE"; started_at: string | null; expected_end_at: string | null;
  }>;

  const machinesOut = machineRows.map((machine) => ({
    machineId: machine.machine_id,
    type: machine.machine_type,
    machineNumber: machine.machine_number,
    status: machine.status,
    statusLabel: machine.status === "IN_USE" ? "TERPAKAI" : "IDLE",
    durationMinutes: machine.machine_type === "WASHER" ? 32 : 50,
    startedAt: machine.started_at,
    expectedEndAt: machine.expected_end_at,
    remainingSeconds: machine.expected_end_at
      ? Math.max(0, Math.ceil((Date.parse(machine.expected_end_at) - now.getTime()) / 1000))
      : 0,
  }));

  const eventRows = (eventResult.results ?? []) as Array<{
    event_id: string; title: string; starts_at: string; ends_at: string;
    reward_type: string; reward_quantity: number; active: number;
  }>;

  const eventOut = eventRows.map((event) => ({
    eventId: event.event_id,
    title: event.title,
    startsAt: event.starts_at,
    endsAt: event.ends_at,
    rewardType: event.reward_type,
    rewardQuantity: Number(event.reward_quantity),
    active: Number(event.active) === 1,
    status: eventStatus(event.starts_at, event.ends_at, Number(event.active), now.getTime()),
  }));

  return json({
    ok: true,
    serverTime: nowIso,
    metrics: {
      participants: Number(metric?.participants ?? 0),
      play: Number(metric?.play_count ?? 0),
      won: Number(metric?.won_count ?? statusMap.get("WON") ?? 0),
      claimed: Number(metric?.claimed_count ?? statusMap.get("CLAIMED") ?? 0),
      redeemed: Number(metric?.redeemed_count ?? statusMap.get("REDEEMED") ?? 0),
      used: Number(metric?.used_count ?? statusMap.get("USED") ?? 0),
      unclaimed: Number(metric?.unclaimed_count ?? 0),
      errorRetry: Number(metric?.error_retry_count ?? 0),
    },
    rewardPool: (poolResult.results ?? []).map((row) => ({
      rewardType: row.reward_type,
      quotaTotal: Number(row.quota_total),
      quotaUsed: Number(row.quota_used),
      remaining: Math.max(0, Number(row.quota_total) - Number(row.quota_used)),
      active: Number(row.active) === 1,
    })),
    machines: machinesOut,
    operatingTime: {
      daily: mapOperations(daily),
      weekly: mapOperations(weekly),
      monthly: mapOperations(monthly),
      yearly: mapOperations(yearly),
    },
    activeEvents: eventOut.filter((event) => event.status === "ACTIVE"),
  });
}

async function handleCustomerTrace(request: Request, env: Env, customerId: string): Promise<Response> {
  const owner = await requireOwner(request, env);
  if (!owner) return errorResponse("UNAUTHORIZED", "Owner authentication is required.", 401);
  const id = customerId.trim();
  if (!id || id.length > 128) return errorResponse("INVALID_REQUEST", "Customer ID is required.", 400);

  const customer = await env.DB.prepare(`
    SELECT customer_id, name, phone_masked, email, created_at
    FROM customers WHERE customer_id = ? LIMIT 1
  `).bind(id).first<{ customer_id: string; name: string; phone_masked: string; email: string; created_at: string }>();
  if (!customer) return errorResponse("CUSTOMER_NOT_FOUND", "Customer was not found.", 404);

  const [transactions, plays, rewards] = await env.DB.batch([
    env.DB.prepare(`SELECT transaction_id, service_type, amount, created_at FROM transactions WHERE customer_id = ? ORDER BY created_at DESC`).bind(id),
    env.DB.prepare(`SELECT play_id, transaction_id, session_id, status, created_at, finished_at FROM plays WHERE customer_id = ? ORDER BY created_at DESC`).bind(id),
    env.DB.prepare(`SELECT reward_id, play_id, type, status, created_at, claimed_at, redeemed_at, used_at FROM rewards WHERE customer_id = ? ORDER BY created_at DESC`).bind(id),
  ]);

  await writeAuditSafe(env, { entityType: "CUSTOMER", entityId: id, action: "TRACE", actor: owner.userId, result: "SUCCESS" });
  return json({ ok: true, customer, transactions: transactions.results ?? [], plays: plays.results ?? [], rewards: rewards.results ?? [] });
}

async function handleAudit(request: Request, env: Env): Promise<Response> {
  const owner = await requireOwner(request, env);
  if (!owner) return errorResponse("UNAUTHORIZED", "Owner authentication is required.", 401);

  const url = new URL(request.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? 50);
  const offsetRaw = Number(url.searchParams.get("offset") ?? 0);
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 50, 1), 100);
  const offset = Math.min(Math.max(Number.isFinite(offsetRaw) ? Math.floor(offsetRaw) : 0, 0), 1_000_000);

  const result = await env.DB.prepare(`
    SELECT timestamp, entity_type, entity_id, action, actor, result
    FROM audit_log ORDER BY timestamp DESC, audit_id DESC LIMIT ? OFFSET ?
  `).bind(limit, offset).all();

  return json({ ok: true, items: result.results ?? [], limit, offset });
}

async function handleRewardPool(request: Request, env: Env): Promise<Response> {
  const owner = await requireOwner(request, env);
  if (!owner) return errorResponse("UNAUTHORIZED", "Owner authentication is required.", 401);

  const url = new URL(request.url);
  const match = url.pathname.match(/^\/owner\/reward-pool\/([^/]+)$/);

  if (request.method === "GET") {
    const result = await env.DB.prepare(`
      SELECT reward_type, quota_total, quota_used, active FROM reward_pool ORDER BY reward_type ASC
    `).all();
    return json({ ok: true, items: (result.results ?? []).map((row) => ({
      rewardType: row.reward_type,
      quotaTotal: Number(row.quota_total),
      quotaUsed: Number(row.quota_used),
      remaining: Math.max(0, Number(row.quota_total) - Number(row.quota_used)),
      active: Number(row.active) === 1,
    })) });
  }

  if (request.method !== "POST" && request.method !== "PATCH") {
    return errorResponse("NOT_FOUND", "Reward Pool endpoint not found.", 404);
  }

  let body: { rewardType?: unknown; quotaTotal?: unknown; active?: unknown };
  try { body = await request.json() as typeof body; } catch { return errorResponse("INVALID_REQUEST", "Invalid JSON request body.", 400); }

  const rewardType = isNonEmptyString(body.rewardType, 120) ? body.rewardType.trim() : match ? decodeURIComponent(match[1]).trim() : "";
  const quotaTotal = parsePositiveInteger(body.quotaTotal);
  const active = body.active === undefined ? 1 : body.active ? 1 : 0;
  if (!rewardType || rewardType.length > 120 || quotaTotal === null) {
    return errorResponse("INVALID_REQUEST", "Reward type and quota total are required.", 400);
  }

  if (request.method === "POST") {
    try {
      await env.DB.prepare(`INSERT INTO reward_pool (reward_type, quota_total, quota_used, active) VALUES (?, ?, 0, ?)`).bind(rewardType, quotaTotal, active).run();
    } catch {
      return errorResponse("REWARD_EXISTS", "Reward type already exists.", 409);
    }
    await writeAuditSafe(env, { entityType: "REWARD", entityId: rewardType, action: "CREATE", actor: owner.userId, result: "SUCCESS" });
  } else {
    const current = await env.DB.prepare(`SELECT quota_used FROM reward_pool WHERE reward_type = ? LIMIT 1`).bind(rewardType).first<{ quota_used: number }>();
    if (!current) return errorResponse("REWARD_NOT_FOUND", "Reward type was not found.", 404);
    if (quotaTotal < Number(current.quota_used)) return errorResponse("INVALID_QUOTA", "Quota total cannot be lower than quota used.", 400);
    const result = await env.DB.prepare(`UPDATE reward_pool SET quota_total = ?, active = ? WHERE reward_type = ?`).bind(quotaTotal, active, rewardType).run();
    if (result.meta.changes !== 1) return errorResponse("REWARD_NOT_FOUND", "Reward type was not found.", 404);
    await writeAuditSafe(env, { entityType: "REWARD", entityId: rewardType, action: "UPDATE", actor: owner.userId, result: "SUCCESS" });
  }

  return json({ ok: true });
}

async function handleEvents(request: Request, env: Env): Promise<Response> {
  const owner = await requireOwner(request, env);
  if (!owner) return errorResponse("UNAUTHORIZED", "Owner authentication is required.", 401);

  const url = new URL(request.url);
  const match = url.pathname.match(/^\/owner\/events\/([^/]+)$/);

  if (request.method === "GET") {
    const rows = await env.DB.prepare(`
      SELECT event_id, title, starts_at, ends_at, reward_type, reward_quantity, active, created_at, updated_at
      FROM events ORDER BY starts_at DESC, event_id DESC LIMIT 100
    `).all();
    const now = Date.now();
    return json({ ok: true, items: (rows.results ?? []).map((row) => ({
      eventId: row.event_id,
      title: row.title,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      rewardType: row.reward_type,
      rewardQuantity: Number(row.reward_quantity),
      active: Number(row.active) === 1,
      status: eventStatus(String(row.starts_at), String(row.ends_at), Number(row.active), now),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })) });
  }

  if (request.method !== "POST" && request.method !== "PATCH") return errorResponse("NOT_FOUND", "Event endpoint not found.", 404);

  let body: { title?: unknown; startsAt?: unknown; endsAt?: unknown; rewardType?: unknown; rewardQuantity?: unknown; active?: unknown };
  try { body = await request.json() as typeof body; } catch { return errorResponse("INVALID_REQUEST", "Invalid JSON request body.", 400); }

  const title = isNonEmptyString(body.title, 160) ? body.title.trim() : "";
  const startsAt = isNonEmptyString(body.startsAt, 64) ? body.startsAt.trim() : "";
  const endsAt = isNonEmptyString(body.endsAt, 64) ? body.endsAt.trim() : "";
  const rewardType = isNonEmptyString(body.rewardType, 120) ? body.rewardType.trim() : "";
  const rewardQuantity = parsePositiveInteger(body.rewardQuantity);
  const active = body.active === undefined ? 1 : body.active ? 1 : 0;
  const startMs = Date.parse(startsAt);
  const endMs = Date.parse(endsAt);

  if (!title || !startsAt || !endsAt || !rewardType || rewardQuantity === null || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return errorResponse("INVALID_REQUEST", "Event title, period, reward and quantity are required.", 400);
  }

  const pool = await env.DB.prepare(`SELECT reward_type FROM reward_pool WHERE reward_type = ? LIMIT 1`).bind(rewardType).first<{ reward_type: string }>();
  if (!pool) return errorResponse("REWARD_NOT_FOUND", "Reward type was not found in Reward Pool.", 400);

  const nowIso = new Date().toISOString();

  if (request.method === "POST") {
    const eventId = `event_${crypto.randomUUID()}`;
    await env.DB.prepare(`
      INSERT INTO events (event_id, title, starts_at, ends_at, reward_type, reward_quantity, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(eventId, title, startsAt, endsAt, rewardType, rewardQuantity, active, nowIso, nowIso).run();
    await writeAuditSafe(env, { entityType: "EVENT", entityId: eventId, action: "CREATE", actor: owner.userId, result: "SUCCESS" });
    return json({ ok: true, eventId }, 201);
  }

  if (!match) return errorResponse("INVALID_REQUEST", "Event ID is required.", 400);
  const eventId = decodeURIComponent(match[1]);
  const result = await env.DB.prepare(`
    UPDATE events SET title = ?, starts_at = ?, ends_at = ?, reward_type = ?, reward_quantity = ?, active = ?, updated_at = ?
    WHERE event_id = ?
  `).bind(title, startsAt, endsAt, rewardType, rewardQuantity, active, nowIso, eventId).run();
  if (result.meta.changes !== 1) return errorResponse("EVENT_NOT_FOUND", "Event was not found.", 404);
  await writeAuditSafe(env, { entityType: "EVENT", entityId: eventId, action: "UPDATE", actor: owner.userId, result: "SUCCESS" });
  return json({ ok: true, eventId });
}

export async function handleOwnerRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/owner/overview" && request.method === "GET") return handleOwnerOverview(request, env);
  if (url.pathname === "/owner/audit" && request.method === "GET") return handleAudit(request, env);
  if (url.pathname === "/owner/reward-pool" || url.pathname.startsWith("/owner/reward-pool/")) return handleRewardPool(request, env);
  if (url.pathname === "/owner/events" || url.pathname.startsWith("/owner/events/")) return handleEvents(request, env);
  if (request.method === "GET") {
    const match = url.pathname.match(/^\/owner\/customer\/([^/]+)$/);
    if (match) return handleCustomerTrace(request, env, decodeURIComponent(match[1]));
  }
  return errorResponse("NOT_FOUND", "Owner endpoint not found.", 404);
}
