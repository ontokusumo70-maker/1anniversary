import type { Env } from "../index";
import { requireSession } from "../auth/session-guard";

/*
 * GET /owner/delivery-counts  (OWNER, view-only)
 * Jumlah request Antar / Jemput yang SUDAH DIKONFIRMASI Staff
 * (status CONFIRMED, belum ditandai selesai).
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function handleOwnerDeliveryRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/owner/delivery-counts") {
    const owner = await requireSession(request, env, ["OWNER"]);
    if (!owner) {
      return json({ ok: false, error: "UNAUTHORIZED", message: "Owner authentication is required." }, 401);
    }

    const result = await env.DB.prepare(`
      SELECT service_type, COUNT(*) AS total
      FROM delivery_requests
      WHERE status = 'CONFIRMED'
      GROUP BY service_type
    `).all<{ service_type: string; total: number }>();

    let antar = 0;
    let jemput = 0;
    for (const row of result.results ?? []) {
      if (row.service_type === "DELIVERY") antar = Number(row.total);
      if (row.service_type === "PICKUP") jemput = Number(row.total);
    }
    return json({ ok: true, antar, jemput });
  }

  return json({ ok: false, error: "NOT_FOUND", message: "Owner delivery endpoint not found." }, 404);
}
