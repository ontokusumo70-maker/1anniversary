-- Store normalized customer phone so authenticated Owner Customer Trace can display it unmasked.
ALTER TABLE customers ADD COLUMN phone TEXT;
