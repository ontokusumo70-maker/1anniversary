-- TERAS LAUNDRY SERVICE SETTINGS
-- Owner-editable Layanan & Fasilitas configuration.
CREATE TABLE IF NOT EXISTS service_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data_json TEXT NOT NULL,
    photo_mime TEXT,
    photo_blob BLOB,
    updated_at TEXT NOT NULL,
    updated_by TEXT
);

INSERT OR IGNORE INTO service_settings (
    id, data_json, photo_mime, photo_blob, updated_at, updated_by
) VALUES (
    1,
    '{"description":"Semua kenyamanan untuk pengalaman laundry terbaik","address1":"Jl. Gegerkalong Hilir No.27","address2":"Ciwaruga-Bandung","phone":"085117624377","mapUrl":"https://maps.app.goo.gl/3KfFnHuLeZRsBnYG6?g_st=ic","instagram":"https://www.instagram.com/teraslaundrycoin.ciwaruga?stkn=MWVzYTN1dHptaHp6bQ==","tiktok":"https://www.tiktok.com/@teraslaundrycoinciwaruga?_r=1&_t=ZS-99mUOH4ItNN","facebook":"https://www.facebook.com/share/1BuDpWuX5J/?mibextid=wwXIfr","selfStart":"07:00","selfEnd":"21:00","dropStart":"07:00","dropEnd":"23:00","coinLabel":"1 Koin","coinPrice":"Rp 10.000,- / 7 Kg","dropLabel":"Drop-off +","dropPrice":"Rp 10.000,-","facilitiesMain":["Washer 5 unit","Dryer 5 unit","Koin untuk pengoperasian mesin","Laundry Bag","Detergent Cair","Parfum/pewangi pakaian","Meja lipat pakaian"],"facilitiesSupport":["Area Parkir","Ruang tunggu smoking/non-smoking","Free WIFI"],"facilitiesFnb":["Aneka Minuman","Aneka Cemilan","Es Batu Kristal Rp 1.500,-/ Kg"]}',
    NULL,
    NULL,
    datetime('now'),
    NULL
);

