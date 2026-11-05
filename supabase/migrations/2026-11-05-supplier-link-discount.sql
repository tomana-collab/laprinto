-- קישור לאתר הספק, הנחת ספק, ונוסחת רווח חדשה עם מע"מ (18%) ועמלת סליקה (0.75% + מע"מ) קבועים.
-- להרצה ב-Supabase Dashboard > SQL Editor.
--
-- סדר החישוב לכל מוצר:
--   1. עלות אחרי הנחת ספק  = cost * (1 - supplier_discount_percent/100)
--   2. עלות כולל מע"מ       = (1) * 1.18
--   3. עמלת סליקה           = price * 0.75% * 1.18   (0.75% מהמחיר שנסלק + מע"מ על העמלה)
--   4. רווח סופי            = price - (2) - (3) - extra_expenses
--
-- שים לב: עמודות vat_percent / fee_percent / fee_fixed נמחקות (הערכים קבועים עכשיו).
-- עלות שהוזנה בעבר ככוללת מע"מ תחושב עכשיו עם מע"מ נוסף — בדוק את המוצרים הקיימים.

alter table products add column if not exists supplier_url text default '';
alter table products add column if not exists supplier_discount_percent numeric not null default 0;

alter table products drop column if exists margin_percent;
alter table products drop column if exists profit;
alter table products drop column if exists net_price;
alter table products drop column if exists vat_percent;
alter table products drop column if exists fee_percent;
alter table products drop column if exists fee_fixed;

alter table products add column cost_after_discount numeric generated always as (
  round(cost * (1 - supplier_discount_percent / 100), 2)
) stored;

alter table products add column cost_with_vat numeric generated always as (
  round(cost * (1 - supplier_discount_percent / 100) * 1.18, 2)
) stored;

alter table products add column clearing_fee numeric generated always as (
  round(price * 0.0075 * 1.18, 2)
) stored;

alter table products add column profit numeric generated always as (
  round(price - cost * (1 - supplier_discount_percent / 100) * 1.18 - price * 0.0075 * 1.18 - extra_expenses, 2)
) stored;

alter table products add column margin_percent numeric generated always as (
  case when price > 0 then round(
    (price - cost * (1 - supplier_discount_percent / 100) * 1.18 - price * 0.0075 * 1.18 - extra_expenses) / price * 100,
  1) else 0 end
) stored;

notify pgrst, 'reload schema';
