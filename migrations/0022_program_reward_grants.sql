-- ============================================================
-- 0022: Penyerahan reward program member oleh Staff.
--   program_rewards.given                    = jumlah yang sudah diserahkan
--   member_rewards.fulfilled_reward_pool_id  = reward program yang diserahkan
-- ============================================================

ALTER TABLE program_rewards ADD COLUMN given INTEGER NOT NULL DEFAULT 0;

ALTER TABLE member_rewards ADD COLUMN fulfilled_reward_pool_id TEXT;
