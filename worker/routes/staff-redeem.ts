import type { Env } from "../index";

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

type CustomerRow = {
  customer_id: string;
  phone_masked: string;
};

/*
 * ============================================================
 * STAFF AUTH
 * ============================================================
 *
 * Temporary internal authentication context.
 * Final Auth/RBAC middleware will provide the authenticated
 * Staff identity and role.
 */

function getStaffId(
  request: Request,
): string | null {
  const value =
    request.headers.get(
      "X-Staff-ID",
    );

  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    return null;
  }

  return value.trim();
}

/*
 * ============================================================
 * RESPONSE HELPERS
 * ============================================================
 */

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

/*
 * ============================================================
 * GET /staff/scan/:token
 * ============================================================
 *
 * QR flow:
 *
 * Customer:
 *   WON → CLAIMED → QR
 *
 * Staff:
 *   Scan QR
 *      ↓
 *   Validate reward
 *      ↓
 *   Display reward + masked phone + status
 *
 * Redeem action is handled separately.
 */

export async function handleStaffScan(
  request: Request,
  env: Env,
  tokenRef: string,
): Promise<Response> {
  /*
   * ----------------------------------------------------------
   * 1. Staff authentication
   * ----------------------------------------------------------
   */

  const staffId =
    getStaffId(request);

  if (!staffId) {
    return errorResponse(
      "UNAUTHORIZED",
      "Staff authentication is required.",
      401,
    );
  }

  if (
    tokenRef.trim().length === 0
  ) {
    return errorResponse(
      "INVALID_REQUEST",
      "QR token is required.",
      400,
    );
  }

  /*
   * ----------------------------------------------------------
   * 2. Lookup reward by opaque token
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
        WHERE token_ref = ?
        LIMIT 1
        `,
      )
      .bind(
        tokenRef.trim(),
      )
      .first<RewardRow>();

  if (!reward) {
    return errorResponse(
      "REWARD_NOT_FOUND",
      "QR reward was not found.",
      404,
    );
  }

  /*
   * ----------------------------------------------------------
   * 3. Load masked customer phone
   * ----------------------------------------------------------
   *
   * Staff hanya mendapatkan masked phone.
   * Tidak mengembalikan nomor telepon penuh.
   */

  const customer =
    await env.DB
      .prepare(
        `
        SELECT
          customer_id,
          phone_masked
        FROM customers
        WHERE customer_id = ?
        LIMIT 1
        `,
      )
      .bind(
        reward.customer_id,
      )
      .first<CustomerRow>();

  if (!customer) {
    return errorResponse(
      "INTERNAL_ERROR",
      "Customer record was not found.",
      500,
    );
  }

  /*
   * ----------------------------------------------------------
   * 4. Validate reward lifecycle
   * ----------------------------------------------------------
   *
   * QR yang valid untuk proses Staff harus berasal
   * dari reward yang sudah CLAIMED.
   */

  const redeemable =
    reward.status === "CLAIMED";

  /*
   * ----------------------------------------------------------
   * 5. Return Staff Validation Page data
   * ----------------------------------------------------------
   */

  return json(
    {
      ok: true,
      reward: {
        rewardId:
          reward.reward_id,

        rewardType:
          reward.type,

        status:
          reward.status,

        phoneMasked:
          customer.phone_masked,

        tokenRef:
          reward.token_ref,

        claimedAt:
          reward.claimed_at,

        redeemedAt:
          reward.redeemed_at,

        usedAt:
          reward.used_at,

        redeemable,
      },
    },
    200,
  );
}

/*
 * ============================================================
 * POST /staff/redeem
 * ============================================================
 *
 * Valid Staff scan → automatic/explicit backend transition:
 *
 * CLAIMED → REDEEMED
 *
 * No customer input code.
 * No manual reward code entry.
 *
 * Atomic state transition prevents double redemption.
 */

type RedeemRequest = {
  tokenRef: string;
};

export async function handleStaffRedeem(
  request: Request,
  env: Env,
): Promise<Response> {
  /*
   * ----------------------------------------------------------
   * 1. Staff authentication
   * ----------------------------------------------------------
   */

  const staffId =
    getStaffId(request);

  if (!staffId) {
    return errorResponse(
      "UNAUTHORIZED",
      "Staff authentication is required.",
      401,
    );
  }

  /*
   * ----------------------------------------------------------
   * 2. Validate request
   * ----------------------------------------------------------
   */

  let body: RedeemRequest;

  try {
    body =
      await request.json() as RedeemRequest;
  } catch {
    return errorResponse(
      "INVALID_REQUEST",
      "Invalid JSON request body.",
      400,
    );
  }

  if (
    typeof body.tokenRef !==
      "string" ||
    body.tokenRef.trim()
      .length === 0
  ) {
    return errorResponse(
      "INVALID_REQUEST",
      "tokenRef is required.",
      400,
    );
  }

  const tokenRef =
    body.tokenRef.trim();

  /*
   * ----------------------------------------------------------
   * 3. Find reward
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
        WHERE token_ref = ?
        LIMIT 1
        `,
      )
      .bind(tokenRef)
      .first<RewardRow>();

  if (!reward) {
    return errorResponse(
      "REWARD_NOT_FOUND",
      "QR reward was not found.",
      404,
    );
  }

  /*
   * ----------------------------------------------------------
   * 4. Already redeemed = idempotent success
   * ----------------------------------------------------------
   */

  if (
    reward.status === "REDEEMED"
  ) {
    return json(
      {
        ok: true,
        reward: {
          rewardId:
            reward.reward_id,

          rewardType:
            reward.type,

          status:
            "REDEEMED",

          tokenRef:
            reward.token_ref,

          redeemedAt:
            reward.redeemed_at,
        },

        idempotent: true,
      },
      200,
    );
  }

  /*
   * ----------------------------------------------------------
   * 5. Reward must be CLAIMED
   * ----------------------------------------------------------
   */

  if (
    reward.status !== "CLAIMED"
  ) {
    return errorResponse(
      "INVALID_REWARD_STATE",
      "Reward is not available for redemption.",
      409,
    );
  }

  /*
   * ----------------------------------------------------------
   * 6. Atomic CLAIMED → REDEEMED
   * ----------------------------------------------------------
   *
   * Only one concurrent request can succeed.
   */

  const redeemedAt =
    new Date().toISOString();

  const updateResult =
    await env.DB
      .prepare(
        `
        UPDATE rewards
        SET
          status = 'REDEEMED',
          redeemed_at = ?
        WHERE reward_id = ?
          AND token_ref = ?
          AND status = 'CLAIMED'
        `,
      )
      .bind(
        redeemedAt,
        reward.reward_id,
        tokenRef,
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
            type,
            status,
            token_ref,
            redeemed_at
          FROM rewards
          WHERE reward_id = ?
          LIMIT 1
          `,
        )
        .bind(
          reward.reward_id,
        )
        .first<{
          reward_id: string;
          type: string;
          status: string;
          token_ref: string | null;
          redeemed_at: string | null;
        }>();

    if (
      current &&
      current.status ===
        "REDEEMED"
    ) {
      return json(
        {
          ok: true,
          reward: {
            rewardId:
              current.reward_id,

            rewardType:
              current.type,

            status:
              "REDEEMED",

            tokenRef:
              current.token_ref,

            redeemedAt:
              current.redeemed_at,
          },

          idempotent: true,
        },
        200,
      );
    }

    return errorResponse(
      "REDEEM_CONFLICT",
      "Reward could not be redeemed.",
      409,
    );
  }

  /*
   * ----------------------------------------------------------
   * 8. Success
   * ----------------------------------------------------------
   */

  return json(
    {
      ok: true,
      reward: {
        rewardId:
          reward.reward_id,

        rewardType:
          reward.type,

        status:
          "REDEEMED",

        tokenRef:
          reward.token_ref,

        redeemedAt,
      },
    },
    200,
  );
}

/*
 * ============================================================
 * ROUTER
 * ============================================================
 */

export async function handleStaffRedeemRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const url =
    new URL(request.url);

  /*
   * GET /staff/scan/:token
   */
  const scanMatch =
    url.pathname.match(
      /^\/staff\/scan\/([^/]+)$/,
    );

  if (
    request.method === "GET" &&
    scanMatch
  ) {
    return handleStaffScan(
      request,
      env,
      decodeURIComponent(
        scanMatch[1],
      ),
    );
  }

  /*
   * POST /staff/redeem
   */
  if (
    request.method === "POST" &&
    url.pathname ===
      "/staff/redeem"
  ) {
    return handleStaffRedeem(
      request,
      env,
    );
  }

  return errorResponse(
    "NOT_FOUND",
    "Staff redeem endpoint not found.",
    404,
  );
}
