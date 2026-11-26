-- מחיר קנייה נכון ליום המכירה: לכל שורת הזמנה נשמרת עלות ליחידה (כולל מע"מ, אחרי הנחת ספק) ברגע שהיא נכנסת.
-- הרווח בהזמנות ובדשבורד מחושב לפיה, כך ששינוי מחיר קנייה אחר כך לא משנה רווח של הזמנות שכבר נמכרו.
-- אם בזמן המכירה לא הייתה עלות למוצר (NULL) — החישוב משתמש בעלות הנוכחית של המוצר.
alter table public.orders add column if not exists cost_at_sale numeric;

create or replace function public.orders_set_cost_at_sale() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.product_id is null then
    if tg_op = 'UPDATE' and old.product_id is not null then new.cost_at_sale := null; end if;
    return new;
  end if;
  if new.cost_at_sale is null or (tg_op = 'UPDATE' and new.product_id is distinct from old.product_id) then
    select nullif(p.cost_with_vat, 0) into new.cost_at_sale from products p where p.id = new.product_id;
  end if;
  return new;
end $$;

drop trigger if exists orders_cost_at_sale on public.orders;
create trigger orders_cost_at_sale before insert or update of product_id on public.orders
  for each row execute function public.orders_set_cost_at_sale();

-- מילוי לאחור להזמנות קיימות: לפי התעודה האחרונה שסופקה עד יום ההזמנה (מחיר אחרי הנחה × מע"מ),
-- ואם אין תעודה כזו — העלות הנוכחית של המוצר.
update public.orders o set cost_at_sale = coalesce(
  (select round(i.unit_cost * (1 - coalesce(i.discount_percent, 0) / 100) * 1.18, 2)
     from stock_receipt_items i join stock_receipts h on h.id = i.receipt_id
    where i.product_id = o.product_id and coalesce(h.status, 'סופק') = 'סופק' and i.unit_cost > 0
      and h.doc_date <= (coalesce(o.order_date, o.created_at) at time zone 'Asia/Jerusalem')::date
    order by h.doc_date desc, h.created_at desc limit 1),
  (select nullif(p.cost_with_vat, 0) from products p where p.id = o.product_id))
where o.product_id is not null and o.cost_at_sale is null;

notify pgrst, 'reload schema';
-- חזרה: drop trigger orders_cost_at_sale on orders; drop function orders_set_cost_at_sale(); alter table orders drop column cost_at_sale;
