import type { Env } from "../index";

export type AuditEntityType =
  | "CUSTOMER"
  | "TRANSACTION"
  | "PLAY"
  | "SESSION"
  | "REWARD"
  | "MACHINE"
  | "EXPORT";

export type AuditAction =
  | "START"
  | "FINISH"
  | "CLAIM"
  | "SCAN"
  | "REDEEM"
  | "USED"
  | "CREATE"
  | "UPDATE"
  | "EXPORT";

export type AuditResult =
  | "SUCCESS"
  | "FAILED"
  | "REJECTED";

export type AuditEntry = {
  entityType: AuditEntityType;
  entityId: string;
  action: AuditAction;
  actor: string;
  result: AuditResult;
};

function generateAuditId(): string {
  return `audit_${crypto.randomUUID()}`;
}

/**
 * Record one server-side audit event.
 *
 * Audit schema:
 * timestamp
 * entity_type
 * entity_id
 * action
 * actor
 * result
 */
export async function writeAudit(
  env: Env,
  entry: AuditEntry,
): Promise<void> {
  const auditId =
    generateAuditId();

  const timestamp =
    new Date().toISOString();

  const entityId =
    entry.entityId.trim();

  const actor =
    entry.actor.trim();

  if (
    entityId.length === 0 ||
    actor.length === 0
  ) {
    throw new Error(
      "INVALID_AUDIT_ENTRY",
    );
  }

  await env.DB
    .prepare(
      `
      INSERT INTO audit_log (
        audit_id,
        timestamp,
        entity_type,
        entity_id,
        action,
        actor,
        result
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      auditId,
      timestamp,
      entry.entityType,
      entityId,
      entry.action,
      actor,
      entry.result,
    )
    .run();
}

/**
 * Write audit without allowing an audit failure
 * to hide the original business operation result.
 *
 * This helper is intended for non-blocking audit
 * integration where the primary operation has
 * already completed.
 */
export async function writeAuditSafe(
  env: Env,
  entry: AuditEntry,
): Promise<void> {
  try {
    await writeAudit(
      env,
      entry,
    );
  } catch (error) {
    console.error(
      "AUDIT_LOG_FAILED:",
      error,
    );
  }
}
