-- ============================================================
-- 0024: Nomor order pada request Jemput + pilihan antar/pickup setelah laundry selesai.
--
-- delivery_requests.order_id    : nomor order (DO-xxxxxx) yang dicadangkan saat
--                                 customer membuat request JEMPUT; nomor yang sama
--                                 menjadi nomor drop-off.
-- delivery_requests.est_done_at : estimasi selesai pengerjaan, diisi Staff saat konfirmasi.
-- dropoff_orders.source         : WALKIN | PICKUP_REQUEST
-- dropoff_orders.return_*       : pilihan customer (DELIVERY | SELF_PICKUP) dan
--                                 konfirmasi Staff setelah laundry selesai.
-- ============================================================

ALTER TABLE delivery_requests ADD COLUMN order_id TEXT;
ALTER TABLE delivery_requests ADD COLUMN est_done_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_requests_order
ON delivery_requests(order_id) WHERE order_id IS NOT NULL;

ALTER TABLE dropoff_orders ADD COLUMN source TEXT NOT NULL DEFAULT 'WALKIN';
ALTER TABLE dropoff_orders ADD COLUMN delivery_request_id TEXT;
ALTER TABLE dropoff_orders ADD COLUMN return_method TEXT;
ALTER TABLE dropoff_orders ADD COLUMN return_chosen_at TEXT;
ALTER TABLE dropoff_orders ADD COLUMN return_confirmed_at TEXT;
ALTER TABLE dropoff_orders ADD COLUMN return_confirmed_by TEXT;

CREATE INDEX IF NOT EXISTS idx_dropoff_orders_request
ON dropoff_orders(delivery_request_id);
