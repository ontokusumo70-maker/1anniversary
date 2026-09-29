-- ============================================================
-- ANTREAN SELF-SERVICE (Washer & Dryer)
-- Bukan Drop-off. Ini murni antrean menunggu MESIN kosong.
-- Satu antrean gabungan untuk Washer (5 unit), satu untuk Dryer (5 unit).
-- Customer boleh memilih mesin tertentu sebagai preferensi saja;
-- itu TIDAK membuat antrean baru (queue_type tetap WASHER/DRYER).
-- Nomor antrean di-reset setiap hari (berbeda dari nomor Drop-off
-- yang tidak pernah direset).
-- ============================================================

-- Counter harian per jenis mesin, dipakai untuk alokasi nomor antrean
-- yang aman dari race condition (pola sama seperti dropoff_sequence).
CREATE TABLE self_service_counters (
    queue_date TEXT NOT NULL,
    machine_type TEXT NOT NULL CHECK (machine_type IN ('WASHER', 'DRYER')),
    next_number INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (queue_date, machine_type)
);

CREATE TABLE self_service_tickets (
    ticket_id TEXT PRIMARY KEY,
    queue_date TEXT NOT NULL,
    queue_number INTEGER NOT NULL,
    machine_type TEXT NOT NULL CHECK (machine_type IN ('WASHER', 'DRYER')),
    customer_id TEXT NOT NULL REFERENCES customers(customer_id),
    preferred_machine_id TEXT,
    status TEXT NOT NULL DEFAULT 'WAITING'
        CHECK (status IN ('WAITING', 'CALLED', 'ACTIVATED', 'NO_SHOW', 'CANCELLED')),
    created_at TEXT NOT NULL,
    called_at TEXT,
    no_show_at TEXT,
    activated_at TEXT,
    activated_machine_id TEXT,
    UNIQUE (queue_date, machine_type, queue_number)
);

-- Anti-duplikasi tingkat database: satu customer tidak boleh punya
-- lebih dari satu tiket AKTIF (WAITING/CALLED) untuk jenis mesin yang
-- sama pada hari yang sama. Ini partial unique index, ditegakkan oleh
-- SQLite/D1 sendiri, bukan hanya dicek di kode.
CREATE UNIQUE INDEX idx_self_service_one_active_per_customer
ON self_service_tickets(customer_id, machine_type, queue_date)
WHERE status IN ('WAITING', 'CALLED');

CREATE INDEX idx_self_service_staff_list
ON self_service_tickets(queue_date, machine_type, status, queue_number);

CREATE INDEX idx_self_service_customer
ON self_service_tickets(customer_id, queue_date);
