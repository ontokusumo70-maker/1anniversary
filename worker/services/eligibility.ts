import type { Env } from "../index";

export interface EligibilityResult {
  eligible: boolean;
  reason:
    | "ELIGIBLE"
    | "TRANSACTION_NOT_FOUND"
    | "TRANSACTION_NOT_OWNED"
    | "TRANSACTION_ALREADY_PLAYED"
    | "CAMPAIGN_NOT_ACTIVE";
  transactionId: string;
  customerId: string;
}

const CAMPAIGN_START = "2026-11-01T00:00:00+07:00";
const CAMPAIGN_END = "2026-11-11T00:00:00+07:00";

function isCampaignActive(now = new Date()): boolean {
  const start = new Date(CAMPAIGN_START).getTime();
  const end = new Date(CAMPAIGN_END).getTime();
  const current = now.getTime();

  return current >= start && current < end;
}

export async function checkEligibility(
  env: Env,
  customerId: string,
  transactionId: string,
): Promise<EligibilityResult> {
  const base = {
    transactionId,
    customerId,
  };

  if (!isCampaignActive()) {
    return {
      ...base,
      eligible: false,
      reason: "CAMPAIGN_NOT_ACTIVE",
    };
  }

  const transaction = await env.DB
    .prepare(
      `
      SELECT
        transaction_id,
        customer_id
      FROM transactions
      WHERE transaction_id = ?
      LIMIT 1
      `,
    )
    .bind(transactionId)
    .first<{
      transaction_id: string;
      customer_id: string;
    }>();

  if (!transaction) {
    return {
      ...base,
      eligible: false,
      reason: "TRANSACTION_NOT_FOUND",
    };
  }

  if (transaction.customer_id !== customerId) {
    return {
      ...base,
      eligible: false,
      reason: "TRANSACTION_NOT_OWNED",
    };
  }

  const existingPlay = await env.DB
    .prepare(
      `
      SELECT play_id
      FROM plays
      WHERE transaction_id = ?
      LIMIT 1
      `,
    )
    .bind(transactionId)
    .first<{
      play_id: string;
    }>();

  if (existingPlay) {
    return {
      ...base,
      eligible: false,
      reason: "TRANSACTION_ALREADY_PLAYED",
    };
  }

  return {
    ...base,
    eligible: true,
    reason: "ELIGIBLE",
  };
}
