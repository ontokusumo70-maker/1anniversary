import type { Env } from "../index";

/*
 * Mirrors the exact normalization/hash/mask/id-generation rules in
 * worker/routes/auth.ts so a customer record created here by Staff
 * (before the customer ever opens the app) resolves to the SAME
 * customer_id the moment that person logs in with their phone number.
 * This is what lets Staff record a purchase or a drop-off for a
 * brand-new walk-in without creating a duplicate customer later.
 */

export function normalizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, "");
}

export async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashPhone(phone: string): Promise<string> {
  return sha256Hex(normalizePhone(phone));
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length <= 4 ? "****" : `${digits.slice(0, 2)}****${digits.slice(-2)}`;
}

export function isPhone(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const normalized = normalizePhone(value);
  return normalized.length >= 8 && normalized.length <= 20;
}

export type CustomerLookup = {
  customerId: string;
  wasCreated: boolean;
};

/**
 * Finds a customer by phone. If none exists, creates a minimal
 * customer record so Staff can serve a walk-in immediately (member
 * purchase, drop-off) without requiring the customer to register first.
 */
export async function findOrCreateCustomerByPhone(
  env: Env,
  rawPhone: string,
): Promise<CustomerLookup> {
  const phone = normalizePhone(rawPhone);
  const phoneHash = await hashPhone(phone);

  const existing = await env.DB.prepare(`
    SELECT customer_id FROM customers WHERE phone_hash = ? LIMIT 1
  `).bind(phoneHash).first<{ customer_id: string }>();

  if (existing) {
    return { customerId: existing.customer_id, wasCreated: false };
  }

  const customerId = `customer_${phoneHash.slice(0, 32)}`;
  const nowIso = new Date().toISOString();

  // INSERT OR IGNORE guards a race where two Staff devices look up the
  // same brand-new phone number at nearly the same moment.
  await env.DB.prepare(`
    INSERT OR IGNORE INTO customers (
      customer_id, phone_hash, phone_masked, phone, name, email, created_at
    )
    VALUES (?, ?, ?, ?, '', '', ?)
  `).bind(customerId, phoneHash, maskPhone(phone), phone, nowIso).run();

  return { customerId, wasCreated: true };
}
