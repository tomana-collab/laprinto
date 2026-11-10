-- יישור המלאי: כל מכירה (גם מלפני תחילת המעקב) יורדת מהמלאי.
--
-- מוצר שלא נספר ידנית (מלאי פתיחה 0): מעכשיו המלאי = מה שנקלט בתעודות - כל מה שנמכר.
-- מוצר שנספר ידנית (מלאי פתיחה שונה מ-0): המלאי הנוכחי שלו נשמר בדיוק כמו שהוא,
--   ע"י תיקון מלאי הפתיחה בהפרש, כדי לא לדרוס ספירה פיזית.
-- מוצרים חדשים יתחילו אף הם לספור את כל המכירות.

-- 1) ה-view: מקשר הזמנה למוצר לפי מק"ט, ותאריך הזמנה חסר נחשב כתאריך היצירה
create or replace view product_stock with (security_invoker = true) as
with ord as (
  select
    coalesce(
      (select p2.id from products p2 where coalesce(o.sku, '') <> '' and p2.sku = o.sku limit 1),
      o.product_id
    ) as pid,
    o.quantity,
    coalesce(o.order_date, o.created_at) as order_date
  from orders o
  where o.wc_status is null or o.wc_status in ('processing', 'completed')
)
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
  select ord.pid as product_id, sum(ord.quantity) as qty
  from ord join products pp on pp.id = ord.pid
  where ord.order_date >= coalesce(pp.stock_from, '-infinity'::timestamptz)
  group by ord.pid
) s on s.product_id = p.id
left join (
  select i.product_id, sum(i.quantity) as qty
  from stock_receipt_items i join stock_receipts h on h.id = i.receipt_id
  where h.status = 'בהמתנה לאספקה'
  group by i.product_id
) w on w.product_id = p.id
left join (
  select pid as product_id, sum(quantity) as qty from ord where pid is not null group by pid
) t on t.product_id = p.id;

grant select on product_stock to authenticated;

-- 2) שימור המלאי של מוצרים שנספרו ידנית, ואז הזזת תאריך ההתחלה לתחילת הזמן
update products p
set opening_stock = case
      when coalesce(p.opening_stock, 0) <> 0 then p.opening_stock + (s.sold_total - s.sold)
      else p.opening_stock
    end,
    stock_from = '-infinity'
from product_stock s
where s.product_id = p.id;

alter table products alter column stock_from set default '-infinity';

notify pgrst, 'reload schema';
