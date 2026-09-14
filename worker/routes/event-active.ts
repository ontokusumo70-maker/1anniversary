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

async function cleanupInactiveEventImages(env: Env, nowIso: string) {
  await env.DB.prepare(`
    DELETE FROM event_images
    WHERE event_id IN (
      SELECT event_id
      FROM events
      WHERE active != 1 OR ends_at <= ?
    )
  `).bind(nowIso).run();
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
    const row = await env.DB.prepare(`
      SELECT e.event_id, e.title, e.starts_at, e.ends_at, e.description,
             CASE WHEN i.event_id IS NULL THEN 0 ELSE 1 END AS has_image
      FROM events e
      LEFT JOIN event_images i ON i.event_id = e.event_id
      WHERE e.active = 1 AND e.starts_at <= ? AND e.ends_at > ?
      ORDER BY e.starts_at DESC, e.event_id DESC
      LIMIT 1
    `).bind(nowIso, nowIso).first<{
      event_id: string;
      title: string;
      starts_at: string;
      ends_at: string;
      description: string;
      has_image: number;
    }>();

    if (!row) return json({ ok: true, active: false });

    return json({
      ok: true,
      active: true,
      event: {
        eventId: row.event_id,
        title: row.title,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        description: row.description || "",
        imageUrl: Number(row.has_image) === 1 ? "/event/active/image" : null,
      },
    });
  }

  if (request.method === "GET" && url.pathname === "/event/active/image") {
    await cleanupInactiveEventImages(env, nowIso);
    const row = await env.DB.prepare(`
      SELECT i.mime_type, i.image_blob
      FROM event_images i
      INNER JOIN events e ON e.event_id = i.event_id
      WHERE e.active = 1 AND e.starts_at <= ? AND e.ends_at > ?
      ORDER BY e.starts_at DESC, e.event_id DESC
      LIMIT 1
    `).bind(nowIso, nowIso).first<{ mime_type: string; image_blob: ArrayBuffer }>();

    if (!row?.image_blob) return new Response("", { status: 404 });

    return new Response(row.image_blob, {
      status: 200,
      headers: {
        "Content-Type": row.mime_type,
        "Cache-Control": "no-store",
      },
    });
  }

  return errorResponse("NOT_FOUND", "Active event endpoint not found.", 404);
}

