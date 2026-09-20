-- 0012_reward_pool_recovery.sql
-- Recovery migration for production DB where 0011 is marked applied
-- but the 0011 schema changes are not present.
-- IMPORTANT: preserves existing events/event_rewards/reward_pool data.

PRAGMA foreign_keys=OFF;

-- 1. Rebuild reward_pool so reward_type is no longer the primary key.
CREATE TABLE reward_pool_new (
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

-- Preserve the two existing pool records with stable IDs.
INSERT INTO reward_pool_new (
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
  CASE
    WHEN reward_type = 'Koin' THEN 'reward_pool_legacy_koin_001'
    WHEN reward_type = 'Laundry Bag' THEN 'reward_pool_legacy_laundry_bag_001'
    ELSE 'reward_pool_legacy_' || lower(replace(reward_type, ' ', '_')) || '_001'
  END,
  reward_type,
  quota_total,
  quota_used,
  0,
  active,
  description,
  valid_from,
  valid_until,
  terms,
  created_by,
  created_at,
  updated_at,
  budget_total
FROM reward_pool;

DROP TABLE reward_pool;
ALTER TABLE reward_pool_new RENAME TO reward_pool;

CREATE INDEX idx_reward_pool_type_active
ON reward_pool(reward_type, active);

CREATE INDEX idx_reward_pool_created_at
ON reward_pool(created_at);

-- 2. Add pool identity to events.
ALTER TABLE events ADD COLUMN reward_pool_id TEXT;

-- 3. Add pool identity to event_rewards.
ALTER TABLE event_rewards ADD COLUMN reward_pool_id TEXT;

-- 4. Add pool identity to rewards for future reward allocation.
ALTER TABLE rewards ADD COLUMN reward_pool_id TEXT;

-- 5. The existing Koin pool becomes the pool for the first existing event.
UPDATE events
SET reward_pool_id = 'reward_pool_legacy_koin_001'
WHERE event_id = 'event_ef25c5ac-8309-438f-800b-8bb1b9d0bad5';

UPDATE event_rewards
SET reward_pool_id = 'reward_pool_legacy_koin_001'
WHERE event_id = 'event_ef25c5ac-8309-438f-800b-8bb1b9d0bad5';

-- Its full 250-stock allocation is already committed to that event.
UPDATE reward_pool
SET quota_used = 250,
    updated_at = '2026-09-20T00:00:00.000Z'
WHERE reward_pool_id = 'reward_pool_legacy_koin_001';

-- 6. Create a NEW Koin pool instance for the second existing event.
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
  'reward_pool_legacy_koin_002',
  reward_type,
  quota_total,
  250,
  0,
  active,
  description,
  valid_from,
  valid_until,
  terms,
  created_by,
  created_at,
  '2026-09-20T00:00:00.000Z',
  budget_total
FROM reward_pool
WHERE reward_pool_id = 'reward_pool_legacy_koin_001';

UPDATE events
SET reward_pool_id = 'reward_pool_legacy_koin_002'
WHERE event_id = 'event_10792fe9-c725-477e-8109-4489000f1481';

UPDATE event_rewards
SET reward_pool_id = 'reward_pool_legacy_koin_002'
WHERE event_id = 'event_10792fe9-c725-477e-8109-4489000f1481';

-- 7. Rebuild indexes used by the application.
CREATE INDEX IF NOT EXISTS idx_event_rewards_event_position
ON event_rewards(event_id, position);

CREATE INDEX IF NOT EXISTS idx_event_rewards_pool
ON event_rewards(reward_pool_id);

CREATE INDEX IF NOT EXISTS idx_events_active
ON events(active);

CREATE INDEX IF NOT EXISTS idx_events_period
ON events(starts_at, ends_at);

CREATE INDEX IF NOT EXISTS idx_events_reward_pool
ON events(reward_pool_id);

CREATE INDEX IF NOT EXISTS idx_rewards_customer_status
ON rewards(customer_id, status);

CREATE INDEX IF NOT EXISTS idx_rewards_token_ref
ON rewards(token_ref);

CREATE INDEX IF NOT EXISTS idx_rewards_pool
ON rewards(reward_pool_id);

PRAGMA foreign_keys=ON;

