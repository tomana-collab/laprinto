-- מק"ט במוצרים + סנכרון הזמנות מהאתר לטבלת orders.
-- להרצה ב-Supabase Dashboard > SQL Editor.

alter table products add column if not exists sku text default '';

-- כל שורת פריט בהזמנת אתר = שורה ב-orders. wc_line_item_id ייחודי כדי שסנכרון חוזר יעדכן ולא יכפיל.
alter table orders add column if not exists wc_order_id bigint;
alter table orders add column if not exists wc_line_item_id bigint unique;
alter table orders add column if not exists order_number text;
alter table orders add column if not exists wc_status text;           -- סטטוס באתר; ריק = הזמנה ידנית
alter table orders add column if not exists product_name text;        -- שם המוצר כפי שנרשם בהזמנה (גם אם המוצר לא קיים ב-products)
alter table orders add column if not exists sku text default '';

-- תאריך ההזמנה (באתר). להזמנות ידניות קיימות: תאריך היצירה
alter table orders add column if not exists order_date timestamptz;
update orders set order_date = created_at where order_date is null;
alter table orders alter column order_date set default now();

notify pgrst, 'reload schema';
