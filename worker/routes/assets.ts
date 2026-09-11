import type { Env } from "../index";

function contentType(key: string): string {
  const lower = key.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

export async function handleAssetRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "GET" || !url.pathname.startsWith("/r2-assets/")) return new Response(null, { status: 404 });
  if (!env.R2) return new Response(JSON.stringify({ ok:false, error:"R2_NOT_CONFIGURED" }), { status:503, headers:{"Content-Type":"application/json","Cache-Control":"no-store"} });
  const key = decodeURIComponent(url.pathname.slice("/r2-assets/".length));
  if (!key || key.includes("..")) return new Response(null, { status:400 });
  const object = await env.R2.get(key);
  if (!object?.body) return new Response(null, { status:404, headers:{"Cache-Control":"no-store"} });
  return new Response(object.body, { status:200, headers:{"Content-Type":contentType(key),"Cache-Control":"public, max-age=31536000, immutable","ETag":object.etag} });
}
