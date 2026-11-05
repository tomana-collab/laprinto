-- ============================================================
-- סנכרון מוצרים מ-WooCommerce + חישוב רווחיות מלא (מע"מ, עמלות)
-- להרצה חד-פעמית ב-Supabase Dashboard > SQL Editor על מסד קיים.
-- (schema.sql מעודכן לאותו מבנה, להקמה מאפס.)
--
-- שים לב: price הוא עכשיו מחיר המכירה *כולל מע"מ* (כמו באתר).
-- מוצרים קיימים יקבלו vat_percent=18 — אם הזנת עבורם מחיר לפני מע"מ,
-- עדכן אותם ל-0 במוצר עצמו.
-- ============================================================

alter table products add column if not exists wc_product_id bigint unique;
alter table products add column if not exists product_url text default '';
alter table products add column if not exists regular_price numeric;
alter table products add column if not exists sale_price numeric;
alter table products add column if not exists vat_percent numeric not null default 18;
alter table products add column if not exists fee_percent numeric not null default 0;   -- עמלת סליקה באחוזים מהמחיר כולל מע"מ
alter table products add column if not exists fee_fixed numeric not null default 0;     -- עמלה קבועה לעסקה
alter table products add column if not exists synced_at timestamptz;

-- עמודות מחושבות: אי אפשר לשנות generated expression, אז מוחקים ויוצרים מחדש
alter table products drop column if exists margin_percent;
alter table products drop column if exists profit;
alter table products drop column if exists net_price;

-- מחיר ללא מע"מ
alter table products add column net_price numeric generated always as (
  round(price / (1 + vat_percent / 100), 2)
) stored;

-- רווח נקי ליחידה = מחיר ללא מע"מ - עמלות - עלות - הוצאות נלוות
alter table products add column profit numeric generated always as (
  round(
    price / (1 + vat_percent / 100)
    - (price * fee_percent / 100 + fee_fixed)
    - cost - extra_expenses,
  2)
) stored;

-- מרווח באחוזים מהמחיר ללא מע"מ
alter table products add column margin_percent numeric generated always as (
  case when price > 0 then round(
    (
      price / (1 + vat_percent / 100)
      - (price * fee_percent / 100 + fee_fixed)
      - cost - extra_expenses
    ) / (price / (1 + vat_percent / 100)) * 100,
  1) else 0 end
) stored;

-- ============================================================
-- אופציונלי: סנכרון אוטומטי כל שעה (pg_cron + pg_net).
-- דורש: Database > Extensions > להפעיל pg_cron ו-pg_net, ולהגדיר
-- SYNC_SECRET כ-secret של ה-Edge Function. מחליפים את שני הערכים
-- בשורות למטה לפני ההרצה (לא להשאיר סוד בקובץ שנשמר ב-git).
-- ============================================================
-- select cron.schedule(
--   'sync-wc-products-hourly',
--   '0 * * * *',
--   $$
--   select net.http_post(
--     url := 'https://oicyoddiruiryktaupem.supabase.co/functions/v1/sync-wc-products',
--     headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', '<SYNC_SECRET>'),
--     body := '{}'::jsonb
--   );
--   $$
-- );
