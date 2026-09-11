/*
 * ============================================================
 * OWNER CSV EXPORT ROUTE
 * Teras Laundry 1st Anniversary
 *
 * 3.9.4
 *
 * Endpoint:
 * GET /owner/export
 *
 * Authorization:
 * OWNER ONLY
 *
 * Supported export:
 * - customers
 * - plays
 * - rewards
 * - audit
 *
 * Filter:
 * - from
 * - to
 *
 * Pagination:
 * - limit
 * - offset
 *
 * Security:
 * - tidak export phone_hash
 * - tidak menghasilkan raw QR secret
 * - token_ref hanya sebagai safe reference
 * - setiap export sukses dicatat ke audit
 * ============================================================
 */

import type { Env } from "../index";
import { requireSession } from "../auth/session-guard";

import {
  buildCsv,
} from "../csv/export";

import {
  buildPagination,
  queryCustomers,
  queryPlays,
  queryRewards,
  queryAudit,
  validateExportRange,
} from "../csv/query";

import {
  writeAuditSafe,
} from "../audit/logger";

export type ExportType =
  | "customers"
  | "plays"
  | "rewards"
  | "audit";

export type OwnerExportRequest = {
  type: ExportType;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
};

const JSON_HEADERS = {
  "Content-Type":
    "application/json; charset=utf-8",
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
        ...JSON_HEADERS,
        "Cache-Control":
          "no-store",
      },
    },
  );
}

function isExportType(
  value: string | null,
): value is ExportType {
  return (
    value === "customers" ||
    value === "plays" ||
    value === "rewards" ||
    value === "audit"
  );
}

export function normalizeExportRequest(
  input: {
    type?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  },
): OwnerExportRequest {
  const type =
    input.type;

  if (!type || !isExportType(type)) {
    throw new Error(
      "INVALID_EXPORT_TYPE",
    );
  }

  if (
    !validateExportRange(
      input.from,
      input.to,
    )
  ) {
    throw new Error(
      "INVALID_EXPORT_RANGE",
    );
  }

  const pagination =
    buildPagination(
      input.limit,
      input.offset,
    );

  return {
    type,
    from: input.from,
    to: input.to,
    limit: pagination.limit,
    offset: pagination.offset,
  };
}

export function buildExportFilename(
  from?: string,
  to?: string,
): string {
  const fromPart =
    from
      ? from.slice(0, 10)
      : "all";

  const toPart =
    to
      ? to.slice(0, 10)
      : "all";

  return (
    "teras-laundry-owner-export-" +
    `${fromPart}-${toPart}.csv`
  );
}

function parseOptionalNumber(
  value: string | null,
): number | undefined {
  if (
    value === null ||
    value.trim() === ""
  ) {
    return undefined;
  }

  const parsed =
    Number(value);

  if (
    !Number.isFinite(parsed)
  ) {
    throw new Error(
      "INVALID_PAGINATION",
    );
  }

  return parsed;
}

function csvResponse(
  csv: string,
  filename: string,
): Response {
  return new Response(
    csv,
    {
      status: 200,
      headers: {
        "Content-Type":
          "text/csv; charset=utf-8",
        "Content-Disposition":
          `attachment; filename="${filename}"`,
        "Cache-Control":
          "no-store",
        "X-Content-Type-Options":
          "nosniff",
      },
    },
  );
}

export async function handleOwnerExportRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  if (
    request.method !== "GET" ||
    new URL(request.url).pathname !==
      "/owner/export"
  ) {
    return json(
      {
        ok: false,
        error: "NOT_FOUND",
        message:
          "Endpoint not found.",
      },
      404,
    );
  }

  const ownerSession =
    await requireSession(request, env, ["OWNER"]);

  if (!ownerSession) {
    return json(
      {
        ok: false,
        error: "UNAUTHORIZED",
        message:
          "Owner authentication required.",
      },
      401,
    );
  }

  const url =
    new URL(request.url);

  let exportRequest:
    OwnerExportRequest;

  try {
    exportRequest =
      normalizeExportRequest({
        type:
          url.searchParams.get(
            "type",
          ) ?? undefined,

        from:
          url.searchParams.get(
            "from",
          ) ?? undefined,

        to:
          url.searchParams.get(
            "to",
          ) ?? undefined,

        limit:
          parseOptionalNumber(
            url.searchParams.get(
              "limit",
            ),
          ),

        offset:
          parseOptionalNumber(
            url.searchParams.get(
              "offset",
            ),
          ),
      });
  } catch (error) {
    const code =
      error instanceof Error
        ? error.message
        : "INVALID_REQUEST";

    if (
      code ===
      "INVALID_EXPORT_TYPE"
    ) {
      return json(
        {
          ok: false,
          error:
            "INVALID_REQUEST",
          message:
            "Invalid export type.",
        },
        400,
      );
    }

    if (
      code ===
      "INVALID_EXPORT_RANGE"
    ) {
      return json(
        {
          ok: false,
          error:
            "INVALID_REQUEST",
          message:
            "Invalid export date range.",
        },
        400,
      );
    }

    return json(
      {
        ok: false,
        error:
          "INVALID_REQUEST",
        message:
          "Invalid export request.",
      },
      400,
    );
  }

  try {
    let csv = "";

    if (
      exportRequest.type ===
      "customers"
    ) {
      const rows =
        await queryCustomers(
          env,
          exportRequest,
          {
            limit:
              exportRequest.limit,
            offset:
              exportRequest.offset,
          },
        );

      csv =
        buildCsv(
          [
            "customer_id",
            "phone_masked",
            "created_at",
            "total_play",
            "total_reward",
            "total_redeemed",
          ],
          rows.map(
            (row) => [
              row.customer_id,
              row.phone_masked,
              row.created_at,
              row.total_play,
              row.total_reward,
              row.total_redeemed,
            ],
          ),
        );
    }

    if (
      exportRequest.type ===
      "plays"
    ) {
      const rows =
        await queryPlays(
          env,
          exportRequest,
          {
            limit:
              exportRequest.limit,
            offset:
              exportRequest.offset,
          },
        );

      csv =
        buildCsv(
          [
            "play_id",
            "customer_id",
            "transaction_reference",
            "service",
            "time",
            "status",
          ],
          rows.map(
            (row) => [
              row.play_id,
              row.customer_id,
              row.transaction_reference,
              row.service,
              row.time,
              row.status,
            ],
          ),
        );
    }

    if (
      exportRequest.type ===
      "rewards"
    ) {
      const rows =
        await queryRewards(
          env,
          exportRequest,
          {
            limit:
              exportRequest.limit,
            offset:
              exportRequest.offset,
          },
        );

      csv =
        buildCsv(
          [
            "reward_id",
            "customer_id",
            "reward_type",
            "safe_token_reference",
            "win_time",
            "claim_time",
            "redeem_time",
            "used_time",
            "status",
          ],
          rows.map(
            (row) => [
              row.reward_id,
              row.customer_id,
              row.reward_type,
              row.safe_token_reference,
              row.win_time,
              row.claim_time,
              row.redeem_time,
              row.used_time,
              row.status,
            ],
          ),
        );
    }

    if (
      exportRequest.type ===
      "audit"
    ) {
      const rows =
        await queryAudit(
          env,
          exportRequest,
          {
            limit:
              exportRequest.limit,
            offset:
              exportRequest.offset,
          },
        );

      csv =
        buildCsv(
          [
            "timestamp",
            "entity_type",
            "entity_id",
            "action",
            "actor",
            "result",
          ],
          rows.map(
            (row) => [
              row.timestamp,
              row.entity_type,
              row.entity_id,
              row.action,
              row.actor,
              row.result,
            ],
          ),
        );
    }

    await writeAuditSafe(
      env,
      {
        entityType:
          "EXPORT",
        entityId:
          exportRequest.type,
        action:
          "EXPORT",
        actor:
          ownerSession.userId,
        result:
          "SUCCESS",
      },
    );

    return csvResponse(
      csv,
      buildExportFilename(
        exportRequest.from,
        exportRequest.to,
      ),
    );
  } catch (error) {
    console.error(
      "OWNER_EXPORT_FAILED:",
      error,
    );

    await writeAuditSafe(
      env,
      {
        entityType:
          "EXPORT",
        entityId:
          exportRequest.type,
        action:
          "EXPORT",
        actor:
          ownerSession.userId,
        result:
          "FAILED",
      },
    );

    return json(
      {
        ok: false,
        error:
          "INTERNAL_ERROR",
        message:
          "Export failed.",
      },
      500,
    );
  }
}
