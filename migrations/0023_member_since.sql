-- ============================================================
-- 0023: Kolom customers.member_since SUDAH ADA di database (migrasi lama),
-- jadi tidak ditambahkan lagi. Migrasi ini hanya melengkapi member lama
-- yang tanggal bergabungnya masih kosong, supaya pertumbuhan Total Member
-- di Overview Owner bisa dihitung per rentang tanggal.
-- ============================================================

UPDATE customers
SET member_since = created_at
WHERE is_member = 1 AND member_since IS NULL;
