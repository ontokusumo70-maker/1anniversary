-- ============================================================
-- REQUEST ANTAR / JEMPUT (customer -> staff)
-- Customer membuat request, Staff mengonfirmasi lalu menandai selesai.
-- Status: NEW -> CONFIRMED -> COMPLETED  (NEW -> REJECTED bila ditolak).
-- Jam operasional, status aktif layanan, dan minimum berat diatur Owner
-- lewat service_settings (pickupDelivery*), bukan di tabel ini.
-- ============================================================

CREATE TABLE delivery_requests (
    request_id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(customer_id),
    service_type TEXT NOT NULL CHECK (service_type IN ('PICKUP', 'DELIVERY')),
    scheduled_date TEXT NOT NULL,
    scheduled_time TEXT NOT NULL,
    contact_name TEXT NOT NULL,
    contact_phone TEXT NOT NULL,
    address TEXT NOT NULL,
    est_weight_kg REAL NOT NULL CHECK (est_weight_kg > 0 AND est_weight_kg <= 99),
    item_count INTEGER NOT NULL CHECK (item_count >= 1 AND item_count <= 20),
    item_unit TEXT NOT NULL CHECK (item_unit IN ('BASKET', 'BAG')),
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'NEW'
        CHECK (status IN ('NEW', 'CONFIRMED', 'COMPLETED', 'REJECTED')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    confirmed_at TEXT,
    confirmed_by TEXT,
    completed_at TEXT,
    completed_by TEXT,
    rejected_at TEXT,
    rejected_by TEXT
);

CREATE INDEX idx_delivery_requests_status
ON delivery_requests(status, scheduled_date, scheduled_time);

CREATE INDEX idx_delivery_requests_customer
ON delivery_requests(customer_id, created_at);
