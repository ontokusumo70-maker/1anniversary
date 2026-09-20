-- TERAS LAUNDRY REWARD POOL INSTANCES
-- V19: setiap Reward Pool adalah instance stok tersendiri.
-- reward_type menjadi nama/display type dan tidak lagi menjadi primary key.
-- Event menyimpan reward_pool_id sehingga satu tipe reward dapat dibuat
-- sebagai pool baru untuk event berbeda.

PRAGMA foreign_keys = OFF;

ALTER TABLE reward_pool RENAME TO reward_pool_legacy;

CREATE TABLE reward_pool (
    reward_pool_id TEXT PRIMARY KEY,
    reward_type TEXT NOT NULL,
    quota_total INTEGER NOT NULL CHECK (quota_total > 0),
    quota_used INTEGER NOT NULL DEFAULT 0 CHECK (quota_used >= 0),
    quota_claimed INTEGER NOT NULL DEFAULT 0 CHECK (quota_claimed >= 0),
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

INSERT INTO reward_pool (
    reward_pool_id, reward_type, quota_total, quota_used, quota_claimed,
    active, description, valid_from, valid_until, terms, created_by,
    created_at, updated_at, budget_total
)
SELECT
    'reward_pool_legacy_' || lower(hex(randomblob(16))),
    reward_type,
    quota_total,
    0,
    MAX(0, quota_used),
    active,
    description,
    valid_from,
    valid_until,
    terms,
    created_by,
    created_at,
    updated_at,
    budget_total
FROM reward_pool_legacy;

ALTER TABLE events ADD COLUMN reward_pool_id TEXT;
ALTER TABLE event_rewards ADD COLUMN reward_pool_id TEXT;
ALTER TABLE rewards ADD COLUMN reward_pool_id TEXT;

CREATE TEMP TABLE reward_pool_event_map (
    event_reward_id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    reward_type TEXT NOT NULL,
    reward_quantity INTEGER NOT NULL,
    reward_pool_id TEXT NOT NULL
);

INSERT INTO reward_pool_event_map (
    event_reward_id,
    event_id,
    reward_type,
    reward_quantity,
    reward_pool_id
)
SELECT
    er.event_reward_id,
    er.event_id,
    er.reward_type,
    er.reward_quantity,
    CASE
        WHEN ROW_NUMBER() OVER (
            PARTITION BY er.reward_type
            ORDER BY er.event_id ASC, er.position ASC, er.event_reward_id ASC
        ) = 1
        THEN (
            SELECT rp.reward_pool_id
            FROM reward_pool rp
            WHERE rp.reward_type = er.reward_type
            ORDER BY rp.created_at ASC, rp.reward_pool_id ASC
            LIMIT 1
        )
        ELSE 'reward_pool_migrated_' || er.event_reward_id
    END
FROM event_rewards er;

-- Existing legacy events that reused one reward type are split into
-- dedicated pools. The additional pool receives the quantity that
-- was already allocated to that event.
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
    m.reward_pool_id,
    legacy.reward_type,
    m.reward_quantity,
    m.reward_quantity,
    0,
    legacy.active,
    legacy.description,
    legacy.valid_from,
    legacy.valid_until,
    legacy.terms,
    legacy.created_by,
    legacy.created_at,
    legacy.updated_at,
    CASE
        WHEN legacy.quota_total > 0
        THEN CAST(ROUND(
            legacy.budget_total * 1.0 * m.reward_quantity / legacy.quota_total
        ) AS INTEGER)
        ELSE 0
    END
FROM reward_pool_event_map m
INNER JOIN reward_pool_legacy legacy
    ON legacy.reward_type = m.reward_type
WHERE m.reward_pool_id LIKE 'reward_pool_migrated_%';

UPDATE event_rewards
SET reward_pool_id = (
    SELECT m.reward_pool_id
    FROM reward_pool_event_map m
    WHERE m.event_reward_id = event_rewards.event_reward_id
);

UPDATE events
SET reward_pool_id = (
    SELECT er.reward_pool_id
    FROM event_rewards er
    WHERE er.event_id = events.event_id
    ORDER BY er.position ASC
    LIMIT 1
);

-- The original pool keeps the first event allocation.
-- Additional events already have their own migrated pool above.
UPDATE reward_pool
SET quota_used = COALESCE((
        SELECT SUM(er.reward_quantity)
        FROM event_rewards er
        WHERE er.reward_pool_id = reward_pool.reward_pool_id
    ), 0)
WHERE reward_pool_id NOT LIKE 'reward_pool_migrated_%';

-- Preserve legacy customer claims on the original pool.
-- Claims are not silently lost during the schema transition.
UPDATE reward_pool
SET quota_used = CASE
        WHEN quota_used < quota_claimed THEN quota_claimed
        ELSE quota_used
    END
WHERE reward_pool_id NOT LIKE 'reward_pool_migrated_%';

UPDATE rewards
SET reward_pool_id = (
    SELECT rp.reward_pool_id
    FROM reward_pool rp
    WHERE rp.reward_type = rewards.type
    ORDER BY rp.created_at ASC, rp.reward_pool_id ASC
    LIMIT 1
);
CREATE INDEX idx_reward_pool_created
ON reward_pool(created_at, reward_pool_id);

CREATE INDEX idx_event_rewards_pool_position
ON event_rewards(reward_pool_id, position);

CREATE INDEX idx_events_reward_pool
ON events(reward_pool_id);

CREATE INDEX idx_rewards_reward_pool
ON rewards(reward_pool_id);

DROP TABLE reward_pool_legacy;

PRAGMA foreign_keys = ON;

