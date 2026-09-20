-- 0011_reward_pool_instances.sql
-- Reward Pool Instance Migration
-- Source of truth: verified production D1 schema/data.
--
-- Purpose:
-- 1. Change reward_pool identity from reward_type to reward_pool_id.
-- 2. Allow multiple independent pools with the same display reward_type.
-- 3. Give every existing event_reward its own pool instance.
-- 4. Link event_rewards/events/rewards to reward_pool_id.
-- 5. Preserve existing Reward Pool metadata and existing indexes.
--
-- Verified production condition before this migration:
-- - event_rewards has no reward_pool_id.
-- - events has no reward_pool_id.
-- - rewards has no reward_pool_id.
-- - reward_pool.reward_type is the PRIMARY KEY.
-- - Existing rewards count = 0, claimed = 0, redeemed = 0.
-- - Existing event allocations include two separate Koin allocations of 250.

PRAGMA defer_foreign_keys = ON;

BEGIN TRANSACTION;

-- ============================================================
-- 1. Preserve the existing reward_pool table temporarily.
-- ============================================================
ALTER TABLE reward_pool RENAME TO reward_pool_legacy;

-- The old index name must be removed before the same index name is
-- recreated on the new reward_pool table.
DROP INDEX IF EXISTS idx_reward_pool_type_active;

-- ============================================================
-- 2. Create the new instance-based Reward Pool table.
--
-- reward_pool_id = internal identity
-- reward_type    = display/business reward type
-- ============================================================
CREATE TABLE reward_pool (
  reward_pool_id TEXT PRIMARY KEY,
  reward_type TEXT NOT NULL,
  quota_total INTEGER NOT NULL,
  quota_used INTEGER NOT NULL DEFAULT 0,
  quota_claimed INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  description TEXT NOT NULL DEFAULT '',
  valid_from TEXT,
  valid_until TEXT,
  terms TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT 'OWNER',
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  budget_total INTEGER NOT NULL DEFAULT 0 CHECK (budget_total >= 0)
);

-- ============================================================
-- 3. Add reward_pool_id to existing event/reward tables.
-- ============================================================
ALTER TABLE event_rewards ADD COLUMN reward_pool_id TEXT;
ALTER TABLE events ADD COLUMN reward_pool_id TEXT;
ALTER TABLE rewards ADD COLUMN reward_pool_id TEXT;

-- ============================================================
-- 4. Create one NEW pool instance for every existing event_reward.
--
-- Each existing event allocation receives an independent copy of the
-- legacy pool metadata. The allocation quantity becomes quota_used.
--
-- Example:
-- Event A -> Koin 250 -> Pool A, quota_used 250
-- Event B -> Koin 250 -> Pool B, quota_used 250
-- ============================================================
INSERT INTO reward_pool (
  reward_pool_id,
  reward_type,
  quota_total,
  quota_used,
  quota_claimed,
  active,
  description,
  valid_from,
  valid_until,
  terms,
  created_by,
  created_at,
  updated_at,
  budget_total
)
SELECT
  'reward_pool_' || er.event_reward_id,
  er.reward_type,
  rp.quota_total,
  er.reward_quantity,
  0,
  rp.active,
  rp.description,
  rp.valid_from,
  rp.valid_until,
  rp.terms,
  rp.created_by,
  rp.created_at,
  rp.updated_at,
  rp.budget_total
FROM event_rewards er
JOIN reward_pool_legacy rp
  ON rp.reward_type = er.reward_type;

-- ============================================================
-- 5. Preserve legacy pools that are NOT referenced by an existing
-- event allocation.
-- ============================================================
INSERT INTO reward_pool (
  reward_pool_id,
  reward_type,
  quota_total,
  quota_used,
  quota_claimed,
  active,
  description,
  valid_from,
  valid_until,
  terms,
  created_by,
  created_at,
  updated_at,
  budget_total
)
SELECT
  'reward_pool_legacy_' || lower(hex(randomblob(16))),
  rp.reward_type,
  rp.quota_total,
  rp.quota_used,
  0,
  rp.active,
  rp.description,
  rp.valid_from,
  rp.valid_until,
  rp.terms,
  rp.created_by,
  rp.created_at,
  rp.updated_at,
  rp.budget_total
FROM reward_pool_legacy rp
WHERE NOT EXISTS (
  SELECT 1
  FROM event_rewards er
  WHERE er.reward_type = rp.reward_type
);

-- ============================================================
-- 6. Link every existing event_reward to its new pool instance.
-- ============================================================
UPDATE event_rewards
SET reward_pool_id = 'reward_pool_' || event_reward_id;

-- ============================================================
-- 7. Link each existing event to its first reward pool instance.
-- event_rewards remains the authoritative row-level allocation table.
-- ============================================================
UPDATE events
SET reward_pool_id = (
  SELECT er.reward_pool_id
  FROM event_rewards er
  WHERE er.event_id = events.event_id
  ORDER BY er.position ASC, er.created_at ASC, er.event_reward_id ASC
  LIMIT 1
);

-- ============================================================
-- 8. Existing rewards were verified as zero rows before migration.
-- New reward allocation code will write reward_pool_id directly.
-- ============================================================

-- ============================================================
-- 9. Recreate the existing Reward Pool index.
-- ============================================================
CREATE INDEX idx_reward_pool_type_active
  ON reward_pool (reward_type, active);

-- ============================================================
-- 10. Drop the temporary legacy table after data has been copied.
-- ============================================================
DROP TABLE reward_pool_legacy;

COMMIT;
