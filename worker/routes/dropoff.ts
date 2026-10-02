import type { Env } from "../index";
import { requireSession } from "../auth/session-guard";
import type { AuthSession } from "../auth/session-guard";
import { writeAuditSafe } from "../audit/logger";
import { broadcastRealtime } from "../realtime";
import { isPhone, findOrCreateCustomerByPhone } from "../lib/customer-lookup";
import { readProgramSettings } from "../lib/program-settings";

/*
 * ============================================================
 * BUSINESS RULES (locked)
 * ============================================================
 * Drop-off is NOT a queue. The customer hands over dirty laundry,
 * pays, and Staff does the work. There is no "waiting" or "called"
 * state for drop-off; that only applies to Self-Service machines.
 *
 * Exactly three states, all changed by Staff only:
 *   RECEIVED  -> customer handed over laundry, weight recorded
 *   COMPLETED -> work is done, ready for pickup; 48h pickup window starts
 *   PICKED_UP -> customer has collected the laundry
 *
 * The order number (e.g. DO-000248) is sequential and never reset
 * daily, because an order can sit for up to 48 hours; it is also the
 * number Staff writes on the physical basket.
 */

const PICKUP_WINDOW_HOURS = 48;

type OrderRow = {
  order_id: string;
  customer_id: string;
  weight_kg: number;
  notes: string;
  status: "RECEIVED" | "COMPLETED" | "PICKED_UP";
  received_at: string;
  received_by: string;
  completed_at: string | null;
  completed_by: string | null;
  pickup_due_at: string | null;
  picked_up_at: string | null;
  picked_up_by: string | null;
  item_count: number;
  item_unit: "BASKET" | "BAG";
  est_done_at: string | null;
};

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

async function getStaffSession(request: Request, env: Env): Promise<AuthSession | null> {
  return requireSession(request, env, ["STAFF"]);
}

async function getCustomerSession(request: Request, env: Env): Promise<AuthSession | null> {
  return requireSession(request, env, ["CUSTOMER"]);
}

function isValidWeight(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 999;
}

async function broadcastOrderUpdated(env: Env, order: OrderRow): Promise<void> {
  try {
    await broadcastRealtime(env, "DROPOFF_ORDER_UPDATED", { order });
  } catch {
    // Realtime delivery is best-effort and must not break the order flow.
  }
}

/** Atomically allocates the next sequential drop-off order number. */
async function allocateOrderId(env: Env): Promise<string> {
  const row = await env.DB.prepare(`
    UPDATE dropoff_sequence
    SET next_number = next_number + 1
    WHERE id = 1
    RETURNING next_number - 1 AS allocated
  `).first<{ allocated: number }>();

  const number = row?.allocated ?? 1;
  return `DO-${String(number).padStart(6, "0")}`;
}

/*
 * ============================================================
 * STAFF: receive dirty laundry
 * ============================================================
 */
async function handleReceive(request: Request, env: Env): Promise<Response> {
  const session = await getStaffSession(request, env);
  if (!session) {
    return errorResponse("UNAUTHORIZED", "Staff authentication is required.", 401);
  }

  let body: {
    phone?: unknown;
    weightKg?: unknown;
    notes?: unknown;
    name?: unknown;
    address?: unknown;
    itemCount?: unknown;
    itemUnit?: unknown;
    estimateHours?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse("INVALID_REQUEST", "Invalid JSON request body.", 400);
  }

  if (!isPhone(body.phone)) {
    return errorResponse("INVALID_REQUEST", "phone is required.", 400);
  }
  if (!isValidWeight(body.weightKg)) {
    return errorResponse("INVALID_REQUEST", "weightKg must be a positive number.", 400);
  }

  const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 200) : "";

  const itemCount = typeof body.itemCount === "number" ? body.itemCount : 1;
  if (!Number.isInteger(itemCount) || itemCount < 1 || itemCount > 99) {
    return errorResponse("INVALID_REQUEST", "itemCount must be an integer between 1 and 99.", 400);
  }
  const itemUnit = body.itemUnit === "BAG"
    ? "BAG"
    : body.itemUnit === "BASKET" || body.itemUnit === undefined
      ? "BASKET"
      : null;
  if (!itemUnit) {
    return errorResponse("INVALID_REQUEST", "itemUnit must be BASKET or BAG.", 400);
  }

  const settings = await readProgramSettings(env);
  const hours = typeof body.estimateHours === "number" && Number.isFinite(body.estimateHours) &&
    body.estimateHours >= 1 && body.estimateHours <= 720
    ? body.estimateHours
    : settings.dropoff.estimateHours;

  const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ").slice(0, 60) : "";
  const address = typeof body.address === "string" ? body.address.trim().slice(0, 250) : "";

  const { customerId } = await findOrCreateCustomerByPhone(env, body.phone);

  // Nama/alamat yang diisi Staff disimpan ke profil customer (diisi manual
  // bila customer belum ada, atau diperbarui bila Staff mengubahnya).
  if (name) {
    await env.DB.prepare(`UPDATE customers SET name = ? WHERE customer_id = ?`).bind(name, customerId).run();
  }
  if (address) {
    await env.DB.prepare(`UPDATE customers SET address = ? WHERE customer_id = ?`).bind(address, customerId).run();
  }

  const orderId = await allocateOrderId(env);
  const nowIso = new Date().toISOString();
  const estDoneAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

  await env.DB.prepare(`
    INSERT INTO dropoff_orders (
      order_id, customer_id, weight_kg, notes, status, received_at, received_by,
      item_count, item_unit, est_done_at
    )
    VALUES (?, ?, ?, ?, 'RECEIVED', ?, ?, ?, ?, ?)
  `).bind(orderId, customerId, body.weightKg, notes, nowIso, session.userId, itemCount, itemUnit, estDoneAt).run();

  const order: OrderRow = {
    order_id: orderId,
    customer_id: customerId,
    weight_kg: body.weightKg,
    notes,
    status: "RECEIVED",
    received_at: nowIso,
    received_by: session.userId,
    completed_at: null,
    completed_by: null,
    pickup_due_at: null,
    picked_up_at: null,
    picked_up_by: null,
    item_count: itemCount,
    item_unit: itemUnit,
    est_done_at: estDoneAt,
  };

  await writeAuditSafe(env, {
    entityType: "DROPOFF_ORDER",
    entityId: orderId,
    action: "CREATE",
    actor: session.userId,
    result: "SUCCESS",
  });

  await broadcastOrderUpdated(env, order);

  return json({ ok: true, order });
}

/*
 * ============================================================
 * STAFF: mark an order completed (ready for pickup)
 * ============================================================
 */
async function handleComplete(request: Request, env: Env, orderId: string): Promise<Response> {
  const session = await getStaffSession(request, env);
  if (!session) {
    return errorResponse("UNAUTHORIZED", "Staff authentication is required.", 401);
  }

  const nowIso = new Date().toISOString();
  const pickupDue = new Date(Date.now() + PICKUP_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

  const update = await env.DB.prepare(`
    UPDATE dropoff_orders
    SET status = 'COMPLETED', completed_at = ?, completed_by = ?, pickup_due_at = ?
    WHERE order_id = ? AND status = 'RECEIVED'
  `).bind(nowIso, session.userId, pickupDue, orderId).run();

  const order = await env.DB.prepare(`
    SELECT * FROM dropoff_orders WHERE order_id = ? LIMIT 1
  `).bind(orderId).first<OrderRow>();

  if (!order) {
    return errorResponse("NOT_FOUND", "Order not found.", 404);
  }

  if (update.meta.changes !== 1) {
    if (order.status === "COMPLETED" || order.status === "PICKED_UP") {
      return json({ ok: true, idempotent: true, order });
    }
    return errorResponse("INVALID_STATE", "Order could not be marked completed.", 409);
  }

  await writeAuditSafe(env, {
    entityType: "DROPOFF_ORDER",
    entityId: orderId,
    action: "COMPLETE",
    actor: session.userId,
    result: "SUCCESS",
  });

  await broadcastOrderUpdated(env, order);

  return json({ ok: true, idempotent: false, order });
}

/*
 * ============================================================
 * STAFF: mark an order picked up by the customer
 * ============================================================
 */
async function handlePickup(request: Request, env: Env, orderId: string): Promise<Response> {
  const session = await getStaffSession(request, env);
  if (!session) {
    return errorResponse("UNAUTHORIZED", "Staff authentication is required.", 401);
  }

  const nowIso = new Date().toISOString();

  const update = await env.DB.prepare(`
    UPDATE dropoff_orders
    SET status = 'PICKED_UP', picked_up_at = ?, picked_up_by = ?
    WHERE order_id = ? AND status = 'COMPLETED'
  `).bind(nowIso, session.userId, orderId).run();

  const order = await env.DB.prepare(`
    SELECT * FROM dropoff_orders WHERE order_id = ? LIMIT 1
  `).bind(orderId).first<OrderRow>();

  if (!order) {
    return errorResponse("NOT_FOUND", "Order not found.", 404);
  }

  if (update.meta.changes !== 1) {
    if (order.status === "PICKED_UP") {
      return json({ ok: true, idempotent: true, order });
    }
    return errorResponse(
      "INVALID_STATE",
      "Order must be COMPLETED before it can be picked up.",
      409,
    );
  }

  await writeAuditSafe(env, {
    entityType: "DROPOFF_ORDER",
    entityId: orderId,
    action: "PICKUP",
    actor: session.userId,
    result: "SUCCESS",
  });

  await broadcastOrderUpdated(env, order);

  return json({ ok: true, idempotent: false, order });
}

/*
 * ============================================================
 * STAFF: dashboard list — everything not yet picked up
 * One query, no submenu: this is the whole Drop-off card.
 * ============================================================
 */
async function handleActiveList(request: Request, env: Env): Promise<Response> {
  const session = await getStaffSession(request, env);
  if (!session) {
    return errorResponse("UNAUTHORIZED", "Staff authentication is required.", 401);
  }

  const orders = await env.DB.prepare(`
    SELECT o.*, c.phone_masked, c.phone, c.name AS customer_name, c.address AS customer_address
    FROM dropoff_orders o
    JOIN customers c ON c.customer_id = o.customer_id
    WHERE o.status IN ('RECEIVED', 'COMPLETED')
    ORDER BY o.received_at ASC
  `).all();

  return json({ ok: true, orders: orders.results ?? [] });
}

/*
 * ============================================================
 * CUSTOMER: current order card (view-only)
 * Only ever the single most recent order not yet picked up, since
 * the dashboard shows at most one drop-off card.
 * ============================================================
 */
async function handleMyOrder(request: Request, env: Env): Promise<Response> {
  const session = await getCustomerSession(request, env);
  if (!session) {
    return errorResponse("UNAUTHORIZED", "Customer authentication is required.", 401);
  }

  const result = await env.DB.prepare(`
    SELECT * FROM dropoff_orders
    WHERE customer_id = ? AND status IN ('RECEIVED', 'COMPLETED')
    ORDER BY received_at DESC
    LIMIT 20
  `).bind(session.userId).all<OrderRow>();
  const orders = result.results ?? [];

  const customer = await env.DB.prepare(`
    SELECT name, phone FROM customers WHERE customer_id = ? LIMIT 1
  `).bind(session.userId).first<{ name: string | null; phone: string | null }>();

  return json({
    ok: true,
    order: orders[0] ?? null,
    orders,
    activeCount: orders.length,
    customer: customer ? { name: customer.name ?? "", phone: customer.phone ?? "" } : null,
  });
}

export async function handleDropoffRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "POST" && url.pathname === "/staff/dropoff/receive") {
    return handleReceive(request, env);
  }

  if (request.method === "GET" && url.pathname === "/staff/dropoff/active") {
    return handleActiveList(request, env);
  }

  if (
    request.method === "POST" &&
    url.pathname.startsWith("/staff/dropoff/") &&
    url.pathname.endsWith("/complete")
  ) {
    const orderId = url.pathname.slice(
      "/staff/dropoff/".length,
      url.pathname.length - "/complete".length,
    );
    if (!orderId) return errorResponse("INVALID_REQUEST", "orderId is required.", 400);
    return handleComplete(request, env, orderId);
  }

  if (
    request.method === "POST" &&
    url.pathname.startsWith("/staff/dropoff/") &&
    url.pathname.endsWith("/pickup")
  ) {
    const orderId = url.pathname.slice(
      "/staff/dropoff/".length,
      url.pathname.length - "/pickup".length,
    );
    if (!orderId) return errorResponse("INVALID_REQUEST", "orderId is required.", 400);
    return handlePickup(request, env, orderId);
  }

  if (request.method === "GET" && url.pathname === "/dropoff/mine") {
    return handleMyOrder(request, env);
  }

  return errorResponse("NOT_FOUND", "Drop-off endpoint not found.", 404);
}
