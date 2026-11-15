-- מסכי המלאי, השלמת מוצרים וההזמנות מתעדכנים מיד כשמשהו משתנה (תעודה חדשה, הזמנה חדשה, שינוי מוצר), בלי רענון ידני.
-- Supabase Realtime שולח אירוע על שינוי בטבלאות האלה, והפורטל טוען מחדש. ההרשאות (RLS) נשמרות: רק משתמש מחובר מקבל אירועים.
-- לא משנה נתונים. חזרה אחורה: בסוף הקובץ.
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['orders', 'stock_receipts', 'stock_receipt_items', 'products'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- חזרה אחורה:
-- alter publication supabase_realtime drop table public.orders, public.stock_receipts, public.stock_receipt_items, public.products;
