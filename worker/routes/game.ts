import type { Env } from "../index";
import { checkEligibility } from "../services/eligibility";
import {
  allocateReward,
  getRewardByPlay,
} from "../services/reward";
import { writeAuditSafe } from "../audit/logger";

const GAME_DURATION_SECONDS = 15;

const MAX_TRANSACTION_ID_LENGTH = 128;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const MAX_PLAY_ID_LENGTH = 200;
const MAX_SESSION_ID_LENGTH = 200;
const MAX_SCORE = 1_000_000_000;

type GameResult = {
  score: number;
};

type StartRequest = {
  transactionId: string;
  idempotencyKey: string;
};

type FinishRequest = {
  playId: string;
  sessionId: string;
  result: GameResult;
  idempotencyKey: string;
};

type AuthSession = {
  session_id: string;
  user_id: string;
  role: "CUSTOMER" | "STAFF" | "OWNER";
  expires_at: string;
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

function isBoundedString(
  value: unknown,
  maxLength: number,
): value is string {
  return (
    isNonEmptyString(value) &&
    value.trim().length <= maxLength
  );
}

function isValidScore(
  value: unknown,
): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_SCORE
  );
}

function makeDeterministicId(
  prefix: string,
  value: string,
): string {
  return `${prefix}_${value
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 180)}`;
}

async function hashToken(
  token: string,
): Promise<string> {
  const data =
    new TextEncoder().encode(token);

  const digest =
    await crypto.subtle.digest(
      "SHA-256",
      data,
    );

  return Array.from(
    new Uint8Array(digest),
    (byte) =>
      byte.toString(16).padStart(2, "0"),
  ).join("");
}

function getBearerToken(
  request: Request,
): string | null {
  const authorization =
    request.headers.get(
      "Authorization",
    );

  if (!authorization) {
    return null;
  }

  const match =
    authorization.match(
      /^Bearer\s+([A-Za-z0-9_-]{20,256})$/i,
    );

  return match
    ? match[1]
    : null;
}

async function requireCustomer(
  request: Request,
  env: Env,
): Promise<
  | {
      ok: true;
      userId: string;
      sessionId: string;
    }
  | {
      ok: false;
      response: Response;
    }
> {
  const token =
    getBearerToken(request);

  if (!token) {
    return {
      ok: false,
      response: errorResponse(
        "UNAUTHORIZED",
        "Customer authentication is required.",
        401,
      ),
    };
  }

  const tokenHash =
    await hashToken(token);

  const session =
    await env.DB
      .prepare(
        `
        SELECT
          session_id,
          user_id,
          role,
          expires_at
        FROM auth_sessions
        WHERE token_hash = ?
          AND revoked_at IS NULL
          AND expires_at > ?
        LIMIT 1
        `,
      )
      .bind(
        tokenHash,
        new Date().toISOString(),
      )
      .first<AuthSession>();

  if (!session) {
    return {
      ok: false,
      response: errorResponse(
        "UNAUTHORIZED",
        "Authentication session is invalid or expired.",
        401,
      ),
    };
  }

  if (
    session.role !== "CUSTOMER"
  ) {
    return {
      ok: false,
      response: errorResponse(
        "FORBIDDEN",
        "Customer role is required.",
        403,
      ),
    };
  }

  return {
    ok: true,
    userId:
      session.user_id,
    sessionId:
      session.session_id,
  };
}

/*
 * ============================================================
 * START
 * ============================================================
 */

async function handleStart(
  request: Request,
  env: Env,
): Promise<Response> {
  const auth =
    await requireCustomer(
      request,
      env,
    );

  if (!auth.ok) {
    return auth.response;
  }

  let body: StartRequest;

  try {
    body =
      await request.json() as StartRequest;
  } catch {
    return errorResponse(
      "INVALID_REQUEST",
      "Invalid JSON request body.",
      400,
    );
  }

  if (
    !isBoundedString(
      body.transactionId,
      MAX_TRANSACTION_ID_LENGTH,
    ) ||
    !isBoundedString(
      body.idempotencyKey,
      MAX_IDEMPOTENCY_KEY_LENGTH,
    )
  ) {
    return errorResponse(
      "INVALID_REQUEST",
      "transactionId and idempotencyKey are required and must be valid.",
      400,
    );
  }

  const transactionId =
    body.transactionId.trim();

  const idempotencyKey =
    body.idempotencyKey.trim();

  const eligibility =
    await checkEligibility(
      env,
      auth.userId,
      transactionId,
    );

  if (!eligibility.eligible) {
    const existingPlay =
      await env.DB
        .prepare(
          `
          SELECT
            play_id,
            session_id,
            status
          FROM plays
          WHERE transaction_id = ?
            AND customer_id = ?
          LIMIT 1
          `,
        )
        .bind(
          transactionId,
          auth.userId,
        )
        .first<{
          play_id: string;
          session_id: string | null;
          status: string;
        }>();

    if (
      eligibility.reason ===
        "TRANSACTION_ALREADY_PLAYED" &&
      existingPlay
    ) {
      return json(
        {
          ok: true,
          playId:
            existingPlay.play_id,
          sessionId:
            existingPlay.session_id,
          status:
            existingPlay.status,
          idempotent: true,
        },
        200,
      );
    }

    if (
      eligibility.reason ===
      "TRANSACTION_NOT_FOUND"
    ) {
      return errorResponse(
        "NOT_ELIGIBLE",
        "Transaction was not found.",
        403,
      );
    }

    if (
      eligibility.reason ===
      "TRANSACTION_NOT_OWNED"
    ) {
      return errorResponse(
        "FORBIDDEN",
        "Transaction does not belong to this customer.",
        403,
      );
    }

    if (
      eligibility.reason ===
      "CAMPAIGN_NOT_ACTIVE"
    ) {
      return errorResponse(
        "NOT_ELIGIBLE",
        "Campaign is not currently active.",
        403,
      );
    }

    return errorResponse(
      "NOT_ELIGIBLE",
      "Customer is not eligible to start the game.",
      403,
    );
  }

  const playId =
    makeDeterministicId(
      "play",
      `${auth.userId}_${transactionId}`,
    );

  const sessionId =
    makeDeterministicId(
      "session",
      playId,
    );

  const startedAt =
    new Date();

  const expiresAt =
    new Date(
      startedAt.getTime() +
        GAME_DURATION_SECONDS * 1000,
    );

  try {
    await env.DB.batch([
      env.DB
        .prepare(
          `
          INSERT INTO plays (
            play_id,
            customer_id,
            transaction_id,
            session_id,
            status,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?)
          `,
        )
        .bind(
          playId,
          auth.userId,
          transactionId,
          sessionId,
          "STARTED",
          startedAt.toISOString(),
        ),

      env.DB
        .prepare(
          `
          INSERT INTO sessions (
            session_id,
            play_id,
            started_at,
            expires_at,
            status
          )
          VALUES (?, ?, ?, ?, ?)
          `,
        )
        .bind(
          sessionId,
          playId,
          startedAt.toISOString(),
          expiresAt.toISOString(),
          "ACTIVE",
        ),
    ]);
  } catch (error) {
    console.error(
      "START transaction failed:",
      error,
    );

    const concurrentPlay =
      await env.DB
        .prepare(
          `
          SELECT
            play_id,
            session_id,
            status
          FROM plays
          WHERE transaction_id = ?
            AND customer_id = ?
          LIMIT 1
          `,
        )
        .bind(
          transactionId,
          auth.userId,
        )
        .first<{
          play_id: string;
          session_id: string | null;
          status: string;
        }>();

    if (concurrentPlay) {
      return json(
        {
          ok: true,
          playId:
            concurrentPlay.play_id,
          sessionId:
            concurrentPlay.session_id,
          status:
            concurrentPlay.status,
          idempotent: true,
        },
        200,
      );
    }

    return errorResponse(
      "INTERNAL_ERROR",
      "Unable to start game.",
      500,
    );
  }

  await writeAuditSafe(
    env,
    {
      entityType: "PLAY",
      entityId: playId,
      action: "START",
      actor: auth.userId,
      result: "SUCCESS",
    },
  );

  return json(
    {
      ok: true,
      playId,
      sessionId,
      startedAt:
        startedAt.toISOString(),
      expiresAt:
        expiresAt.toISOString(),
    },
    201,
  );
}

/*
 * ============================================================
 * FINISH
 * ============================================================
 */

async function handleFinish(
  request: Request,
  env: Env,
): Promise<Response> {
  const auth =
    await requireCustomer(
      request,
      env,
    );

  if (!auth.ok) {
    return auth.response;
  }

  let body: FinishRequest;

  try {
    body =
      await request.json() as FinishRequest;
  } catch {
    return errorResponse(
      "INVALID_REQUEST",
      "Invalid JSON request body.",
      400,
    );
  }

  if (
    !isBoundedString(
      body.playId,
      MAX_PLAY_ID_LENGTH,
    ) ||
    !isBoundedString(
      body.sessionId,
      MAX_SESSION_ID_LENGTH,
    ) ||
    !isBoundedString(
      body.idempotencyKey,
      MAX_IDEMPOTENCY_KEY_LENGTH,
    ) ||
    !body.result ||
    !isValidScore(
      body.result.score,
    )
  ) {
    return errorResponse(
      "INVALID_REQUEST",
      "playId, sessionId, result.score and idempotencyKey are required and must be valid.",
      400,
    );
  }

  const playId =
    body.playId.trim();

  const sessionId =
    body.sessionId.trim();

  const play =
    await env.DB
      .prepare(
        `
        SELECT
          p.play_id,
          p.customer_id,
          p.session_id,
          p.status,
          p.finished_at,
          s.started_at,
          s.expires_at,
          s.status AS session_status
        FROM plays p
        INNER JOIN sessions s
          ON s.session_id = p.session_id
        WHERE p.play_id = ?
          AND p.session_id = ?
        LIMIT 1
        `,
      )
      .bind(
        playId,
        sessionId,
      )
      .first<{
        play_id: string;
        customer_id: string;
        session_id: string;
        status: string;
        finished_at: string | null;
        started_at: string;
        expires_at: string;
        session_status: string;
      }>();

  if (!play) {
    return errorResponse(
      "SESSION_NOT_FOUND",
      "Play or session was not found.",
      404,
    );
  }

  if (
    play.customer_id !==
    auth.userId
  ) {
    return errorResponse(
      "FORBIDDEN",
      "Play does not belong to this customer.",
      403,
    );
  }

  const existingReward =
    await getRewardByPlay(
      env,
      play.play_id,
    );

  if (existingReward) {
    return json(
      {
        ok: true,
        playId:
          play.play_id,
        status:
          existingReward.status,
        rewardId:
          existingReward.rewardId,
        rewardType:
          existingReward.rewardType,
        tokenRef:
          existingReward.tokenRef,
        idempotent: true,
      },
      200,
    );
  }

  if (
    play.status === "COMPLETED" ||
    play.status === "WON"
  ) {
    return errorResponse(
      "PLAY_ALREADY_FINISHED",
      "Play has already finished but no reward is available.",
      409,
    );
  }

  if (
    play.session_status !==
    "ACTIVE"
  ) {
    return errorResponse(
      "SESSION_EXPIRED",
      "Game session is no longer active.",
      409,
    );
  }

  const now =
    Date.now();

  const startedAt =
    new Date(
      play.started_at,
    ).getTime();

  const expiresAt =
    new Date(
      play.expires_at,
    ).getTime();

  if (
    !Number.isFinite(
      startedAt,
    ) ||
    !Number.isFinite(
      expiresAt,
    )
  ) {
    return errorResponse(
      "SESSION_NOT_FOUND",
      "Session timestamps are invalid.",
      500,
    );
  }

  if (
    now > expiresAt
  ) {
    await env.DB
      .prepare(
        `
        UPDATE sessions
        SET status = 'EXPIRED'
        WHERE session_id = ?
          AND play_id = ?
          AND status = 'ACTIVE'
        `,
      )
      .bind(
        play.session_id,
        play.play_id,
      )
      .run();

    return errorResponse(
      "SESSION_EXPIRED",
      "Game session has expired.",
      409,
    );
  }

  const minimumFinishAt =
    startedAt +
    GAME_DURATION_SECONDS * 1000;

  if (
    now < minimumFinishAt
  ) {
    return errorResponse(
      "INVALID_REQUEST",
      "Game session has not reached the required 15-second duration.",
      409,
    );
  }

  let reward;

  try {
    reward =
      await allocateReward(
        env,
        play.play_id,
        play.customer_id,
      );
  } catch (error) {
    console.error(
      "Reward allocation failed:",
      error,
    );

    const message =
      error instanceof Error
        ? error.message
        : "UNKNOWN_ERROR";

    const concurrentReward = await getRewardByPlay(env, play.play_id);
    if (concurrentReward) {
      return json({
        ok: true,
        playId: play.play_id,
        status: concurrentReward.status,
        rewardId: concurrentReward.rewardId,
        rewardType: concurrentReward.rewardType,
        tokenRef: concurrentReward.tokenRef,
        idempotent: true,
      }, 200);
    }

    if (
      message ===
      "REWARD_POOL_EMPTY"
    ) {
      return errorResponse(
        "INTERNAL_ERROR",
        "No reward is currently available.",
        503,
      );
    }

    return errorResponse(
      "INTERNAL_ERROR",
      "Unable to allocate reward.",
      500,
    );
  }

  const finishTime =
    new Date().toISOString();

  const updateResult =
    await env.DB
      .prepare(
        `
        UPDATE plays
        SET
          status = 'COMPLETED',
          finished_at = ?
        WHERE play_id = ?
          AND customer_id = ?
          AND session_id = ?
          AND status = 'STARTED'
        `,
      )
      .bind(
        finishTime,
        play.play_id,
        auth.userId,
        play.session_id,
      )
      .run();

  if (
    updateResult.meta.changes !== 1
  ) {
    const currentReward =
      await getRewardByPlay(
        env,
        play.play_id,
      );

    if (currentReward) {
      return json(
        {
          ok: true,
          playId:
            play.play_id,
          status:
            currentReward.status,
          rewardId:
            currentReward.rewardId,
          rewardType:
            currentReward.rewardType,
          tokenRef:
            currentReward.tokenRef,
          idempotent: true,
        },
        200,
      );
    }

    return errorResponse(
      "PLAY_ALREADY_FINISHED",
      "Play could not be completed.",
      409,
    );
  }

  await env.DB
    .prepare(
      `
      UPDATE sessions
      SET status = 'COMPLETED'
      WHERE session_id = ?
        AND play_id = ?
        AND status = 'ACTIVE'
      `,
    )
    .bind(
      play.session_id,
      play.play_id,
    )
    .run();

  await writeAuditSafe(
    env,
    {
      entityType: "PLAY",
      entityId: play.play_id,
      action: "FINISH",
      actor: auth.userId,
      result: "SUCCESS",
    },
  );

  return json(
    {
      ok: true,
      playId:
        play.play_id,
      status:
        reward.status,
      rewardId:
        reward.rewardId,
      rewardType:
        reward.rewardType,
      tokenRef:
        reward.tokenRef,
    },
    200,
  );
}

/*
 * ============================================================
 * ROUTER
 * ============================================================
 */

export async function handleGameRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const url =
    new URL(request.url);

  if (
    request.method === "POST" &&
    url.pathname === "/start"
  ) {
    return handleStart(
      request,
      env,
    );
  }

  if (
    request.method === "POST" &&
    url.pathname === "/finish"
  ) {
    return handleFinish(
      request,
      env,
    );
  }

  return errorResponse(
    "NOT_FOUND",
    "Game endpoint not found.",
    404,
  );
}
