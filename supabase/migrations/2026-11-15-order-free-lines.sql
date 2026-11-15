-- מוצר שמוסיפים ידנית להזמנת אתר, ללא חיוב (מתנה). נשמר כשורת פריט נוספת באותה הזמנה:
--  • אותו wc_order_id ואותם פרטי הזמנה/סטטוס, מחיר 0, בלי wc_line_item_id — לכן סנכרון ההזמנות מ-WooCommerce לא נוגע בה ולא מוחק אותה.
--  • יורדת מהמלאי בדיוק כמו שאר השורות בהזמנה (כשיש להזמנה סטטוס טיפול או שהושלמה) — דרך ה-view product_stock הקיים.
--  • העלות שלה נספרת בעלות/רווח ההזמנה (מתנה עולה כסף).
-- לא משנה ולא מוחק נתונים קיימים. חזרה אחורה: בסוף הקובץ.

alter table orders add column if not exists manual_line boolean not null default false;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'orders_manual_line_free') then
    alter table orders add constraint orders_manual_line_free check (not manual_line or coalesce(price, 0) = 0);
  end if;
end $$;

-- סטטוס הזמנת האתר מתעדכן בסנכרון רק בשורות של האתר; כאן הוא מועתק גם לשורות הידניות של אותה הזמנה
-- (אחרת הזמנה שהושלמה באתר לא הייתה מורידה את המתנה מהמלאי)
create or replace function public.orders_sync_manual_lines_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.orders m set wc_status = new.wc_status
  where m.wc_order_id = new.wc_order_id and m.manual_line and m.wc_status is distinct from new.wc_status;
  return null;
end $$;
drop trigger if exists trg_orders_sync_manual_lines on public.orders;
create trigger trg_orders_sync_manual_lines after insert or update of wc_status on public.orders
  for each row when (new.wc_line_item_id is not null and new.wc_order_id is not null)
  execute function public.orders_sync_manual_lines_status();

notify pgrst, 'reload schema';

-- חזרה אחורה:
-- drop trigger if exists trg_orders_sync_manual_lines on public.orders;
-- drop function if exists public.orders_sync_manual_lines_status();
-- delete from orders where manual_line;
-- alter table orders drop constraint if exists orders_manual_line_free, drop column if exists manual_line;
