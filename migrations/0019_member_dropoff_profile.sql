-- ============================================================
-- 0019: profil customer (alamat), status member (join), data drop-off
-- lengkap, klaim reward, dan pengaturan program yang dikelola Owner.
-- ============================================================

-- Profil customer. Nama sudah ada sejak 0003; alamat baru.
ALTER TABLE customers ADD COLUMN address TEXT NOT NULL DEFAULT '';

-- Status member: customer harus JOIN dulu. 0 = belum member, 1 = member.
ALTER TABLE customers ADD COLUMN is_member INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN member_since TEXT;

-- Customer yang sudah punya progress koin sebelum fitur join ada
-- dianggap sudah member (tidak kehilangan data lama).
UPDATE customers
SET is_member = 1,
    member_since = COALESCE(
      (SELECT updated_at FROM member_progress p WHERE p.customer_id = customers.customer_id),
      created_at
    )
WHERE customer_id IN (SELECT customer_id FROM member_progress);

-- Drop-off: jumlah keranjang/bungkus dan estimasi selesai.
ALTER TABLE dropoff_orders ADD COLUMN item_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE dropoff_orders ADD COLUMN item_unit TEXT NOT NULL DEFAULT 'BASKET';
ALTER TABLE dropoff_orders ADD COLUMN est_done_at TEXT;

-- Reward: customer menekan "Klaim"; staff yang menyerahkan (FULFILLED).
ALTER TABLE member_rewards ADD COLUMN claimed_at TEXT;

-- Pengaturan program yang HANYA boleh diubah Owner (JSON).
-- Isi: { member: { enabled, bonusEveryCoins, bonusCoins, bagAtCoins },
--        dropoff: { estimateHours } }
CREATE TABLE IF NOT EXISTS program_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customers_is_member ON customers(is_member);
