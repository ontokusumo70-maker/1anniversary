/*
 * ============================================================
 * CSV EXPORT QUERY
 * Teras Laundry 1st Anniversary
 *
 * 3.9.3
 *
 * Tanggung jawab:
 * - validasi date range
 * - pagination/chunking
 * - query Customer
 * - query Play
 * - query Reward
 * - query Audit
 *
 * Authorization tetap ditangani oleh route Owner.
 * ============================================================
 */

import type { Env } from "../index";

/* ============================================================
 * TYPES
 * ============================================================
 */

export type ExportRange = {
  from?: string;
  to?: string;
};

export type Pagination = {
  limit: number;
  offset: number;
};

export type CustomerExportRow = {
  customer_id: string;
  phone_masked: string;
  created_at: string;
  total_play: number;
  total_reward: number;
  total_redeemed: number;
};

export type PlayExportRow = {
  play_id: string;
  customer_id: string;
  transaction_reference: string;
  service: string;
  time: string;
  status: string;
};

export type RewardExportRow = {
  reward_id: string;
  customer_id: string;
  reward_type: string;
  safe_token_reference: string;
  win_time: string;
  claim_time: string | null;
  redeem_time: string | null;
  used_time: string | null;
  status: string;
};

export type AuditExportRow = {
  timestamp: string;
  entity_type: string;
  entity_id: string;
  action: string;
  actor: string;
  result: string;
};

/* ============================================================
 * CONSTANTS
 * ============================================================
 */

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 1000;
const MAX_OFFSET = 10_000_000;

/* ============================================================
 * DATE RANGE
 * ============================================================
 */

export function validateExportRange(
  from?: string,
  to?: string,
): boolean {
  if (!from && !to) {
    return true;
  }

  const fromMs =
    from
      ? Date.parse(from)
      : null;

  const toMs =
    to
      ? Date.parse(to)
      : null;

  if (
    from &&
    !Number.isFinite(fromMs)
  ) {
    return false;
  }

  if (
    to &&
    !Number.isFinite(toMs)
  ) {
    return false;
  }

  if (
    fromMs !== null &&
    toMs !== null &&
    fromMs > toMs
  ) {
    return false;
  }

  return true;
}

export function buildDateFilter(
  from?: string,
  to?: string,
): {
  sql: string;
  params: string[];
} {
  const conditions: string[] = [];
  const params: string[] = [];

  if (from) {
    conditions.push(
      "created_at >= ?",
    );

    params.push(from);
  }

  if (to) {
    conditions.push(
      "created_at <= ?",
    );

    params.push(to);
  }

  if (conditions.length === 0) {
    return {
      sql: "",
      params: [],
    };
  }

  return {
    sql:
      " WHERE " +
      conditions.join(
        " AND ",
      ),
    params,
  };
}

/* ============================================================
 * PAGINATION
 * ============================================================
 */

export function buildPagination(
  limit?: number,
  offset?: number,
): Pagination {
  const normalizedLimit =
    Number.isFinite(limit)
      ? Math.floor(
          limit as number,
        )
      : DEFAULT_LIMIT;

  const normalizedOffset =
    Number.isFinite(offset)
      ? Math.floor(
          offset as number,
        )
      : 0;

  return {
    limit: Math.min(
      Math.max(
        normalizedLimit,
        1,
      ),
      MAX_LIMIT,
    ),
    offset: Math.min(
      Math.max(
        normalizedOffset,
        0,
      ),
      MAX_OFFSET,
    ),
  };
}

/* ============================================================
 * CUSTOMER QUERY
 *
 * CSV minimum:
 * Customer ID
 * phone/masked phone
 * registration date
 * total Play
 * total Reward
 * total Redeemed
 *
 * phone_masked digunakan.
 * phone_hash tidak diekspor.
 * ============================================================
 */

export async function queryCustomers(
  env: Env,
  range: ExportRange = {},
  pagination: Pagination = buildPagination(),
): Promise<CustomerExportRow[]> {
  if (
    !validateExportRange(
      range.from,
      range.to,
    )
  ) {
    throw new Error(
      "INVALID_EXPORT_RANGE",
    );
  }

  const conditions: string[] = [];
  const params: string[] = [];

  if (range.from) {
    conditions.push(
      "c.created_at >= ?",
    );

    params.push(range.from);
  }

  if (range.to) {
    conditions.push(
      "c.created_at <= ?",
    );

    params.push(range.to);
  }

  const where =
    conditions.length > 0
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

  const result =
    await env.DB
      .prepare(
        `
        SELECT
          c.customer_id,
          c.phone_masked,
          c.created_at,

          (
            SELECT COUNT(*)
            FROM plays p
            WHERE p.customer_id =
              c.customer_id
          ) AS total_play,

          (
            SELECT COUNT(*)
            FROM rewards r
            WHERE r.customer_id =
              c.customer_id
          ) AS total_reward,

          (
            SELECT COUNT(*)
            FROM rewards r
            WHERE r.customer_id =
              c.customer_id
              AND r.status IN (
                'REDEEMED',
                'USED'
              )
          ) AS total_redeemed

        FROM customers c
        ${where}

        ORDER BY
          c.created_at ASC,
          c.customer_id ASC

        LIMIT ?
        OFFSET ?
        `,
      )
      .bind(
        ...params,
        pagination.limit,
        pagination.offset,
      )
      .all<CustomerExportRow>();

  return result.results;
}

/* ============================================================
 * PLAY QUERY
 * ============================================================
 */

export async function queryPlays(
  env: Env,
  range: ExportRange = {},
  pagination: Pagination = buildPagination(),
): Promise<PlayExportRow[]> {
  if (
    !validateExportRange(
      range.from,
      range.to,
    )
  ) {
    throw new Error(
      "INVALID_EXPORT_RANGE",
    );
  }

  const conditions: string[] = [];
  const params: string[] = [];

  if (range.from) {
    conditions.push(
      "p.created_at >= ?",
    );

    params.push(range.from);
  }

  if (range.to) {
    conditions.push(
      "p.created_at <= ?",
    );

    params.push(range.to);
  }

  const where =
    conditions.length > 0
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

  const result =
    await env.DB
      .prepare(
        `
        SELECT
          p.play_id,
          p.customer_id,
          p.transaction_id
            AS transaction_reference,
          t.service_type
            AS service,
          p.created_at
            AS time,
          p.status

        FROM plays p

        INNER JOIN transactions t
          ON t.transaction_id =
             p.transaction_id

        ${where}

        ORDER BY
          p.created_at ASC,
          p.play_id ASC

        LIMIT ?
        OFFSET ?
        `,
      )
      .bind(
        ...params,
        pagination.limit,
        pagination.offset,
      )
      .all<PlayExportRow>();

  return result.results;
}

/* ============================================================
 * REWARD QUERY
 *
 * IMPORTANT:
 * token_ref adalah opaque QR reference.
 * Tidak ada raw secret token tambahan yang dibuat/export.
 *
 * Migration hanya menyediakan:
 * token_ref
 * created_at
 * claimed_at
 * redeemed_at
 * used_at
 *
 * created_at dipakai sebagai win_time.
 * ============================================================
 */

export async function queryRewards(
  env: Env,
  range: ExportRange = {},
  pagination: Pagination = buildPagination(),
): Promise<RewardExportRow[]> {
  if (
    !validateExportRange(
      range.from,
      range.to,
    )
  ) {
    throw new Error(
      "INVALID_EXPORT_RANGE",
    );
  }

  const conditions: string[] = [];
  const params: string[] = [];

  if (range.from) {
    conditions.push(
      "r.created_at >= ?",
    );

    params.push(range.from);
  }

  if (range.to) {
    conditions.push(
      "r.created_at <= ?",
    );

    params.push(range.to);
  }

  const where =
    conditions.length > 0
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

  const result =
    await env.DB
      .prepare(
        `
        SELECT
          r.reward_id,
          r.customer_id,
          r.type
            AS reward_type,

          /*
           * Safe opaque reference.
           * Tidak melakukan transformasi menjadi secret baru.
           */
          r.token_ref
            AS safe_token_reference,

          r.created_at
            AS win_time,

          r.claimed_at
            AS claim_time,

          r.redeemed_at
            AS redeem_time,

          r.used_at
            AS used_time,

          r.status

        FROM rewards r

        ${where}

        ORDER BY
          r.created_at ASC,
          r.reward_id ASC

        LIMIT ?
        OFFSET ?
        `,
      )
      .bind(
        ...params,
        pagination.limit,
        pagination.offset,
      )
      .all<RewardExportRow>();

  return result.results;
}

/* ============================================================
 * AUDIT QUERY
 * ============================================================
 */

export async function queryAudit(
  env: Env,
  range: ExportRange = {},
  pagination: Pagination = buildPagination(),
): Promise<AuditExportRow[]> {
  if (
    !validateExportRange(
      range.from,
      range.to,
    )
  ) {
    throw new Error(
      "INVALID_EXPORT_RANGE",
    );
  }

  const conditions: string[] = [];
  const params: string[] = [];

  if (range.from) {
    conditions.push(
      "a.timestamp >= ?",
    );

    params.push(range.from);
  }

  if (range.to) {
    conditions.push(
      "a.timestamp <= ?",
    );

    params.push(range.to);
  }

  const where =
    conditions.length > 0
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

  const result =
    await env.DB
      .prepare(
        `
        SELECT
          a.timestamp,
          a.entity_type,
          a.entity_id,
          a.action,
          a.actor,
          a.result

        FROM audit_log a

        ${where}

        ORDER BY
          a.timestamp ASC,
          a.audit_id ASC

        LIMIT ?
        OFFSET ?
        `,
      )
      .bind(
        ...params,
        pagination.limit,
        pagination.offset,
      )
      .all<AuditExportRow>();

  return result.results;
}
