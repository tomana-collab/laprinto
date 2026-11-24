-- איחוד הזמנות ב-CRM בלבד (לא באתר): שורה עם merged_into_wc_order_id מוצגת כחלק מההזמנה הזו.
-- הסנכרון מהאתר לא נוגע בעמודה, כך שהאיחוד נשמר. ביטול איחוד = החזרת העמודה ל-NULL.
alter table public.orders add column if not exists merged_into_wc_order_id bigint;
create index if not exists orders_merged_into_idx on public.orders (merged_into_wc_order_id) where merged_into_wc_order_id is not null;
