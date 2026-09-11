import type { Env } from "../index";
import { writeAuditSafe } from "../audit/logger";

type ClaimRequest = {
  rewardId: string;
  idempotencyKey: string;
};

type RewardRow = {
  reward_id: string;
  play_id: string;
  customer_id: string;
  type: string;
  status: string;
  token_ref: string | null;
  created_at: string;
  claimed_at: string | null;
  redeemed_at: string | null;
  used_at: string | null;
};

function json(
  data: unknown,
  status = 200,
): Response {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type":
          "application/json; charset=utf-8",
        "Cache-Control":
          "no-store",
      },
    },
  );
}

function errorResponse(
  error: string,
  message: string,
  status: number,
): Response {
  return json(
    {
      ok: false,
      error,
      message,
    },
    status,
  );
}

function isNonEmptyString(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
}

function getCustomerId(
  request: Request,
): string | null {
  const value =
    request.headers.get(
      "X-Customer-ID",
    );

  return isNonEmptyString(value)
    ? value.trim()
    : null;
}

function generateTokenRef(): string {
  return crypto.randomUUID();
}

/*
 * ============================================================
 * CLAIM REWARD
 * ============================================================
 */

export async function handleClaim(
  request: Request,
  env: Env,
): Promise<Response> {
  const customerId =
    getCustomerId(request);

  if (!customerId) {
    return errorResponse(
      "UNAUTHORIZED",
      "Customer authentication is required.",
      401,
    );
  }

  let body: ClaimRequest;

  try {
    body =
      await request.json() as ClaimRequest;
  } catch {
    return errorResponse(
      "INVALID_REQUEST",
      "Invalid JSON request body.",
      400,
    );
  }

  if (
    !isNonEmptyString(
      body.rewardId,
    ) ||
    !isNonEmptyString(
      body.idempotencyKey,
    )
  ) {
    return errorResponse(
      "INVALID_REQUEST",
      "rewardId and idempotencyKey are required.",
      400,
    );
  }

  const rewardId =
    body.rewardId.trim();

  const idempotencyKey =
    body.idempotencyKey.trim();

  /*
   * idempotencyKey tetap menjadi bagian contract.
   * State reward digunakan sebagai authoritative
   * idempotency guard.
   */
  void idempotencyKey;

  /*
   * ----------------------------------------------------------
   * 1. Load Reward
   * ----------------------------------------------------------
   */

  const reward =
    await env.DB
      .prepare(
        `
        SELECT
          reward_id,
          play_id,
          customer_id,
          type,
          status,
          token_ref,
          created_at,
          claimed_at,
          redeemed_at,
          used_at
        FROM rewards
        WHERE reward_id = ?
        LIMIT 1
        `,
      )
      .bind(rewardId)
      .first<RewardRow>();

  if (!reward) {
    return errorResponse(
      "REWARD_NOT_FOUND",
      "Reward was not found.",
      404,
    );
  }

  /*
   * ----------------------------------------------------------
   * 2. Ownership
   * ----------------------------------------------------------
   */

  if (
    reward.customer_id !==
    customerId
  ) {
    return errorResponse(
      "FORBIDDEN",
      "Reward does not belong to this customer.",
      403,
    );
  }

  /*
   * ----------------------------------------------------------
   * 3. Already claimed
   * ----------------------------------------------------------
   *
   * Retry tidak membuat token baru.
   *
   * Audit tidak ditulis lagi karena state transition
   * sudah terjadi pada request sebelumnya.
   */

  if (
    reward.status === "CLAIMED"
  ) {
    if (!reward.token_ref) {
      return errorResponse(
        "INTERNAL_ERROR",
        "Claimed reward has no token reference.",
        500,
      );
    }

    return json(
      {
        ok: true,
        rewardId:
          reward.reward_id,
        rewardType:
          reward.type,
        status:
          "CLAIMED",
        tokenRef:
          reward.token_ref,
        claimedAt:
          reward.claimed_at,
        idempotent: true,
      },
      200,
    );
  }

  /*
   * ----------------------------------------------------------
   * 4. Invalid lifecycle
   * ----------------------------------------------------------
   */

  if (
    reward.status === "REDEEMED" ||
    reward.status === "USED"
  ) {
    return errorResponse(
      "INVALID_REWARD_STATE",
      "Reward can no longer be claimed.",
      409,
    );
  }

  if (
    reward.status !== "WON"
  ) {
    return errorResponse(
      "INVALID_REWARD_STATE",
      "Reward is not available for claim.",
      409,
    );
  }

  /*
   * ----------------------------------------------------------
   * 5. Generate opaque token
   * ----------------------------------------------------------
   */

  const tokenRef =
    reward.token_ref ??
    generateTokenRef();

  const claimedAt =
    new Date().toISOString();

  /*
   * ----------------------------------------------------------
   * 6. Atomic WON → CLAIMED
   * ----------------------------------------------------------
   */

  const updateResult =
    await env.DB
      .prepare(
        `
        UPDATE rewards
        SET
          status = 'CLAIMED',
          token_ref = ?,
          claimed_at = ?
        WHERE reward_id = ?
          AND customer_id = ?
          AND status = 'WON'
        `,
      )
      .bind(
        tokenRef,
        claimedAt,
        reward.reward_id,
        customerId,
      )
      .run();

  /*
   * ----------------------------------------------------------
   * 7. Race-condition protection
   * ----------------------------------------------------------
   */

  if (
    updateResult.meta.changes !== 1
  ) {
    const current =
      await env.DB
        .prepare(
          `
          SELECT
            reward_id,
            play_id,
            customer_id,
            type,
            status,
            token_ref,
            created_at,
            claimed_at,
            redeemed_at,
            used_at
          FROM rewards
          WHERE reward_id = ?
          LIMIT 1
          `,
        )
        .bind(
          reward.reward_id,
        )
        .first<RewardRow>();

    if (
      current &&
      current.customer_id ===
        customerId &&
      current.status ===
        "CLAIMED" &&
      current.token_ref
    ) {
      return json(
        {
          ok: true,
          rewardId:
            current.reward_id,
          rewardType:
            current.type,
          status:
            "CLAIMED",
          tokenRef:
            current.token_ref,
          claimedAt:
            current.claimed_at,
          idempotent: true,
        },
        200,
      );
    }

    return errorResponse(
      "INVALID_REWARD_STATE",
      "Reward could not be claimed.",
      409,
    );
  }

  /*
   * ----------------------------------------------------------
   * 8. AUDIT: CLAIM SUCCESS
   * ----------------------------------------------------------
   */

  await writeAuditSafe(
    env,
    {
      entityType: "REWARD",
      entityId:
        reward.reward_id,
      action: "CLAIM",
      actor: customerId,
      result: "SUCCESS",
    },
  );

  /*
   * ----------------------------------------------------------
   * 9. Success
   * ----------------------------------------------------------
   */

  return json(
    {
      ok: true,
      rewardId:
        reward.reward_id,
      rewardType:
        reward.type,
      status:
        "CLAIMED",
      tokenRef,
      claimedAt,
    },
    200,
  );
}

/*
 * ============================================================
 * ROUTER
 * ============================================================
 */

export async function handleClaimRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const url =
    new URL(request.url);

  if (
    request.method === "POST" &&
    url.pathname === "/claim"
  ) {
    return handleClaim(
      request,
      env,
    );
  }

  return errorResponse(
    "NOT_FOUND",
    "Claim endpoint not found.",
    404,
  );
}
