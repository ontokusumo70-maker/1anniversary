import type { Env } from "../index";
import { writeAuditSafe } from "../audit/logger";
import { requireSession } from "../auth/session-guard";
import type { AuthSession } from "../auth/session-guard";

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

async function getStaffSession(
  request: Request,
  env: Env,
): Promise<AuthSession | null> {
  return requireSession(request, env, ["STAFF"]);
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
 * STAFF REDEEM
 * ============================================================
 */

export async function handleStaffRedeem(
  request: Request,
  env: Env,
): Promise<Response> {
  const staffSession =
    await getStaffSession(request, env);

  if (!staffSession) {
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
        actor: staffSession.userId,
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
