-- ============================================================
-- 0030: Reward Member (Program) yang dipilih Owner dari Reward Pool.
-- Satu baris = satu reward pool yang dipakai di Program Member.
-- ============================================================

CREATE TABLE IF NOT EXISTS program_rewards (
    program_reward_id TEXT PRIMARY KEY,
    reward_pool_id TEXT NOT NULL UNIQUE,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_program_rewards_position
ON program_rewards(position);
