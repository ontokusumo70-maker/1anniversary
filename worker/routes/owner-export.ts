/* Owner CSV report. One endpoint, four report sections, Owner only. */
import type { Env } from "../index";
import { requireSession } from "../auth/session-guard";
import { buildCsv, type CsvCell } from "../csv/export";
import { buildPagination, queryAudit, queryCustomers, queryEvents, queryMachineUsage, validateExportRange } from "../csv/query";
import { writeAuditSafe } from "../audit/logger";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

function csvResponse(csv: string): Response {
  return new Response(csv, { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="teras-laundry-owner-report.csv"', "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

function parseDateRange(url: URL) {
  const from = url.searchParams.get("from") || undefined;
  const to = url.searchParams.get("to") || undefined;
  if (!validateExportRange(from, to)) throw new Error("INVALID_EXPORT_RANGE");
  return { from, to };
}

export function buildOwnerReportCsv(input: {
  datasets: Set<string>;
  customers: Awaited<ReturnType<typeof queryCustomers>>;
  machines: Awaited<ReturnType<typeof queryMachineUsage>>;
  events: Awaited<ReturnType<typeof queryEvents>>;
  audit: Awaited<ReturnType<typeof queryAudit>>;
  rewardPool?: Array<Record<string, unknown>>;
  eventRewards?: Array<{ event_id: string; reward_type: string; reward_quantity: number; position: number }>;
}): string {
  const lines: string[] = [];

  if (input.datasets.has("customer")) {
    const totalCustomers = input.customers.length ? input.customers[0].total_customers : 0;
    lines.push(buildCsv(["LAPORAN TERAS LAUNDRY OWNER - CUSTOMER"], []));
    lines.push(buildCsv(["BAGIAN", "TOTAL KONSUMEN"], [["Konsumen", totalCustomers]]));
    lines.push(buildCsv(["nama", "nomor_telepon", "email"], input.customers.map((row) => [row.name, row.phone, row.email])));
  }

  if (input.datasets.has("machine-operation")) {
    lines.push(buildCsv(["LAPORAN TERAS LAUNDRY OWNER - MACHINE OPERATION"], []));
    lines.push(buildCsv(["machine_type", "machine_number", "total_operations", "total_seconds"], input.machines.map((row) => [row.machine_type, row.machine_number, row.total_operations, row.total_seconds])));
  }

  if (input.datasets.has("reward-pool")) {
    lines.push(buildCsv(["LAPORAN TERAS LAUNDRY OWNER - REWARD POOL"], []));
    const rewardRows: CsvCell[][] = (input.rewardPool || []).map((row) => [
      row.reward_type == null ? "" : String(row.reward_type),
      row.description == null ? "" : String(row.description),
      Number(row.quota_total || 0),
      Number(row.quota_used || 0),
      Math.max(0, Number(row.quota_total || 0) - Number(row.quota_used || 0)),
      Number(row.budget_total || 0),
      Number(row.reward_claimed || 0),
      row.terms == null ? "" : String(row.terms),
      Number(row.active) === 1 ? "ACTIVE" : "INACTIVE",
    ]);
    lines.push(buildCsv(["reward_type", "description", "quota_total", "quota_used", "remaining", "budget_total", "reward_claimed", "terms", "active"], rewardRows));
  }

  if (input.datasets.has("event")) {
    const rewardByEvent = new Map<string, Array<{ reward_type: string; reward_quantity: number; position: number }>>();
    for (const reward of input.eventRewards || []) {
      const list = rewardByEvent.get(reward.event_id) || [];
      list.push(reward);
      rewardByEvent.set(reward.event_id, list);
    }
    const eventRows: Array<(string | number)[]> = [];
    for (const event of input.events) {
      const rewards = rewardByEvent.get(event.event_id) || [{ reward_type: event.reward_type, reward_quantity: event.reward_quantity, position: 0 }];
      rewards.sort((a, b) => a.position - b.position);
      eventRows.push(...rewards.map((reward) => [
        event.event_id,
        event.title,
        event.starts_at,
        event.ends_at,
        reward.reward_type,
        reward.reward_quantity,
        event.active,
      ]));
    }
    lines.push(buildCsv(["LAPORAN TERAS LAUNDRY OWNER - EVENT"], []));
    lines.push(buildCsv(["event_id", "judul_event", "mulai", "selesai", "reward", "jumlah_reward", "active"], eventRows));
  }

  if (input.datasets.has("audit")) {
    lines.push(buildCsv(["LAPORAN TERAS LAUNDRY OWNER - AUDIT"], []));
    lines.push(buildCsv(["timestamp", "entity_type", "entity_id", "action", "actor", "result"], input.audit.map((row) => [row.timestamp, row.entity_type, row.entity_id, row.action, row.actor, row.result])));
  }

  return lines.join("");
}

export async function handleOwnerExportRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "GET" || url.pathname !== "/owner/export") return json({ ok: false, error: "NOT_FOUND" }, 404);

  const owner = await requireSession(request, env, ["OWNER"]);
  if (!owner) return json({ ok: false, error: "UNAUTHORIZED", message: "Owner authentication required." }, 401);

  try {
    const range = parseDateRange(url);
    const allowedDatasets = new Set(["customer", "reward-pool", "event", "machine-operation"]);
    const datasets = new Set(
      (url.searchParams.get("datasets") || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    );
    if (!datasets.size || [...datasets].some((dataset) => !allowedDatasets.has(dataset))) {
      return json({ ok: false, error: "INVALID_DATASET", message: "Pilih dataset CSV yang tersedia." }, 400);
    }

    const pagination = buildPagination(500, 0);
    const [customers, machines, events, audit] = await Promise.all([
      datasets.has("customer") ? queryCustomers(env, range, pagination) : Promise.resolve([]),
      datasets.has("machine-operation") ? queryMachineUsage(env, range) : Promise.resolve([]),
      datasets.has("event") ? queryEvents(env, range, pagination) : Promise.resolve([]),
      Promise.resolve([]),
    ]);

    let rewardPool: Array<Record<string, unknown>> = [];
    if (datasets.has("reward-pool")) {
      const startIso = range.from || new Date(0).toISOString();
      const endIso = range.to || new Date().toISOString();
      const rewardResult = await env.DB.prepare(`
        SELECT rp.reward_type, rp.description, rp.quota_total, rp.quota_used, rp.budget_total, rp.terms, rp.active,
          (SELECT COUNT(*) FROM rewards r
           WHERE r.type = rp.reward_type AND r.claimed_at IS NOT NULL
             AND r.claimed_at >= ? AND r.claimed_at <= ?) AS reward_claimed
        FROM reward_pool rp ORDER BY rp.reward_type ASC
      `).bind(startIso, endIso).all<Record<string, unknown>>();
      rewardPool = rewardResult.results || [];
    }

    let eventRewards: Array<{ event_id: string; reward_type: string; reward_quantity: number; position: number }> = [];
    if (datasets.has("event")) {
      const eventIds = events.map((event) => event.event_id);
      if (eventIds.length) {
        const placeholders = eventIds.map(() => "?").join(",");
        const rewardResult = await env.DB.prepare(`
          SELECT event_id, reward_type, reward_quantity, position
          FROM event_rewards
          WHERE event_id IN (${placeholders})
          ORDER BY event_id ASC, position ASC
        `).bind(...eventIds).all<{ event_id: string; reward_type: string; reward_quantity: number; position: number }>();
        eventRewards = rewardResult.results || [];
      }
    }

    const csv = buildOwnerReportCsv({ datasets, customers, machines, events, audit, rewardPool, eventRewards });
    await writeAuditSafe(env, { entityType: "EXPORT", entityId: "OWNER_REPORT", action: "EXPORT", actor: owner.userId, result: "SUCCESS" });
    return csvResponse(csv);
  } catch (error) {
    console.error("OWNER_EXPORT_FAILED:", error);
    await writeAuditSafe(env, { entityType: "EXPORT", entityId: "OWNER_REPORT", action: "EXPORT", actor: owner.userId, result: "FAILED" });
    const message = error instanceof Error && error.message === "INVALID_EXPORT_RANGE" ? "Invalid export date range." : "Export failed.";
    return json({ ok: false, error: "INVALID_REQUEST", message }, 400);
  }
}
