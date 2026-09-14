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

async function cleanupInactiveEventImages(env: Env, nowIso: string) {
  await env.DB.prepare(`
    DELETE FROM event_images
    WHERE event_id IN (
      SELECT event_id
      FROM events
      WHERE active != 1 OR ends_at <= ?
    )
  `).bind(nowIso).run();
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
    const startMs = Date.parse(event.starts_at);
    const endMs = Date.parse(event.ends_at);
    if (Number(event.active) !== 1 || !Number.isFinite(startMs) || !Number.isFinite(endMs) || now < startMs || now >= endMs) {
      return new Response("", { status: 404 });
    }
    const image = await env.DB.prepare(`SELECT mime_type, image_blob FROM event_images WHERE event_id = ? LIMIT 1`).bind(eventId).first<{ mime_type: string; image_blob: ArrayBuffer }>();
    if (!image?.image_blob) return new Response("", { status: 404 });
    return new Response(image.image_blob, {
      status: 200,
      headers: { "Content-Type": image.mime_type, "Cache-Control": "no-store" },
    });
  }

  if (request.method === "DELETE") {
    await env.DB.prepare(`DELETE FROM event_images WHERE event_id = ?`).bind(eventId).run();
    await writeAuditSafe(env, { entityType: "EVENT_IMAGE", entityId: eventId, action: "DELETE", actor: owner.userId, result: "SUCCESS" });
    return json({ ok: true });
  }

  if (request.method !== "PUT") return errorResponse("NOT_FOUND", "Event image endpoint not found.", 404);

  const now = Date.now();
  const startMs = Date.parse(event.starts_at);
  const endMs = Date.parse(event.ends_at);
  if (Number(event.active) !== 1 || !Number.isFinite(startMs) || !Number.isFinite(endMs) || now < startMs || now >= endMs) {
    return errorResponse("EVENT_NOT_ACTIVE", "Image hanya dapat disimpan untuk Event Aktif.", 409);
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

  const releaseExpired = env.DB.prepare(`
    UPDATE machines
    SET status = 'IDLE', started_at = NULL, expected_end_at = NULL, activated_by = NULL
    WHERE status = 'IN_USE' AND expected_end_at IS NOT NULL AND expected_end_at <= ?
  `).bind(nowIso);

  const metrics = env.DB.prepare(`
    SELECT
      (SELECT COUNT(DISTINCT p.customer_id)
       FROM plays p
       INNER JOIN events e
         ON p.created_at >= e.starts_at
        AND p.created_at < e.ends_at
       WHERE p.created_at >= ? AND p.created_at < ?) AS participants,
      (SELECT COUNT(DISTINCT p.customer_id)
       FROM plays p
       INNER JOIN events e
         ON p.created_at >= e.starts_at
        AND p.created_at < e.ends_at
       WHERE p.created_at >= ? AND p.created_at < ?) AS participants_previous,
      (SELECT COUNT(*) FROM rewards WHERE claimed_at IS NOT NULL AND claimed_at >= ? AND claimed_at < ?) AS claimed_count,
      (SELECT COUNT(*) FROM rewards WHERE claimed_at IS NOT NULL AND claimed_at >= ? AND claimed_at < ?) AS claimed_previous,
      (SELECT COUNT(*) FROM rewards WHERE redeemed_at IS NOT NULL AND redeemed_at >= ? AND redeemed_at < ?) AS redeemed_count,
      (SELECT COUNT(*) FROM rewards WHERE redeemed_at IS NOT NULL AND redeemed_at >= ? AND redeemed_at < ?) AS redeemed_previous,
      (SELECT COUNT(*) FROM plays) AS play_count,
      (SELECT COUNT(*) FROM rewards WHERE status = 'WON') AS won_count,
      (SELECT COUNT(*) FROM rewards WHERE status = 'USED') AS used_count,
      (SELECT COUNT(*) FROM rewards WHERE status NOT IN ('WON','CLAIMED','REDEEMED','USED')) AS unclaimed_count,
      (SELECT COUNT(*) FROM audit_log WHERE result IN ('FAILED','REJECTED')) AS error_retry_count
  `).bind(
    currentStartIso, currentEndIso,
    previousStartIso, previousEndIso,
    currentStartIso, currentEndIso,
    previousStartIso, previousEndIso,
    currentStartIso, currentEndIso,
    previousStartIso, previousEndIso,
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

  const operations = ["daily", "weekly", "monthly", "yearly"].map(() =>
    env.DB.prepare(`
      SELECT machine_type, COALESCE(SUM(duration_seconds),0) AS total_seconds
      FROM machine_operations
      WHERE started_at >= ? AND started_at < ?
      GROUP BY machine_type
    `).bind(currentStartIso, currentEndIso),
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
      daily: { from: requestedFrom, to: requestedTo },
      weekly: { from: requestedFrom, to: requestedTo },
      monthly: { from: requestedFrom, to: requestedTo },
      yearly: { from: requestedFrom, to: requestedTo },
    },
    activeEvents: eventOut.filter((event) =>
      event.active &&
      event.startsAt < currentEndIso &&
      event.endsAt >= currentStartIso
    ),
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
    const [result, eventResult] = await Promise.all([
      env.DB.prepare(`SELECT reward_type, description, quota_total, quota_used, terms, active FROM reward_pool ORDER BY reward_type ASC`).all(),
      env.DB.prepare(`SELECT event_id, title, starts_at, ends_at, reward_type, reward_quantity, active FROM events ORDER BY starts_at DESC, event_id DESC LIMIT 100`).all(),
    ]);
    const eventsByReward = new Map<string, Array<Record<string, unknown>>>();
    for (const row of (eventResult.results ?? []) as Array<Record<string, unknown>>) {
      const rewardType = String(row.reward_type);
      const list = eventsByReward.get(rewardType) ?? [];
      list.push(row);
      eventsByReward.set(rewardType, list);
    }
    const items = (result.results ?? []).map((row) => {
      const record = row as Record<string, unknown>;
      const rewardType = String(record.reward_type);
      return {
        rewardType,
        description: String(record.description ?? ""),
        quotaTotal: Number(record.quota_total),
        quotaUsed: Number(record.quota_used),
        remaining: Math.max(0, Number(record.quota_total) - Number(record.quota_used)),
        terms: String(record.terms ?? ""),
        active: Number(record.active) === 1,
        events: (eventsByReward.get(rewardType) ?? []).map((event) => ({
          eventId: String(event.event_id), title: String(event.title), startsAt: String(event.starts_at), endsAt: String(event.ends_at),
          rewardQuantity: Number(event.reward_quantity), active: Number(event.active) === 1,
        })),
      };
    });
    return json({ ok: true, items });
  }

  if (request.method === "DELETE") {
    if (!match) return errorResponse("INVALID_REQUEST", "Reward type is required.", 400);
    const rewardType = decodeURIComponent(match[1]);
    const linked = await env.DB.prepare(`SELECT COUNT(*) AS count FROM events WHERE reward_type = ?`).bind(rewardType).first<{ count: number }>();
    if (Number(linked?.count ?? 0) > 0) return errorResponse("REWARD_IN_USE", "Reward masih digunakan oleh event dan tidak dapat dihapus.", 409);
    const result = await env.DB.prepare(`DELETE FROM reward_pool WHERE reward_type = ?`).bind(rewardType).run();
    if (result.meta.changes !== 1) return errorResponse("REWARD_NOT_FOUND", "Reward tidak ditemukan.", 404);
    await writeAuditSafe(env, { entityType: "REWARD", entityId: rewardType, action: "DELETE", actor: owner.userId, result: "SUCCESS" });
    return json({ ok: true });
  }

  if (request.method !== "POST" && request.method !== "PATCH") return errorResponse("NOT_FOUND", "Reward Pool endpoint not found.", 404);
  let body: { rewardType?: unknown; description?: unknown; quotaTotal?: unknown; terms?: unknown; active?: unknown };
  try { body = await request.json() as typeof body; } catch { return errorResponse("INVALID_REQUEST", "Invalid JSON request body.", 400); }
  const rewardType = isNonEmptyString(body.rewardType, 120) ? body.rewardType.trim() : match ? decodeURIComponent(match[1]).trim() : "";
  const description = body.description === undefined ? "" : (isNonEmptyString(body.description, 200) ? body.description.trim() : "");
  const terms = body.terms === undefined ? "" : (isNonEmptyString(body.terms, 200) ? body.terms.trim() : "");
  const quotaTotal = parsePositiveInteger(body.quotaTotal);
  const active = body.active === undefined ? 1 : body.active ? 1 : 0;
  if (!rewardType || quotaTotal === null) return errorResponse("INVALID_REQUEST", "Nama reward dan total stok wajib diisi.", 400);
  const nowIso = new Date().toISOString();

  if (request.method === "POST") {
    try {
      await env.DB.prepare(`INSERT INTO reward_pool (reward_type, description, quota_total, quota_used, terms, active, created_by, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)`)
        .bind(rewardType, description, quotaTotal, terms, active, owner.userId, nowIso, nowIso).run();
    } catch { return errorResponse("REWARD_EXISTS", "Reward sudah ada.", 409); }
    await writeAuditSafe(env, { entityType: "REWARD", entityId: rewardType, action: "CREATE", actor: owner.userId, result: "SUCCESS" });
  } else {
    if (!match) return errorResponse("INVALID_REQUEST", "Reward type is required.", 400);
    const current = await env.DB.prepare(`SELECT quota_used FROM reward_pool WHERE reward_type = ? LIMIT 1`).bind(rewardType).first<{ quota_used: number }>();
    if (!current) return errorResponse("REWARD_NOT_FOUND", "Reward tidak ditemukan.", 404);
    if (quotaTotal < Number(current.quota_used)) return errorResponse("INVALID_QUOTA", "Total stok tidak boleh lebih kecil dari yang sudah digunakan.", 400);
    const result = await env.DB.prepare(`UPDATE reward_pool SET description = ?, quota_total = ?, terms = ?, active = ?, updated_at = ? WHERE reward_type = ?`).bind(description, quotaTotal, terms, active, nowIso, rewardType).run();
    if (result.meta.changes !== 1) return errorResponse("REWARD_NOT_FOUND", "Reward tidak ditemukan.", 404);
    await writeAuditSafe(env, { entityType: "REWARD", entityId: rewardType, action: "UPDATE", actor: owner.userId, result: "SUCCESS" });
  }
  return json({ ok: true, rewardType });
}

async function handleEvents(request: Request, env: Env): Promise<Response> {
  const owner = await requireOwner(request, env);
  if (!owner) return errorResponse("UNAUTHORIZED", "Owner authentication is required.", 401);
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/owner\/events\/([^/]+)$/);

  if (request.method === "GET") {
    await cleanupInactiveEventImages(env, new Date().toISOString());
    const rows = await env.DB.prepare(`SELECT e.event_id, e.title, e.starts_at, e.ends_at, e.reward_type, e.reward_quantity, e.description, e.active, e.created_at, e.updated_at, CASE WHEN i.event_id IS NULL THEN 0 ELSE 1 END AS has_image FROM events e LEFT JOIN event_images i ON i.event_id = e.event_id ORDER BY e.starts_at DESC, e.event_id DESC LIMIT 100`).all();
    const now = Date.now();
    return json({ ok: true, items: (rows.results ?? []).map((row) => ({
      eventId: String((row as any).event_id), title: String((row as any).title), startsAt: String((row as any).starts_at), endsAt: String((row as any).ends_at), rewardType: String((row as any).reward_type), rewardQuantity: Number((row as any).reward_quantity), description: String((row as any).description ?? ""), active: Number((row as any).active) === 1, hasImage: Number((row as any).has_image) === 1, imageUrl: Number((row as any).has_image) === 1 && eventStatus(String((row as any).starts_at), String((row as any).ends_at), Number((row as any).active), now) === "ACTIVE" ? `/owner/events/${encodeURIComponent(String((row as any).event_id))}/image` : null, status: eventStatus(String((row as any).starts_at), String((row as any).ends_at), Number((row as any).active), now), createdAt: String((row as any).created_at), updatedAt: String((row as any).updated_at),
    })) });
  }

  if (request.method === "DELETE") {
    if (!match) return errorResponse("INVALID_REQUEST", "Event ID is required.", 400);
    const eventId = decodeURIComponent(match[1]);
    await env.DB.prepare(`DELETE FROM event_images WHERE event_id = ?`).bind(eventId).run();
    const result = await env.DB.prepare(`DELETE FROM events WHERE event_id = ?`).bind(eventId).run();
    if (result.meta.changes !== 1) return errorResponse("EVENT_NOT_FOUND", "Event tidak ditemukan.", 404);
    await writeAuditSafe(env, { entityType: "EVENT", entityId: eventId, action: "DELETE", actor: owner.userId, result: "SUCCESS" });
    return json({ ok: true });
  }

  if (request.method !== "POST" && request.method !== "PATCH") return errorResponse("NOT_FOUND", "Event endpoint not found.", 404);
  let body: { title?: unknown; startsAt?: unknown; endsAt?: unknown; rewardType?: unknown; rewardQuantity?: unknown; description?: unknown; active?: unknown };
  try { body = await request.json() as typeof body; } catch { return errorResponse("INVALID_REQUEST", "Invalid JSON request body.", 400); }
  const title = isNonEmptyString(body.title, 160) ? body.title.trim() : "";
  const startsAt = isNonEmptyString(body.startsAt, 64) ? body.startsAt.trim() : "";
  const endsAt = isNonEmptyString(body.endsAt, 64) ? body.endsAt.trim() : "";
  const rewardType = isNonEmptyString(body.rewardType, 120) ? body.rewardType.trim() : "";
  const rewardQuantity = parsePositiveInteger(body.rewardQuantity);
  const description = body.description === undefined ? "" : (isNonEmptyString(body.description, 200) ? body.description.trim() : "");
  const active = body.active === undefined ? 1 : body.active ? 1 : 0;
  const startMs = Date.parse(startsAt), endMs = Date.parse(endsAt);
  if (!title || !startsAt || !endsAt || !rewardType || rewardQuantity === null || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return errorResponse("INVALID_REQUEST", "Event title, period, reward and quantity are required.", 400);
  const pool = await env.DB.prepare(`SELECT reward_type, active FROM reward_pool WHERE reward_type = ? LIMIT 1`).bind(rewardType).first<{ reward_type: string; active: number }>();
  if (!pool) return errorResponse("REWARD_NOT_FOUND", "Reward tidak tersedia di Reward Pool.", 400);
  if (Number(pool.active) !== 1) return errorResponse("REWARD_INACTIVE", "Reward tidak aktif.", 400);
  const nowIso = new Date().toISOString();

  if (request.method === "POST") {
    const eventId = `event_${crypto.randomUUID()}`;
    await env.DB.prepare(`INSERT INTO events (event_id, title, starts_at, ends_at, reward_type, reward_quantity, description, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(eventId, title, startsAt, endsAt, rewardType, rewardQuantity, description, active, nowIso, nowIso).run();
    await writeAuditSafe(env, { entityType: "EVENT", entityId: eventId, action: "CREATE", actor: owner.userId, result: "SUCCESS" });
    return json({ ok: true, eventId }, 201);
  }
  if (!match) return errorResponse("INVALID_REQUEST", "Event ID is required.", 400);
  const eventId = decodeURIComponent(match[1]);
  const result = await env.DB.prepare(`UPDATE events SET title = ?, starts_at = ?, ends_at = ?, reward_type = ?, reward_quantity = ?, description = ?, active = ?, updated_at = ? WHERE event_id = ?`).bind(title, startsAt, endsAt, rewardType, rewardQuantity, description, active, nowIso, eventId).run();
  if (result.meta.changes !== 1) return errorResponse("EVENT_NOT_FOUND", "Event tidak ditemukan.", 404);
  if (active !== 1 || endMs <= Date.now()) {
    await env.DB.prepare(`DELETE FROM event_images WHERE event_id = ?`).bind(eventId).run();
  }
  await writeAuditSafe(env, { entityType: "EVENT", entityId: eventId, action: "UPDATE", actor: owner.userId, result: "SUCCESS" });
  return json({ ok: true, eventId });
}

export async function handleOwnerRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/owner/overview" && request.method === "GET") return handleOwnerOverview(request, env);
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
