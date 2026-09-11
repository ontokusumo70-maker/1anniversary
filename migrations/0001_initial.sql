PRAGMA foreign_keys = ON;

-- ============================================================
-- TERAS LAUNDRY 1st ANNIVERSARY 2026
-- MASTER DATABASE MIGRATION
-- D1 SOURCE OF TRUTH
-- ============================================================


-- ============================================================
-- CUSTOMERS
-- ============================================================

CREATE TABLE customers (
    customer_id TEXT PRIMARY KEY,
    phone_hash TEXT NOT NULL UNIQUE,
    phone_masked TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX idx_customers_phone_hash
ON customers(phone_hash);


-- ============================================================
-- TRANSACTIONS
-- ============================================================

CREATE TABLE transactions (
    transaction_id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    service_type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    created_at TEXT NOT NULL,

    FOREIGN KEY (customer_id)
        REFERENCES customers(customer_id)
);

CREATE INDEX idx_transactions_customer_created
ON transactions(customer_id, created_at);


-- ============================================================
-- PLAYS
-- ============================================================

CREATE TABLE plays (
    play_id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    transaction_id TEXT NOT NULL,
    session_id TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    finished_at TEXT,

    FOREIGN KEY (customer_id)
        REFERENCES customers(customer_id),

    FOREIGN KEY (transaction_id)
        REFERENCES transactions(transaction_id)
);

CREATE INDEX idx_plays_transaction_status
ON plays(transaction_id, status);


-- ============================================================
-- SESSIONS
-- ============================================================

CREATE TABLE sessions (
    session_id TEXT PRIMARY KEY,
    play_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    status TEXT NOT NULL,

    FOREIGN KEY (play_id)
        REFERENCES plays(play_id)
);

CREATE INDEX idx_sessions_session
ON sessions(session_id);


-- ============================================================
-- REWARD POOL
-- ============================================================

CREATE TABLE reward_pool (
    reward_type TEXT PRIMARY KEY,
    quota_total INTEGER NOT NULL,
    quota_used INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_reward_pool_type_active
ON reward_pool(reward_type, active);


-- ============================================================
-- REWARDS
-- Lifecycle:
-- MENANG → KLAIM → REDEEM → DIPERGUNAKAN
-- ============================================================

CREATE TABLE rewards (
    reward_id TEXT PRIMARY KEY,
    play_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    token_ref TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    claimed_at TEXT,
    redeemed_at TEXT,
    used_at TEXT,

    FOREIGN KEY (play_id)
        REFERENCES plays(play_id),

    FOREIGN KEY (customer_id)
        REFERENCES customers(customer_id)
);

CREATE INDEX idx_rewards_token_ref
ON rewards(token_ref);

CREATE INDEX idx_rewards_customer_status
ON rewards(customer_id, status);


-- ============================================================
-- AUDIT LOG
-- ============================================================

CREATE TABLE audit_log (
    audit_id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    action TEXT NOT NULL,
    actor TEXT NOT NULL,
    result TEXT NOT NULL
);

CREATE INDEX idx_audit_timestamp_entity
ON audit_log(timestamp, entity_type, entity_id);


-- ============================================================
-- STAFF USERS
-- ============================================================

CREATE TABLE staff_users (
    staff_id TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    credential_ref TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_staff_role_active
ON staff_users(role, active);


-- ============================================================
-- ASSETS
-- R2 IS NOT ACTIVATED CURRENTLY.
-- This table stores metadata/reference only.
-- ============================================================

CREATE TABLE assets (
    asset_id TEXT PRIMARY KEY,
    r2_key TEXT,
    type TEXT NOT NULL,
    version TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_assets_type_version
ON assets(type, version);


-- ============================================================
-- MACHINE STATUS
-- 5 WASHERS + 5 DRYERS
--
-- Washer operating duration: 32 minutes
-- Dryer operating duration: 50 minutes
--
-- Status:
-- IDLE
-- IN_USE
-- ============================================================

CREATE TABLE machines (
    machine_id TEXT PRIMARY KEY,

    machine_type TEXT NOT NULL
        CHECK (machine_type IN ('WASHER', 'DRYER')),

    machine_number INTEGER NOT NULL,

    status TEXT NOT NULL DEFAULT 'IDLE'
        CHECK (status IN ('IDLE', 'IN_USE')),

    started_at TEXT,
    expected_end_at TEXT,

    activated_by TEXT,

    created_at TEXT NOT NULL,

    UNIQUE(machine_type, machine_number)
);

CREATE INDEX idx_machines_type_status
ON machines(machine_type, status);


-- ============================================================
-- MACHINE OPERATIONS
-- Historical operating records
-- Used by Owner for daily/weekly/monthly/yearly statistics.
-- ============================================================

CREATE TABLE machine_operations (
    operation_id TEXT PRIMARY KEY,

    machine_id TEXT NOT NULL,

    machine_type TEXT NOT NULL
        CHECK (machine_type IN ('WASHER', 'DRYER')),

    machine_number INTEGER NOT NULL,

    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL,

    duration_seconds INTEGER NOT NULL,

    activated_by TEXT NOT NULL,

    created_at TEXT NOT NULL,

    FOREIGN KEY (machine_id)
        REFERENCES machines(machine_id)
);

CREATE INDEX idx_machine_operations_machine_started
ON machine_operations(machine_id, started_at);

CREATE INDEX idx_machine_operations_started
ON machine_operations(started_at);

CREATE INDEX idx_machine_operations_type_started
ON machine_operations(machine_type, started_at);


-- ============================================================
-- MACHINE MASTER DATA
-- 5 WASHERS
-- 5 DRYERS
-- All machines start IDLE.
-- ============================================================

INSERT INTO machines (
    machine_id,
    machine_type,
    machine_number,
    status,
    created_at
)
VALUES
    ('W1', 'WASHER', 1, 'IDLE', CURRENT_TIMESTAMP),
    ('W2', 'WASHER', 2, 'IDLE', CURRENT_TIMESTAMP),
    ('W3', 'WASHER', 3, 'IDLE', CURRENT_TIMESTAMP),
    ('W4', 'WASHER', 4, 'IDLE', CURRENT_TIMESTAMP),
    ('W5', 'WASHER', 5, 'IDLE', CURRENT_TIMESTAMP),

    ('D1', 'DRYER', 1, 'IDLE', CURRENT_TIMESTAMP),
    ('D2', 'DRYER', 2, 'IDLE', CURRENT_TIMESTAMP),
    ('D3', 'DRYER', 3, 'IDLE', CURRENT_TIMESTAMP),
    ('D4', 'DRYER', 4, 'IDLE', CURRENT_TIMESTAMP),
    ('D5', 'DRYER', 5, 'IDLE', CURRENT_TIMESTAMP);
