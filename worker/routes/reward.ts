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
        "Cache-Control": "no-store",
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
  /*
   * Temporary internal authentication context.
   * Final Auth/RBAC middleware will provide
   * the authenticated customer identity.
   */
  const value =
    request.headers.get(
      "X-Customer-ID",
    );

  return isNonEmptyString(value)
    ? value.trim()
    : null;
}

/*
 * ============================================================
 * GET /reward/:id
 * ============================================================
 *
 * Customer dapat reload detail reward miliknya.
 *
 * Security:
 * - Customer wajib authenticated.
 * - Reward wajib dimiliki Customer tersebut.
 * - Query menggunakan primary key reward_id.
 * - Tidak mengembalikan reward milik customer lain.
 */

export async function handleRewardDetail(
  request: Request,
  env: Env,
  rewardId: string,
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

  if (
    !isNonEmptyString(rewardId)
  ) {
    return errorResponse(
      "INVALID_REQUEST",
      "Reward ID is required.",
      400,
    );
  }

  const normalizedRewardId =
    rewardId.trim();

  /*
   * Query indexed primary key.
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
      .bind(
        normalizedRewardId,
      )
      .first<RewardRow>();

  if (!reward) {
    return errorResponse(
      "REWARD_NOT_FOUND",
      "Reward was not found.",
      404,
    );
  }

  /*
   * Ownership must be checked server-side.
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
   * Return only the reward information
   * required by the customer flow.
   *
   * token_ref is returned only after the
   * server has associated it with this customer.
   */
  return json(
    {
      ok: true,
      reward: {
        rewardId:
          reward.reward_id,
        playId:
          reward.play_id,
        type:
          reward.type,
        status:
          reward.status,
        tokenRef:
          reward.token_ref,
        createdAt:
          reward.created_at,
        claimedAt:
          reward.claimed_at,
        redeemedAt:
          reward.redeemed_at,
        usedAt:
          reward.used_at,
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

export async function handleRewardRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const url =
    new URL(request.url);

  const match =
    url.pathname.match(
      /^\/reward\/([^/]+)$/,
    );

  if (
    request.method === "GET" &&
    match
  ) {
    return handleRewardDetail(
      request,
      env,
      decodeURIComponent(
        match[1],
      ),
    );
  }

  return errorResponse(
    "NOT_FOUND",
    "Reward endpoint not found.",
    404,
  );
}
