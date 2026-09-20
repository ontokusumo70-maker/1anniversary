-- 0014_reward_pool_force_repair.sql
-- PRODUCTION FORCE REPAIR
-- Applies to the verified live schema where reward_pool still has
-- reward_type as PRIMARY KEY and no reward_pool_id/quota_claimed.

PRAGMA defer_foreign_keys = ON;

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

INSERT INTO reward_pool_new (
  reward_pool_id, reward_type, quota_total, quota_used, quota_claimed,
  active, description, valid_from, valid_until, terms, created_by,
  created_at, updated_at, budget_total
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

ALTER TABLE events ADD COLUMN reward_pool_id TEXT;
ALTER TABLE event_rewards ADD COLUMN reward_pool_id TEXT;
ALTER TABLE rewards ADD COLUMN reward_pool_id TEXT;

UPDATE events
SET reward_pool_id = 'reward_pool_legacy_koin_001'
WHERE event_id = 'event_ef25c5ac-8309-438f-800b-8bb1b9d0bad5';

UPDATE event_rewards
SET reward_pool_id = 'reward_pool_legacy_koin_001'
WHERE event_id = 'event_ef25c5ac-8309-438f-800b-8bb1b9d0bad5';

UPDATE reward_pool
SET quota_used = 250
WHERE reward_pool_id = 'reward_pool_legacy_koin_001';

INSERT INTO reward_pool (
  reward_pool_id, reward_type, quota_total, quota_used, quota_claimed,
  active, description, valid_from, valid_until, terms, created_by,
  created_at, updated_at, budget_total
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
  strftime('%Y-%m-%dT%H:%M:%fZ','now'),
  budget_total
FROM reward_pool
WHERE reward_pool_id = 'reward_pool_legacy_koin_001';

UPDATE events
SET reward_pool_id = 'reward_pool_legacy_koin_002'
WHERE event_id = 'event_10792fe9-c725-477e-8109-4489000f1481';

UPDATE event_rewards
SET reward_pool_id = 'reward_pool_legacy_koin_002'
WHERE event_id = 'event_10792fe9-c725-477e-8109-4489000f1481';

CREATE INDEX idx_event_rewards_pool
ON event_rewards(reward_pool_id);

CREATE INDEX idx_events_reward_pool
ON events(reward_pool_id);

CREATE INDEX idx_rewards_pool
ON rewards(reward_pool_id);

