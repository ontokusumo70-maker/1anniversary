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

type AuthSessionRow = {
  session_id: string;
  user_id: string;
  role: string;
  expires_at: string;
  revoked_at: string | null;
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

function getBearerToken(
  request: Request,
): string | null {
  const header =
    request.headers.get(
      "Authorization",
    );

  if (!header) {
    return null;
  }

  const match =
    header.match(
      /^Bearer\s+(.+)$/i,
    );

  if (!match) {
    return null;
  }

  const token =
    match[1].trim();

  return token.length > 0
    ? token
    : null;
}

async function sha256Hex(
  value: string,
): Promise<string> {
  const encoded =
    new TextEncoder().encode(value);

  const digest =
    await crypto.subtle.digest(
      "SHA-256",
      encoded,
    );

  return Array.from(
    new Uint8Array(digest),
  )
    .map((byte) =>
      byte
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");
}

async function authenticateCustomer(
  request: Request,
  env: Env,
): Promise<string | null> {
  const token =
    getBearerToken(request);

  if (!token) {
    return null;
  }

  const tokenHash =
    await sha256Hex(token);

  const session =
    await env.DB
      .prepare(
        `
        SELECT
          session_id,
          user_id,
          role,
          expires_at,
          revoked_at
        FROM auth_sessions
        WHERE token_hash = ?
        LIMIT 1
        `,
      )
      .bind(tokenHash)
      .first<AuthSessionRow>();

  if (!session) {
    return null;
  }

  if (
    session.revoked_at !== null
  ) {
    return null;
  }

  if (
    session.role !== "CUSTOMER"
  ) {
    return null;
  }

  const expiresAt =
    Date.parse(
      session.expires_at,
    );

  if (
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now()
  ) {
    return null;
  }

  return session.user_id;
}

function generateTokenRef(): string {
  return crypto.randomUUID();
}

export async function handleClaim(
  request: Request,
  env: Env,
): Promise<Response> {
  const customerId =
    await authenticateCustomer(
      request,
      env,
    );

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

  if (
    rewardId.length > 128 ||
    idempotencyKey.length > 128
  ) {
    return errorResponse(
      "INVALID_REQUEST",
      "Request value is too long.",
      400,
    );
  }

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
    );
  }

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

  void idempotencyKey;

  const tokenRef =
    generateTokenRef();

  const claimedAt =
    new Date().toISOString();

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
      );
    }

    return errorResponse(
      "INVALID_REWARD_STATE",
      "Reward could not be claimed.",
      409,
    );
  }

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
  );
}

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
