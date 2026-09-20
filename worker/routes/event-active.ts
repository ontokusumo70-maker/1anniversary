import type { Env } from "../index";
import { requireSession } from "../auth/session-guard";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function errorResponse(error: string, message: string, status: number): Response {
  return json({ ok: false, error, message }, status);
}

async function requireEventViewer(request: Request, env: Env) {
  return requireSession(request, env, ["OWNER", "STAFF", "CUSTOMER"]);
}

const EVENT_IMAGE_RETENTION_DAYS = 30;

async function cleanupInactiveEventImages(env: Env, nowIso: string) {
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) return;
  const cutoffIso = new Date(nowMs - (EVENT_IMAGE_RETENTION_DAYS * 86400000)).toISOString();
  await env.DB.prepare(`
    DELETE FROM event_images
    WHERE event_id IN (
      SELECT event_id
      FROM events
      WHERE active != 1 OR ends_at <= ?
    )
  `).bind(cutoffIso).run();
}

export async function handleActiveEventRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== "/event/active" && url.pathname !== "/event/active/image") {
    return errorResponse("NOT_FOUND", "Active event endpoint not found.", 404);
  }

  const session = await requireEventViewer(request, env);
  if (!session) return errorResponse("UNAUTHORIZED", "Authentication is required.", 401);

  const nowIso = new Date().toISOString();

  if (request.method === "GET" && url.pathname === "/event/active") {
    await cleanupInactiveEventImages(env, nowIso);
    const requestedEventId = (url.searchParams.get("eventId") || "").trim();

    let rows: any[] = [];

    if (requestedEventId) {
      const row = await env.DB.prepare(`
        SELECT e.event_id, e.title, e.starts_at, e.ends_at, e.reward_type,
               e.reward_quantity, e.description,
               rp.quota_total, rp.quota_used, rp.terms,
               CASE WHEN i.event_id IS NULL THEN 0 ELSE 1 END AS has_image
        FROM events e
        LEFT JOIN reward_pool rp ON rp.reward_type = e.reward_type
        LEFT JOIN event_images i ON i.event_id = e.event_id
        WHERE e.event_id = ? AND e.active = 1 AND e.ends_at > ?
        LIMIT 1
      `).bind(requestedEventId, nowIso).first();
      if (row) rows = [row];
    } else {
      const activeResult = await env.DB.prepare(`
        SELECT e.event_id, e.title, e.starts_at, e.ends_at, e.reward_type,
               e.reward_quantity, e.description,
               rp.quota_total, rp.quota_used, rp.terms,
               CASE WHEN i.event_id IS NULL THEN 0 ELSE 1 END AS has_image
        FROM events e
        LEFT JOIN reward_pool rp ON rp.reward_type = e.reward_type
        LEFT JOIN event_images i ON i.event_id = e.event_id
        WHERE e.active = 1 AND e.starts_at <= ? AND e.ends_at > ?
        ORDER BY e.starts_at ASC, e.event_id ASC
      `).bind(nowIso, nowIso).all();

      const upcomingResult = await env.DB.prepare(`
        SELECT e.event_id, e.title, e.starts_at, e.ends_at, e.reward_type,
               e.reward_quantity, e.description,
               rp.quota_total, rp.quota_used, rp.terms,
               CASE WHEN i.event_id IS NULL THEN 0 ELSE 1 END AS has_image
        FROM events e
        LEFT JOIN reward_pool rp ON rp.reward_type = e.reward_type
        LEFT JOIN event_images i ON i.event_id = e.event_id
        WHERE e.active = 1 AND e.starts_at > ? AND e.ends_at > ?
        ORDER BY e.starts_at ASC, e.event_id ASC
      `).bind(nowIso, nowIso).all();

      for (const activeRow of (activeResult.results ?? [])) {
        rows.push(activeRow);
      }
      for (const upcomingRow of (upcomingResult.results ?? [])) {
        rows.push(upcomingRow);
      }
    }

    if (!rows.length) return json({ ok: true, active: false, events: [] });

    const events = [];
    for (const row of rows) {
      const rewardRows = await env.DB.prepare(`
        SELECT er.reward_type, er.reward_quantity, rp.quota_total, rp.quota_used, rp.terms
        FROM event_rewards er
        LEFT JOIN reward_pool rp ON rp.reward_type = er.reward_type
        WHERE er.event_id = ?
        ORDER BY er.position ASC
      `).bind((row as any).event_id).all();

      const rewards = (rewardRows.results ?? []).map((reward) => ({
        rewardType: String((reward as any).reward_type),
        rewardQuantity: Number((reward as any).reward_quantity),
        remaining: Math.max(0, Number((reward as any).quota_total ?? 0) - Number((reward as any).quota_used ?? 0)),
        terms: String((reward as any).terms || "—"),
      }));

      if (!rewards.length) rewards.push({
        rewardType: (row as any).reward_type,
        rewardQuantity: Number((row as any).reward_quantity),
        remaining: Math.max(0, Number((row as any).quota_total ?? 0) - Number((row as any).quota_used ?? 0)),
        terms: (row as any).terms || "—",
      });

      const startsAt = String((row as any).starts_at);
      const endsAt = String((row as any).ends_at);
      events.push({
        eventId: (row as any).event_id,
        title: (row as any).title,
        startsAt,
        endsAt,
        description: (row as any).description || "",
        rewards,
        status: Date.parse(startsAt) > Date.parse(nowIso) ? "UPCOMING" : "ACTIVE",
        imageUrl: Number((row as any).has_image) === 1
          ? `/event/active/image?eventId=${encodeURIComponent(String((row as any).event_id))}`
          : null,
      });
    }

    const activeEvents = events.filter((event) => event.status === "ACTIVE");
    const upcomingEvents = events.filter((event) => event.status === "UPCOMING");
    const activeEvent = activeEvents[0] || null;
    const upcomingEvent = upcomingEvents[0] || null;

    return json({
      ok: true,
      serverNow: nowIso,
      active: events.length > 0,
      events,
      activeEvents,
      upcomingEvents,
      activeEvent,
      upcomingEvent,
      // Backward compatibility: existing detail/dashboard code can still use event.
      event: events[0] || null,
    });
  }

  if (request.method === "GET" && url.pathname === "/event/active/image") {
    await cleanupInactiveEventImages(env, nowIso);
    const requestedEventId = (url.searchParams.get("eventId") || "").trim();
    let row: any = requestedEventId
      ? await env.DB.prepare(`
      SELECT i.mime_type, i.image_blob
      FROM event_images i
      INNER JOIN events e ON e.event_id = i.event_id
      WHERE e.event_id = ? AND e.active = 1 AND e.ends_at > ?
      LIMIT 1
    `).bind(requestedEventId, nowIso).first()
      : await env.DB.prepare(`
      SELECT i.mime_type, i.image_blob
      FROM event_images i
      INNER JOIN events e ON e.event_id = i.event_id
      WHERE e.active = 1 AND e.starts_at <= ? AND e.ends_at > ?
      ORDER BY e.starts_at DESC, e.event_id DESC
      LIMIT 1
    `).bind(nowIso, nowIso).first();
    if (!row && !requestedEventId) {
      row = await env.DB.prepare(`
        SELECT i.mime_type, i.image_blob
        FROM event_images i
        INNER JOIN events e ON e.event_id = i.event_id
        WHERE e.active = 1 AND e.starts_at > ? AND e.ends_at > ?
        ORDER BY e.starts_at ASC, e.event_id ASC
        LIMIT 1
      `).bind(nowIso, nowIso).first();
    }

    if (!row?.image_blob) return new Response("", { status: 404 });

    const imageBytes = row.image_blob instanceof ArrayBuffer
      ? new Uint8Array(row.image_blob)
      : row.image_blob instanceof Uint8Array
        ? row.image_blob
        : new Uint8Array(row.image_blob as any);
    return new Response(imageBytes, {
      status: 200,
      headers: {
        "Content-Type": row.mime_type,
        "Cache-Control": "no-store",
      },
    });
  }

  return errorResponse("NOT_FOUND", "Active event endpoint not found.", 404);
}
