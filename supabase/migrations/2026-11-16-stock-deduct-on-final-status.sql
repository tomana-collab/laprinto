-- מלאי: ירידה מהמלאי הקיים רק אחרי שנקבע סטטוס טיפול להזמנה (נקלט ובטיפול / בוצעה חריטה-אריזה / יצא למשלוח / הגיע ללקוח —
-- כל אחד מהם מוריד), או כשהיא "הושלמה" באתר. הזמנה בלי סטטוס טיפול נשארת "הזמנה פתוחה" (open_orders)
-- ומשמשת למסך "השלמת מוצרים": מה הוזמן ואין במלאי.
-- לא מוחק ולא משנה נתונים; משנה רק את חישוב ה-view. עמודות קיימות נשארות באותו סדר, open_orders נוספה בסוף.

create or replace view product_stock with (security_invoker = true) as
with ord as (
  select
    coalesce(
      (select p2.id from products p2 where coalesce(o.sku, '') <> '' and p2.sku = o.sku limit 1),
      o.product_id
    ) as pid,
    o.quantity,
    coalesce(o.order_date, o.created_at) as order_date,
    (o.wc_status = 'completed' or coalesce(btrim(o.handling_status), '') <> '') as is_final
  from orders o
  where o.wc_status is null or o.wc_status in ('processing', 'completed')
)
select
  p.id as product_id,
  coalesce(p.opening_stock, 0) as opening,
  coalesce(r.qty, 0) as received,
  coalesce(s.qty, 0) as sold,                                   -- ירד מהמלאי: הזמנות עם סטטוס טיפול או שהושלמו
  coalesce(p.opening_stock, 0) + coalesce(r.qty, 0) - coalesce(s.qty, 0) as stock,
  coalesce(w.qty, 0) as incoming,
  coalesce(t.qty, 0) as sold_total,                             -- כל ההזמנות שנספרות
  coalesce(op.qty, 0) as open_orders                            -- הוזמנו ועדיין בלי סטטוס טיפול
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
  where ord.is_final and ord.order_date >= coalesce(pp.stock_from, '-infinity'::timestamptz)
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
) t on t.product_id = p.id
left join (
  select pid as product_id, sum(quantity) as qty from ord where pid is not null and not is_final group by pid
) op on op.product_id = p.id;

grant select on product_stock to authenticated;
notify pgrst, 'reload schema';

-- חזרה אחורה: להריץ שוב את supabase/migrations/2026-11-11-stock-count-all-sales.sql (סעיף 1, ה-view בלבד).
