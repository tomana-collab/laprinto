-- מוצר: שדה שנערך ידנית ב-CRM (שם, מק"ט, מחיר, קטגוריה, סטטוס, תמונה, תיאור...) לא נדרס בסנכרון הבא מהאתר.
-- כמו בהזמנות: עריכה של משתמש מחובר מסמנת את השדה ב-manual_fields, וסנכרון המוצרים (sync-wc-products) מדלג עליו.
-- שדות של ה-CRM בלבד (עלות, ספק, הנחת ספק, הוצאות נלוות, הערות, מלאי) ממילא לא נשלחים מהאתר. לא משנה נתונים קיימים.
alter table products add column if not exists manual_fields text[] not null default '{}';

create or replace function public.products_track_manual_edits() returns trigger
language plpgsql set search_path = '' as $$
declare
  cols text[] := array['name','sku','product_url','image_url','category','subcategory','price','regular_price','sale_price',
    'status','description','short_description'];
  c text; o jsonb := to_jsonb(old); n jsonb := to_jsonb(new);
begin
  if coalesce(auth.role(), '') = 'authenticated' then
    foreach c in array cols loop
      -- ריק ו-null נחשבים אותו דבר, כדי ששמירת טופס בלי שינוי לא תנעל שדה
      if o -> c is distinct from n -> c and not (coalesce(o ->> c, '') = '' and coalesce(n ->> c, '') = '')
         and not (c = any(new.manual_fields)) then
        new.manual_fields := new.manual_fields || c;
      end if;
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists trg_products_track_manual_edits on public.products;
create trigger trg_products_track_manual_edits before update on public.products
  for each row execute function public.products_track_manual_edits();

notify pgrst, 'reload schema';
-- חזרה: drop trigger trg_products_track_manual_edits on products; drop function products_track_manual_edits(); alter table products drop column manual_fields;
