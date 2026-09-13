-- TERAS LAUNDRY OWNER EVENT REWARDS
-- Supports multiple rewards per event while retaining the legacy primary reward columns.

CREATE TABLE event_rewards (
    event_reward_id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
    reward_type TEXT NOT NULL,
    reward_quantity INTEGER NOT NULL CHECK (reward_quantity > 0),
    position INTEGER NOT NULL CHECK (position >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_event_rewards_event_position
ON event_rewards(event_id, position);

