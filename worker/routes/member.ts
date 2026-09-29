import type { Env } from "../index";
import { requireSession } from "../auth/session-guard";
import type { AuthSession } from "../auth/session-guard";
import { writeAuditSafe } from "../audit/logger";
import { broadcastRealtime } from "../realtime";
import { isPhone, findOrCreateCustomerByPhone } from "../lib/customer-lookup";

/*
 * ============================================================
 * BUSINESS RULES (locked, see Member Reward Digital spec v3.0)
 * ============================================================
 * - Progress = total_coins_purchased. Never reset, never decreases.
 * - Every multiple of 10  -> +1 BONUS_COIN entitlement (cumulative).
 * - Every multiple of 40  -> +1 LAUNDRY_BAG entitlement (cumulative,
 *   in addition to the BONUS_COIN already due at that same multiple
 *   of 10, since 40 is also a multiple of 10).
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
function bonusCountAt(total: number): number {
  return Math.floor(total / 10);
}

function bagCountAt(total: number): number {
  return Math.floor(total / 40);
}

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

  const oldBonusCount = bonusCountAt(oldTotal);
  const newBonusCount = bonusCountAt(newTotal);
  const oldBagCount = bagCountAt(oldTotal);
  const newBagCount = bagCountAt(newTotal);

  const newRewards: RewardRow[] = [];
  const nowIso2 = new Date().toISOString();

  for (let i = oldBonusCount + 1; i <= newBonusCount; i++) {
    const milestone = i * 10;
    const rewardId = crypto.randomUUID();
    const insert = await env.DB.prepare(`
      INSERT OR IGNORE INTO member_rewards
        (reward_id, customer_id, reward_type, milestone_number, source_purchase_id, status, created_at)
      VALUES (?, ?, 'BONUS_COIN', ?, ?, 'AVAILABLE', ?)
    `).bind(rewardId, customerId, milestone, purchaseId, nowIso2).run();

    if (insert.meta.changes === 1) {
      newRewards.push({
        reward_id: rewardId,
        customer_id: customerId,
        reward_type: "BONUS_COIN",
        milestone_number: milestone,
        source_purchase_id: purchaseId,
        status: "AVAILABLE",
        created_at: nowIso2,
        fulfilled_at: null,
        fulfilled_by: null,
      });
    }
  }

  for (let i = oldBagCount + 1; i <= newBagCount; i++) {
    const milestone = i * 40;
    const rewardId = crypto.randomUUID();
    const insert = await env.DB.prepare(`
      INSERT OR IGNORE INTO member_rewards
        (reward_id, customer_id, reward_type, milestone_number, source_purchase_id, status, created_at)
      VALUES (?, ?, 'LAUNDRY_BAG', ?, ?, 'AVAILABLE', ?)
    `).bind(rewardId, customerId, milestone, purchaseId, nowIso2).run();

    if (insert.meta.changes === 1) {
      newRewards.push({
        reward_id: rewardId,
        customer_id: customerId,
        reward_type: "LAUNDRY_BAG",
        milestone_number: milestone,
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

  const nowIso = new Date().toISOString();

  const update = await env.DB.prepare(`
    UPDATE member_rewards
    SET status = 'FULFILLED', fulfilled_at = ?, fulfilled_by = ?
    WHERE reward_id = ? AND status = 'AVAILABLE'
  `).bind(nowIso, session.userId, rewardId).run();

  if (update.meta.changes !== 1) {
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

  return json({
    ok: true,
    totalCoinsPurchased: total,
    coinMilestoneProgress: total % 10,
    bagMilestoneProgress: total % 40,
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
