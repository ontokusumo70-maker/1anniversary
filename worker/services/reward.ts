import type { Env } from "../index";

export type RewardAllocation = {
  rewardId: string;
  rewardType: string;
  tokenRef: string;
  status: "WON" | "CLAIMED" | "REDEEMED" | "USED";
  createdAt: string;
};

type RewardPoolRow = {
  reward_type: string;
  quota_total: number;
  quota_used: number;
  active: number;
};

type RewardRow = {
  reward_id: string;
  type: string;
  status: string;
  token_ref: string;
  created_at: string;
};

/**
 * ============================================================
 * REWARD SERVICE
 * ============================================================
 *
 * Baseline:
 * - Reward dipilih dari Reward Pool yang dikonfigurasi Owner.
 * - Quota ditegakkan server-side.
 * - Reward ID dibuat oleh server.
 * - token_ref bersifat opaque.
 * - Status awal reward = WON.
 *
 * Catatan:
 * Baseline tidak menetapkan weight/priority reward.
 * Karena itu service tidak membuat weight/priority baru.
 */

/**
 * Generate opaque reward token.
 *
 * Tidak menggunakan customer phone, customer ID,
 * play ID, atau data PII sebagai token yang ditampilkan.
 */
function generateTokenRef(): string {
  return crypto.randomUUID();
}

/**
 * Generate server-side Reward ID.
 */
function generateRewardId(playId: string): string {
  return `reward_${playId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 180)}`;
}

/**
 * Select one available Reward Pool.
 *
 * Karena schema baseline tidak memiliki weight/priority,
 * pool yang tersedia dipilih secara uniform random.
 */
function selectRandomPool(
  pools: RewardPoolRow[],
): RewardPoolRow | null {
  if (pools.length === 0) {
    return null;
  }

  const index =
    Math.floor(
      Math.random() * pools.length,
    );

  return pools[index] ?? null;
}

/**
 * Check whether a reward pool still has quota.
 */
function hasQuota(
  pool: RewardPoolRow,
): boolean {
  return (
    pool.active === 1 &&
    pool.quota_used <
      pool.quota_total
  );
}

/**
 * ============================================================
 * EXISTING REWARD
 * ============================================================
 *
 * Finish harus idempotent.
 * Jika reward sudah pernah dibuat untuk Play,
 * return reward tersebut daripada membuat duplicate.
 */
export async function getRewardByPlay(
  env: Env,
  playId: string,
): Promise<RewardAllocation | null> {
  const row =
    await env.DB
      .prepare(
        `
        SELECT
          reward_id,
          type,
          status,
          token_ref,
          created_at
        FROM rewards
        WHERE play_id = ?
        LIMIT 1
        `,
      )
      .bind(playId)
      .first<RewardRow>();

  if (!row) {
    return null;
  }

  return {
    rewardId: row.reward_id,
    rewardType: row.type,
    tokenRef: row.token_ref,
    status: row.status as RewardAllocation["status"],
    createdAt: row.created_at,
  };
}

/**
 * ============================================================
 * REWARD ALLOCATION
 * ============================================================
 *
 * Membuat reward dari Reward Pool.
 *
 * Penting:
 * Fungsi ini sengaja tidak menentukan jenis hadiah,
 * nominal hadiah, atau quota final.
 *
 * Semua itu berasal dari tabel reward_pool yang
 * dikonfigurasi Owner.
 */
export async function allocateReward(
  env: Env,
  playId: string,
  customerId: string,
): Promise<RewardAllocation> {
  /*
   * ----------------------------------------------------------
   * 1. Idempotency check
   * ----------------------------------------------------------
   *
   * Satu Play hanya boleh memiliki satu Reward.
   */
  const existing =
    await getRewardByPlay(
      env,
      playId,
    );

  if (existing) {
    return existing;
  }

  /*
   * ----------------------------------------------------------
   * 2. Load active pools with remaining quota
   * ----------------------------------------------------------
   */
  const result =
    await env.DB
      .prepare(
        `
        SELECT
          reward_type,
          quota_total,
          quota_used,
          active
        FROM reward_pool
        WHERE active = 1
          AND quota_used < quota_total
        ORDER BY reward_type ASC
        `,
      )
      .all<RewardPoolRow>();

  const pools =
    result.results ?? [];

  if (pools.length === 0) {
    throw new Error(
      "REWARD_POOL_EMPTY",
    );
  }

  /*
   * ----------------------------------------------------------
   * 3. Select available pool
   * ----------------------------------------------------------
   *
   * No hard-coded reward type.
   */
  const selectedPool =
    selectRandomPool(
      pools.filter(hasQuota),
    );

  if (!selectedPool) {
    throw new Error(
      "REWARD_POOL_EMPTY",
    );
  }

  const rewardType =
    selectedPool.reward_type;

  const rewardId =
    generateRewardId(playId);

  const tokenRef =
    generateTokenRef();

  const createdAt =
    new Date().toISOString();

  /*
   * ----------------------------------------------------------
   * 4. Atomic quota reservation
   * ----------------------------------------------------------
   *
   * quota_used hanya dinaikkan jika quota masih tersedia.
   *
   * Ini penting untuk mencegah quota negatif/over-quota
   * ketika beberapa request masuk bersamaan.
   */
  const quotaUpdate =
    await env.DB
      .prepare(
        `
        UPDATE reward_pool
        SET quota_used = quota_used + 1
        WHERE reward_type = ?
          AND active = 1
          AND quota_used < quota_total
        `,
      )
      .bind(rewardType)
      .run();

  if (
    quotaUpdate.meta.changes !== 1
  ) {
    /*
     * Pool yang dipilih kalah race condition.
     *
     * Retry dengan pool lain yang masih tersedia.
     */
    const retryResult =
      await env.DB
        .prepare(
          `
          SELECT
            reward_type,
            quota_total,
            quota_used,
            active
          FROM reward_pool
          WHERE active = 1
            AND quota_used < quota_total
          ORDER BY reward_type ASC
          `,
        )
        .all<RewardPoolRow>();

    const retryPools =
      retryResult.results ?? [];

    const retryPool =
      selectRandomPool(
        retryPools.filter(hasQuota),
      );

    if (!retryPool) {
      throw new Error(
        "REWARD_POOL_EMPTY",
      );
    }

    const retryUpdate =
      await env.DB
        .prepare(
          `
          UPDATE reward_pool
          SET quota_used = quota_used + 1
          WHERE reward_type = ?
            AND active = 1
            AND quota_used < quota_total
          `,
        )
        .bind(
          retryPool.reward_type,
        )
        .run();

    if (
      retryUpdate.meta.changes !== 1
    ) {
      throw new Error(
        "REWARD_POOL_BUSY",
      );
    }

    /*
     * Gunakan pool hasil retry.
     */
    const retryRewardType =
      retryPool.reward_type;

    try {
      await env.DB
        .prepare(
          `
          INSERT INTO rewards (
            reward_id,
            play_id,
            customer_id,
            type,
            status,
            token_ref,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .bind(
          rewardId,
          playId,
          customerId,
          retryRewardType,
          "WON",
          tokenRef,
          createdAt,
        )
        .run();
    } catch (error) {
      /*
       * Compensation jika insert reward gagal.
       */
      await env.DB
        .prepare(
          `
          UPDATE reward_pool
          SET quota_used =
            CASE
              WHEN quota_used > 0
              THEN quota_used - 1
              ELSE 0
            END
          WHERE reward_type = ?
            AND quota_used > 0
          `,
        )
        .bind(
          retryRewardType,
        )
        .run();

      throw error;
    }

    return {
      rewardId,
      rewardType:
        retryRewardType,
      tokenRef,
      status: "WON",
      createdAt,
    };
  }

  /*
   * ----------------------------------------------------------
   * 5. Create Reward
   * ----------------------------------------------------------
   */
  try {
    await env.DB
      .prepare(
        `
        INSERT INTO rewards (
          reward_id,
          play_id,
          customer_id,
          type,
          status,
          token_ref,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .bind(
        rewardId,
        playId,
        customerId,
        rewardType,
        "WON",
        tokenRef,
        createdAt,
      )
      .run();
  } catch (error) {
    /*
     * Jika Reward gagal dibuat setelah quota
     * berhasil dinaikkan, kembalikan quota.
     */
    await env.DB
      .prepare(
        `
        UPDATE reward_pool
        SET quota_used =
          CASE
            WHEN quota_used > 0
            THEN quota_used - 1
            ELSE 0
          END
        WHERE reward_type = ?
          AND quota_used > 0
        `,
      )
      .bind(rewardType)
      .run();

    throw error;
  }

  /*
   * ----------------------------------------------------------
   * 6. Return server-created Reward
   * ----------------------------------------------------------
   */
  return {
    rewardId,
    rewardType,
    tokenRef,
    status: "WON",
    createdAt,
  };
}
