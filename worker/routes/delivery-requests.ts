import type { Env } from "../index";
import { requireSession } from "../auth/session-guard";
import type { AuthSession } from "../auth/session-guard";
import { writeAuditSafe } from "../audit/logger";
import { broadcastRealtime } from "../realtime";
import { isPhone, normalizePhone } from "../lib/customer-lookup";
import { readProgramSettings } from "../lib/program-settings";
import { allocateOrderId } from "./dropoff";

/*
 * ============================================================
 * REQUEST ANTAR / JEMPUT
 * ============================================================
 * Customer  : membuat request (POST /delivery/requests) dan melihat
 *             request miliknya sendiri (GET /delivery/requests/mine).
 * Staff     : melihat semua request, konfirmasi / tolak, tandai selesai.
 * Owner     : hanya mengatur jam operasional, aktif/nonaktif layanan,
 *             dan minimum berat lewat Pengaturan Layanan
 *             (service_settings: pickupDelivery*). Route ini hanya
 *             MEMBACA pengaturan tersebut.
 *
 * Status: NEW -> CONFIRMED -> COMPLETED, atau NEW -> REJECTED.
 *
 * Request JEMPUT mendapat nomor order (DO-xxxxxx) otomatis saat dibuat.
 * Saat Staff mengonfirmasi, drop-off dibuat otomatis dengan nomor yang sama
 * (Staff hanya mengisi estimasi selesai), jadi tidak perlu input drop-off dua kali.
 * Request ANTAR tidak memiliki nomor order.
 */

type DeliveryStatus = "NEW" | "CONFIRMED" | "COMPLETED" | "REJECTED";
type ServiceType = "PICKUP" | "DELIVERY";
type ItemUnit = "BASKET" | "BAG";

type RequestRow = {
  request_id: string;
  customer_id: string;
  service_type: ServiceType;
  scheduled_date: string;
  scheduled_time: string;
  contact_name: string;
  contact_phone: string;
  address: string;
  est_weight_kg: number;
  item_count: number;
  item_unit: ItemUnit;
  notes: string;
  status: DeliveryStatus;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
  confirmed_by: string | null;
  completed_at: string | null;
  completed_by: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
  order_id: string | null;
  est_done_at: string | null;
};

type DeliverySettings = {
  enabled: boolean;
  hoursStart: string;
  hoursEnd: string;
  minOrderKg: number | null;
  areas: string;
  tariffLabel: string;
  note: string;
  whatsapp: string;
};

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const MAX_OPEN_REQUESTS_PER_CUSTOMER = 5;
const MAX_DAYS_AHEAD = 60;
const FINISHED_VISIBLE_DAYS = 7;
const LIST_LIMIT = 300;

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

function wibNow(): { date: string; time: string } {
  const iso = new Date(Date.now() + WIB_OFFSET_MS).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

function normalizeHm(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(".", ":");
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function daysBetween(fromDate: string, toDate: string): number {
  return Math.round(
    (Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86400000,
  );
}

async function readSettings(env: Env): Promise<DeliverySettings> {
  let data: Record<string, unknown> = {};
  try {
    const row = await env.DB.prepare(`
      SELECT data_json FROM service_settings WHERE id = 1 LIMIT 1
    `).first<{ data_json: string }>();
    const parsed = row?.data_json ? JSON.parse(row.data_json) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>;
    }
  } catch {
    data = {};
  }

  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const minRaw = Number(data.pickupDeliveryMinOrderKg);

  return {
    enabled: data.pickupDeliveryEnabled === true,
    hoursStart: normalizeHm(data.pickupDeliveryHoursStart) ?? normalizeHm(data.dropStart) ?? "07:00",
    hoursEnd: normalizeHm(data.pickupDeliveryHoursEnd) ?? normalizeHm(data.dropEnd) ?? "21:00",
    minOrderKg: Number.isFinite(minRaw) && minRaw > 0 ? minRaw : null,
    areas: text(data.pickupDeliveryAreas),
    tariffLabel: text(data.pickupDeliveryTariffLabel),
    note: text(data.pickupDeliveryNote),
    whatsapp: text(data.pickupDeliveryWhatsapp),
  };
}

function toDto(row: RequestRow) {
  return {
    id: row.request_id,
    type: row.service_type,
    date: row.scheduled_date,
    time: row.scheduled_time,
    name: row.contact_name,
    phone: row.contact_phone,
    address: row.address,
    estWeightKg: row.est_weight_kg,
    itemCount: row.item_count,
    itemUnit: row.item_unit,
    notes: row.notes,
    status: row.status,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
    completedAt: row.completed_at,
    rejectedAt: row.rejected_at,
    orderId: row.order_id,
    estDoneAt: row.est_done_at,
  };
}

async function broadcastUpdated(env: Env, requestId: string, status: DeliveryStatus): Promise<void> {
  try {
    await broadcastRealtime(env, "DELIVERY_REQUEST_UPDATED", { requestId, status });
  } catch {
    // Realtime bersifat best-effort dan tidak boleh menggagalkan proses request.
  }
}

async function getCustomerSession(request: Request, env: Env): Promise<AuthSession | null> {
  return requireSession(request, env, ["CUSTOMER"]);
}

async function getStaffSession(request: Request, env: Env): Promise<AuthSession | null> {
  return requireSession(request, env, ["STAFF"]);
}

/* ------------------------------------------------------------ *
 * GET /delivery/settings  (CUSTOMER, STAFF, OWNER)
 * ------------------------------------------------------------ */
async function handleSettings(request: Request, env: Env): Promise<Response> {
  const session = await requireSession(request, env, ["CUSTOMER", "STAFF", "OWNER"]);
  if (!session) return errorResponse("UNAUTHORIZED", "Authentication is required.", 401);

  const settings = await readSettings(env);
  const today = wibNow();
  const profile = session.role === "CUSTOMER"
    ? await env.DB.prepare(`
        SELECT name, phone FROM customers WHERE customer_id = ? LIMIT 1
      `).bind(session.userId).first<{ name: string | null; phone: string | null }>()
    : null;

  return json({
    ok: true,
    settings,
    today: today.date,
    nowTime: today.time,
    profile: profile
      ? { name: profile.name ?? "", phone: profile.phone ?? "" }
      : null,
  });
}

/* ------------------------------------------------------------ *
 * POST /delivery/requests  (CUSTOMER)
 * ------------------------------------------------------------ */
async function handleCreate(request: Request, env: Env): Promise<Response> {
  const session = await getCustomerSession(request, env);
  if (!session) return errorResponse("UNAUTHORIZED", "Customer authentication is required.", 401);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorResponse("INVALID_REQUEST", "Invalid JSON request body.", 400);
  }

  const settings = await readSettings(env);
  if (!settings.enabled) {
    return errorResponse("SERVICE_DISABLED", "Layanan antar/jemput sedang tidak aktif.", 403);
  }

  const today = wibNow();
  const fields: Record<string, string> = {};

  const type = body.type === "PICKUP" || body.type === "DELIVERY" ? body.type : null;
  if (!type) fields.type = "Pilih jenis layanan.";

  const date = isValidDate(body.date) ? body.date : null;
  if (!date) {
    fields.date = "Tanggal tidak valid.";
  } else if (date < today.date) {
    fields.date = "Tanggal tidak boleh sebelum hari ini.";
  } else if (daysBetween(today.date, date) > MAX_DAYS_AHEAD) {
    fields.date = `Maksimal ${MAX_DAYS_AHEAD} hari ke depan.`;
  }

  const time = normalizeHm(body.time);
  if (!time) {
    fields.time = "Jam tidak valid.";
  } else if (time < settings.hoursStart || time > settings.hoursEnd) {
    fields.time = `Jam operasional ${settings.hoursStart} – ${settings.hoursEnd}.`;
  } else if (date && date === today.date && time < today.time) {
    fields.time = "Jam sudah lewat.";
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 2 || name.length > 60) fields.name = "Nama 2–60 karakter.";

  const phoneRaw = typeof body.phone === "string" ? body.phone.trim() : "";
  if (!isPhone(phoneRaw)) fields.phone = "Nomor telepon tidak valid.";

  const address = typeof body.address === "string" ? body.address.trim() : "";
  if (address.length < 10 || address.length > 250) fields.address = "Alamat 10–250 karakter.";

  const weight = typeof body.estWeightKg === "number" ? body.estWeightKg : Number.NaN;
  if (!Number.isFinite(weight) || weight < 1 || weight > 99) {
    fields.estWeightKg = "Estimasi berat 1–99 kg.";
  } else if (settings.minOrderKg !== null && weight < settings.minOrderKg) {
    fields.estWeightKg = `Minimum ${settings.minOrderKg} kg.`;
  }

  const count = typeof body.itemCount === "number" ? body.itemCount : Number.NaN;
  if (!Number.isInteger(count) || count < 1 || count > 20) fields.itemCount = "Jumlah 1–20.";

  const unit = body.itemUnit === "BASKET" || body.itemUnit === "BAG" ? body.itemUnit : null;
  if (!unit) fields.itemUnit = "Pilih keranjang atau bungkus.";

  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  if (notes.length > 200) fields.notes = "Catatan maksimal 200 karakter.";

  const firstError = Object.values(fields)[0];
  if (firstError) {
    return json({ ok: false, error: "VALIDATION_FAILED", message: firstError, fields }, 400);
  }

  const open = await env.DB.prepare(`
    SELECT COUNT(*) AS total
    FROM delivery_requests
    WHERE customer_id = ? AND status IN ('NEW', 'CONFIRMED')
  `).bind(session.userId).first<{ total: number }>();
  if ((open?.total ?? 0) >= MAX_OPEN_REQUESTS_PER_CUSTOMER) {
    return errorResponse(
      "TOO_MANY_OPEN_REQUESTS",
      `Maksimal ${MAX_OPEN_REQUESTS_PER_CUSTOMER} request aktif. Tunggu salah satunya selesai.`,
      409,
    );
  }

  const requestId = `dr_${crypto.randomUUID()}`;
  const nowIso = new Date().toISOString();

  // Request JEMPUT = drop-off: nomor ordernya dicadangkan sekarang.
  const orderId = type === "PICKUP" ? await allocateOrderId(env) : null;

  await env.DB.prepare(`
    INSERT INTO delivery_requests (
      request_id, customer_id, service_type, scheduled_date, scheduled_time,
      contact_name, contact_phone, address, est_weight_kg, item_count, item_unit,
      notes, status, created_at, updated_at, order_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEW', ?, ?, ?)
  `).bind(
    requestId, session.userId, type, date, time,
    name, normalizePhone(phoneRaw), address, weight, count, unit,
    notes, nowIso, nowIso, orderId,
  ).run();

  await writeAuditSafe(env, {
    entityType: "DELIVERY_REQUEST",
    entityId: requestId,
    action: "CREATE",
    actor: session.userId,
    result: "SUCCESS",
  });
  await broadcastUpdated(env, requestId, "NEW");

  const row = await env.DB.prepare(`
    SELECT * FROM delivery_requests WHERE request_id = ? LIMIT 1
  `).bind(requestId).first<RequestRow>();

  return json({ ok: true, request: row ? toDto(row) : { id: requestId, status: "NEW" } }, 201);
}

/* ------------------------------------------------------------ *
 * GET /delivery/requests/mine  (CUSTOMER)
 * ------------------------------------------------------------ */
async function handleMine(request: Request, env: Env): Promise<Response> {
  const session = await getCustomerSession(request, env);
  if (!session) return errorResponse("UNAUTHORIZED", "Customer authentication is required.", 401);

  const result = await env.DB.prepare(`
    SELECT * FROM delivery_requests
    WHERE customer_id = ?
    ORDER BY created_at DESC
    LIMIT 20
  `).bind(session.userId).all<RequestRow>();

  const rows = result.results ?? [];
  return json({
    ok: true,
    requests: rows.map(toDto),
    openCount: rows.filter((row) => row.status === "NEW" || row.status === "CONFIRMED").length,
    newCount: rows.filter((row) => row.status === "NEW").length,
  });
}

/* ------------------------------------------------------------ *
 * GET /staff/delivery/requests?status=ALL|NEW|CONFIRMED|COMPLETED
 * (STAFF, OWNER hanya melihat)
 * ------------------------------------------------------------ */
function groupOf(status: DeliveryStatus): number {
  if (status === "NEW") return 0;
  if (status === "CONFIRMED") return 1;
  return 2;
}

async function handleStaffList(request: Request, env: Env): Promise<Response> {
  const session = await requireSession(request, env, ["STAFF", "OWNER"]);
  if (!session) return errorResponse("UNAUTHORIZED", "Staff authentication is required.", 401);

  const url = new URL(request.url);
  const filter = (url.searchParams.get("status") || "ALL").toUpperCase();
  if (!["ALL", "NEW", "CONFIRMED", "COMPLETED"].includes(filter)) {
    return errorResponse("INVALID_REQUEST", "status filter is invalid.", 400);
  }

  const cutoffIso = new Date(Date.now() - FINISHED_VISIBLE_DAYS * 86400000).toISOString();
  const result = await env.DB.prepare(`
    SELECT * FROM delivery_requests
    WHERE status IN ('NEW', 'CONFIRMED')
       OR (status = 'COMPLETED' AND completed_at >= ?)
       OR (status = 'REJECTED' AND rejected_at >= ?)
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(cutoffIso, cutoffIso, LIST_LIMIT).all<RequestRow>();

  const rows = (result.results ?? []).slice().sort((a, b) => {
    const groupDiff = groupOf(a.status) - groupOf(b.status);
    if (groupDiff !== 0) return groupDiff;
    if (groupOf(a.status) < 2) {
      return `${a.scheduled_date} ${a.scheduled_time}`.localeCompare(`${b.scheduled_date} ${b.scheduled_time}`);
    }
    const aDone = a.completed_at ?? a.rejected_at ?? "";
    const bDone = b.completed_at ?? b.rejected_at ?? "";
    return bDone.localeCompare(aDone);
  });

  const counts = {
    all: rows.length,
    new: rows.filter((row) => row.status === "NEW").length,
    confirmed: rows.filter((row) => row.status === "CONFIRMED").length,
    completed: rows.filter((row) => row.status === "COMPLETED").length,
  };

  const visible = filter === "ALL" ? rows : rows.filter((row) => row.status === filter);
  return json({ ok: true, counts, requests: visible.map(toDto) });
}

/* ------------------------------------------------------------ *
 * GET /staff/delivery/count  -> { newCount }  (badge dashboard)
 * ------------------------------------------------------------ */
async function handleStaffCount(request: Request, env: Env): Promise<Response> {
  const session = await requireSession(request, env, ["STAFF", "OWNER"]);
  if (!session) return errorResponse("UNAUTHORIZED", "Staff authentication is required.", 401);

  const row = await env.DB.prepare(`
    SELECT COUNT(*) AS total FROM delivery_requests WHERE status = 'NEW'
  `).first<{ total: number }>();

  return json({ ok: true, newCount: row?.total ?? 0 });
}

/* ------------------------------------------------------------ *
 * POST /staff/delivery/requests/:id/(confirm|reject|complete)
 * ------------------------------------------------------------ */
type Transition = {
  from: DeliveryStatus;
  to: DeliveryStatus;
  action: "CONFIRM" | "REJECT" | "COMPLETE";
  sql: string;
};

const TRANSITIONS: Record<string, Transition> = {
  confirm: {
    from: "NEW",
    to: "CONFIRMED",
    action: "CONFIRM",
    sql: "UPDATE delivery_requests SET status = 'CONFIRMED', confirmed_at = ?, confirmed_by = ?, updated_at = ? WHERE request_id = ? AND status = 'NEW'",
  },
  reject: {
    from: "NEW",
    to: "REJECTED",
    action: "REJECT",
    sql: "UPDATE delivery_requests SET status = 'REJECTED', rejected_at = ?, rejected_by = ?, updated_at = ? WHERE request_id = ? AND status = 'NEW'",
  },
  complete: {
    from: "CONFIRMED",
    to: "COMPLETED",
    action: "COMPLETE",
    sql: "UPDATE delivery_requests SET status = 'COMPLETED', completed_at = ?, completed_by = ?, updated_at = ? WHERE request_id = ? AND status = 'CONFIRMED'",
  },
};

async function handleTransition(
  request: Request,
  env: Env,
  requestId: string,
  verb: string,
): Promise<Response> {
  const session = await getStaffSession(request, env);
  if (!session) return errorResponse("UNAUTHORIZED", "Staff authentication is required.", 401);

  const transition = TRANSITIONS[verb];
  if (!transition) return errorResponse("NOT_FOUND", "Delivery endpoint not found.", 404);

  // Body opsional (hanya dipakai saat konfirmasi request JEMPUT): estimasi selesai.
  let body: { estDoneAt?: unknown; estimateHours?: unknown } = {};
  if (verb === "confirm") {
    try {
      body = (await request.json()) as typeof body;
    } catch {
      body = {};
    }
  }

  const nowIso = new Date().toISOString();
  const result = await env.DB.prepare(transition.sql)
    .bind(nowIso, session.userId, nowIso, requestId)
    .run();

  const changes = Number((result as { meta?: { changes?: number } }).meta?.changes ?? 0);
  if (changes < 1) {
    const existing = await env.DB.prepare(`
      SELECT status FROM delivery_requests WHERE request_id = ? LIMIT 1
    `).bind(requestId).first<{ status: DeliveryStatus }>();

    await writeAuditSafe(env, {
      entityType: "DELIVERY_REQUEST",
      entityId: requestId,
      action: transition.action,
      actor: session.userId,
      result: "REJECTED",
    });

    if (!existing) return errorResponse("NOT_FOUND", "Request tidak ditemukan.", 404);
    return errorResponse(
      "INVALID_STATE",
      `Request sudah berstatus ${existing.status}; aksi tidak dapat dilakukan.`,
      409,
    );
  }

  await writeAuditSafe(env, {
    entityType: "DELIVERY_REQUEST",
    entityId: requestId,
    action: transition.action,
    actor: session.userId,
    result: "SUCCESS",
  });

  let row = await env.DB.prepare(`
    SELECT * FROM delivery_requests WHERE request_id = ? LIMIT 1
  `).bind(requestId).first<RequestRow>();

  if (row && row.service_type === "PICKUP") {
    if (verb === "confirm") {
      await createDropoffForPickup(env, row, session.userId, body, nowIso);
    } else if (verb === "complete") {
      // Cucian benar-benar sudah dijemput = waktu diterima.
      await env.DB.prepare(`
        UPDATE dropoff_orders SET received_at = ?
        WHERE delivery_request_id = ? AND status = 'RECEIVED'
      `).bind(nowIso, requestId).run();
      await broadcastDropoff(env, row.order_id);
    }
    row = await env.DB.prepare(`
      SELECT * FROM delivery_requests WHERE request_id = ? LIMIT 1
    `).bind(requestId).first<RequestRow>();
  }

  await broadcastUpdated(env, requestId, transition.to);

  return json({ ok: true, request: row ? toDto(row) : { id: requestId, status: transition.to } });
}

/** Estimasi selesai: dari Staff (ISO / jam) atau bawaan Pengaturan Program. */
async function resolveEstDoneAt(
  env: Env,
  body: { estDoneAt?: unknown; estimateHours?: unknown },
): Promise<string> {
  if (typeof body.estDoneAt === "string") {
    const ms = Date.parse(body.estDoneAt);
    if (Number.isFinite(ms) && ms > Date.now()) return new Date(ms).toISOString();
  }
  let hours = typeof body.estimateHours === "number" && Number.isFinite(body.estimateHours) &&
    body.estimateHours >= 1 && body.estimateHours <= 720
    ? body.estimateHours
    : 0;
  if (!hours) {
    try {
      hours = (await readProgramSettings(env)).dropoff.estimateHours || 24;
    } catch {
      hours = 24;
    }
  }
  return new Date(Date.now() + hours * 3600 * 1000).toISOString();
}

async function broadcastDropoff(env: Env, orderId: string | null): Promise<void> {
  if (!orderId) return;
  try {
    const order = await env.DB.prepare(`
      SELECT * FROM dropoff_orders WHERE order_id = ? LIMIT 1
    `).bind(orderId).first();
    if (order) await broadcastRealtime(env, "DROPOFF_ORDER_UPDATED", { order });
  } catch {
    // best-effort
  }
}

/** Membuat drop-off otomatis (nomor order sama dengan request jemput). */
async function createDropoffForPickup(
  env: Env,
  row: RequestRow,
  staffId: string,
  body: { estDoneAt?: unknown; estimateHours?: unknown },
  nowIso: string,
): Promise<void> {
  const estDoneAt = await resolveEstDoneAt(env, body);

  let orderId = row.order_id;
  if (!orderId) {
    // Request lama (dibuat sebelum fitur ini) belum punya nomor order.
    orderId = await allocateOrderId(env);
  }

  await env.DB.prepare(`
    UPDATE delivery_requests SET order_id = ?, est_done_at = ? WHERE request_id = ?
  `).bind(orderId, estDoneAt, row.request_id).run();

  await env.DB.prepare(`
    INSERT OR IGNORE INTO dropoff_orders (
      order_id, customer_id, weight_kg, notes, status, received_at, received_by,
      item_count, item_unit, est_done_at, source, delivery_request_id
    )
    VALUES (?, ?, ?, ?, 'RECEIVED', ?, ?, ?, ?, ?, 'PICKUP_REQUEST', ?)
  `).bind(
    orderId, row.customer_id, row.est_weight_kg, row.notes ?? "", nowIso, staffId,
    row.item_count, row.item_unit, estDoneAt, row.request_id,
  ).run();

  // Nama & alamat dari request mengisi profil customer bila masih kosong.
  await env.DB.prepare(`
    UPDATE customers
    SET name = CASE WHEN name IS NULL OR name = '' THEN ? ELSE name END,
        address = CASE WHEN address IS NULL OR address = '' THEN ? ELSE address END
    WHERE customer_id = ?
  `).bind(row.contact_name, row.address, row.customer_id).run();

  await writeAuditSafe(env, {
    entityType: "DROPOFF_ORDER",
    entityId: orderId,
    action: "CREATE",
    actor: staffId,
    result: "SUCCESS",
  });
  await broadcastDropoff(env, orderId);
}

/* ------------------------------------------------------------ *
 * Router
 * ------------------------------------------------------------ */
export async function handleDeliveryRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "GET" && path === "/delivery/settings") {
    return handleSettings(request, env);
  }
  if (request.method === "POST" && path === "/delivery/requests") {
    return handleCreate(request, env);
  }
  if (request.method === "GET" && path === "/delivery/requests/mine") {
    return handleMine(request, env);
  }
  if (request.method === "GET" && path === "/staff/delivery/requests") {
    return handleStaffList(request, env);
  }
  if (request.method === "GET" && path === "/staff/delivery/count") {
    return handleStaffCount(request, env);
  }

  const match = /^\/staff\/delivery\/requests\/([^/]+)\/(confirm|reject|complete)$/.exec(path);
  if (request.method === "POST" && match) {
    return handleTransition(request, env, decodeURIComponent(match[1]), match[2]);
  }

  return errorResponse("NOT_FOUND", "Delivery endpoint not found.", 404);
}
