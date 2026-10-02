import type { Env } from "../index";
import { requireSession } from "../auth/session-guard";
import { writeAuditSafe } from "../audit/logger";
import { broadcastRealtime } from "../realtime";
import { isPhone, normalizePhone } from "../lib/customer-lookup";
import {
  cycleView,
  readProgramSettings,
  sanitizeProgramSettings,
} from "../lib/program-settings";

/*
 * ============================================================
 * PROGRAM MEMBER & DATA CUSTOMER (endpoint baru)
 * ============================================================
 * Owner    : satu-satunya yang membuat/mengubah/mengaktifkan atau
 *            menonaktifkan aturan program (PUT /owner/program-settings).
 * Staff    : melihat daftar customer/member, mencari, melihat detail,
 *            dan mencatat pembelian koin (POST /staff/member/purchase di
 *            member.ts) hanya untuk customer yang sudah member.
 * Customer : melihat progres, JOIN member, dan KLAIM reward miliknya.
 */

type CustomerRow = {
  customer_id: string;
  name: string | null;
  phone: string | null;
  phone_masked: string;
  address: string | null;
  is_member: number;
  member_since: string | null;
  total_coins: number | null;
};

type RewardRow = {
  reward_id: string;
  reward_type: "BONUS_COIN" | "LAUNDRY_BAG";
  milestone_number: number;
  status: "AVAILABLE" | "FULFILLED";
  created_at: string;
  claimed_at: string | null;
  fulfilled_at: string | null;
};

const LIST_LIMIT = 200;

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

async function safeBroadcast(env: Env, type: string, payload: unknown): Promise<void> {
  try {
    await broadcastRealtime(env, type, payload);
  } catch {
    // realtime best-effort
  }
}

function customerDto(row: CustomerRow) {
  return {
    customerId: row.customer_id,
    name: (row.name ?? "").trim(),
    phone: row.phone ?? "",
    address: (row.address ?? "").trim(),
    isMember: row.is_member === 1,
    memberSince: row.member_since,
    totalCoins: row.total_coins ?? 0,
  };
}

async function fetchRewardLists(env: Env, customerId: string) {
  const result = await env.DB.prepare(`
    SELECT reward_id, reward_type, milestone_number, status, created_at, claimed_at, fulfilled_at
    FROM member_rewards
    WHERE customer_id = ?
    ORDER BY created_at DESC, milestone_number DESC
    LIMIT 100
  `).bind(customerId).all<RewardRow>();
  const rows = result.results ?? [];
  const dto = (r: RewardRow) => ({
    rewardId: r.reward_id,
    type: r.reward_type,
    milestone: r.milestone_number,
    status: r.status,
    createdAt: r.created_at,
    claimedAt: r.claimed_at,
    fulfilledAt: r.fulfilled_at,
  });
  return {
    available: rows.filter((r) => r.status === "AVAILABLE").map(dto),
    history: rows.filter((r) => r.status === "FULFILLED").map(dto),
  };
}

async function fetchPurchases(env: Env, customerId: string) {
  const result = await env.DB.prepare(`
    SELECT purchase_id, quantity, created_at
    FROM member_purchases
    WHERE customer_id = ?
    ORDER BY created_at DESC
    LIMIT 50
  `).bind(customerId).all<{ purchase_id: string; quantity: number; created_at: string }>();
  return (result.results ?? []).map((p) => ({
    purchaseId: p.purchase_id,
    quantity: p.quantity,
    createdAt: p.created_at,
  }));
}

/* ------------------------------------------------------------ *
 * GET /program/settings  (semua peran login) — hanya baca
 * ------------------------------------------------------------ */
async function handleReadSettings(request: Request, env: Env): Promise<Response> {
  const session = await requireSession(request, env, ["CUSTOMER", "STAFF", "OWNER"]);
  if (!session) return errorResponse("UNAUTHORIZED", "Authentication is required.", 401);
  return json({ ok: true, settings: await readProgramSettings(env) });
}

/* ------------------------------------------------------------ *
 * GET/PUT /owner/program-settings  (OWNER saja)
 * ------------------------------------------------------------ */
async function handleOwnerSettings(request: Request, env: Env): Promise<Response> {
  const owner = await requireSession(request, env, ["OWNER"]);
  if (!owner) return errorResponse("UNAUTHORIZED", "Owner authentication is required.", 401);

  if (request.method === "GET") {
    return json({ ok: true, settings: await readProgramSettings(env) });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("INVALID_REQUEST", "Invalid JSON request body.", 400);
  }
  const parsed = sanitizeProgramSettings(body);
  if (!parsed.ok) return errorResponse("INVALID_SETTINGS", parsed.message, 400);

  const nowIso = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO program_settings (id, data_json, updated_at, updated_by)
    VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      data_json = excluded.data_json,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
  `).bind(JSON.stringify(parsed.value), nowIso, owner.userId).run();

  await writeAuditSafe(env, {
    entityType: "PROGRAM_SETTINGS",
    entityId: "program",
    action: "UPDATE",
    actor: owner.userId,
    result: "SUCCESS",
  });
  await safeBroadcast(env, "MEMBER_PROGRESS_UPDATED", { settings: true });
  return json({ ok: true, settings: parsed.value });
}

/* ------------------------------------------------------------ *
 * POST /member/join  (CUSTOMER)
 * ------------------------------------------------------------ */
async function handleJoin(request: Request, env: Env): Promise<Response> {
  const session = await requireSession(request, env, ["CUSTOMER"]);
  if (!session) return errorResponse("UNAUTHORIZED", "Customer authentication is required.", 401);

  const settings = await readProgramSettings(env);
  if (!settings.member.enabled) {
    return errorResponse("PROGRAM_DISABLED", "Program member sedang tidak aktif.", 403);
  }

  const customer = await env.DB.prepare(`
    SELECT customer_id, is_member FROM customers WHERE customer_id = ? LIMIT 1
  `).bind(session.userId).first<{ customer_id: string; is_member: number }>();
  if (!customer) {
    return errorResponse("NOT_FOUND", "Data customer tidak ditemukan. Silakan login ulang.", 404);
  }

  const nowIso = new Date().toISOString();
  if (customer.is_member !== 1) {
    await env.DB.prepare(`
      UPDATE customers SET is_member = 1, member_since = ? WHERE customer_id = ? AND is_member = 0
    `).bind(nowIso, session.userId).run();
    await env.DB.prepare(`
      INSERT OR IGNORE INTO member_progress (customer_id, total_coins_purchased, updated_at)
      VALUES (?, 0, ?)
    `).bind(session.userId, nowIso).run();
    await writeAuditSafe(env, {
      entityType: "CUSTOMER",
      entityId: session.userId,
      action: "JOIN",
      actor: session.userId,
      result: "SUCCESS",
    });
    await safeBroadcast(env, "MEMBER_PROGRESS_UPDATED", { customerId: session.userId, joined: true });
  }
  return json({ ok: true, isMember: true });
}

/* ------------------------------------------------------------ *
 * GET /member/me  (CUSTOMER)
 * ------------------------------------------------------------ */
async function handleMe(request: Request, env: Env): Promise<Response> {
  const session = await requireSession(request, env, ["CUSTOMER"]);
  if (!session) return errorResponse("UNAUTHORIZED", "Customer authentication is required.", 401);

  const settings = await readProgramSettings(env);
  const row = await env.DB.prepare(`
    SELECT c.customer_id, c.name, c.phone, c.phone_masked, c.address, c.is_member, c.member_since,
           p.total_coins_purchased AS total_coins
    FROM customers c
    LEFT JOIN member_progress p ON p.customer_id = c.customer_id
    WHERE c.customer_id = ?
    LIMIT 1
  `).bind(session.userId).first<CustomerRow>();

  if (!row) {
    return json({ ok: true, isMember: false, settings: settings.member, customer: null });
  }

  const dto = customerDto(row);
  if (!dto.isMember) {
    return json({ ok: true, isMember: false, settings: settings.member, customer: dto });
  }

  const rewards = await fetchRewardLists(env, row.customer_id);
  const purchases = await fetchPurchases(env, row.customer_id);
  return json({
    ok: true,
    isMember: true,
    settings: settings.member,
    customer: dto,
    progress: cycleView(dto.totalCoins, settings.member),
    purchases,
    rewards,
  });
}

/* ------------------------------------------------------------ *
 * POST /member/rewards/:id/claim  (CUSTOMER)
 * Customer hanya menandai klaim; penyerahan dilakukan Staff (fulfill).
 * ------------------------------------------------------------ */
async function handleClaim(request: Request, env: Env, rewardId: string): Promise<Response> {
  const session = await requireSession(request, env, ["CUSTOMER"]);
  if (!session) return errorResponse("UNAUTHORIZED", "Customer authentication is required.", 401);

  const nowIso = new Date().toISOString();
  const update = await env.DB.prepare(`
    UPDATE member_rewards
    SET claimed_at = ?
    WHERE reward_id = ? AND customer_id = ? AND status = 'AVAILABLE' AND claimed_at IS NULL
  `).bind(nowIso, rewardId, session.userId).run();

  const reward = await env.DB.prepare(`
    SELECT reward_id, status, claimed_at FROM member_rewards
    WHERE reward_id = ? AND customer_id = ? LIMIT 1
  `).bind(rewardId, session.userId).first<{ reward_id: string; status: string; claimed_at: string | null }>();
  if (!reward) return errorResponse("NOT_FOUND", "Reward tidak ditemukan.", 404);

  if (update.meta.changes === 1) {
    await writeAuditSafe(env, {
      entityType: "MEMBER_REWARD",
      entityId: rewardId,
      action: "CLAIM",
      actor: session.userId,
      result: "SUCCESS",
    });
    await safeBroadcast(env, "MEMBER_PROGRESS_UPDATED", { customerId: session.userId, claimed: rewardId });
  }
  return json({ ok: true, claimedAt: reward.claimed_at, status: reward.status });
}

/* ------------------------------------------------------------ *
 * GET /staff/members?q=  (STAFF, OWNER hanya baca)
 * ------------------------------------------------------------ */
async function handleStaffMembers(request: Request, env: Env): Promise<Response> {
  const session = await requireSession(request, env, ["STAFF", "OWNER"]);
  if (!session) return errorResponse("UNAUTHORIZED", "Staff authentication is required.", 401);

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim().slice(0, 60);
  const nameLike = q.toLowerCase();
  const digits = q.replace(/\D/g, "");
  const phoneLike = digits.length >= 3 ? digits : "";

  const totals = await env.DB.prepare(`
    SELECT COUNT(*) AS customers, COALESCE(SUM(is_member), 0) AS members
    FROM customers
    WHERE phone IS NOT NULL AND phone != ''
  `).first<{ customers: number; members: number }>();

  let result;
  if (q === "") {
    result = await env.DB.prepare(`
      SELECT c.customer_id, c.name, c.phone, c.phone_masked, c.address, c.is_member, c.member_since,
             p.total_coins_purchased AS total_coins
      FROM customers c
      LEFT JOIN member_progress p ON p.customer_id = c.customer_id
      WHERE c.phone IS NOT NULL AND c.phone != ''
      ORDER BY c.is_member DESC, lower(c.name) ASC, c.created_at DESC
      LIMIT ?
    `).bind(LIST_LIMIT).all<CustomerRow>();
  } else {
    result = await env.DB.prepare(`
      SELECT c.customer_id, c.name, c.phone, c.phone_masked, c.address, c.is_member, c.member_since,
             p.total_coins_purchased AS total_coins
      FROM customers c
      LEFT JOIN member_progress p ON p.customer_id = c.customer_id
      WHERE c.phone IS NOT NULL AND c.phone != ''
        AND (instr(lower(c.name), ?) > 0 OR (? != '' AND instr(c.phone, ?) > 0))
      ORDER BY c.is_member DESC, lower(c.name) ASC, c.created_at DESC
      LIMIT ?
    `).bind(nameLike, phoneLike, phoneLike, LIST_LIMIT).all<CustomerRow>();
  }

  return json({
    ok: true,
    totalCustomers: totals?.customers ?? 0,
    totalMembers: totals?.members ?? 0,
    customers: (result.results ?? []).map(customerDto),
  });
}

/* ------------------------------------------------------------ *
 * GET /staff/members/:customerId  (STAFF, OWNER hanya baca)
 * ------------------------------------------------------------ */
async function handleStaffMemberDetail(request: Request, env: Env, customerId: string): Promise<Response> {
  const session = await requireSession(request, env, ["STAFF", "OWNER"]);
  if (!session) return errorResponse("UNAUTHORIZED", "Staff authentication is required.", 401);

  const row = await env.DB.prepare(`
    SELECT c.customer_id, c.name, c.phone, c.phone_masked, c.address, c.is_member, c.member_since,
           p.total_coins_purchased AS total_coins
    FROM customers c
    LEFT JOIN member_progress p ON p.customer_id = c.customer_id
    WHERE c.customer_id = ?
    LIMIT 1
  `).bind(customerId).first<CustomerRow>();
  if (!row) return errorResponse("NOT_FOUND", "Customer tidak ditemukan.", 404);

  const settings = await readProgramSettings(env);
  const dto = customerDto(row);
  if (!dto.isMember) {
    return json({ ok: true, customer: dto, settings: settings.member });
  }
  return json({
    ok: true,
    customer: dto,
    settings: settings.member,
    progress: cycleView(dto.totalCoins, settings.member),
    purchases: await fetchPurchases(env, row.customer_id),
    rewards: await fetchRewardLists(env, row.customer_id),
  });
}

/* ------------------------------------------------------------ *
 * GET /staff/customers/lookup?phone=  (STAFF)
 * Dipakai form Drop-off: isi nomor HP -> nama & alamat muncul otomatis.
 * Tidak membuat customer baru.
 * ------------------------------------------------------------ */
async function handleCustomerLookup(request: Request, env: Env): Promise<Response> {
  const session = await requireSession(request, env, ["STAFF"]);
  if (!session) return errorResponse("UNAUTHORIZED", "Staff authentication is required.", 401);

  const phone = new URL(request.url).searchParams.get("phone") || "";
  if (!isPhone(phone)) return errorResponse("INVALID_REQUEST", "phone is required.", 400);

  const normalized = normalizePhone(phone);
  const row = await env.DB.prepare(`
    SELECT customer_id, name, phone, address, is_member
    FROM customers
    WHERE phone = ?
    LIMIT 1
  `).bind(normalized).first<{
    customer_id: string; name: string | null; phone: string | null;
    address: string | null; is_member: number;
  }>();

  if (!row) return json({ ok: true, found: false });
  return json({
    ok: true,
    found: true,
    customerId: row.customer_id,
    name: (row.name ?? "").trim(),
    phone: row.phone ?? normalized,
    address: (row.address ?? "").trim(),
    isMember: row.is_member === 1,
  });
}

export async function handleProgramRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (method === "GET" && path === "/program/settings") return handleReadSettings(request, env);
  if (path === "/owner/program-settings" && (method === "GET" || method === "PUT")) {
    return handleOwnerSettings(request, env);
  }
  if (method === "POST" && path === "/member/join") return handleJoin(request, env);
  if (method === "GET" && path === "/member/me") return handleMe(request, env);
  if (method === "GET" && path === "/staff/members") return handleStaffMembers(request, env);
  if (method === "GET" && path === "/staff/customers/lookup") return handleCustomerLookup(request, env);

  const claim = /^\/member\/rewards\/([^/]+)\/claim$/.exec(path);
  if (method === "POST" && claim) return handleClaim(request, env, decodeURIComponent(claim[1]));

  const detail = /^\/staff\/members\/([^/]+)$/.exec(path);
  if (method === "GET" && detail) return handleStaffMemberDetail(request, env, decodeURIComponent(detail[1]));

  return errorResponse("NOT_FOUND", "Program endpoint not found.", 404);
}
