CREATE TABLE event_images (
    event_id TEXT PRIMARY KEY REFERENCES events(event_id) ON DELETE CASCADE,
    mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/webp')),
    image_blob BLOB NOT NULL,
    byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 307200),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

