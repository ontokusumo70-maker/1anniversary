-- TERAS LAUNDRY OWNER REWARD POOL DETAILS
-- Reward Pool stores the complete reward information used by Event selection.

ALTER TABLE reward_pool ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE reward_pool ADD COLUMN valid_from TEXT;
ALTER TABLE reward_pool ADD COLUMN valid_until TEXT;
ALTER TABLE reward_pool ADD COLUMN terms TEXT NOT NULL DEFAULT '';
ALTER TABLE reward_pool ADD COLUMN created_by TEXT NOT NULL DEFAULT 'OWNER';
ALTER TABLE reward_pool ADD COLUMN created_at TEXT NOT NULL DEFAULT '';
ALTER TABLE reward_pool ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';

UPDATE reward_pool
SET created_at = CASE WHEN created_at = '' THEN datetime('now') ELSE created_at END,
    updated_at = CASE WHEN updated_at = '' THEN datetime('now') ELSE updated_at END;

