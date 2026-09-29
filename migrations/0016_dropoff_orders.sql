-- ============================================================
-- DROP-OFF (titip cuci)
-- Bukan antrean. Alurnya: Staff terima cucian kotor dari customer,
-- timbang, kerjakan, lalu infokan selesai untuk diambil.
-- Status hanya 3: RECEIVED -> COMPLETED -> PICKED_UP.
-- Nomor pesanan (order_id) berurutan dan TIDAK PERNAH direset harian,
-- karena cucian bisa menunggu diambil sampai 48 jam; nomor ini juga
-- yang ditulis Staff pada keranjang fisik.
-- ============================================================

CREATE TABLE dropoff_sequence (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    next_number INTEGER NOT NULL DEFAULT 1
);

INSERT INTO dropoff_sequence (id, next_number) VALUES (1, 1);

CREATE TABLE dropoff_orders (
    order_id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(customer_id),
    weight_kg REAL NOT NULL CHECK (weight_kg > 0),
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED', 'COMPLETED', 'PICKED_UP')),
    received_at TEXT NOT NULL,
    received_by TEXT NOT NULL,
    completed_at TEXT,
    completed_by TEXT,
    pickup_due_at TEXT,
    picked_up_at TEXT,
    picked_up_by TEXT
);

CREATE INDEX idx_dropoff_orders_customer
ON dropoff_orders(customer_id, status);

CREATE INDEX idx_dropoff_orders_status
ON dropoff_orders(status, received_at);
