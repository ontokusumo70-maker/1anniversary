import type { Env } from "../index";
import { requireSession } from "../auth/session-guard";
import { writeAuditSafe } from "../audit/logger";
import { releaseExpiredMachines } from "./machines";
import { handleOwnerExportRequest } from "./owner-export";
import { broadcastRealtime } from "../realtime";

async function publishRealtime(env: Env, type: string, payload: unknown): Promise<void> {
  try {
    await broadcastRealtime(env, type, payload);
  } catch (error) {
    console.error("REALTIME_BROADCAST_FAILED:", type, error);
  }
}

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

function parseOwnerDateOnly(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00+07:00`);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatOwnerDateOnly(date: Date): string {
  const wib = new Date(date.getTime() + (7 * 60 * 60 * 1000));
  return `${wib.getUTCFullYear()}-${String(wib.getUTCMonth() + 1).padStart(2, "0")}-${String(wib.getUTCDate()).padStart(2, "0")}`;
}

function addOwnerDays(date: Date, days: number): Date {
  return new Date(date.getTime() + (days * 86400000));
}

function ownerPercentChange(current: number, previous: number): number {
  if (previous === 0) return 0;
  return Math.round(((current - previous) / previous) * 100);
}

const EVENT_RETENTION_DAYS = 30;

async function cleanupInactiveEventImages(env: Env, nowIso: string) {
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) return;
  const cutoffIso = new Date(nowMs - (EVENT_RETENTION_DAYS * 86400000)).toISOString();
  await env.DB.prepare(`
    DELETE FROM event_images
    WHERE event_id IN (
      SELECT event_id
      FROM events
      WHERE active != 1 OR ends_at <= ?
    )
  `).bind(cutoffIso).run();
}

export async function cleanupExpiredEvents(env: Env, now = new Date()): Promise<void> {
  const cutoffIso = new Date(now.getTime() - (EVENT_RETENTION_DAYS * 86400000)).toISOString();
  await env.DB.prepare(`DELETE FROM events WHERE julianday(ends_at) <= julianday(?)`).bind(cutoffIso).run();
}

async function handleEventImage(request: Request, env: Env, eventId: string): Promise<Response> {
  const owner = await requireOwner(request, env);
  if (!owner) return errorResponse("UNAUTHORIZED", "Owner authentication is required.", 401);
  if (!eventId || eventId.length > 128) return errorResponse("INVALID_REQUEST", "Event ID is required.", 400);

  const event = await env.DB.prepare(`
    SELECT event_id, starts_at, ends_at, active
    FROM events WHERE event_id = ? LIMIT 1
  `).bind(eventId).first<{ event_id: string; starts_at: string; ends_at: string; active: number }>();
  if (!event) return errorResponse("EVENT_NOT_FOUND", "Event tidak ditemukan.", 404);

  if (request.method === "GET") {
    const now = Date.now();
    const endMs = Date.parse(event.ends_at);
    const retentionUntilMs = Number.isFinite(endMs) ? endMs + (EVENT_RETENTION_DAYS * 86400000) : NaN;
    if (Number(event.active) !== 1 || !Number.isFinite(endMs) || now >= retentionUntilMs) {
      return new Response("", { status: 404 });
    }
    const image = await env.DB.prepare(`SELECT mime_type, image_blob FROM event_images WHERE event_id = ? LIMIT 1`).bind(eventId).first<{ mime_type: string; image_blob: ArrayBuffer }>();
    if (!image?.image_blob) return new Response("", { status: 404 });
    const imageBytes = image.image_blob instanceof ArrayBuffer
      ? new Uint8Array(image.image_blob)
      : image.image_blob instanceof Uint8Array
        ? image.image_blob
        : new Uint8Array(image.image_blob as any);
    return new Response(imageBytes, {
      status: 200,
      headers: { "Content-Type": image.mime_type, "Cache-Control": "no-store" },
    });
  }

  if (request.method === "DELETE") {
    await env.DB.prepare(`DELETE FROM event_images WHERE event_id = ?`).bind(eventId).run();
    await writeAuditSafe(env, { entityType: "EVENT_IMAGE", entityId: eventId, action: "DELETE", actor: owner.userId, result: "SUCCESS" });
    await publishRealtime(env, "EVENT_UPDATED", { eventId });
    return json({ ok: true });
  }

  if (request.method !== "PUT") return errorResponse("NOT_FOUND", "Event image endpoint not found.", 404);

  const now = Date.now();
  const startMs = Date.parse(event.starts_at);
  const endMs = Date.parse(event.ends_at);
  if (Number(event.active) !== 1 || !Number.isFinite(startMs) || !Number.isFinite(endMs) || now >= endMs) {
    return errorResponse("EVENT_NOT_AVAILABLE", "Image hanya dapat disimpan untuk Event yang masih akan datang atau sedang aktif.", 409);
  }

  const mimeType = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (mimeType !== "image/jpeg" && mimeType !== "image/webp") {
    return errorResponse("INVALID_IMAGE_TYPE", "Image harus JPG atau WebP.", 400);
  }

  const image = await request.arrayBuffer();
  if (image.byteLength < 1 || image.byteLength > 307200) {
    return errorResponse("IMAGE_TOO_LARGE", "Ukuran image maksimal 300 KB.", 413);
  }

  const bytes = new Uint8Array(image);
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isWebp = bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  if ((mimeType === "image/jpeg" && !isJpeg) || (mimeType === "image/webp" && !isWebp)) {
    return errorResponse("INVALID_IMAGE", "Isi file image tidak valid.", 400);
  }

  const nowIso = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO event_images (event_id, mime_type, image_blob, byte_size, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(event_id) DO UPDATE SET
      mime_type = excluded.mime_type,
      image_blob = excluded.image_blob,
      byte_size = excluded.byte_size,
      updated_at = excluded.updated_at
  `).bind(eventId, mimeType, image, image.byteLength, nowIso, nowIso).run();

  await writeAuditSafe(env, { entityType: "EVENT_IMAGE", entityId: eventId, action: "UPLOAD", actor: owner.userId, result: "SUCCESS" });
  await publishRealtime(env, "EVENT_UPDATED", { eventId });
  return json({ ok: true, eventId, byteSize: image.byteLength, mimeType });
}

async function handleOwnerOverview(request: Request, env: Env): Promise<Response> {
  const owner = await requireOwner(request, env);
  if (!owner) return errorResponse("UNAUTHORIZED", "Owner authentication is required.", 401);

  const now = new Date();
  const nowIso = now.toISOString();
  const url = new URL(request.url);
  const today = formatOwnerDateOnly(now);
  const requestedFrom = url.searchParams.get("from") || today;
  const requestedTo = url.searchParams.get("to") || requestedFrom;
  const rangeFrom = parseOwnerDateOnly(requestedFrom);
  const rangeTo = parseOwnerDateOnly(requestedTo);
  if (!rangeFrom || !rangeTo || rangeFrom.getTime() > rangeTo.getTime()) {
    return errorResponse("INVALID_DATE_RANGE", "Rentang tanggal Owner tidak valid.", 400);
  }

  const currentStartIso = rangeFrom.toISOString();
  const currentEndExclusive = addOwnerDays(rangeTo, 1);
  const currentEndIso = currentEndExclusive.toISOString();
  const selectedDays = Math.max(1, Math.round((currentEndExclusive.getTime() - rangeFrom.getTime()) / 86400000));
  const previousTo = new Date(rangeFrom.getTime() - 86400000);
  const previousFrom = new Date(previousTo.getTime() - ((selectedDays - 1) * 86400000));
  const previousStartIso = previousFrom.toISOString();
  const previousEndIso = currentStartIso;

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

  await cleanupInactiveEventImages(env, nowIso);

  await releaseExpiredMachines(env, nowIso);

  const metrics = env.DB.prepare(`
    SELECT
      (SELECT COUNT(DISTINCT p.customer_id)
       FROM plays p
       INNER JOIN events e
         ON p.created_at >= e.starts_at
        AND p.created_at < e.ends_at
       WHERE e.active = 1
         AND e.starts_at <= ?
         AND e.ends_at > ?
         AND p.created_at >= ? AND p.created_at < ?) AS participants,
      (SELECT COUNT(DISTINCT p.customer_id)
       FROM plays p
       INNER JOIN events e
         ON p.created_at >= e.starts_at
        AND p.created_at < e.ends_at
       WHERE e.active = 1
         AND e.starts_at <= ?
         AND e.ends_at > ?
         AND p.created_at >= ? AND p.created_at < ?) AS participants_previous,
      (SELECT COUNT(*) FROM rewards WHERE claimed_at IS NOT NULL AND claimed_at >= ? AND claimed_at < ?) AS claimed_count,
      (SELECT COUNT(*) FROM rewards WHERE claimed_at IS NOT NULL AND claimed_at >= ? AND claimed_at < ?) AS claimed_previous,
      (SELECT COUNT(*) FROM rewards WHERE redeemed_at IS NOT NULL AND redeemed_at >= ? AND redeemed_at < ?) AS redeemed_count,
      (SELECT COUNT(*) FROM rewards WHERE redeemed_at IS NOT NULL AND redeemed_at >= ? AND redeemed_at < ?) AS redeemed_previous,
      (SELECT COALESCE(SUM(e.reward_quantity), 0)
       FROM events e
       WHERE e.starts_at < ? AND e.ends_at > ?) AS total_reward_supplied,
      (SELECT COUNT(*) FROM plays) AS play_count,
      (SELECT COUNT(*) FROM rewards WHERE status = 'WON') AS won_count,
      (SELECT COUNT(*) FROM rewards WHERE status = 'USED') AS used_count,
      (SELECT COUNT(*) FROM rewards WHERE status NOT IN ('WON','CLAIMED','REDEEMED','USED')) AS unclaimed_count,
      (SELECT COUNT(*) FROM audit_log WHERE result IN ('FAILED','REJECTED')) AS error_retry_count
  `).bind(
    nowIso, nowIso, currentStartIso, currentEndIso,
    nowIso, nowIso, previousStartIso, previousEndIso,
    currentStartIso, currentEndIso,
    previousStartIso, previousEndIso,
    currentStartIso, currentEndIso,
    previousStartIso, previousEndIso,
    currentEndIso, currentStartIso,
  );

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

  const operationRanges = {
    daily: { start: dayStart, end: addOwnerDays(dayStart, 1) },
    weekly: { start: weekStart, end: addOwnerDays(weekStart, 7) },
    monthly: { start: monthStart, end: new Date(Date.UTC(year, month + 1, 1) - wibOffset) },
    yearly: { start: yearStart, end: new Date(Date.UTC(year + 1, 0, 1) - wibOffset) },
  };

  const operations = ["daily", "weekly", "monthly", "yearly"].map((period) => {
    const range = operationRanges[period as keyof typeof operationRanges];
    return env.DB.prepare(`
      SELECT machine_type, COALESCE(SUM(duration_seconds),0) AS total_seconds
      FROM machine_operations
      WHERE started_at >= ? AND started_at < ?
      GROUP BY machine_type
    `).bind(range.start.toISOString(), range.end.toISOString());
  });

  const events = env.DB.prepare(`
    SELECT event_id, title, starts_at, ends_at, reward_type, reward_quantity, active
    FROM events
    ORDER BY starts_at DESC, event_id DESC
    LIMIT 50
  `);

  const [metricResult, rewardResult, poolResult, machineResult, daily, weekly, monthly, yearly, eventResult] =
    await env.DB.batch([
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

  const mapOperations = (result: { results?: Array<Record<string, unknown>> }) => {
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
    reward_type: string; reward_quantity: number; description: string; active: number; has_image: number;
  }>;

  const eventOut = eventRows.map((event) => ({
    eventId: event.event_id,
    title: event.title,
    startsAt: event.starts_at,
    endsAt: event.ends_at,
    rewardType: event.reward_type,
    rewardQuantity: Number(event.reward_quantity),
    description: String(event.description ?? ""),
    active: Number(event.active) === 1,
    imageUrl: Number(event.has_image) === 1 && eventStatus(event.starts_at, event.ends_at, Number(event.active), now.getTime()) === "ACTIVE" ? "/event/active/image" : null,
    status: eventStatus(event.starts_at, event.ends_at, Number(event.active), now.getTime()),
  }));

  return json({
    ok: true,
    serverTime: nowIso,
    dateRange: {
      from: requestedFrom,
      to: requestedTo,
      previousFrom: formatOwnerDateOnly(previousFrom),
      previousTo: formatOwnerDateOnly(previousTo),
    },
    metrics: {
      participants: Number(metric?.participants ?? 0),
      participantsPrevious: Number(metric?.participants_previous ?? 0),
      participantsChangePct: ownerPercentChange(Number(metric?.participants ?? 0), Number(metric?.participants_previous ?? 0)),
      play: Number(metric?.play_count ?? 0),
      won: Number(metric?.won_count ?? statusMap.get("WON") ?? 0),
      claimed: Number(metric?.claimed_count ?? statusMap.get("CLAIMED") ?? 0),
      claimedPrevious: Number(metric?.claimed_previous ?? 0),
      claimedChangePct: ownerPercentChange(Number(metric?.claimed_count ?? 0), Number(metric?.claimed_previous ?? 0)),
      redeemed: Number(metric?.redeemed_count ?? statusMap.get("REDEEMED") ?? 0),
      redeemedPrevious: Number(metric?.redeemed_previous ?? 0),
      redeemedChangePct: ownerPercentChange(Number(metric?.redeemed_count ?? 0), Number(metric?.redeemed_previous ?? 0)),
      totalRewardSupplied: Number(metric?.total_reward_supplied ?? 0),
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
    operationRanges: {
      daily: { from: formatOwnerDateOnly(operationRanges.daily.start), to: formatOwnerDateOnly(new Date(operationRanges.daily.end.getTime() - 86400000)) },
      weekly: { from: formatOwnerDateOnly(operationRanges.weekly.start), to: formatOwnerDateOnly(new Date(operationRanges.weekly.end.getTime() - 86400000)) },
      monthly: { from: formatOwnerDateOnly(operationRanges.monthly.start), to: formatOwnerDateOnly(new Date(operationRanges.monthly.end.getTime() - 86400000)) },
      yearly: { from: formatOwnerDateOnly(operationRanges.yearly.start), to: formatOwnerDateOnly(new Date(operationRanges.yearly.end.getTime() - 86400000)) },
    },
    activeEvents: eventOut.filter((event) =>
      event.status === "ACTIVE"
    ),
  });
}

async function handleOwnerCustomers(request: Request, env: Env): Promise<Response> {
  const owner = await requireOwner(request, env);
  if (!owner) return errorResponse("UNAUTHORIZED", "Owner authentication is required.", 401);

  const url = new URL(request.url);
  const search = (url.searchParams.get("search") || "").trim().slice(0, 128);
  const scope = (url.searchParams.get("scope") || "").trim().toLowerCase();
  const activeEventScope = scope === "active-event";
  const statusFilter = (url.searchParams.get("status") || "all").trim().toLowerCase();
  const nowIso = new Date().toISOString();
  const activeSessionExists = `EXISTS (
    SELECT 1
    FROM auth_sessions s_customer
    WHERE s_customer.user_id = c.customer_id
      AND s_customer.role = 'CUSTOMER'
      AND s_customer.session_id NOT LIKE 'otp_%'
      AND s_customer.revoked_at IS NULL
      AND s_customer.expires_at > ?
  )`;
  const pageRaw = Number(url.searchParams.get("page") || 1);
  const pageSizeRaw = Number(url.searchParams.get("pageSize") || 10);
  const page = Number.isInteger(pageRaw) && pageRaw > 0 ? Math.min(pageRaw, 100000) : 1;
  const pageSize = Number.isInteger(pageSizeRaw) && pageSizeRaw > 0 ? Math.min(pageSizeRaw, 50) : 10;
  const offset = (page - 1) * pageSize;
  const pattern = `%${search.replace(/[\%_]/g, "\\$&")}%`;
  const whereClauses: string[] = [];
  const whereParams: unknown[] = [];
  if (activeEventScope) {
    whereClauses.push(`EXISTS (
      SELECT 1
      FROM plays p_active
      INNER JOIN events e_active
        ON p_active.created_at >= e_active.starts_at
       AND p_active.created_at < e_active.ends_at
      WHERE p_active.customer_id = c.customer_id
        AND e_active.active = 1
        AND e_active.starts_at <= ?
        AND e_active.ends_at > ?
    )`);
    whereParams.push(nowIso, nowIso);
  }
  if (statusFilter === "active") {
    whereClauses.push(activeSessionExists);
    whereParams.push(nowIso);
  } else if (statusFilter === "inactive") {
    whereClauses.push(`NOT ${activeSessionExists}`);
    whereParams.push(nowIso);
  }
  if (search) {
    whereClauses.push(`(c.email LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\' OR c.phone_masked LIKE ? ESCAPE '\\' OR c.customer_id LIKE ? ESCAPE '\\')`);
    whereParams.push(pattern, pattern, pattern, pattern);
  }
  const where = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";
  const params = [...whereParams, pageSize, offset];

  const result = await env.DB.prepare(`
    SELECT c.customer_id, c.email, c.phone, c.phone_masked, c.created_at,
      (SELECT COUNT(*) FROM plays p WHERE p.customer_id = c.customer_id) AS total_play,
      (SELECT COUNT(*) FROM rewards r WHERE r.customer_id = c.customer_id) AS total_reward,
      (SELECT COUNT(*) FROM rewards r WHERE r.customer_id = c.customer_id AND r.redeemed_at IS NOT NULL) AS total_redeemed,
      CASE WHEN ${activeSessionExists} THEN 'ACTIVE' ELSE 'INACTIVE' END AS login_status,
      COUNT(*) OVER () AS total_count
    FROM customers c ${where}
    ORDER BY c.created_at DESC, c.customer_id ASC
    LIMIT ? OFFSET ?
  `).bind(...[nowIso, ...whereParams, pageSize, offset]).all();

  const rows = (result.results ?? []) as Array<Record<string, unknown>>;
  const total = Number(rows[0]?.total_count ?? 0);
  return json({ ok: true, total, page, pageSize, items: rows.map((row) => ({
    customerId: String(row.customer_id ?? ""), email: String(row.email ?? ""),
    phone: String(row.phone ?? ""), phoneMasked: String(row.phone_masked ?? ""), createdAt: String(row.created_at ?? ""),
    totalPlay: Number(row.total_play ?? 0), totalReward: Number(row.total_reward ?? 0),
    totalRedeemed: Number(row.total_redeemed ?? 0), status: String(row.login_status ?? "INACTIVE"),
  })) });
}

async function handleOwnerCustomerDelete(request: Request, env: Env, customerId: string): Promise<Response> {
  const owner = await requireOwner(request, env);
  if (!owner) return errorResponse("UNAUTHORIZED", "Owner authentication is required.", 401);
  const id = customerId.trim();
  if (!id || id.length > 128) return errorResponse("INVALID_REQUEST", "Customer ID is required.", 400);

  const customer = await env.DB.prepare(`
    SELECT customer_id, email
    FROM customers
    WHERE customer_id = ?
    LIMIT 1
  `).bind(id).first<{ customer_id: string; email: string }>();
  if (!customer) return errorResponse("CUSTOMER_NOT_FOUND", "Customer was not found.", 404);

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM rewards WHERE customer_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM sessions WHERE play_id IN (SELECT play_id FROM plays WHERE customer_id = ?)`).bind(id),
    env.DB.prepare(`DELETE FROM plays WHERE customer_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM transactions WHERE customer_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM auth_sessions WHERE user_id = ? AND role = 'CUSTOMER'`).bind(id),
    env.DB.prepare(`DELETE FROM customers WHERE customer_id = ?`).bind(id),
  ]);

  await writeAuditSafe(env, {
    entityType: "CUSTOMER",
    entityId: id,
    action: "DELETE",
    actor: owner.userId,
    result: "SUCCESS",
  });

  return json({ ok: true, customerId: id });
}

async function handleCustomerTrace(request: Request, env: Env, customerId: string): Promise<Response> {
  const owner = await requireOwner(request, env);
  if (!owner) return errorResponse("UNAUTHORIZED", "Owner authentication is required.", 401);
  const id = customerId.trim();
  if (!id || id.length > 128) return errorResponse("INVALID_REQUEST", "Customer ID is required.", 400);

  const customer = await env.DB.prepare(`
    SELECT customer_id, name, phone, phone_masked, email, created_at,
      CASE WHEN EXISTS (
        SELECT 1 FROM auth_sessions s_customer
        WHERE s_customer.user_id = customers.customer_id
          AND s_customer.role = 'CUSTOMER'
          AND s_customer.session_id NOT LIKE 'otp_%'
          AND s_customer.revoked_at IS NULL
          AND s_customer.expires_at > ?
      ) THEN 'ACTIVE' ELSE 'INACTIVE' END AS login_status
    FROM customers WHERE customer_id = ? LIMIT 1
  `).bind(new Date().toISOString(), id).first<{ customer_id: string; name: string; phone: string | null; phone_masked: string; email: string; created_at: string; login_status: string }>();
  if (!customer) return errorResponse("CUSTOMER_NOT_FOUND", "Customer was not found.", 404);

  const [transactions, plays, rewards] = await env.DB.batch([
    env.DB.prepare(`SELECT transaction_id, service_type, amount, created_at FROM transactions WHERE customer_id = ? ORDER BY created_at DESC`).bind(id),
    env.DB.prepare(`SELECT play_id, transaction_id, session_id, status, created_at, finished_at FROM plays WHERE customer_id = ? ORDER BY created_at DESC`).bind(id),
    env.DB.prepare(`SELECT reward_id, play_id, type, status, token_ref, created_at, claimed_at, redeemed_at, used_at FROM rewards WHERE customer_id = ? ORDER BY created_at DESC`).bind(id),
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
    const [result, eventResult, eventRewardResult, claimedResult] = await Promise.all([
      env.DB.prepare(`
        SELECT reward_pool_id, reward_type, description, quota_total, quota_used,
               quota_claimed, budget_total, terms, active
        FROM reward_pool
        ORDER BY reward_type ASC, created_at ASC, reward_pool_id ASC
      `).all(),
      env.DB.prepare(`
        SELECT event_id, title, starts_at, ends_at, reward_type, reward_quantity,
               reward_pool_id, active
        FROM events
        ORDER BY starts_at DESC, event_id DESC
        LIMIT 100
      `).all(),
      env.DB.prepare(`
        SELECT event_id, reward_pool_id, reward_type, reward_quantity, position
        FROM event_rewards
        ORDER BY event_id ASC, position ASC
      `).all(),
      env.DB.prepare(`
        SELECT reward_pool_id, type AS reward_type, COUNT(*) AS claimed_count
        FROM rewards
        WHERE claimed_at IS NOT NULL
          AND claimed_at >= ?
          AND claimed_at < ?
        GROUP BY reward_pool_id, type
      `).bind(
        (() => {
          const from = url.searchParams.get("from");
          return from ? new Date(`${from}T00:00:00+07:00`).toISOString() : new Date(0).toISOString();
        })(),
        (() => {
          const to = url.searchParams.get("to");
          return to ? new Date(`${to}T23:59:59.999+07:00`).toISOString() : new Date().toISOString();
        })(),
      ).all(),
    ]);

    const claimedByPool = new Map<string, number>();
    for (const row of (claimedResult.results ?? []) as Array<Record<string, unknown>>) {
      const poolId = String(row.reward_pool_id ?? "");
      if (poolId) claimedByPool.set(poolId, Number(row.claimed_count ?? 0));
    }

    const rewardRowsByEvent = new Map<string, Array<{
      rewardPoolId: string;
      rewardType: string;
      rewardQuantity: number;
    }>>();

    for (const row of (eventRewardResult.results ?? []) as Array<Record<string, unknown>>) {
      const eventId = String(row.event_id);
      const list = rewardRowsByEvent.get(eventId) ?? [];
      list.push({
        rewardPoolId: String(row.reward_pool_id ?? ""),
        rewardType: String(row.reward_type),
        rewardQuantity: Number(row.reward_quantity ?? 0),
      });
      rewardRowsByEvent.set(eventId, list);
    }

    const eventsByPool = new Map<string, Array<Record<string, unknown>>>();
    for (const row of (eventResult.results ?? []) as Array<Record<string, unknown>>) {
      const eventId = String(row.event_id);
      const rewards = rewardRowsByEvent.get(eventId);
      const legacyReward = {
        rewardPoolId: String(row.reward_pool_id ?? ""),
        rewardType: String(row.reward_type),
        rewardQuantity: Number(row.reward_quantity ?? 0),
      };
      const eventRewards = rewards?.length ? rewards : [legacyReward];

      for (const reward of eventRewards) {
        const poolId = reward.rewardPoolId;
        if (!poolId) continue;
        const eventRecord = {
          ...row,
          reward_pool_id: poolId,
          reward_type: reward.rewardType,
          reward_quantity: reward.rewardQuantity,
        };
        const list = eventsByPool.get(poolId) ?? [];
        list.push(eventRecord);
        eventsByPool.set(poolId, list);
      }
    }

    const items = (result.results ?? []).map((row) => {
      const record = row as Record<string, unknown>;
      const rewardPoolId = String(record.reward_pool_id);
      const quotaTotal = Number(record.quota_total);
      const quotaUsed = Number(record.quota_used);
      const quotaClaimed = Number(record.quota_claimed ?? claimedByPool.get(rewardPoolId) ?? 0);

      return {
        rewardPoolId,
        rewardType: String(record.reward_type),
        description: String(record.description ?? ""),
        quotaTotal,
        quotaUsed,
        quotaClaimed,
        remaining: Math.max(0, quotaTotal - quotaUsed),
        budgetTotal: Number(record.budget_total ?? 0),
        rewardClaimed: Number(claimedByPool.get(rewardPoolId) ?? quotaClaimed),
        terms: String(record.terms ?? ""),
        active: Number(record.active) === 1,
        events: (eventsByPool.get(rewardPoolId) ?? []).map((event) => ({
          eventId: String(event.event_id),
          title: String(event.title),
          startsAt: String(event.starts_at),
          endsAt: String(event.ends_at),
          rewardQuantity: Number(event.reward_quantity),
          active: Number(event.active) === 1,
        })),
      };
    });

    return json({ ok: true, items });
  }

  if (request.method === "DELETE") {
    if (!match) return errorResponse("INVALID_REQUEST", "Reward pool ID is required.", 400);
    const rewardPoolId = decodeURIComponent(match[1]);

    const linked = await env.DB.prepare(`
      SELECT
        (
          SELECT COUNT(*)
          FROM events
          WHERE reward_pool_id = ?
             OR event_id IN (
               SELECT event_id FROM event_rewards WHERE reward_pool_id = ?
             )
        ) AS event_count,
        (
          SELECT COUNT(*)
          FROM rewards
          WHERE reward_pool_id = ?
        ) AS reward_count
    `).bind(rewardPoolId, rewardPoolId, rewardPoolId).first<{
      event_count: number;
      reward_count: number;
    }>();

    if (Number(linked?.event_count ?? 0) > 0 || Number(linked?.reward_count ?? 0) > 0) {
      return errorResponse("REWARD_IN_USE", "Reward masih digunakan oleh event atau sudah memiliki reward customer dan tidak dapat dihapus.", 409);
    }

    const result = await env.DB.prepare(`
      DELETE FROM reward_pool WHERE reward_pool_id = ?
    `).bind(rewardPoolId).run();

    if (result.meta.changes !== 1) {
      return errorResponse("REWARD_NOT_FOUND", "Reward tidak ditemukan.", 404);
    }

    await writeAuditSafe(env, {
      entityType: "REWARD",
      entityId: rewardPoolId,
      action: "DELETE",
      actor: owner.userId,
      result: "SUCCESS",
    });

    await publishRealtime(env, "REWARD_UPDATED", { rewardPoolId });
    return json({ ok: true });
  }

  if (request.method !== "POST" && request.method !== "PATCH") {
    return errorResponse("NOT_FOUND", "Reward Pool endpoint not found.", 404);
  }

  let body: {
    rewardPoolId?: unknown;
    rewardType?: unknown;
    description?: unknown;
    quotaTotal?: unknown;
    unitPrice?: unknown;
    budgetTotal?: unknown;
    terms?: unknown;
    active?: unknown;
  };

  try {
    body = await request.json() as typeof body;
  } catch {
    return errorResponse("INVALID_REQUEST", "Invalid JSON request body.", 400);
  }

  const pathRewardPoolId = match ? decodeURIComponent(match[1]).trim() : "";
  const rewardPoolId = pathRewardPoolId || (isNonEmptyString(body.rewardPoolId, 128) ? body.rewardPoolId.trim() : "");
  const rewardType = isNonEmptyString(body.rewardType, 120) ? body.rewardType.trim() : "";
  const description = body.description === undefined ? "" : (isNonEmptyString(body.description, 500) ? body.description.trim() : "");
  const terms = body.terms === undefined ? "" : (isNonEmptyString(body.terms, 500) ? body.terms.trim() : "");
  const quotaTotal = parsePositiveInteger(body.quotaTotal);
  const unitPrice = body.unitPrice === undefined ? null : Number(body.unitPrice);
  const legacyBudgetTotal = body.budgetTotal === undefined ? NaN : Number(body.budgetTotal);
  const budgetTotal = unitPrice !== null && Number.isSafeInteger(unitPrice) && unitPrice >= 0 && quotaTotal !== null
    ? quotaTotal * unitPrice
    : legacyBudgetTotal;
  const active = body.active === undefined ? 1 : body.active ? 1 : 0;

  if (!rewardType || quotaTotal === null || !Number.isSafeInteger(budgetTotal) || budgetTotal < 0) {
    return errorResponse("INVALID_REQUEST", "Nama reward, total stok, dan harga satuan wajib diisi.", 400);
  }

  const nowIso = new Date().toISOString();

  if (request.method === "POST") {
    const newRewardPoolId = `reward_pool_${crypto.randomUUID()}`;

    try {
      await env.DB.prepare(`
        INSERT INTO reward_pool (
          reward_pool_id, reward_type, description, quota_total, quota_used,
          quota_claimed, budget_total, terms, active, created_by, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?)
      `).bind(
        newRewardPoolId,
        rewardType,
        description,
        quotaTotal,
        budgetTotal,
        terms,
        active,
        owner.userId,
        nowIso,
        nowIso,
      ).run();
    } catch {
      return errorResponse("REWARD_CREATE_FAILED", "Reward baru gagal dibuat.", 500);
    }

    await writeAuditSafe(env, {
      entityType: "REWARD",
      entityId: newRewardPoolId,
      action: "CREATE",
      actor: owner.userId,
      result: "SUCCESS",
    });

    await publishRealtime(env, "REWARD_UPDATED", { rewardPoolId: newRewardPoolId });
    return json({ ok: true, rewardPoolId: newRewardPoolId, rewardType }, 201);
  }

  if (!rewardPoolId) {
    return errorResponse("INVALID_REQUEST", "Reward pool ID is required.", 400);
  }

  const current = await env.DB.prepare(`
    SELECT reward_pool_id, quota_total, quota_used, quota_claimed
    FROM reward_pool
    WHERE reward_pool_id = ?
    LIMIT 1
  `).bind(rewardPoolId).first<{
    reward_pool_id: string;
    quota_total: number;
    quota_used: number;
    quota_claimed: number;
  }>();

  if (!current) {
    return errorResponse("REWARD_NOT_FOUND", "Reward tidak ditemukan.", 404);
  }

  if (quotaTotal < Number(current.quota_used)) {
    return errorResponse("INVALID_QUOTA", "Total stok tidak boleh lebih kecil dari stok yang sudah dialokasikan ke event.", 400);
  }

  if (quotaTotal < Number(current.quota_claimed)) {
    return errorResponse("INVALID_QUOTA", "Total stok tidak boleh lebih kecil dari reward yang sudah diklaim.", 400);
  }

  try {
    const result = await env.DB.prepare(`
      UPDATE reward_pool
      SET reward_type = ?, description = ?, quota_total = ?, budget_total = ?,
          terms = ?, active = ?, updated_at = ?
      WHERE reward_pool_id = ?
    `).bind(
      rewardType,
      description,
      quotaTotal,
      budgetTotal,
      terms,
      active,
      nowIso,
      rewardPoolId,
    ).run();

    if (result.meta.changes !== 1) {
      return errorResponse("REWARD_NOT_FOUND", "Reward tidak ditemukan.", 404);
    }
  } catch {
    return errorResponse("REWARD_UPDATE_FAILED", "Perubahan reward gagal disimpan.", 500);
  }

  await writeAuditSafe(env, {
    entityType: "REWARD",
    entityId: rewardPoolId,
    action: "UPDATE",
    actor: owner.userId,
    result: "SUCCESS",
  });

  await publishRealtime(env, "REWARD_UPDATED", { rewardPoolId });
  return json({ ok: true, rewardPoolId, rewardType });
}


async function handleEvents(request: Request, env: Env): Promise<Response> {
  const owner = await requireOwner(request, env);
  if (!owner) return errorResponse("UNAUTHORIZED", "Owner authentication is required.", 401);
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/owner\/events\/([^/]+)$/);

  if (request.method === "GET") {
    await cleanupExpiredEvents(env);
    await cleanupInactiveEventImages(env, new Date().toISOString());

    const rows = await env.DB.prepare(`
      SELECT e.event_id, e.title, e.starts_at, e.ends_at, e.reward_type,
             e.reward_quantity, e.reward_pool_id, e.description, e.active,
             e.created_at, e.updated_at,
             CASE WHEN i.event_id IS NULL THEN 0 ELSE 1 END AS has_image
      FROM events e
      LEFT JOIN event_images i ON i.event_id = e.event_id
      ORDER BY e.starts_at DESC, e.event_id DESC
      LIMIT 100
    `).all();

    const rewardRows = await env.DB.prepare(`
      SELECT er.event_id, er.reward_pool_id, er.reward_type,
             er.reward_quantity, er.position, rp.terms
      FROM event_rewards er
      LEFT JOIN reward_pool rp ON rp.reward_pool_id = er.reward_pool_id
      ORDER BY er.event_id ASC, er.position ASC
    `).all();

    const rewardsByEvent = new Map<string, Array<{
      rewardPoolId: string;
      rewardType: string;
      rewardQuantity: number;
      terms: string;
    }>>();

    for (const reward of (rewardRows.results ?? []) as Array<Record<string, unknown>>) {
      const eventId = String(reward.event_id);
      const list = rewardsByEvent.get(eventId) ?? [];
      list.push({
        rewardPoolId: String(reward.reward_pool_id ?? ""),
        rewardType: String(reward.reward_type),
        rewardQuantity: Number(reward.reward_quantity),
        terms: String(reward.terms ?? ""),
      });
      rewardsByEvent.set(eventId, list);
    }

    const now = Date.now();

    return json({
      ok: true,
      items: (rows.results ?? []).map((row) => {
        const eventId = String((row as any).event_id);
        const legacyRewards = [{
          rewardPoolId: String((row as any).reward_pool_id ?? ""),
          rewardType: String((row as any).reward_type),
          rewardQuantity: Number((row as any).reward_quantity),
          terms: "",
        }];
        const rewards = rewardsByEvent.get(eventId)?.length
          ? rewardsByEvent.get(eventId)!
          : legacyRewards;
        const status = eventStatus(
          String((row as any).starts_at),
          String((row as any).ends_at),
          Number((row as any).active),
          now,
        );

        return {
          eventId,
          title: String((row as any).title),
          startsAt: String((row as any).starts_at),
          endsAt: String((row as any).ends_at),
          rewardPoolId: String((row as any).reward_pool_id ?? rewards[0]?.rewardPoolId ?? ""),
          rewardType: rewards[0].rewardType,
          rewardQuantity: rewards[0].rewardQuantity,
          rewards,
          description: String((row as any).description ?? ""),
          active: Number((row as any).active) === 1,
          hasImage: Number((row as any).has_image) === 1,
          shareUrl: "https://1anniversary.pages.dev/customer",
          imageUrl: Number((row as any).has_image) === 1 && status !== "INACTIVE"
            ? `/owner/events/${encodeURIComponent(eventId)}/image`
            : null,
          status,
          createdAt: String((row as any).created_at),
          updatedAt: String((row as any).updated_at),
        };
      }),
    });
  }

  if (request.method === "DELETE") {
    if (!match) return errorResponse("INVALID_REQUEST", "Event ID is required.", 400);

    const eventId = decodeURIComponent(match[1]);
    const event = await env.DB.prepare(`
      SELECT event_id, ends_at
      FROM events
      WHERE event_id = ?
      LIMIT 1
    `).bind(eventId).first<{ event_id: string; ends_at: string }>();

    if (!event) return errorResponse("EVENT_NOT_FOUND", "Event tidak ditemukan.", 404);

    const eventRewards = await env.DB.prepare(`
      SELECT reward_pool_id, reward_quantity
      FROM event_rewards
      WHERE event_id = ?
      ORDER BY position ASC
    `).bind(eventId).all();

    const poolIds = [...new Set(
      (eventRewards.results ?? [])
        .map((row) => String((row as any).reward_pool_id ?? ""))
        .filter(Boolean),
    )];

    const statements: D1PreparedStatement[] = [];

    for (const row of (eventRewards.results ?? []) as Array<Record<string, unknown>>) {
      const poolId = String(row.reward_pool_id ?? "");
      const quantity = Number(row.reward_quantity ?? 0);
      if (!poolId || quantity < 1) continue;

      statements.push(env.DB.prepare(`
        UPDATE reward_pool
        SET quota_used = MAX(
          quota_claimed,
          quota_used - ?
        ),
        updated_at = ?
        WHERE reward_pool_id = ?
      `).bind(quantity, new Date().toISOString(), poolId));
    }

    statements.push(
      env.DB.prepare(`DELETE FROM event_images WHERE event_id = ?`).bind(eventId),
      env.DB.prepare(`DELETE FROM events WHERE event_id = ?`).bind(eventId),
    );

    try {
      const result = await env.DB.batch(statements);
      const deleteResult = result[result.length - 1];
      if (deleteResult?.meta?.changes !== 1) {
        return errorResponse("EVENT_NOT_FOUND", "Event tidak ditemukan.", 404);
      }
    } catch {
      return errorResponse("EVENT_DELETE_FAILED", "Event gagal dihapus.", 500);
    }

    await writeAuditSafe(env, {
      entityType: "EVENT",
      entityId: eventId,
      action: "DELETE",
      actor: owner.userId,
      result: "SUCCESS",
    });

    await publishRealtime(env, "EVENT_UPDATED", { eventId });
    return json({ ok: true });
  }

  if (request.method !== "POST" && request.method !== "PATCH") {
    return errorResponse("NOT_FOUND", "Event endpoint not found.", 404);
  }

  let body: {
    title?: unknown;
    startsAt?: unknown;
    endsAt?: unknown;
    rewards?: unknown;
    rewardType?: unknown;
    rewardQuantity?: unknown;
    description?: unknown;
    active?: unknown;
  };

  try {
    body = await request.json() as typeof body;
  } catch {
    return errorResponse("INVALID_REQUEST", "Invalid JSON request body.", 400);
  }

  const title = isNonEmptyString(body.title, 160) ? body.title.trim() : "";
  const startsAt = isNonEmptyString(body.startsAt, 64) ? body.startsAt.trim() : "";
  const endsAt = isNonEmptyString(body.endsAt, 64) ? body.endsAt.trim() : "";
  const description = body.description === undefined
    ? ""
    : (isNonEmptyString(body.description, 500) ? body.description.trim() : "");
  const active = body.active === undefined ? 1 : body.active ? 1 : 0;

  const rawRewards = Array.isArray(body.rewards)
    ? body.rewards
    : (body.rewardType
      ? [{ rewardType: body.rewardType, rewardQuantity: body.rewardQuantity }]
      : []);

  const rewards: Array<{
    rewardPoolId: string;
    rewardType: string;
    rewardQuantity: number;
  }> = [];

  for (const item of rawRewards) {
    if (!item || typeof item !== "object") {
      return errorResponse("INVALID_REQUEST", "Format reward tidak valid.", 400);
    }

    const rewardPoolId = isNonEmptyString((item as any).rewardPoolId, 128)
      ? (item as any).rewardPoolId.trim()
      : "";
    const rewardType = isNonEmptyString((item as any).rewardType, 120)
      ? (item as any).rewardType.trim()
      : "";
    const rewardQuantity = parsePositiveInteger((item as any).rewardQuantity);

    if (!rewardPoolId || rewardQuantity === null) {
      return errorResponse("INVALID_REQUEST", "Reward pool dan jumlah reward wajib diisi.", 400);
    }

    rewards.push({
      rewardPoolId,
      rewardType,
      rewardQuantity,
    });
  }

  if (!rewards.length) {
    return errorResponse("INVALID_REQUEST", "Minimal satu reward harus dipilih.", 400);
  }

  const duplicatePool = rewards.find((reward, index) =>
    rewards.findIndex((candidate) => candidate.rewardPoolId === reward.rewardPoolId) !== index
  );

  if (duplicatePool) {
    return errorResponse("DUPLICATE_REWARD_POOL", "Reward pool yang sama tidak boleh dipakai dua kali dalam satu event. Tambahkan reward pool baru.", 409);
  }

  const startsMs = Date.parse(startsAt);
  const endsMs = Date.parse(endsAt);

  if (
    !title ||
    !startsAt ||
    !endsAt ||
    !Number.isFinite(startsMs) ||
    !Number.isFinite(endsMs) ||
    endsMs <= startsMs
  ) {
    return errorResponse("INVALID_REQUEST", "Event title dan period wajib diisi dengan benar.", 400);
  }

  const poolResult = await env.DB.prepare(`
    SELECT reward_pool_id, reward_type, quota_total, quota_used,
           quota_claimed, active
    FROM reward_pool
    WHERE reward_pool_id IN (${rewards.map(() => "?").join(",")})
  `).bind(...rewards.map((reward) => reward.rewardPoolId)).all();

  const poolById = new Map<string, Record<string, unknown>>();
  for (const row of (poolResult.results ?? []) as Array<Record<string, unknown>>) {
    poolById.set(String(row.reward_pool_id), row);
  }

  for (const reward of rewards) {
    const pool = poolById.get(reward.rewardPoolId);
    if (!pool || Number(pool.active) !== 1) {
      return errorResponse(
        "REWARD_INACTIVE",
        `Reward pool tidak aktif atau tidak tersedia: ${reward.rewardType || reward.rewardPoolId}.`,
        400,
      );
    }

    if (reward.rewardType && String(pool.reward_type) !== reward.rewardType) {
      return errorResponse("REWARD_MISMATCH", "Reward yang dipilih tidak sesuai dengan reward pool.", 409);
    }

    reward.rewardType = String(pool.reward_type);
  }

  const poolUsage = await env.DB.prepare(`
    SELECT er.reward_pool_id, er.event_id
    FROM event_rewards er
    WHERE er.reward_pool_id IN (${rewards.map(() => "?").join(",")})
      ${match ? "AND er.event_id <> ?" : ""}
  `).bind(
    ...rewards.map((reward) => reward.rewardPoolId),
    ...(match ? [decodeURIComponent(match[1])] : []),
  ).all();

  if ((poolUsage.results ?? []).length > 0) {
    return errorResponse(
      "REWARD_IN_USE",
      "Reward pool sudah digunakan oleh event lain. Buat reward pool baru untuk event ini.",
      409,
    );
  }

  const nowIso = new Date().toISOString();

  if (request.method === "POST") {
    for (const reward of rewards) {
      const pool = poolById.get(reward.rewardPoolId)!;
      const available = Number(pool.quota_total) - Number(pool.quota_used);
      if (reward.rewardQuantity > available) {
        return errorResponse(
          "REWARD_STOCK_INSUFFICIENT",
          `Stok reward ${reward.rewardType} tidak mencukupi. Sisa stok pool: ${Math.max(0, available)}.`,
          409,
        );
      }
    }

    const eventId = `event_${crypto.randomUUID()}`;
    const statements: D1PreparedStatement[] = [
      env.DB.prepare(`
        INSERT INTO events (
          event_id, title, starts_at, ends_at, reward_type,
          reward_quantity, reward_pool_id, description, active,
          created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        eventId,
        title,
        startsAt,
        endsAt,
        rewards[0].rewardType,
        rewards[0].rewardQuantity,
        rewards[0].rewardPoolId,
        description,
        active,
        nowIso,
        nowIso,
      ),
      ...rewards.map((reward, index) => env.DB.prepare(`
        INSERT INTO event_rewards (
          event_reward_id, event_id, reward_pool_id, reward_type,
          reward_quantity, position, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        `event_reward_${crypto.randomUUID()}`,
        eventId,
        reward.rewardPoolId,
        reward.rewardType,
        reward.rewardQuantity,
        index,
        nowIso,
        nowIso,
      )),
      ...rewards.map((reward) => env.DB.prepare(`
        UPDATE reward_pool
        SET quota_used = quota_used + ?,
            updated_at = ?
        WHERE reward_pool_id = ?
          AND active = 1
          AND quota_used + ? <= quota_total
      `).bind(
        reward.rewardQuantity,
        nowIso,
        reward.rewardPoolId,
        reward.rewardQuantity,
      )),
    ];

    try {
      const result = await env.DB.batch(statements);
      const poolUpdateStart = 1 + rewards.length;
      for (let index = 0; index < rewards.length; index += 1) {
        const poolUpdate = result[poolUpdateStart + index];
        if (poolUpdate?.meta?.changes !== 1) {
          throw new Error("REWARD_STOCK_INSUFFICIENT");
        }
      }
    } catch (error) {
      return errorResponse(
        error instanceof Error && error.message === "REWARD_STOCK_INSUFFICIENT"
          ? "REWARD_STOCK_INSUFFICIENT"
          : "EVENT_CREATE_FAILED",
        error instanceof Error && error.message === "REWARD_STOCK_INSUFFICIENT"
          ? "Stok reward tidak mencukupi untuk alokasi event."
          : "Event gagal dibuat.",
        409,
      );
    }

    await writeAuditSafe(env, {
      entityType: "EVENT",
      entityId: eventId,
      action: "CREATE",
      actor: owner.userId,
      result: "SUCCESS",
    });

    await publishRealtime(env, "EVENT_UPDATED", { eventId });
    return json({ ok: true, eventId }, 201);
  }

  if (!match) return errorResponse("INVALID_REQUEST", "Event ID is required.", 400);

  const eventId = decodeURIComponent(match[1]);
  const existing = await env.DB.prepare(`
    SELECT event_id
    FROM events
    WHERE event_id = ?
    LIMIT 1
  `).bind(eventId).first<{ event_id: string }>();

  if (!existing) {
    return errorResponse("EVENT_NOT_FOUND", "Event tidak ditemukan.", 404);
  }

  const oldRewardResult = await env.DB.prepare(`
    SELECT reward_pool_id, reward_quantity
    FROM event_rewards
    WHERE event_id = ?
    ORDER BY position ASC
  `).bind(eventId).all();

  const oldRewards = (oldRewardResult.results ?? []) as Array<Record<string, unknown>>;
  const oldByPool = new Map<string, number>();
  for (const row of oldRewards) {
    const poolId = String(row.reward_pool_id ?? "");
    if (poolId) {
      oldByPool.set(poolId, (oldByPool.get(poolId) ?? 0) + Number(row.reward_quantity ?? 0));
    }
  }

  const newByPool = new Map<string, number>();
  for (const reward of rewards) {
    newByPool.set(reward.rewardPoolId, reward.rewardQuantity);
  }

  const allPoolIds = new Set<string>([
    ...oldByPool.keys(),
    ...newByPool.keys(),
  ]);

  const allocationDeltas = new Map<string, number>();
  for (const poolId of allPoolIds) {
    allocationDeltas.set(
      poolId,
      (newByPool.get(poolId) ?? 0) - (oldByPool.get(poolId) ?? 0),
    );
  }

  const poolStatements = await env.DB.prepare(`
    SELECT reward_pool_id, quota_total, quota_used, quota_claimed, active
    FROM reward_pool
    WHERE reward_pool_id IN (${Array.from(allPoolIds).map(() => "?").join(",")})
  `).bind(...Array.from(allPoolIds)).all();

  const poolsForUpdate = new Map<string, Record<string, unknown>>();
  for (const row of (poolStatements.results ?? []) as Array<Record<string, unknown>>) {
    poolsForUpdate.set(String(row.reward_pool_id), row);
  }

  for (const [poolId, delta] of allocationDeltas) {
    const pool = poolsForUpdate.get(poolId);
    if (!pool) return errorResponse("REWARD_NOT_FOUND", "Reward pool tidak ditemukan.", 404);

    const nextUsed = Number(pool.quota_used) + delta;
    if (nextUsed < Number(pool.quota_claimed)) {
      return errorResponse("INVALID_QUOTA", "Alokasi event tidak boleh lebih kecil dari reward yang sudah diklaim.", 409);
    }
    if (nextUsed > Number(pool.quota_total)) {
      return errorResponse("REWARD_STOCK_INSUFFICIENT", "Stok reward tidak mencukupi untuk alokasi event.", 409);
    }
    if (delta > 0 && Number(pool.active) !== 1) {
      return errorResponse("REWARD_INACTIVE", "Reward pool yang ditambahkan harus aktif.", 400);
    }
  }

  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`
      UPDATE events
      SET title = ?, starts_at = ?, ends_at = ?, reward_type = ?,
          reward_quantity = ?, reward_pool_id = ?, description = ?,
          active = ?, updated_at = ?
      WHERE event_id = ?
    `).bind(
      title,
      startsAt,
      endsAt,
      rewards[0].rewardType,
      rewards[0].rewardQuantity,
      rewards[0].rewardPoolId,
      description,
      active,
      nowIso,
      eventId,
    ),
    env.DB.prepare(`DELETE FROM event_rewards WHERE event_id = ?`).bind(eventId),
    ...rewards.map((reward, index) => env.DB.prepare(`
      INSERT INTO event_rewards (
        event_reward_id, event_id, reward_pool_id, reward_type,
        reward_quantity, position, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      `event_reward_${crypto.randomUUID()}`,
      eventId,
      reward.rewardPoolId,
      reward.rewardType,
      reward.rewardQuantity,
      index,
      nowIso,
      nowIso,
    )),
    ...Array.from(allocationDeltas)
      .filter(([, delta]) => delta !== 0)
      .map(([poolId, delta]) => env.DB.prepare(`
        UPDATE reward_pool
        SET quota_used = quota_used + ?,
            updated_at = ?
        WHERE reward_pool_id = ?
      `).bind(delta, nowIso, poolId)),
  ];

  try {
    await env.DB.batch(statements);
  } catch {
    return errorResponse("EVENT_UPDATE_FAILED", "Perubahan event gagal disimpan.", 500);
  }

  if (active !== 1 || endsMs <= Date.now()) {
    await env.DB.prepare(`DELETE FROM event_images WHERE event_id = ?`).bind(eventId).run();
  }

  await writeAuditSafe(env, {
    entityType: "EVENT",
    entityId: eventId,
    action: "UPDATE",
    actor: owner.userId,
    result: "SUCCESS",
  });

  await publishRealtime(env, "EVENT_UPDATED", { eventId });
  return json({ ok: true, eventId });
}



const SERVICE_SETTINGS_DEFAULT_PHOTO = "/assets/background/laundry/Laundry-area.jpg";
const SERVICE_SETTINGS_MAX_PHOTO_BYTES = 1048576;

function serviceSettingsImageUrl(request: Request): string {
  return new URL("/service-settings/image", request.url).toString();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function serviceImageBytesValid(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === "image/png") {
    return bytes.length >= 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  }
  if (mimeType === "image/webp") {
    return bytes.length >= 12 &&
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  }
  return false;
}

async function readServiceSettings(env: Env, request: Request): Promise<Response> {
  try {
    const row = await env.DB.prepare(`
      SELECT data_json, photo_mime, photo_blob
      FROM service_settings
      WHERE id = 1
      LIMIT 1
    `).first<{ data_json: string; photo_mime: string | null; photo_blob: ArrayBuffer | Uint8Array | null }>();

    if (!row?.data_json) {
      return json({
        ok: true,
        settings: {},
        photoUrl: SERVICE_SETTINGS_DEFAULT_PHOTO,
      });
    }

    let settings: unknown;
    try {
      settings = JSON.parse(row.data_json);
    } catch {
      return errorResponse("SERVICE_SETTINGS_CORRUPT", "Data Pengaturan Layanan tidak valid.", 500);
    }

    if (!isPlainObject(settings)) {
      return errorResponse("SERVICE_SETTINGS_CORRUPT", "Data Pengaturan Layanan tidak valid.", 500);
    }

    return json({
      ok: true,
      settings,
      photoUrl: row.photo_blob && row.photo_mime ? serviceSettingsImageUrl(request) : SERVICE_SETTINGS_DEFAULT_PHOTO,
    });
  } catch (error) {
    console.error("SERVICE_SETTINGS_READ_FAILED:", error);
    return errorResponse("INTERNAL_ERROR", "Pengaturan Layanan gagal dimuat.", 500);
  }
}

async function handlePublicServiceSettings(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/service-settings/image") {
    if (request.method !== "GET") return errorResponse("NOT_FOUND", "Service image endpoint not found.", 404);
    try {
      const row = await env.DB.prepare(`
        SELECT photo_mime, photo_blob
        FROM service_settings
        WHERE id = 1
        LIMIT 1
      `).first<{ photo_mime: string | null; photo_blob: ArrayBuffer | Uint8Array | null }>();
      if (!row?.photo_blob || !row.photo_mime) return new Response("", { status: 404 });
      const bytes = row.photo_blob instanceof ArrayBuffer
        ? new Uint8Array(row.photo_blob)
        : row.photo_blob instanceof Uint8Array
          ? row.photo_blob
          : new Uint8Array(row.photo_blob as any);
      return new Response(bytes, {
        status: 200,
        headers: {
          "Content-Type": row.photo_mime,
          "Cache-Control": "no-store",
        },
      });
    } catch (error) {
      console.error("SERVICE_SETTINGS_IMAGE_READ_FAILED:", error);
      return errorResponse("INTERNAL_ERROR", "Foto area laundry gagal dimuat.", 500);
    }
  }

  if (request.method !== "GET") return errorResponse("NOT_FOUND", "Service settings endpoint not found.", 404);
  return readServiceSettings(env, request);
}

async function handleOwnerServiceSettings(request: Request, env: Env): Promise<Response> {
  const owner = await requireOwner(request, env);
  if (!owner) return errorResponse("UNAUTHORIZED", "Owner authentication is required.", 401);

  if (request.method === "GET") {
    return readServiceSettings(env, request);
  }

  if (request.method !== "PUT") {
    return errorResponse("NOT_FOUND", "Service settings endpoint not found.", 404);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse("INVALID_REQUEST", "Data Pengaturan Layanan tidak valid.", 400);
  }

  const settingsText = form.get("settings");
  if (typeof settingsText !== "string" || settingsText.trim().length === 0 || settingsText.length > 65536) {
    return errorResponse("INVALID_SETTINGS", "Data Pengaturan Layanan tidak valid.", 400);
  }

  let settings: unknown;
  try {
    settings = JSON.parse(settingsText);
  } catch {
    return errorResponse("INVALID_SETTINGS", "Data Pengaturan Layanan tidak valid.", 400);
  }
  if (!isPlainObject(settings)) {
    return errorResponse("INVALID_SETTINGS", "Data Pengaturan Layanan tidak valid.", 400);
  }

  const removePhoto = form.get("removePhoto") === "1";
  const photoEntry = form.get("photo");
  const photo = photoEntry instanceof File && photoEntry.size > 0 ? photoEntry : null;

  if (photo && photo.size > SERVICE_SETTINGS_MAX_PHOTO_BYTES) {
    return errorResponse("IMAGE_TOO_LARGE", "Ukuran foto maksimal 1 MB.", 413);
  }

  let photoMime: string | null | undefined;
  let photoBlob: ArrayBuffer | null | undefined;

  if (removePhoto) {
    photoMime = null;
    photoBlob = null;
  } else if (photo) {
    const mimeType = photo.type.toLowerCase();
    if (mimeType !== "image/jpeg" && mimeType !== "image/png" && mimeType !== "image/webp") {
      return errorResponse("INVALID_IMAGE_TYPE", "Foto harus JPG, PNG, atau WebP.", 400);
    }
    const bytes = new Uint8Array(await photo.arrayBuffer());
    if (!serviceImageBytesValid(bytes, mimeType)) {
      return errorResponse("INVALID_IMAGE", "Isi file foto tidak valid.", 400);
    }
    photoMime = mimeType;
    photoBlob = bytes.buffer;
  }

  const nowIso = new Date().toISOString();
  try {
    if (photoMime !== undefined) {
      await env.DB.prepare(`
        INSERT INTO service_settings (id, data_json, photo_mime, photo_blob, updated_at, updated_by)
        VALUES (1, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          data_json = excluded.data_json,
          photo_mime = excluded.photo_mime,
          photo_blob = excluded.photo_blob,
          updated_at = excluded.updated_at,
          updated_by = excluded.updated_by
      `).bind(JSON.stringify(settings), photoMime, photoBlob, nowIso, owner.userId).run();
    } else {
      await env.DB.prepare(`
        INSERT INTO service_settings (id, data_json, updated_at, updated_by)
        VALUES (1, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          data_json = excluded.data_json,
          updated_at = excluded.updated_at,
          updated_by = excluded.updated_by
      `).bind(JSON.stringify(settings), nowIso, owner.userId).run();
    }
  } catch (error) {
    console.error("SERVICE_SETTINGS_SAVE_FAILED:", error);
    return errorResponse("INTERNAL_ERROR", "Pengaturan Layanan gagal disimpan.", 500);
  }

  await publishRealtime(env, "SERVICE_SETTINGS_UPDATED", { updatedAt: nowIso });
  return readServiceSettings(env, request);
}

export async function handleOwnerRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/service-settings" || url.pathname === "/service-settings/image") {
    return handlePublicServiceSettings(request, env);
  }
  if (url.pathname === "/owner/service-settings" && (request.method === "GET" || request.method === "PUT")) {
    return handleOwnerServiceSettings(request, env);
  }
  if (url.pathname === "/owner/export" && request.method === "GET") return handleOwnerExportRequest(request, env);
  if (url.pathname === "/owner/overview" && request.method === "GET") return handleOwnerOverview(request, env);
  const customerDeleteMatch = url.pathname.match(/^\/owner\/customers\/([^/]+)$/);
  if (customerDeleteMatch && request.method === "DELETE") {
    return handleOwnerCustomerDelete(request, env, decodeURIComponent(customerDeleteMatch[1]));
  }
  if (url.pathname === "/owner/customers" && request.method === "GET") return handleOwnerCustomers(request, env);
  if (url.pathname === "/owner/audit" && request.method === "GET") return handleAudit(request, env);
  if (url.pathname === "/owner/reward-pool" || url.pathname.startsWith("/owner/reward-pool/")) return handleRewardPool(request, env);
  const eventImageMatch = url.pathname.match(/^\/owner\/events\/([^/]+)\/image$/);
  if (eventImageMatch) return handleEventImage(request, env, decodeURIComponent(eventImageMatch[1]));
  if (url.pathname === "/owner/events" || url.pathname.startsWith("/owner/events/")) return handleEvents(request, env);
  if (request.method === "GET") {
    const match = url.pathname.match(/^\/owner\/customer\/([^/]+)$/);
    if (match) return handleCustomerTrace(request, env, decodeURIComponent(match[1]));
  }
  return errorResponse("NOT_FOUND", "Owner endpoint not found.", 404);
}
