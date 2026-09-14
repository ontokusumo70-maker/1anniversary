-- Reward Pool: Owner budget per reward.
ALTER TABLE reward_pool ADD COLUMN budget_total INTEGER NOT NULL DEFAULT 0 CHECK (budget_total >= 0);

