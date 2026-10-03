import type { Env } from "../index";
import { requireSession } from "../auth/session-guard";
import { writeAuditSafe } from "../audit/logger";
import { cycleView, readProgramSettings } from "../lib/program-settings";

/*
 * ============================================================
 * OWNER — CUSTOMER TRACE
 * ============================================================
 * Daftar customer (login sebagai member / belum member) beserta ringkasan
 * reward program, dan halaman detail dengan "Customer Journey": urutan
 * waktu perolehan reward program (koin bonus, laundry bag) serta reward
 * event. Hanya Owner yang dapat mengakses.
 */

type ListRow = {
  customer_id: string;
  name: string | null;
  phone: string | null;
  phone_masked: string;
  is_member: number;
  member_since: string | null;
  created_at: string;
  total_coins: number | null;
  bonus_coins: number | null;
  bags: number | null;
  rewards_pending: number | null;
  total_count: number;
};

const MAX_PAGE_SIZE = 50;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function errorResponse(error: string, message: string, status: number): Response {
  return json({ ok: false, error, message }, status);
}

/* ------------------------------------------------------------ *
 * GET /owner/customers?search=&status=all|member|non-member&page=&pageSize=
 * ------------------------------------------------------------ */
export async function handleOwnerCustomerList(request: Request, env: Env): Promise<Response> {
  const owner = await requireSession(request, env, ["OWNER"]);
  if (!owner) return errorResponse("UNAUTHORIZED", "Owner authentication is required.", 401);

  const url = new URL(request.url);
  const search = (url.searchParams.get("search") || "").trim().slice(0, 60).toLowerCase();
  const digits = search.replace(/\D/g, "");
  const status = (url.searchParams.get("status") || "all").toLowerCase();
  const pageRaw = Number(url.searchParams.get("page") || 1);
  const sizeRaw = Number(url.searchParams.get("pageSize") || 10);
  const page = Number.isInteger(pageRaw) && pageRaw > 0 ? Math.min(pageRaw, 100000) : 1;
  const pageSize = Number.isInteger(sizeRaw) && sizeRaw > 0 ? Math.min(sizeRaw, MAX_PAGE_SIZE) : 10;
  const offset = (page - 1) * pageSize;

  const where: string[] = [];
  const params: unknown[] = [];
  if (status === "member") where.push("c.is_member = 1");
  else if (status === "non-member" || status === "nonmember") where.push("c.is_member = 0");
  if (search) {
    where.push("(instr(lower(c.name), ?) > 0 OR (? != '' AND instr(c.phone, ?) > 0))");
    params.push(search, digits.length >= 3 ? digits : "", digits);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const result = await env.DB.prepare(`
    SELECT c.customer_id, c.name, c.phone, c.phone_masked, c.is_member, c.member_since, c.created_at,
      p.total_coins_purchased AS total_coins,
      (SELECT COALESCE(SUM(r.quantity), 0) FROM member_rewards r
        WHERE r.customer_id = c.customer_id AND r.reward_type = 'BONUS_COIN') AS bonus_coins,
      (SELECT COUNT(*) FROM member_rewards r
        WHERE r.customer_id = c.customer_id AND r.reward_type = 'LAUNDRY_BAG') AS bags,
      (SELECT COUNT(*) FROM member_rewards r
        WHERE r.customer_id = c.customer_id AND r.status = 'AVAILABLE') AS rewards_pending,
      COUNT(*) OVER () AS total_count
    FROM customers c
    LEFT JOIN member_progress p ON p.customer_id = c.customer_id
    ${clause}
    ORDER BY c.is_member DESC, lower(c.name) ASC, c.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(...params, pageSize, offset).all<ListRow>();

  const rows = result.results ?? [];
  const totals = await env.DB.prepare(`
    SELECT COUNT(*) AS customers, COALESCE(SUM(is_member), 0) AS members FROM customers
  `).first<{ customers: number; members: number }>();

  return json({
    ok: true,
    total: Number(rows[0]?.total_count ?? 0),
    page,
    pageSize,
    totalCustomers: totals?.customers ?? 0,
    totalMembers: totals?.members ?? 0,
    items: rows.map((r) => ({
      customerId: r.customer_id,
      name: (r.name ?? "").trim(),
      phone: r.phone ?? "",
      phoneMasked: r.phone_masked,
      isMember: r.is_member === 1,
      memberSince: r.member_since,
      createdAt: r.created_at,
      totalCoins: r.total_coins ?? 0,
      rewards: {
        bonusCoins: r.bonus_coins ?? 0,
        bags: r.bags ?? 0,
        pending: r.rewards_pending ?? 0,
      },
    })),
  });
}

/* ------------------------------------------------------------ *
 * GET /owner/customer/:id — detail + journey
 * ------------------------------------------------------------ */
type JourneyItem = {
  at: string;
  group: "PROGRAM" | "EVENT";
  kind: string;
  title: string;
  detail: string;
};

export async function handleOwnerCustomerDetail(request: Request, env: Env, customerId: string): Promise<Response> {
  const owner = await requireSession(request, env, ["OWNER"]);
  if (!owner) return errorResponse("UNAUTHORIZED", "Owner authentication is required.", 401);

  const id = customerId.trim();
  if (!id || id.length > 128) return errorResponse("INVALID_REQUEST", "Customer ID is required.", 400);

  const customer = await env.DB.prepare(`
    SELECT c.customer_id, c.name, c.phone, c.phone_masked, c.address, c.is_member, c.member_since, c.created_at,
           p.total_coins_purchased AS total_coins
    FROM customers c
    LEFT JOIN member_progress p ON p.customer_id = c.customer_id
    WHERE c.customer_id = ?
    LIMIT 1
  `).bind(id).first<{
    customer_id: string; name: string | null; phone: string | null; phone_masked: string;
    address: string | null; is_member: number; member_since: string | null; created_at: string;
    total_coins: number | null;
  }>();
  if (!customer) return errorResponse("CUSTOMER_NOT_FOUND", "Customer was not found.", 404);

  const settings = await readProgramSettings(env);
  const total = customer.total_coins ?? 0;

  const [purchases, programRewards, eventRewards] = await env.DB.batch([
    env.DB.prepare(`
      SELECT quantity, created_at FROM member_purchases WHERE customer_id = ? ORDER BY created_at DESC LIMIT 200
    `).bind(id),
    env.DB.prepare(`
      SELECT reward_type, milestone_number, quantity, status, created_at, claimed_at, fulfilled_at
      FROM member_rewards WHERE customer_id = ? ORDER BY created_at DESC LIMIT 200
    `).bind(id),
    env.DB.prepare(`
      SELECT type, status, created_at, claimed_at, redeemed_at, used_at
      FROM rewards WHERE customer_id = ? ORDER BY created_at DESC LIMIT 200
    `).bind(id),
  ]);

  const journey: JourneyItem[] = [];

  if (customer.is_member === 1 && customer.member_since) {
    journey.push({ at: customer.member_since, group: "PROGRAM", kind: "JOIN", title: "Bergabung sebagai member", detail: "" });
  }
  for (const p of (purchases.results ?? []) as Array<{ quantity: number; created_at: string }>) {
    journey.push({ at: p.created_at, group: "PROGRAM", kind: "PURCHASE", title: "Pembelian koin", detail: `+${p.quantity} koin` });
  }
  for (const r of (programRewards.results ?? []) as Array<{
    reward_type: string; milestone_number: number; quantity: number; status: string;
    created_at: string; claimed_at: string | null; fulfilled_at: string | null;
  }>) {
    const what = r.reward_type === "LAUNDRY_BAG" ? "1 laundry bag" : `${r.quantity} koin bonus`;
    const from = `dari ${r.milestone_number} koin`;
    journey.push({ at: r.created_at, group: "PROGRAM", kind: "REWARD_EARNED", title: `Reward program: ${what}`, detail: from });
    if (r.claimed_at) journey.push({ at: r.claimed_at, group: "PROGRAM", kind: "REWARD_CLAIMED", title: `Diklaim customer: ${what}`, detail: from });
    if (r.fulfilled_at) journey.push({ at: r.fulfilled_at, group: "PROGRAM", kind: "REWARD_FULFILLED", title: `Diserahkan staff: ${what}`, detail: from });
  }
  for (const r of (eventRewards.results ?? []) as Array<{
    type: string; status: string; created_at: string; claimed_at: string | null;
    redeemed_at: string | null; used_at: string | null;
  }>) {
    const label = r.type || "Reward";
    journey.push({ at: r.created_at, group: "EVENT", kind: "EVENT_REWARD", title: `Reward event: ${label}`, detail: "" });
    if (r.claimed_at) journey.push({ at: r.claimed_at, group: "EVENT", kind: "EVENT_CLAIMED", title: `Reward event diklaim: ${label}`, detail: "" });
    if (r.redeemed_at) journey.push({ at: r.redeemed_at, group: "EVENT", kind: "EVENT_REDEEMED", title: `Reward event ditukar: ${label}`, detail: "" });
  }
  journey.sort((a, b) => b.at.localeCompare(a.at));

  await writeAuditSafe(env, {
    entityType: "CUSTOMER",
    entityId: id,
    action: "TRACE",
    actor: owner.userId,
    result: "SUCCESS",
  });

  return json({
    ok: true,
    customer: {
      customerId: customer.customer_id,
      name: (customer.name ?? "").trim(),
      phone: customer.phone ?? "",
      phoneMasked: customer.phone_masked,
      address: (customer.address ?? "").trim(),
      isMember: customer.is_member === 1,
      memberSince: customer.member_since,
      createdAt: customer.created_at,
      totalCoins: total,
    },
    rules: settings.member,
    progress: customer.is_member === 1 ? cycleView(total, settings.member) : null,
    journey,
  });
}
