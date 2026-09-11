import type { Env } from "../index";
import { checkEligibility } from "../services/eligibility";

const GAME_DURATION_SECONDS = 15;

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

function json(
  data: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type":
        "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
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

function isValidScore(
  value: unknown,
): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    Number.isFinite(value) &&
    value >= 0
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

function getCustomerId(
  request: Request,
): string | null {
  /*
   * Auth/RBAC layer will provide the authenticated
   * Customer ID. This internal context header is
   * replaced by the final auth middleware integration.
   */
  const value =
    request.headers.get("X-Customer-ID");

  return isNonEmptyString(value)
    ? value.trim()
    : null;
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
  const customerId =
    getCustomerId(request);

  if (!customerId) {
    return errorResponse(
      "UNAUTHORIZED",
      "Customer authentication is required.",
      401,
    );
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
    !isNonEmptyString(
      body.transactionId,
    ) ||
    !isNonEmptyString(
      body.idempotencyKey,
    )
  ) {
    return errorResponse(
      "INVALID_REQUEST",
      "transactionId and idempotencyKey are required.",
      400,
    );
  }

  const transactionId =
    body.transactionId.trim();

  const idempotencyKey =
    body.idempotencyKey.trim();

  /*
   * Eligibility must be checked before creating
   * Play and Session.
   */
  const eligibility =
    await checkEligibility(
      env,
      customerId,
      transactionId,
    );

  if (!eligibility.eligible) {
    /*
     * Preserve idempotency for an already-created Play.
     */
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
          LIMIT 1
          `,
        )
        .bind(transactionId)
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
      `${customerId}_${transactionId}_${idempotencyKey}`,
    );

  const sessionId =
    makeDeterministicId(
      "session",
      playId,
    );

  const startedAt = new Date();

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
          customerId,
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
          LIMIT 1
          `,
        )
        .bind(transactionId)
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
 * FINISH VALIDATION
 * ============================================================
 */

async function handleFinish(
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

  /*
   * Validate request contract.
   */
  if (
    !isNonEmptyString(body.playId) ||
    !isNonEmptyString(body.sessionId) ||
    !isNonEmptyString(
      body.idempotencyKey,
    ) ||
    !body.result ||
    !isValidScore(
      body.result.score,
    )
  ) {
    return errorResponse(
      "INVALID_REQUEST",
      "playId, sessionId, result.score and idempotencyKey are required.",
      400,
    );
  }

  const playId =
    body.playId.trim();

  const sessionId =
    body.sessionId.trim();

  /*
   * Query through indexed primary/session keys.
   */
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

  /*
   * Play + Session must exist and match.
   */
  if (!play) {
    return errorResponse(
      "SESSION_NOT_FOUND",
      "Play or session was not found.",
      404,
    );
  }

  /*
   * Customer ownership validation.
   */
  if (
    play.customer_id !==
    customerId
  ) {
    return errorResponse(
      "FORBIDDEN",
      "Play does not belong to this customer.",
      403,
    );
  }

  /*
   * Idempotent Finish.
   */
  if (
    play.status === "COMPLETED" ||
    play.status === "WON"
  ) {
    return json(
      {
        ok: true,
        playId: play.play_id,
        status: play.status,
        idempotent: true,
      },
      200,
    );
  }

  /*
   * Session must still be active.
   */
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

  /*
   * Server validates actual session expiry.
   */
  const now =
    Date.now();

  const expiresAt =
    new Date(
      play.expires_at,
    ).getTime();

  if (
    !Number.isFinite(
      expiresAt,
    )
  ) {
    return errorResponse(
      "SESSION_NOT_FOUND",
      "Session expiry is invalid.",
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
          AND status = 'ACTIVE'
        `,
      )
      .bind(
        play.session_id,
      )
      .run();

    return errorResponse(
      "SESSION_EXPIRED",
      "Game session has expired.",
      409,
    );
  }

  /*
   * Server accepts the submitted score only as
   * validated game-result data.
   *
   * No winning threshold is invented here.
   * Reward determination remains server-side
   * in the Reward API stage.
   */
  const finishTime =
    new Date().toISOString();

  /*
   * Atomic state transition:
   * STARTED → COMPLETED
   *
   * This prevents two concurrent Finish requests
   * from completing the same Play twice.
   */
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
        customerId,
        play.session_id,
      )
      .run();

  if (
    updateResult.meta.changes !== 1
  ) {
    /*
     * Another request may have completed
     * the Play first. Re-read state.
     */
    const currentPlay =
      await env.DB
        .prepare(
          `
          SELECT
            play_id,
            status
          FROM plays
          WHERE play_id = ?
          LIMIT 1
          `,
        )
        .bind(
          play.play_id,
        )
        .first<{
          play_id: string;
          status: string;
        }>();

    if (
      currentPlay &&
      (
        currentPlay.status ===
          "COMPLETED" ||
        currentPlay.status ===
          "WON"
      )
    ) {
      return json(
        {
          ok: true,
          playId:
            currentPlay.play_id,
          status:
            currentPlay.status,
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

  /*
   * Close the session after successful Finish.
   */
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

  /*
   * Reward creation is intentionally NOT performed
   * here. It belongs to the Reward API stage,
   * where Reward Pool and atomic reward allocation
   * are handled server-side.
   */
  return json(
    {
      ok: true,
      playId: play.play_id,
      status: "COMPLETED",
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
