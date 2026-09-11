/*
 * ============================================================
 * AUTH SESSIONS
 * Teras Laundry 1st Anniversary
 *
 * 0002
 *
 * Authentication session dipisahkan dari game sessions.
 * ============================================================
 */

CREATE TABLE auth_sessions (
    session_id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (
        role IN (
            'CUSTOMER',
            'STAFF',
            'OWNER'
        )
    ),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT
);

CREATE INDEX idx_auth_sessions_token_hash
    ON auth_sessions(token_hash);

CREATE INDEX idx_auth_sessions_user_id
    ON auth_sessions(user_id);

CREATE INDEX idx_auth_sessions_expires_at
    ON auth_sessions(expires_at);

CREATE INDEX idx_auth_sessions_active
    ON auth_sessions(
        token_hash,
        expires_at,
        revoked_at
    );
