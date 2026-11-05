-- סה"כ יחידות שנמכרו (מכל ההזמנות שנספרות כמכירה), בנפרד מהכמות שיורדת מהמלאי (מאז stock_from).
create or replace view product_stock with (security_invoker = true) as
select
  p.id as product_id,
  coalesce(p.opening_stock, 0) as opening,
  coalesce(r.qty, 0) as received,
  coalesce(s.qty, 0) as sold,
  coalesce(p.opening_stock, 0) + coalesce(r.qty, 0) - coalesce(s.qty, 0) as stock,
  coalesce(w.qty, 0) as incoming,
  coalesce(t.qty, 0) as sold_total
from products p
left join (
  select i.product_id, sum(i.quantity) as qty
  from stock_receipt_items i join stock_receipts h on h.id = i.receipt_id
  where coalesce(h.status, 'סופק') = 'סופק'
  group by i.product_id
) r on r.product_id = p.id
left join (
  select o.product_id, sum(o.quantity) as qty
  from orders o
  join products pp on pp.id = o.product_id
  where (o.wc_status is null or o.wc_status in ('processing', 'completed'))
    and o.order_date >= coalesce(pp.stock_from, '-infinity'::timestamptz)
  group by o.product_id
) s on s.product_id = p.id
left join (
  select i.product_id, sum(i.quantity) as qty
  from stock_receipt_items i join stock_receipts h on h.id = i.receipt_id
  where h.status = 'בהמתנה לאספקה'
  group by i.product_id
) w on w.product_id = p.id
left join (
  select o.product_id, sum(o.quantity) as qty
  from orders o
  where o.wc_status is null or o.wc_status in ('processing', 'completed')
  group by o.product_id
) t on t.product_id = p.id;

grant select on product_stock to authenticated;
notify pgrst, 'reload schema';
