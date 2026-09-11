import type { Env } from "../index";
import { writeAuditSafe } from "../audit/logger";

type RewardRow = {
  reward_id: string;
  customer_id: string;
  type: string;
  status: string;
  token_ref: string | null;
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

function getStaffId(
  request: Request,
): string | null {
  const value =
    request.headers.get(
      "X-Staff-ID",
    );

  return value?.trim()
    ? value.trim()
    : null;
}

function maskPhone(
  phone: string,
): string {
  if (phone.length <= 4) {
    return "****";
  }

  return (
    phone.slice(0, 2) +
    "****" +
    phone.slice(-2)
  );
}

/*
 * ============================================================
 * STAFF SCAN
 * ============================================================
 */

export async function handleStaffScan(
  request: Request,
  env: Env,
  token: string,
): Promise<Response> {
  const staffId =
    getStaffId(request);

  if (!staffId) {
    return errorResponse(
      "UNAUTHORIZED",
      "Staff authentication is required.",
      401,
    );
  }

  const tokenRef =
    token.trim();

  if (!tokenRef) {
    return errorResponse(
      "INVALID_REQUEST",
      "Token is required.",
      400,
    );
  }

  /*
   * ----------------------------------------------------------
   * 1. Lookup reward by opaque token
   * ----------------------------------------------------------
   */

  const reward =
    await env.DB
      .prepare(
        `
        SELECT
          reward_id,
          customer_id,
          type,
          status,
          token_ref,
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
      "Reward token was not found.",
      404,
    );
  }

  /*
   * ----------------------------------------------------------
   * 2. Customer lookup for masked phone
   * ----------------------------------------------------------
   */

  const customer =
    await env.DB
      .prepare(
        `
        SELECT phone
        FROM customers
        WHERE customer_id = ?
        LIMIT 1
        `,
      )
      .bind(
        reward.customer_id,
      )
      .first<{
        phone: string;
      }>();

  /*
   * ----------------------------------------------------------
   * 3. Determine redeemability
   * ----------------------------------------------------------
   */

  const redeemable =
    reward.status ===
    "CLAIMED";

  /*
   * ----------------------------------------------------------
   * 4. AUDIT: SCAN SUCCESS
   * ----------------------------------------------------------
   *
   * Scan berhasil karena:
   * - token ditemukan
   * - reward ditemukan
   * - customer terkait tersedia
   *
   * SCAN tidak mengubah status reward.
   */

  await writeAuditSafe(
    env,
    {
      entityType: "REWARD",
      entityId:
        reward.reward_id,
      action: "SCAN",
      actor: staffId,
      result: "SUCCESS",
    },
  );

  /*
   * ----------------------------------------------------------
   * 5. Response
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
        reward.status,
      redeemable,
      customer: {
        customerId:
          reward.customer_id,
        phone:
          customer?.phone
            ? maskPhone(
                customer.phone,
              )
            : null,
      },
      claimedAt:
        reward.claimed_at,
      redeemedAt:
        reward.redeemed_at,
      usedAt:
        reward.used_at,
    },
    200,
  );
}

/*
 * ============================================================
 * STAFF REDEEM
 * ============================================================
 */

export async function handleStaffRedeem(
  request: Request,
  env: Env,
): Promise<Response> {
  const staffId =
    getStaffId(request);

  if (!staffId) {
    return errorResponse(
      "UNAUTHORIZED",
      "Staff authentication is required.",
      401,
    );
  }

  let body: {
    rewardId: string;
  };

  try {
    body =
      await request.json() as {
        rewardId: string;
      };
  } catch {
    return errorResponse(
      "INVALID_REQUEST",
      "Invalid JSON request body.",
      400,
    );
  }

  if (
    typeof body.rewardId !==
      "string" ||
    !body.rewardId.trim()
  ) {
    return errorResponse(
      "INVALID_REQUEST",
      "rewardId is required.",
      400,
    );
  }

  const rewardId =
    body.rewardId.trim();

  /*
   * ----------------------------------------------------------
   * 1. Atomic CLAIMED → REDEEMED
   * ----------------------------------------------------------
   */

  const redeemedAt =
    new Date().toISOString();

  const result =
    await env.DB
      .prepare(
        `
        UPDATE rewards
        SET
          status = 'REDEEMED',
          redeemed_at = ?
        WHERE reward_id = ?
          AND status = 'CLAIMED'
        `,
      )
      .bind(
        redeemedAt,
        rewardId,
      )
      .run();

  /*
   * ----------------------------------------------------------
   * 2. Successful redeem
   * ----------------------------------------------------------
   */

  if (
    result.meta.changes === 1
  ) {
    await writeAuditSafe(
      env,
      {
        entityType: "REWARD",
        entityId: rewardId,
        action: "REDEEM",
        actor: staffId,
        result: "SUCCESS",
      },
    );

    return json(
      {
        ok: true,
        rewardId,
        status: "REDEEMED",
        redeemedAt,
      },
      200,
    );
  }

  /*
   * ----------------------------------------------------------
   * 3. Idempotent already redeemed
   * ----------------------------------------------------------
   */

  const reward =
    await env.DB
      .prepare(
        `
        SELECT
          reward_id,
          status,
          redeemed_at
        FROM rewards
        WHERE reward_id = ?
        LIMIT 1
        `,
      )
      .bind(rewardId)
      .first<{
        reward_id: string;
        status: string;
        redeemed_at: string | null;
      }>();

  if (
    reward &&
    reward.status ===
      "REDEEMED"
  ) {
    return json(
      {
        ok: true,
        rewardId:
          reward.reward_id,
        status:
          "REDEEMED",
        redeemedAt:
          reward.redeemed_at,
        idempotent: true,
      },
      200,
    );
  }

  return errorResponse(
    "INVALID_REWARD_STATE",
    "Reward is not redeemable.",
    409,
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

  if (
    request.method === "GET" &&
    url.pathname.startsWith(
      "/staff/scan/",
    )
  ) {
    const token =
      url.pathname.slice(
        "/staff/scan/".length,
      );

    return handleStaffScan(
      request,
      env,
      decodeURIComponent(token),
    );
  }

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
    "Staff endpoint not found.",
    404,
  );
}
