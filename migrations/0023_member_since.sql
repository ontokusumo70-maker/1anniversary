-- ============================================================
-- 0023: Waktu customer menjadi member (untuk pertumbuhan Total Member
-- per rentang tanggal di Overview Owner).
-- Diisi otomatis lewat trigger, jadi alur "join member" tidak perlu diubah.
-- ============================================================

ALTER TABLE customers ADD COLUMN member_since TEXT;

-- Member yang sudah ada: pakai tanggal customer dibuat sebagai perkiraan.
UPDATE customers SET member_since = created_at WHERE is_member = 1 AND member_since IS NULL;

CREATE TRIGGER IF NOT EXISTS trg_customers_member_since_update
AFTER UPDATE OF is_member ON customers
WHEN NEW.is_member = 1 AND COALESCE(OLD.is_member, 0) <> 1
BEGIN
  UPDATE customers
  SET member_since = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE customer_id = NEW.customer_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_customers_member_since_insert
AFTER INSERT ON customers
WHEN NEW.is_member = 1
BEGIN
  UPDATE customers
  SET member_since = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE customer_id = NEW.customer_id;
END;
