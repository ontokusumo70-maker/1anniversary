import type { Env } from "../index";
import { requireSession } from "../auth/session-guard";
import type { AuthSession } from "../auth/session-guard";
import { writeAuditSafe } from "../audit/logger";
import { broadcastRealtime } from "../realtime";
import { handleStaffActivateMachine } from "./machines";

/*
 * ============================================================
 * BUSINESS RULES (locked)
 * ============================================================
 * - Self-Service queue is ONLY about waiting for a free machine.
 *   It has nothing to do with Drop-off.
 * - One combined queue per machine type: WASHER, DRYER.
 *   Picking a specific machine (e.g. W4) is a PREFERENCE only; it
 *   never creates a separate queue.
 * - FIFO by queue_number. Queue numbers reset daily (Asia/Jakarta).
 * - A customer can hold at most one active ticket (WAITING/CALLED)
 *   per machine type at a time — enforced by a DB partial unique
 *   index, not just application logic.
 * - Flow: WAITING -> (optional) CALLED -> ACTIVATED
 *                              \-> NO_SHOW (only after 10 minutes
 *                                  from called_at, Staff-triggered)
 * - Activating a ticket reuses the EXISTING machine activation
 *   endpoint (worker/routes/machines.ts) so machine state has a
 *   single source of truth and a single atomic IDLE->IN_USE guard.
 *   This file never writes to the `machines` table directly.
 */

const NO_SHOW_MINUTES = 10;

type MachineType = "WASHER" | "DRYER";

type TicketRow = {
  ticket_id: string;
  queue_date: string;
  queue_number: number;
  machine_type: MachineType;
  customer_id: string;
  preferred_machine_id: string | null;
  status: "WAITING" | "CALLED" | "ACTIVATED" | "NO_SHOW" | "CANCELLED";
  created_at: string;
  called_at: string | null;
  no_show_at: string | null;
  activated_at: string | null;
  activated_machine_id: string | null;
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

async function getViewerSession(request: Request, env: Env): Promise<AuthSession | null> {
  return requireSession(request, env, ["CUSTOMER", "STAFF", "OWNER"]);
}

/** Calendar date in Asia/Jakarta (UTC+7, no DST) as YYYY-MM-DD. */
function jakartaDateString(at: Date = new Date()): string {
  const shifted = new Date(at.getTime() + 7 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function isMachineType(value: unknown): value is MachineType {
  return value === "WASHER" || value === "DRYER";
}

function machinePrefix(type: MachineType): "W" | "D" {
  return type === "WASHER" ? "W" : "D";
}

function isValidPreferredMachine(value: unknown, type: MachineType): value is string {
  if (typeof value !== "string") return false;
  const pattern = new RegExp(`^${machinePrefix(type)}[1-5]$`);
  return pattern.test(value.trim().toUpperCase());
}

/** Human-facing ticket code. C = Cuci (Washer), K = Kering (Dryer). */
function displayCode(type: MachineType, queueNumber: number): string {
  const letter = type === "WASHER" ? "C" : "K";
  return `${letter}-${String(queueNumber).padStart(2, "0")}`;
}

function ticketResponse(ticket: TicketRow, position: number | null): Record<string, unknown> {
  return {
    ticketId: ticket.ticket_id,
    queueDate: ticket.queue_date,
    machineType: ticket.machine_type,
    queueNumber: ticket.queue_number,
    displayCode: displayCode(ticket.machine_type, ticket.queue_number),
    preferredMachineId: ticket.preferred_machine_id,
    status: ticket.status,
    createdAt: ticket.created_at,
    calledAt: ticket.called_at,
    noShowAt: ticket.no_show_at,
    activatedAt: ticket.activated_at,
    activatedMachineId: ticket.activated_machine_id,
    position,
  };
}

async function broadcastQueueUpdated(env: Env, machineType: MachineType, queueDate: string): Promise<void> {
  try {
    await broadcastRealtime(env, "SELF_SERVICE_QUEUE_UPDATED", { machineType, queueDate });
  } catch {
    // Realtime delivery is best-effort and must not break the queue flow.
  }
}

/** Atomically allocates the next queue number for (date, machineType). */
async function allocateQueueNumber(env: Env, queueDate: string, machineType: MachineType): Promise<number> {
  await env.DB.prepare(`
    INSERT OR IGNORE INTO self_service_counters (queue_date, machine_type, next_number)
    VALUES (?, ?, 1)
  `).bind(queueDate, machineType).run();

  const row = await env.DB.prepare(`
    UPDATE self_service_counters
    SET next_number = next_number + 1
    WHERE queue_date = ? AND machine_type = ?
    RETURNING next_number - 1 AS allocated
  `).bind(queueDate, machineType).first<{ allocated: number }>();

  return row?.allocated ?? 1;
}

/*
 * ============================================================
 * CUSTOMER: join the queue
 * ============================================================
 */
async function handleJoin(request: Request, env: Env): Promise<Response> {
  const session = await getCustomerSession(request, env);
  if (!session) {
    return errorResponse("UNAUTHORIZED", "Customer authentication is required.", 401);
  }

  let body: { machineType?: unknown; preferredMachineId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse("INVALID_REQUEST", "Invalid JSON request body.", 400);
  }

  if (!isMachineType(body.machineType)) {
    return errorResponse("INVALID_REQUEST", "machineType must be WASHER or DRYER.", 400);
  }

  const machineType = body.machineType;

  let preferredMachineId: string | null = null;
  if (body.preferredMachineId !== undefined && body.preferredMachineId !== null) {
    if (!isValidPreferredMachine(body.preferredMachineId, machineType)) {
      return errorResponse(
        "INVALID_REQUEST",
        `preferredMachineId must match ${machinePrefix(machineType)}1-${machinePrefix(machineType)}5.`,
        400,
      );
    }
    preferredMachineId = (body.preferredMachineId as string).trim().toUpperCase();
  }

  const queueDate = jakartaDateString();

  // Friendly pre-check (final guarantee is the DB partial unique index below).
  const existing = await env.DB.prepare(`
    SELECT * FROM self_service_tickets
    WHERE customer_id = ? AND machine_type = ? AND queue_date = ?
      AND status IN ('WAITING', 'CALLED')
    LIMIT 1
  `).bind(session.userId, machineType, queueDate).first<TicketRow>();

  if (existing) {
    const position = await computePosition(env, existing);
    return json({ ok: true, alreadyQueued: true, ticket: ticketResponse(existing, position) });
  }

  const ticketId = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const queueNumber = await allocateQueueNumber(env, queueDate, machineType);

  try {
    await env.DB.prepare(`
      INSERT INTO self_service_tickets (
        ticket_id, queue_date, queue_number, machine_type,
        customer_id, preferred_machine_id, status, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 'WAITING', ?)
    `).bind(ticketId, queueDate, queueNumber, machineType, session.userId, preferredMachineId, nowIso).run();
  } catch (error) {
    // Extremely rare race: another request for this same customer+type
    // slipped in between our pre-check and insert. The partial unique
    // index rejected us — return that ticket instead of erroring out.
    const raceExisting = await env.DB.prepare(`
      SELECT * FROM self_service_tickets
      WHERE customer_id = ? AND machine_type = ? AND queue_date = ?
        AND status IN ('WAITING', 'CALLED')
      LIMIT 1
    `).bind(session.userId, machineType, queueDate).first<TicketRow>();

    if (raceExisting) {
      const position = await computePosition(env, raceExisting);
      return json({ ok: true, alreadyQueued: true, ticket: ticketResponse(raceExisting, position) });
    }

    console.error("SELF_SERVICE_JOIN_FAILED:", error);
    return errorResponse("INTERNAL_ERROR", "Could not join the queue.", 500);
  }

  const ticket: TicketRow = {
    ticket_id: ticketId,
    queue_date: queueDate,
    queue_number: queueNumber,
    machine_type: machineType,
    customer_id: session.userId,
    preferred_machine_id: preferredMachineId,
    status: "WAITING",
    created_at: nowIso,
    called_at: null,
    no_show_at: null,
    activated_at: null,
    activated_machine_id: null,
  };

  await writeAuditSafe(env, {
    entityType: "SELF_SERVICE_TICKET",
    entityId: ticketId,
    action: "CREATE",
    actor: session.userId,
    result: "SUCCESS",
  });

  await broadcastQueueUpdated(env, machineType, queueDate);

  const position = await computePosition(env, ticket);
  return json({ ok: true, alreadyQueued: false, ticket: ticketResponse(ticket, position) });
}

/** 1-based position among WAITING tickets of the same type/date (null once called/activated). */
async function computePosition(env: Env, ticket: TicketRow): Promise<number | null> {
  if (ticket.status !== "WAITING") return null;

  const row = await env.DB.prepare(`
    SELECT COUNT(*) AS ahead FROM self_service_tickets
    WHERE machine_type = ? AND queue_date = ? AND status = 'WAITING' AND queue_number < ?
  `).bind(ticket.machine_type, ticket.queue_date, ticket.queue_number).first<{ ahead: number }>();

  return (row?.ahead ?? 0) + 1;
}

/*
 * ============================================================
 * CUSTOMER: view my active tickets
 * ============================================================
 */
async function handleMine(request: Request, env: Env): Promise<Response> {
  const session = await getCustomerSession(request, env);
  if (!session) {
    return errorResponse("UNAUTHORIZED", "Customer authentication is required.", 401);
  }

  const queueDate = jakartaDateString();

  const result = await env.DB.prepare(`
    SELECT * FROM self_service_tickets
    WHERE customer_id = ? AND queue_date = ? AND status IN ('WAITING', 'CALLED')
    ORDER BY created_at ASC
  `).bind(session.userId, queueDate).all<TicketRow>();

  const tickets = await Promise.all(
    (result.results ?? []).map(async (ticket) => {
      const position = await computePosition(env, ticket);
      return ticketResponse(ticket, position);
    }),
  );

  return json({ ok: true, tickets });
}

/*
 * ============================================================
 * CUSTOMER: cancel my own ticket
 * ============================================================
 */
async function handleCancel(request: Request, env: Env, ticketId: string): Promise<Response> {
  const session = await getCustomerSession(request, env);
  if (!session) {
    return errorResponse("UNAUTHORIZED", "Customer authentication is required.", 401);
  }

  const update = await env.DB.prepare(`
    UPDATE self_service_tickets
    SET status = 'CANCELLED'
    WHERE ticket_id = ? AND customer_id = ? AND status IN ('WAITING', 'CALLED')
  `).bind(ticketId, session.userId).run();

  if (update.meta.changes !== 1) {
    return errorResponse("INVALID_STATE", "Ticket could not be cancelled.", 409);
  }

  const ticket = await env.DB.prepare(`
    SELECT * FROM self_service_tickets WHERE ticket_id = ? LIMIT 1
  `).bind(ticketId).first<TicketRow>();

  await writeAuditSafe(env, {
    entityType: "SELF_SERVICE_TICKET",
    entityId: ticketId,
    action: "CANCEL",
    actor: session.userId,
    result: "SUCCESS",
  });

  if (ticket) {
    await broadcastQueueUpdated(env, ticket.machine_type, ticket.queue_date);
  }

  return json({ ok: true });
}

/*
 * ============================================================
 * PUBLIC (any logged-in role): queue board summary
 * This is the "Antrean Saat Ini" card data — one lightweight
 * query per machine type, safe to poll/broadcast-refresh often.
 * ============================================================
 */
async function handleBoard(request: Request, env: Env): Promise<Response> {
  const session = await getViewerSession(request, env);
  if (!session) {
    return errorResponse("UNAUTHORIZED", "Authentication is required.", 401);
  }

  const queueDate = jakartaDateString();

  async function summaryFor(machineType: MachineType) {
    const waiting = await env.DB.prepare(`
      SELECT COUNT(*) AS n FROM self_service_tickets
      WHERE machine_type = ? AND queue_date = ? AND status = 'WAITING'
    `).bind(machineType, queueDate).first<{ n: number }>();

    const called = await env.DB.prepare(`
      SELECT * FROM self_service_tickets
      WHERE machine_type = ? AND queue_date = ? AND status = 'CALLED'
      ORDER BY queue_number ASC
      LIMIT 1
    `).bind(machineType, queueDate).first<TicketRow>();

    return {
      waitingCount: waiting?.n ?? 0,
      calledDisplayCode: called ? displayCode(called.machine_type, called.queue_number) : null,
    };
  }

  return json({
    ok: true,
    queueDate,
    washer: await summaryFor("WASHER"),
    dryer: await summaryFor("DRYER"),
  });
}

/*
 * ============================================================
 * STAFF: full waiting list (one query, no submenu)
 * ============================================================
 */
async function handleStaffList(request: Request, env: Env): Promise<Response> {
  const session = await getStaffSession(request, env);
  if (!session) {
    return errorResponse("UNAUTHORIZED", "Staff authentication is required.", 401);
  }

  const queueDate = jakartaDateString();

  const result = await env.DB.prepare(`
    SELECT t.*, c.phone_masked
    FROM self_service_tickets t
    JOIN customers c ON c.customer_id = t.customer_id
    WHERE t.queue_date = ? AND t.status IN ('WAITING', 'CALLED')
    ORDER BY
      CASE WHEN t.machine_type = 'WASHER' THEN 1 ELSE 2 END,
      t.queue_number ASC
  `).bind(queueDate).all();

  return json({ ok: true, queueDate, tickets: result.results ?? [] });
}

/*
 * ============================================================
 * STAFF: call the next ticket (visibility only; does not touch
 * any machine). Starts the 10-minute no-show window.
 * ============================================================
 */
async function handleCall(request: Request, env: Env, ticketId: string): Promise<Response> {
  const session = await getStaffSession(request, env);
  if (!session) {
    return errorResponse("UNAUTHORIZED", "Staff authentication is required.", 401);
  }

  const nowIso = new Date().toISOString();

  const update = await env.DB.prepare(`
    UPDATE self_service_tickets
    SET status = 'CALLED', called_at = ?
    WHERE ticket_id = ? AND status = 'WAITING'
  `).bind(nowIso, ticketId).run();

  const ticket = await env.DB.prepare(`
    SELECT * FROM self_service_tickets WHERE ticket_id = ? LIMIT 1
  `).bind(ticketId).first<TicketRow>();

  if (!ticket) {
    return errorResponse("NOT_FOUND", "Ticket not found.", 404);
  }

  if (update.meta.changes !== 1) {
    if (ticket.status === "CALLED") {
      return json({ ok: true, idempotent: true, ticket: ticketResponse(ticket, null) });
    }
    return errorResponse("INVALID_STATE", "Ticket is not waiting to be called.", 409);
  }

  await writeAuditSafe(env, {
    entityType: "SELF_SERVICE_TICKET",
    entityId: ticketId,
    action: "CALL",
    actor: session.userId,
    result: "SUCCESS",
  });

  await broadcastQueueUpdated(env, ticket.machine_type, ticket.queue_date);

  return json({ ok: true, idempotent: false, ticket: ticketResponse(ticket, null) });
}

/*
 * ============================================================
 * STAFF: mark a called ticket as no-show
 * Only allowed once at least 10 minutes have passed since the
 * call — enforced server-side, not just in the UI.
 * ============================================================
 */
async function handleNoShow(request: Request, env: Env, ticketId: string): Promise<Response> {
  const session = await getStaffSession(request, env);
  if (!session) {
    return errorResponse("UNAUTHORIZED", "Staff authentication is required.", 401);
  }

  const ticket = await env.DB.prepare(`
    SELECT * FROM self_service_tickets WHERE ticket_id = ? LIMIT 1
  `).bind(ticketId).first<TicketRow>();

  if (!ticket) {
    return errorResponse("NOT_FOUND", "Ticket not found.", 404);
  }

  if (ticket.status !== "CALLED" || !ticket.called_at) {
    return errorResponse("INVALID_STATE", "Ticket must be CALLED before it can be marked no-show.", 409);
  }

  const calledAtMs = Date.parse(ticket.called_at);
  const elapsedMinutes = (Date.now() - calledAtMs) / 60000;

  if (elapsedMinutes < NO_SHOW_MINUTES) {
    return errorResponse(
      "TOO_EARLY",
      `Customer masih punya waktu ${Math.ceil(NO_SHOW_MINUTES - elapsedMinutes)} menit lagi sebelum bisa ditandai NO_SHOW.`,
      409,
    );
  }

  const nowIso = new Date().toISOString();

  const update = await env.DB.prepare(`
    UPDATE self_service_tickets
    SET status = 'NO_SHOW', no_show_at = ?
    WHERE ticket_id = ? AND status = 'CALLED'
  `).bind(nowIso, ticketId).run();

  if (update.meta.changes !== 1) {
    return errorResponse("INVALID_STATE", "Ticket could not be marked no-show.", 409);
  }

  await writeAuditSafe(env, {
    entityType: "SELF_SERVICE_TICKET",
    entityId: ticketId,
    action: "NO_SHOW",
    actor: session.userId,
    result: "SUCCESS",
  });

  await broadcastQueueUpdated(env, ticket.machine_type, ticket.queue_date);

  return json({ ok: true });
}

/*
 * ============================================================
 * STAFF: activate — one tap that both starts the chosen machine
 * (via the existing machine-activation endpoint, so machine state
 * has a single source of truth) and resolves the ticket.
 * ============================================================
 */
async function handleActivate(request: Request, env: Env, ticketId: string): Promise<Response> {
  const session = await getStaffSession(request, env);
  if (!session) {
    return errorResponse("UNAUTHORIZED", "Staff authentication is required.", 401);
  }

  let body: { machineId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse("INVALID_REQUEST", "Invalid JSON request body.", 400);
  }

  if (typeof body.machineId !== "string" || !/^[WD][1-5]$/.test(body.machineId.trim().toUpperCase())) {
    return errorResponse("INVALID_REQUEST", "machineId must look like W1-W5 or D1-D5.", 400);
  }

  const machineId = body.machineId.trim().toUpperCase();

  const ticket = await env.DB.prepare(`
    SELECT * FROM self_service_tickets WHERE ticket_id = ? LIMIT 1
  `).bind(ticketId).first<TicketRow>();

  if (!ticket) {
    return errorResponse("NOT_FOUND", "Ticket not found.", 404);
  }

  if (ticket.status !== "WAITING" && ticket.status !== "CALLED") {
    return errorResponse("INVALID_STATE", "Ticket is not available to activate.", 409);
  }

  if (machineId[0] !== machinePrefix(ticket.machine_type)) {
    return errorResponse(
      "MACHINE_TYPE_MISMATCH",
      `Ticket is for ${ticket.machine_type}; machineId must start with ${machinePrefix(ticket.machine_type)}.`,
      400,
    );
  }

  // Reuse the existing, already-atomic machine activation endpoint.
  // It does not read the request body, so passing the same `request`
  // through (after we already consumed its JSON above) is safe.
  const activateResult = await handleStaffActivateMachine(request, env, machineId);
  const activateData = await activateResult.json() as { ok: boolean; error?: string; message?: string; machine?: unknown };

  if (!activateData.ok) {
    // Machine could not be activated (e.g. already in use). Ticket is
    // left untouched so Staff can pick a different machine.
    return json(activateData, activateResult.status);
  }

  const nowIso = new Date().toISOString();

  const update = await env.DB.prepare(`
    UPDATE self_service_tickets
    SET status = 'ACTIVATED', activated_at = ?, activated_machine_id = ?
    WHERE ticket_id = ? AND status IN ('WAITING', 'CALLED')
  `).bind(nowIso, machineId, ticketId).run();

  if (update.meta.changes !== 1) {
    // Extremely rare: the machine was activated successfully, but this
    // ticket was already resolved by a concurrent request in between.
    // The machine itself is correctly IN_USE regardless; only the
    // convenience link to this ticket could not be recorded.
    console.error("SELF_SERVICE_ACTIVATE_TICKET_LINK_LOST:", ticketId, machineId);
  }

  await writeAuditSafe(env, {
    entityType: "SELF_SERVICE_TICKET",
    entityId: ticketId,
    action: "ACTIVATE",
    actor: session.userId,
    result: "SUCCESS",
  });

  await broadcastQueueUpdated(env, ticket.machine_type, ticket.queue_date);

  return json({ ok: true, machine: activateData.machine, ticketId, ticketLinked: update.meta.changes === 1 });
}

export async function handleSelfServiceQueueRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "POST" && url.pathname === "/queue/self-service/join") {
    return handleJoin(request, env);
  }

  if (request.method === "GET" && url.pathname === "/queue/self-service/mine") {
    return handleMine(request, env);
  }

  if (request.method === "GET" && url.pathname === "/queue/self-service/board") {
    return handleBoard(request, env);
  }

  if (
    request.method === "POST" &&
    url.pathname.startsWith("/queue/self-service/") &&
    url.pathname.endsWith("/cancel")
  ) {
    const ticketId = url.pathname.slice(
      "/queue/self-service/".length,
      url.pathname.length - "/cancel".length,
    );
    if (!ticketId) return errorResponse("INVALID_REQUEST", "ticketId is required.", 400);
    return handleCancel(request, env, ticketId);
  }

  if (request.method === "GET" && url.pathname === "/staff/queue/self-service") {
    return handleStaffList(request, env);
  }

  if (
    request.method === "POST" &&
    url.pathname.startsWith("/staff/queue/self-service/") &&
    url.pathname.endsWith("/call")
  ) {
    const ticketId = url.pathname.slice(
      "/staff/queue/self-service/".length,
      url.pathname.length - "/call".length,
    );
    if (!ticketId) return errorResponse("INVALID_REQUEST", "ticketId is required.", 400);
    return handleCall(request, env, ticketId);
  }

  if (
    request.method === "POST" &&
    url.pathname.startsWith("/staff/queue/self-service/") &&
    url.pathname.endsWith("/no-show")
  ) {
    const ticketId = url.pathname.slice(
      "/staff/queue/self-service/".length,
      url.pathname.length - "/no-show".length,
    );
    if (!ticketId) return errorResponse("INVALID_REQUEST", "ticketId is required.", 400);
    return handleNoShow(request, env, ticketId);
  }

  if (
    request.method === "POST" &&
    url.pathname.startsWith("/staff/queue/self-service/") &&
    url.pathname.endsWith("/activate")
  ) {
    const ticketId = url.pathname.slice(
      "/staff/queue/self-service/".length,
      url.pathname.length - "/activate".length,
    );
    if (!ticketId) return errorResponse("INVALID_REQUEST", "ticketId is required.", 400);
    return handleActivate(request, env, ticketId);
  }

  return errorResponse("NOT_FOUND", "Self-service queue endpoint not found.", 404);
}
