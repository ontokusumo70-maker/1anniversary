import type { Env } from "../index";
import { requireSession } from "../auth/session-guard";
import { writeAuditSafe } from "../audit/logger";

/*
 * ============================================================
 * REWARD MEMBER (PROGRAM) — dipilih Owner dari Reward Pool
 * ============================================================
 * GET /owner/program-rewards  (OWNER)         -> reward program + reward pool
 * PUT /owner/program-rewards  (OWNER)         -> simpan seluruh daftar reward program
 * GET /staff/program-rewards  (STAFF, OWNER)  -> reward program + sisa untuk diserahkan
 *
 * Data pilihan disimpan di program_rewards (migrations 0021 + 0022).
 * Jumlah reward program DICADANGKAN dari stok Reward Pool lewat
 * reward_pool.quota_used (sama seperti alokasi ke Event), sehingga "Sisa"
 * di menu Reward Pool ikut berkurang. Kolom `given` mencatat jumlah yang
 * sudah diserahkan Staff ke customer (member.ts).
 */

type PoolRow = {
  reward_pool_id: string;
  reward_type: string;
  quota_total: number;
  quota_used: number;
  active: number;
};

type ItemRow = {
  reward_pool_id: string;
  reward_type: string;
  quantity: number;
  given: number;
  active: number;
};

const MAX_ITEMS = 20;
const MAX_QUANTITY = 1_000_000;

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

async function readItems(env: Env) {
  const result = await env.DB.prepare(`
    SELECT pr.reward_pool_id, pr.quantity, pr.given, rp.reward_type, rp.active
    FROM program_rewards pr
    JOIN reward_pool rp ON rp.reward_pool_id = pr.reward_pool_id
    ORDER BY pr.position ASC, pr.created_at ASC
  `).all<ItemRow>();

  return (result.results ?? []).map((row) => {
    const quantity = Number(row.quantity);
    const given = Number(row.given ?? 0);
    return {
      rewardPoolId: row.reward_pool_id,
      rewardType: row.reward_type,
      quantity,
      given,
      remaining: Math.max(0, quantity - given),
      active: Number(row.active) === 1,
    };
  });
}

async function handleGet(request: Request, env: Env): Promise<Response> {
  const owner = await requireSession(request, env, ["OWNER"]);
  if (!owner) return errorResponse("UNAUTHORIZED", "Owner authentication is required.", 401);

  const poolResult = await env.DB.prepare(`
    SELECT reward_pool_id, reward_type, quota_total, quota_used, active
    FROM reward_pool
    ORDER BY reward_type ASC, created_at ASC, reward_pool_id ASC
  `).all<PoolRow>();

  return json({
    ok: true,
    items: await readItems(env),
    pools: (poolResult.results ?? []).map((row) => ({
      rewardPoolId: row.reward_pool_id,
      rewardType: row.reward_type,
      quotaTotal: Number(row.quota_total),
      quotaUsed: Number(row.quota_used),
      freeStock: Math.max(0, Number(row.quota_total) - Number(row.quota_used)),
      active: Number(row.active) === 1,
    })),
  });
}

async function handleStaffGet(request: Request, env: Env): Promise<Response> {
  const session = await requireSession(request, env, ["STAFF", "OWNER"]);
  if (!session) return errorResponse("UNAUTHORIZED", "Staff authentication is required.", 401);
  return json({ ok: true, items: await readItems(env) });
}

async function handlePut(request: Request, env: Env): Promise<Response> {
  const owner = await requireSession(request, env, ["OWNER"]);
  if (!owner) return errorResponse("UNAUTHORIZED", "Owner authentication is required.", 401);

  let body: { items?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse("INVALID_REQUEST", "Invalid JSON request body.", 400);
  }

  if (!Array.isArray(body.items)) {
    return errorResponse("INVALID_REQUEST", "items harus berupa daftar.", 400);
  }
  if (body.items.length > MAX_ITEMS) {
    return errorResponse("INVALID_REQUEST", `Maksimal ${MAX_ITEMS} reward program.`, 400);
  }

  const items: Array<{ rewardPoolId: string; quantity: number }> = [];
  const seen = new Set<string>();
  for (const raw of body.items as Array<Record<string, unknown>>) {
    const rewardPoolId = typeof raw?.rewardPoolId === "string" ? raw.rewardPoolId.trim() : "";
    const quantity = Number(raw?.quantity);
    if (!rewardPoolId) {
      return errorResponse("INVALID_REQUEST", "Pilih reward dari Reward Pool.", 400);
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      return errorResponse("INVALID_REQUEST", "Jumlah reward harus angka bulat minimal 1.", 400);
    }
    if (seen.has(rewardPoolId)) {
      return errorResponse("INVALID_REQUEST", "Reward yang sama tidak boleh dipilih dua kali.", 400);
    }
    seen.add(rewardPoolId);
    items.push({ rewardPoolId, quantity });
  }

  // Alokasi tersimpan saat ini (untuk selisih stok dan jumlah yang sudah diserahkan).
  const oldResult = await env.DB.prepare(`
    SELECT reward_pool_id, quantity, given FROM program_rewards
  `).all<{ reward_pool_id: string; quantity: number; given: number }>();
  const oldQty = new Map<string, number>();
  const oldGiven = new Map<string, number>();
  for (const row of oldResult.results ?? []) {
    oldQty.set(row.reward_pool_id, Number(row.quantity));
    oldGiven.set(row.reward_pool_id, Number(row.given ?? 0));
  }

  const newQty = new Map(items.map((item) => [item.rewardPoolId, item.quantity]));
  const deltas: Array<{ rewardPoolId: string; delta: number }> = [];

  for (const [poolId, qty] of newQty) {
    const delta = qty - (oldQty.get(poolId) ?? 0);
    if (delta !== 0) deltas.push({ rewardPoolId: poolId, delta });
  }
  for (const [poolId, qty] of oldQty) {
    if (!newQty.has(poolId)) {
      if ((oldGiven.get(poolId) ?? 0) > 0) {
        return errorResponse(
          "REWARD_ALREADY_GIVEN",
          "Reward ini sudah pernah diserahkan ke customer dan tidak dapat dihapus dari program.",
          409,
        );
      }
      deltas.push({ rewardPoolId: poolId, delta: -qty });
    }
  }

  for (const item of items) {
    const pool = await env.DB.prepare(`
      SELECT reward_pool_id, reward_type, quota_total, quota_used, active
      FROM reward_pool WHERE reward_pool_id = ? LIMIT 1
    `).bind(item.rewardPoolId).first<PoolRow>();

    if (!pool) {
      return errorResponse("REWARD_NOT_FOUND", "Reward di Reward Pool tidak ditemukan.", 404);
    }

    const given = oldGiven.get(item.rewardPoolId) ?? 0;
    if (item.quantity < given) {
      return errorResponse(
        "QUANTITY_BELOW_GIVEN",
        `Jumlah ${pool.reward_type} tidak boleh di bawah yang sudah diserahkan (${given}).`,
        409,
      );
    }

    const delta = item.quantity - (oldQty.get(item.rewardPoolId) ?? 0);
    if (delta > 0) {
      if (Number(pool.active) !== 1) {
        return errorResponse("REWARD_INACTIVE", `Reward ${pool.reward_type} sedang nonaktif.`, 409);
      }
      const free = Math.max(0, Number(pool.quota_total) - Number(pool.quota_used));
      if (delta > free) {
        return errorResponse(
          "QUANTITY_EXCEEDS_STOCK",
          `Jumlah ${pool.reward_type} melebihi stok tersedia (${free + (oldQty.get(item.rewardPoolId) ?? 0)}).`,
          409,
        );
      }
    }
  }

  const nowIso = new Date().toISOString();
  const statements = [env.DB.prepare(`DELETE FROM program_rewards`)];
  items.forEach((item, index) => {
    statements.push(
      env.DB.prepare(`
        INSERT INTO program_rewards (
          program_reward_id, reward_pool_id, quantity, given, position, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        `pr_${crypto.randomUUID()}`,
        item.rewardPoolId,
        item.quantity,
        oldGiven.get(item.rewardPoolId) ?? 0,
        index,
        nowIso,
        nowIso,
      ),
    );
  });
  for (const { rewardPoolId, delta } of deltas) {
    statements.push(
      env.DB.prepare(`
        UPDATE reward_pool
        SET quota_used = MAX(0, quota_used + ?),
            updated_at = ?
        WHERE reward_pool_id = ?
      `).bind(delta, nowIso, rewardPoolId),
    );
  }
  await env.DB.batch(statements);

  await writeAuditSafe(env, {
    entityType: "PROGRAM_REWARDS",
    entityId: "program",
    action: "UPDATE",
    actor: owner.userId,
    result: "SUCCESS",
  });

  return handleGet(request, env);
}

export async function handleProgramRewardsRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/owner/program-rewards") {
    if (request.method === "GET") return handleGet(request, env);
    if (request.method === "PUT") return handlePut(request, env);
  }

  if (url.pathname === "/staff/program-rewards" && request.method === "GET") {
    return handleStaffGet(request, env);
  }

  return errorResponse("NOT_FOUND", "Program rewards endpoint not found.", 404);
}
