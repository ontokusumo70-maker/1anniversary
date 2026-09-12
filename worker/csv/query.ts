/*
 * ============================================================
 * CSV EXPORT QUERY
 * Owner report: Customer + Machine + Event + Audit.
 * Queries are paginated to protect D1/Worker resource limits.
 * ============================================================
 */

import type { Env } from "../index";

export type ExportRange = { from?: string; to?: string };
export type Pagination = { limit: number; offset: number };

export type CustomerExportRow = {
  customer_id: string;
  name: string;
  phone: string;
  email: string;
  created_at: string;
  total_customers: number;
};

export type MachineExportRow = {
  machine_type: string;
  machine_number: number;
  total_operations: number;
  total_seconds: number;
};

export type EventExportRow = {
  event_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  reward_type: string;
  reward_quantity: number;
  active: number;
};

export type AuditExportRow = {
  timestamp: string;
  entity_type: string;
  entity_id: string;
  action: string;
  actor: string;
  result: string;
};

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 1000;
const MAX_OFFSET = 10_000_000;

export function validateExportRange(from?: string, to?: string): boolean {
  if (!from && !to) return true;
  const fromMs = from ? Date.parse(from) : null;
  const toMs = to ? Date.parse(to) : null;
  if (from && !Number.isFinite(fromMs)) return false;
  if (to && !Number.isFinite(toMs)) return false;
  if (fromMs !== null && toMs !== null && fromMs > toMs) return false;
  return true;
}

export function buildDateFilter(from?: string, to?: string): { sql: string; params: string[] } {
  const conditions: string[] = [];
  const params: string[] = [];
  if (from) { conditions.push("created_at >= ?"); params.push(from); }
  if (to) { conditions.push("created_at <= ?"); params.push(to); }
  return conditions.length ? { sql: ` WHERE ${conditions.join(" AND ")}`, params } : { sql: "", params: [] };
}

export function buildPagination(limit?: number, offset?: number): Pagination {
  const normalizedLimit = Number.isFinite(limit) ? Math.floor(limit as number) : DEFAULT_LIMIT;
  const normalizedOffset = Number.isFinite(offset) ? Math.floor(offset as number) : 0;
  return {
    limit: Math.min(Math.max(normalizedLimit, 1), MAX_LIMIT),
    offset: Math.min(Math.max(normalizedOffset, 0), MAX_OFFSET),
  };
}

export async function queryCustomers(env: Env, range: ExportRange = {}, pagination: Pagination = buildPagination()): Promise<CustomerExportRow[]> {
  if (!validateExportRange(range.from, range.to)) throw new Error("INVALID_EXPORT_RANGE");
  const conditions: string[] = [];
  const params: string[] = [];
  if (range.from) { conditions.push("c.created_at >= ?"); params.push(range.from); }
  if (range.to) { conditions.push("c.created_at <= ?"); params.push(range.to); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await env.DB.prepare(`
    SELECT c.customer_id, c.name, c.phone_masked AS phone, c.email, c.created_at, COUNT(*) OVER () AS total_customers
    FROM customers c ${where}
    ORDER BY c.created_at ASC, c.customer_id ASC LIMIT ? OFFSET ?
  `).bind(...params, pagination.limit, pagination.offset).all<CustomerExportRow>();
  return result.results;
}

export async function queryMachineUsage(env: Env, range: ExportRange = {}): Promise<MachineExportRow[]> {
  if (!validateExportRange(range.from, range.to)) throw new Error("INVALID_EXPORT_RANGE");
  const conditions: string[] = [];
  const params: string[] = [];
  if (range.from) { conditions.push("started_at >= ?"); params.push(range.from); }
  if (range.to) { conditions.push("started_at <= ?"); params.push(range.to); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await env.DB.prepare(`
    SELECT machine_type, machine_number, COUNT(*) AS total_operations, COALESCE(SUM(duration_seconds),0) AS total_seconds
    FROM machine_operations ${where}
    GROUP BY machine_type, machine_number
    ORDER BY CASE WHEN machine_type = 'WASHER' THEN 1 ELSE 2 END, machine_number ASC
  `).bind(...params).all<MachineExportRow>();
  return result.results;
}

export async function queryEvents(env: Env, range: ExportRange = {}, pagination: Pagination = buildPagination()): Promise<EventExportRow[]> {
  if (!validateExportRange(range.from, range.to)) throw new Error("INVALID_EXPORT_RANGE");
  const conditions: string[] = [];
  const params: string[] = [];
  if (range.from) { conditions.push("starts_at >= ?"); params.push(range.from); }
  if (range.to) { conditions.push("starts_at <= ?"); params.push(range.to); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await env.DB.prepare(`
    SELECT event_id, title, starts_at, ends_at, reward_type, reward_quantity, active
    FROM events ${where} ORDER BY starts_at ASC, event_id ASC LIMIT ? OFFSET ?
  `).bind(...params, pagination.limit, pagination.offset).all<EventExportRow>();
  return result.results;
}

export async function queryAudit(env: Env, range: ExportRange = {}, pagination: Pagination = buildPagination()): Promise<AuditExportRow[]> {
  if (!validateExportRange(range.from, range.to)) throw new Error("INVALID_EXPORT_RANGE");
  const conditions: string[] = [];
  const params: string[] = [];
  if (range.from) { conditions.push("timestamp >= ?"); params.push(range.from); }
  if (range.to) { conditions.push("timestamp <= ?"); params.push(range.to); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await env.DB.prepare(`
    SELECT timestamp, entity_type, entity_id, action, actor, result
    FROM audit_log ${where} ORDER BY timestamp ASC, audit_id ASC LIMIT ? OFFSET ?
  `).bind(...params, pagination.limit, pagination.offset).all<AuditExportRow>();
  return result.results;
}
