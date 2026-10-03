import type { Env } from "../index";
import { requireSession } from "../auth/session-guard";
import type { AuthSession } from "../auth/session-guard";
import { writeAuditSafe } from "../audit/logger";
import { broadcastRealtime } from "../realtime";
import { isPhone, findOrCreateCustomerByPhone } from "../lib/customer-lookup";
import { readProgramSettings, rewardMilestones } from "../lib/program-settings";

/*
 * ============================================================
 * BUSINESS RULES (locked, see Member Reward Digital spec v3.0)
 * ============================================================
 * - Progress = total_coins_purchased. Never reset, never decreases.
 * - Aturan (kelipatan koin bonus, jumlah bonus, target laundry bag, aktif/nonaktif)
 *   TIDAK di-hardcode: dibaca dari program_settings yang hanya bisa diubah Owner.
 *   Bawaan bila Owner belum mengatur: setiap kelipatan 10 -> +1 koin bonus,
 *   setiap kelipatan 40 -> +1 laundry bag (siklus tampilan mulai dari 0 lagi).
 * - Hanya customer yang sudah JOIN member yang bisa dicatat pembelian koinnya.
 * - Bonus coins given as reward are NEVER added back into
 *   total_coins_purchased.
 * - A purchase is idempotent by purchase_id: retrying the exact same
 *   request never double-counts.
 * - Concurrent purchases for the same customer use optimistic
 *   concurrency (compare-and-swap on total_coins_purchased) so no
 *   update is ever lost.
 */

const MAX_QUANTITY = 999;
const MAX_ATTEMPTS = 5;

type RewardRow = {
  reward_id: string;
  customer_id: string;
  reward_type: "BONUS_COIN" | "LAUNDRY_BAG";
  milestone_number: number;
  source_purchase_id: string;
  status: "AVAILABLE" | "FULFILLED";
  created_at: string;
  fulfilled_at: string | null;
  fulfilled_by: string | null;
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 128;
}

function isValidQuantity(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= MAX_QUANTITY;
}

async function broadcastMemberUpdated(env: Env, customerId: string, totalCoinsPurchased: number): Promise<void> {
  try {
    await broadcastRealtime(env, "MEMBER_PROGRESS_UPDATED", { customerId, totalCoinsPurchased });
  } catch {
    // Realtime delivery is best-effort and must not break the purchase flow.
  }
}

/**
 * Cumulative entitlement counts owed at a given total. Kept as plain
 * integer floor division so the logic is identical whether the total
 * grew by 1 coin or by 500 coins in a single transaction.
 */
async function fetchRewards(
  env: Env,
  customerId: string,
): Promise<{ available: RewardRow[]; history: RewardRow[] }> {
  const available = await env.DB.prepare(`
    SELECT * FROM member_rewards
    WHERE customer_id = ? AND status = 'AVAILABLE'
    ORDER BY milestone_number ASC
  `).bind(customerId).all<RewardRow>();

  const history = await env.DB.prepare(`
    SELECT * FROM member_rewards
    WHERE customer_id = ? AND status = 'FULFILLED'
    ORDER BY fulfilled_at DESC
    LIMIT 20
  `).bind(customerId).all<RewardRow>();

  return {
    available: available.results ?? [],
    history: history.results ?? [],
  };
}

/*
 * ============================================================
 * STAFF: record a coin purchase
 * ============================================================
 */
async function handleRecordPurchase(request: Request, env: Env): Promise<Response> {
  const session = await getStaffSession(request, env);
  if (!session) {
    return errorResponse("UNAUTHORIZED", "Staff authentication is required.", 401);
  }

  let body: { phone?: unknown; quantity?: unknown; purchaseId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse("INVALID_REQUEST", "Invalid JSON request body.", 400);
  }

  if (!isPhone(body.phone)) {
    return errorResponse("INVALID_REQUEST", "phone is required.", 400);
  }
  if (!isValidQuantity(body.quantity)) {
    return errorResponse("INVALID_REQUEST", `quantity must be an integer between 1 and ${MAX_QUANTITY}.`, 400);
  }
  if (!isNonEmptyString(body.purchaseId)) {
    return errorResponse("INVALID_REQUEST", "purchaseId is required for idempotency.", 400);
  }

  const quantity = body.quantity;
  const purchaseId = body.purchaseId.trim();
  const nowIso = new Date().toISOString();

  const { customerId } = await findOrCreateCustomerByPhone(env, body.phone);

  // Hanya customer yang sudah JOIN member yang boleh dicatat pembelian koinnya,
  // dan hanya selama program diaktifkan Owner.
  const memberRow = await env.DB.prepare(`
    SELECT is_member FROM customers WHERE customer_id = ? LIMIT 1
  `).bind(customerId).first<{ is_member: number }>();
  if (!memberRow || memberRow.is_member !== 1) {
    return errorResponse("NOT_MEMBER", "Customer belum menjadi member.", 409);
  }
  const rules = (await readProgramSettings(env)).member;
  if (!rules.enabled) {
    return errorResponse("PROGRAM_DISABLED", "Program member sedang tidak aktif.", 403);
  }

  // Idempotency gate: if this exact purchaseId was already recorded,
  // return the current state instead of processing it again.
  const insertPurchase = await env.DB.prepare(`
    INSERT OR IGNORE INTO member_purchases (purchase_id, customer_id, quantity, created_by, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(purchaseId, customerId, quantity, session.userId, nowIso).run();

  if (insertPurchase.meta.changes !== 1) {
    const existingPurchase = await env.DB.prepare(`
      SELECT customer_id FROM member_purchases WHERE purchase_id = ? LIMIT 1
    `).bind(purchaseId).first<{ customer_id: string }>();

    if (!existingPurchase || existingPurchase.customer_id !== customerId) {
      return errorResponse(
        "PURCHASE_ID_CONFLICT",
        "purchaseId already used for a different customer.",
        409,
      );
    }

    const progress = await env.DB.prepare(`
      SELECT total_coins_purchased FROM member_progress WHERE customer_id = ?
    `).bind(customerId).first<{ total_coins_purchased: number }>();

    const rewardsFromThisPurchase = await env.DB.prepare(`
      SELECT * FROM member_rewards WHERE source_purchase_id = ?
    `).bind(purchaseId).all<RewardRow>();

    return json({
      ok: true,
      idempotent: true,
      customerId,
      totalCoinsPurchased: progress?.total_coins_purchased ?? 0,
      newRewards: rewardsFromThisPurchase.results ?? [],
    });
  }

  // Ensure a progress row exists, then apply the purchase with
  // optimistic concurrency so two simultaneous purchases for the
  // same customer never lose one of the updates.
  await env.DB.prepare(`
    INSERT OR IGNORE INTO member_progress (customer_id, total_coins_purchased, updated_at)
    VALUES (?, 0, ?)
  `).bind(customerId, nowIso).run();

  let oldTotal = -1;
  let newTotal = -1;
  let applied = false;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const current = await env.DB.prepare(`
      SELECT total_coins_purchased FROM member_progress WHERE customer_id = ?
    `).bind(customerId).first<{ total_coins_purchased: number }>();

    oldTotal = current?.total_coins_purchased ?? 0;
    newTotal = oldTotal + quantity;

    const update = await env.DB.prepare(`
      UPDATE member_progress
      SET total_coins_purchased = ?, updated_at = ?
      WHERE customer_id = ? AND total_coins_purchased = ?
    `).bind(newTotal, new Date().toISOString(), customerId, oldTotal).run();

    if (update.meta.changes === 1) {
      applied = true;
      break;
    }
    // Someone else updated this customer's progress in between; retry.
  }

  if (!applied) {
    return errorResponse(
      "CONFLICT",
      "Progress could not be updated due to concurrent requests. Please retry.",
      409,
    );
  }

  const newRewards: RewardRow[] = [];
  const nowIso2 = new Date().toISOString();

  for (const m of rewardMilestones(oldTotal, newTotal, rules)) {
    const rewardId = crypto.randomUUID();
    const insert = await env.DB.prepare(`
      INSERT OR IGNORE INTO member_rewards
        (reward_id, customer_id, reward_type, milestone_number, source_purchase_id, status, created_at, quantity)
      VALUES (?, ?, ?, ?, ?, 'AVAILABLE', ?, ?)
    `).bind(rewardId, customerId, m.type, m.milestone, purchaseId, nowIso2, m.quantity).run();

    if (insert.meta.changes === 1) {
      newRewards.push({
        reward_id: rewardId,
        customer_id: customerId,
        reward_type: m.type,
        milestone_number: m.milestone,
        source_purchase_id: purchaseId,
        status: "AVAILABLE",
        created_at: nowIso2,
        fulfilled_at: null,
        fulfilled_by: null,
      });
    }
  }

  await writeAuditSafe(env, {
    entityType: "MEMBER_PURCHASE",
    entityId: purchaseId,
    action: "CREATE",
    actor: session.userId,
    result: "SUCCESS",
  });

  await broadcastMemberUpdated(env, customerId, newTotal);

  return json({
    ok: true,
    idempotent: false,
    customerId,
    totalCoinsPurchased: newTotal,
    newRewards,
  });
}

/*
 * ============================================================
 * STAFF: fulfill (hand over) a reward
 * ============================================================
 */
async function handleFulfillReward(request: Request, env: Env, rewardId: string): Promise<Response> {
  const session = await getStaffSession(request, env);
  if (!session) {
    return errorResponse("UNAUTHORIZED", "Staff authentication is required.", 401);
  }

  // Body opsional: reward program member yang diserahkan (dipilih Staff).
  let body: { programRewardPoolId?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const programPoolId =
    typeof body.programRewardPoolId === "string" ? body.programRewardPoolId.trim() : "";

  const nowIso = new Date().toISOString();

  const existing = await env.DB.prepare(`
    SELECT * FROM member_rewards WHERE reward_id = ? LIMIT 1
  `).bind(rewardId).first<RewardRow & { quantity?: number | null }>();

  if (!existing) {
    return errorResponse("NOT_FOUND", "Reward not found.", 404);
  }
  if (existing.status === "FULFILLED") {
    return json({ ok: true, idempotent: true, reward: existing });
  }

  // Bila Owner sudah memilih reward program, Staff wajib memilih salah satunya.
  const configured = await env.DB.prepare(`
    SELECT COUNT(*) AS n
    FROM program_rewards pr
    JOIN reward_pool rp ON rp.reward_pool_id = pr.reward_pool_id
  `).first<{ n: number }>();

  const grantQty = Math.max(1, Number(existing.quantity ?? 1));
  let reservedPoolId: string | null = null;

  if (Number(configured?.n ?? 0) > 0) {
    if (!programPoolId) {
      return errorResponse(
        "PROGRAM_REWARD_REQUIRED",
        "Pilih reward program member yang diserahkan.",
        400,
      );
    }

    const reserve = await env.DB.prepare(`
      UPDATE program_rewards
      SET given = given + ?, updated_at = ?
      WHERE reward_pool_id = ? AND given + ? <= quantity
    `).bind(grantQty, nowIso, programPoolId, grantQty).run();

    if (reserve.meta.changes !== 1) {
      const row = await env.DB.prepare(`
        SELECT quantity, given FROM program_rewards WHERE reward_pool_id = ? LIMIT 1
      `).bind(programPoolId).first<{ quantity: number; given: number }>();
      if (!row) {
        return errorResponse("PROGRAM_REWARD_NOT_FOUND", "Reward tersebut tidak dipakai di Program Member.", 404);
      }
      return errorResponse(
        "PROGRAM_REWARD_OUT_OF_STOCK",
        `Stok reward program tidak cukup (sisa ${Math.max(0, Number(row.quantity) - Number(row.given))}).`,
        409,
      );
    }
    reservedPoolId = programPoolId;
  }

  const update = await env.DB.prepare(`
    UPDATE member_rewards
    SET status = 'FULFILLED', fulfilled_at = ?, fulfilled_by = ?, fulfilled_reward_pool_id = ?
    WHERE reward_id = ? AND status = 'AVAILABLE'
  `).bind(nowIso, session.userId, reservedPoolId, rewardId).run();

  if (update.meta.changes !== 1) {
    // Balikkan cadangan stok program bila penyerahan tidak jadi tercatat.
    if (reservedPoolId) {
      await env.DB.prepare(`
        UPDATE program_rewards
        SET given = MAX(0, given - ?), updated_at = ?
        WHERE reward_pool_id = ?
      `).bind(grantQty, nowIso, reservedPoolId).run();
    }

    const current = await env.DB.prepare(`
      SELECT * FROM member_rewards WHERE reward_id = ? LIMIT 1
    `).bind(rewardId).first<RewardRow>();

    if (!current) {
      return errorResponse("NOT_FOUND", "Reward not found.", 404);
    }
    if (current.status === "FULFILLED") {
      return json({ ok: true, idempotent: true, reward: current });
    }
    return errorResponse("INVALID_STATE", "Reward could not be fulfilled.", 409);
  }

  const reward = await env.DB.prepare(`
    SELECT * FROM member_rewards WHERE reward_id = ? LIMIT 1
  `).bind(rewardId).first<RewardRow>();

  await writeAuditSafe(env, {
    entityType: "MEMBER_REWARD",
    entityId: rewardId,
    action: "FULFILL",
    actor: session.userId,
    result: "SUCCESS",
  });

  if (reward) {
    try {
      await broadcastRealtime(env, "MEMBER_REWARD_FULFILLED", { reward });
    } catch {
      // best-effort
    }
  }

  return json({ ok: true, idempotent: false, reward });
}

/*
 * ============================================================
 * STAFF: lookup a customer's member progress by phone
 * (used before recording a purchase, or to hand over a reward
 * on a visit where no purchase happens)
 * ============================================================
 */
async function handleStaffLookup(request: Request, env: Env): Promise<Response> {
  const session = await getStaffSession(request, env);
  if (!session) {
    return errorResponse("UNAUTHORIZED", "Staff authentication is required.", 401);
  }

  const url = new URL(request.url);
  const phone = url.searchParams.get("phone");

  if (!phone || !isPhone(phone)) {
    return errorResponse("INVALID_REQUEST", "phone query parameter is required.", 400);
  }

  const { customerId } = await findOrCreateCustomerByPhone(env, phone);

  const progress = await env.DB.prepare(`
    SELECT total_coins_purchased FROM member_progress WHERE customer_id = ?
  `).bind(customerId).first<{ total_coins_purchased: number }>();

  const { available, history } = await fetchRewards(env, customerId);

  return json({
    ok: true,
    customerId,
    totalCoinsPurchased: progress?.total_coins_purchased ?? 0,
    availableRewards: available,
    rewardHistory: history,
  });
}

/*
 * ============================================================
 * CUSTOMER: view own progress (view-only, matches AC-03)
 * ============================================================
 */
async function handleCustomerProgress(request: Request, env: Env): Promise<Response> {
  const session = await getCustomerSession(request, env);
  if (!session) {
    return errorResponse("UNAUTHORIZED", "Customer authentication is required.", 401);
  }

  const progress = await env.DB.prepare(`
    SELECT total_coins_purchased FROM member_progress WHERE customer_id = ?
  `).bind(session.userId).first<{ total_coins_purchased: number }>();

  const total = progress?.total_coins_purchased ?? 0;
  const { available, history } = await fetchRewards(env, session.userId);
  const rules = (await readProgramSettings(env)).member;

  return json({
    ok: true,
    totalCoinsPurchased: total,
    coinMilestoneProgress: total % Math.max(1, rules.bonusEveryCoins),
    bagMilestoneProgress: total % Math.max(1, rules.bagAtCoins),
    availableRewards: available,
    rewardHistory: history,
  });
}

export async function handleMemberRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "POST" && url.pathname === "/staff/member/purchase") {
    return handleRecordPurchase(request, env);
  }

  if (request.method === "GET" && url.pathname === "/staff/member/lookup") {
    return handleStaffLookup(request, env);
  }

  if (
    request.method === "POST" &&
    url.pathname.startsWith("/staff/member/reward/") &&
    url.pathname.endsWith("/fulfill")
  ) {
    const rewardId = url.pathname.slice(
      "/staff/member/reward/".length,
      url.pathname.length - "/fulfill".length,
    );

    if (!rewardId) {
      return errorResponse("INVALID_REQUEST", "rewardId is required.", 400);
    }

    return handleFulfillReward(request, env, rewardId);
  }

  if (request.method === "GET" && url.pathname === "/member/progress") {
    return handleCustomerProgress(request, env);
  }

  return errorResponse("NOT_FOUND", "Member endpoint not found.", 404);
}
