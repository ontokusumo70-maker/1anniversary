-- Jumlah koin bonus per reward (aturan Owner bisa memberi lebih dari 1 koin).
ALTER TABLE member_rewards ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1;
