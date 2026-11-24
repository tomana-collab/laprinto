-- מצב תשלום לספק על תעודה: שולם / לא שולם / שולם חלקית (+ סכום ששולם ותאריך תשלום).
-- תעודות קיימות נשארות NULL ("לא סומן") כדי לא לנחש אם שולמו.
alter table public.stock_receipts
  add column if not exists payment_status text check (payment_status in ('שולם', 'לא שולם', 'שולם חלקית')),
  add column if not exists paid_amount numeric(12,2),
  add column if not exists paid_at date;
