/* Owner CSV report. One endpoint, four report sections, Owner only. */
import type { Env } from "../index";
import { requireSession } from "../auth/session-guard";
import { buildCsv } from "../csv/export";
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
  customers: Awaited<ReturnType<typeof queryCustomers>>;
  machines: Awaited<ReturnType<typeof queryMachineUsage>>;
  events: Awaited<ReturnType<typeof queryEvents>>;
  audit: Awaited<ReturnType<typeof queryAudit>>;
}): string {
  const lines: string[] = [];
  lines.push(buildCsv(["LAPORAN TERAS LAUNDRY OWNER"], []));
  const totalCustomers = input.customers.length ? input.customers[0].total_customers : 0;
  lines.push(buildCsv(["BAGIAN", "TOTAL KONSUMEN"], [["Konsumen", totalCustomers]]));
  lines.push(buildCsv(["nama", "nomor_telepon", "email"], input.customers.map((row) => [row.name, row.phone, row.email])));
  lines.push(buildCsv(["machine_type", "machine_number", "total_operations", "total_seconds"], input.machines.map((row) => [row.machine_type, row.machine_number, row.total_operations, row.total_seconds])));
  lines.push(buildCsv(["event_id", "judul_event", "mulai", "selesai", "reward", "jumlah_reward", "active"], input.events.map((row) => [row.event_id, row.title, row.starts_at, row.ends_at, row.reward_type, row.reward_quantity, row.active])));
  lines.push(buildCsv(["timestamp", "entity_type", "entity_id", "action", "actor", "result"], input.audit.map((row) => [row.timestamp, row.entity_type, row.entity_id, row.action, row.actor, row.result])));
  return lines.join("");
}

export async function handleOwnerExportRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "GET" || url.pathname !== "/owner/export") return json({ ok: false, error: "NOT_FOUND" }, 404);

  const owner = await requireSession(request, env, ["OWNER"]);
  if (!owner) return json({ ok: false, error: "UNAUTHORIZED", message: "Owner authentication required." }, 401);

  try {
    const range = parseDateRange(url);
    const pagination = buildPagination(500, 0);
    const [customers, machines, events, audit] = await Promise.all([
      queryCustomers(env, range, pagination),
      queryMachineUsage(env, range),
      queryEvents(env, range, pagination),
      queryAudit(env, range, pagination),
    ]);

    const csv = buildOwnerReportCsv({ customers, machines, events, audit });
    await writeAuditSafe(env, { entityType: "EXPORT", entityId: "OWNER_REPORT", action: "EXPORT", actor: owner.userId, result: "SUCCESS" });
    return csvResponse(csv);
  } catch (error) {
    console.error("OWNER_EXPORT_FAILED:", error);
    await writeAuditSafe(env, { entityType: "EXPORT", entityId: "OWNER_REPORT", action: "EXPORT", actor: owner.userId, result: "FAILED" });
    const message = error instanceof Error && error.message === "INVALID_EXPORT_RANGE" ? "Invalid export date range." : "Export failed.";
    return json({ ok: false, error: "INVALID_REQUEST", message }, 400);
  }
}
