-- TERAS LAUNDRY OWNER MANAGEMENT
-- Adds customer contact fields required by Owner export and Event management.

ALTER TABLE customers ADD COLUMN name TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN email TEXT NOT NULL DEFAULT '';

CREATE INDEX idx_customers_email ON customers(email);

CREATE TABLE events (
    event_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    reward_type TEXT NOT NULL,
    reward_quantity INTEGER NOT NULL CHECK (reward_quantity > 0),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_events_period_active
ON events(active, starts_at, ends_at);

