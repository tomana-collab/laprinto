-- עדכון ידני של סטטוס ההזמנה ב-CRM לא נדרס בסנכרון הבא מהאתר (מוסיף wc_status לשדות המוגנים ב-manual_fields).
-- שאר השדות כבר מוגנים מ-2026-11-18. שדות שהסנכרון בכלל לא שולח (סטטוס טיפול, הערות פנימיות, לא לספק, מוכן) לא נדרסים ממילא.
create or replace function public.orders_track_manual_edits() returns trigger
language plpgsql set search_path = '' as $$
declare
  cols text[] := array['product_id','product_name','sku','quantity','price','discount_amount','personalization',
    'customer_name','customer_phone','customer_email','shipping_address','shipping_method','payment_method',
    'customer_note','coupons','shipping_total','order_total','order_date','engraving','has_engraving','wc_status'];
  c text; o jsonb := to_jsonb(old); n jsonb := to_jsonb(new);
begin
  if coalesce(auth.role(), '') = 'authenticated' and old.wc_line_item_id is not null then
    foreach c in array cols loop
      if o -> c is distinct from n -> c and not (c = any(new.manual_fields)) then
        new.manual_fields := new.manual_fields || c;
      end if;
    end loop;
  end if;
  return new;
end $$;
-- חזרה: להריץ שוב את 2026-11-18-engraving-manual-protect.sql (בלי wc_status)
