-- פרטי מזמין ופרטי הזמנה מהאתר (נמשכים בסנכרון הזמנות).
-- להרצה ב-Supabase Dashboard > SQL Editor.
-- שים לב: אלה פרטים אישיים של לקוחות; טבלת orders פתוחה לכל משתמש מחובר ב-CRM.

alter table orders add column if not exists customer_name text;
alter table orders add column if not exists customer_phone text;
alter table orders add column if not exists customer_email text;
alter table orders add column if not exists shipping_address text;
alter table orders add column if not exists shipping_method text;
alter table orders add column if not exists payment_method text;
alter table orders add column if not exists customer_note text;       -- הערת הלקוח בהזמנה
alter table orders add column if not exists personalization text;     -- התאמה אישית / מטא של הפריט
alter table orders add column if not exists coupons text;
alter table orders add column if not exists shipping_total numeric;   -- דמי משלוח (כולל מע"מ), לכל ההזמנה
alter table orders add column if not exists order_total numeric;      -- סה"כ ההזמנה כולל משלוח, לכל ההזמנה

notify pgrst, 'reload schema';
