import type { Env } from "../index";

export type RewardAllocation = {
  rewardId: string;
  rewardPoolId: string;
  rewardType: string;
  tokenRef: string;
  status: "WON" | "CLAIMED" | "REDEEMED" | "USED";
  createdAt: string;
};

type RewardPoolRow = {
  reward_pool_id: string;
  reward_type: string;
  quota_total: number;
  quota_used: number;
  quota_claimed: number;
  active: number;
};

type RewardRow = {
  reward_id: string;
  reward_pool_id: string | null;
  type: string;
  status: string;
  token_ref: string;
  created_at: string;
};

function generateTokenRef(): string {
  return crypto.randomUUID();
}

function generateRewardId(playId: string): string {
  return `reward_${playId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 180)}`;
}

function selectRandomPool(
  pools: RewardPoolRow[],
): RewardPoolRow | null {
  if (pools.length === 0) return null;
  const index = Math.floor(Math.random() * pools.length);
  return pools[index] ?? null;
}

function hasQuota(pool: RewardPoolRow): boolean {
  return (
    pool.active === 1 &&
    pool.quota_claimed < pool.quota_used &&
    pool.quota_used <= pool.quota_total
  );
}

export async function getRewardByPlay(
  env: Env,
  playId: string,
): Promise<RewardAllocation | null> {
  const row = await env.DB
    .prepare(`
      SELECT
        reward_id,
        reward_pool_id,
        type,
        status,
        token_ref,
        created_at
      FROM rewards
      WHERE play_id = ?
      LIMIT 1
    `)
    .bind(playId)
    .first<RewardRow>();

  if (!row) return null;

  let rewardPoolId = String(row.reward_pool_id ?? "");
  if (!rewardPoolId) {
    const pool = await env.DB.prepare(`
      SELECT reward_pool_id
      FROM reward_pool
      WHERE reward_type = ?
      ORDER BY created_at ASC, reward_pool_id ASC
      LIMIT 1
    `).bind(row.type).first<{ reward_pool_id: string }>();
    rewardPoolId = String(pool?.reward_pool_id ?? "");
  }

  return {
    rewardId: row.reward_id,
    rewardPoolId,
    rewardType: row.type,
    tokenRef: row.token_ref,
    status: row.status as RewardAllocation["status"],
    createdAt: row.created_at,
  };
}

export async function allocateReward(
  env: Env,
  playId: string,
  customerId: string,
): Promise<RewardAllocation> {
  const existing = await getRewardByPlay(env, playId);
  if (existing) return existing;

  const nowIso = new Date().toISOString();

  /*
   * Reward pool is dedicated to an Event.
   * Only pools allocated to an event that is ACTIVE now
   * can be awarded by the game.
   *
   * quota_used    = quantity reserved/allocated to the event
   * quota_claimed = quantity already won/claimed by customers
   */
  const result = await env.DB
    .prepare(`
      SELECT DISTINCT
        rp.reward_pool_id,
        rp.reward_type,
        rp.quota_total,
        rp.quota_used,
        rp.quota_claimed,
        rp.active
      FROM reward_pool rp
      INNER JOIN event_rewards er
        ON er.reward_pool_id = rp.reward_pool_id
      INNER JOIN events e
        ON e.event_id = er.event_id
      WHERE rp.active = 1
        AND e.active = 1
        AND e.starts_at <= ?
        AND e.ends_at > ?
        AND rp.quota_claimed < rp.quota_used
      ORDER BY rp.reward_pool_id ASC
    `)
    .bind(nowIso, nowIso)
    .all<RewardPoolRow>();

  const pools = (result.results ?? []).filter(hasQuota);
  if (pools.length === 0) {
    throw new Error("REWARD_POOL_EMPTY");
  }

  const selectedPool = selectRandomPool(pools);
  if (!selectedPool) throw new Error("REWARD_POOL_EMPTY");

  const rewardId = generateRewardId(playId);
  const tokenRef = generateTokenRef();
  const createdAt = nowIso;

  const claimUpdate = await env.DB
    .prepare(`
      UPDATE reward_pool
      SET quota_claimed = quota_claimed + 1,
          updated_at = ?
      WHERE reward_pool_id = ?
        AND active = 1
        AND quota_claimed < quota_used
    `)
    .bind(createdAt, selectedPool.reward_pool_id)
    .run();

  if (claimUpdate.meta.changes !== 1) {
    throw new Error("REWARD_POOL_BUSY");
  }

  try {
    await env.DB
      .prepare(`
        INSERT INTO rewards (
          reward_id,
          play_id,
          customer_id,
          type,
          status,
          token_ref,
          created_at,
          reward_pool_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        rewardId,
        playId,
        customerId,
        selectedPool.reward_type,
        "WON",
        tokenRef,
        createdAt,
        selectedPool.reward_pool_id,
      )
      .run();
  } catch (error) {
    await env.DB
      .prepare(`
        UPDATE reward_pool
        SET quota_claimed =
          CASE
            WHEN quota_claimed > 0
            THEN quota_claimed - 1
            ELSE 0
          END,
          updated_at = ?
        WHERE reward_pool_id = ?
          AND quota_claimed > 0
      `)
      .bind(createdAt, selectedPool.reward_pool_id)
      .run();

    throw error;
  }

  return {
    rewardId,
    rewardPoolId: selectedPool.reward_pool_id,
    rewardType: selectedPool.reward_type,
    tokenRef,
    status: "WON",
    createdAt,
  };
}
