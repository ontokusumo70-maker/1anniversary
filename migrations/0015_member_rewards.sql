-- ============================================================
-- MEMBER REWARD DIGITAL (menggantikan member card stempel manual)
-- Aturan: progress dihitung dari TOTAL KOIN YANG DIBELI, tidak pernah
-- direset. Setiap kelipatan 10 koin -> 1 Bonus Koin. Setiap kelipatan
-- 40 koin -> 1 Laundry Bag (selain Bonus Koin di kelipatan 10 itu).
-- Bonus koin yang diberikan TIDAK dihitung sebagai pembelian.
-- ============================================================

-- Akumulasi total koin yang benar-benar dibeli per customer.
CREATE TABLE member_progress (
    customer_id TEXT PRIMARY KEY REFERENCES customers(customer_id),
    total_coins_purchased INTEGER NOT NULL DEFAULT 0 CHECK (total_coins_purchased >= 0),
    updated_at TEXT NOT NULL
);

-- Satu baris = satu transaksi pembelian koin yang diinput Staff.
-- purchase_id adalah idempotency key: request yang sama (retry jaringan,
-- double tap) tidak akan pernah menambah progress dua kali.
CREATE TABLE member_purchases (
    purchase_id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(customer_id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX idx_member_purchases_customer
ON member_purchases(customer_id);

-- Hak reward yang terbentuk dari milestone. UNIQUE constraint adalah
-- lapisan terakhir anti-duplikasi: satu customer tidak mungkin punya
-- dua reward untuk milestone yang sama, walau ada request bersamaan.
CREATE TABLE member_rewards (
    reward_id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(customer_id),
    reward_type TEXT NOT NULL CHECK (reward_type IN ('BONUS_COIN', 'LAUNDRY_BAG')),
    milestone_number INTEGER NOT NULL CHECK (milestone_number > 0),
    source_purchase_id TEXT NOT NULL REFERENCES member_purchases(purchase_id),
    status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'FULFILLED')),
    created_at TEXT NOT NULL,
    fulfilled_at TEXT,
    fulfilled_by TEXT,
    UNIQUE (customer_id, reward_type, milestone_number)
);

CREATE INDEX idx_member_rewards_customer_status
ON member_rewards(customer_id, status);
