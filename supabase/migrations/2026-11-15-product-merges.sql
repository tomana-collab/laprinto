-- איחוד מוצרים: מוצר שנוצר בטעות (למשל וריאציה שלא קיימת באמת) מאוחד למוצר הנכון.
-- כל המכירות והקליטות של המוצר המאוחד נספרות על המוצר שאליו איחדו, בחישוב המלאי (view product_stock).
-- האיחוד נשמר בטבלה נפרדת, ולכן סנכרון המוצרים וההזמנות מ-WooCommerce לא מבטל אותו. שורות ההזמנה עצמן לא משתנות.
-- לא מוחק ולא משנה נתונים קיימים. חזרה אחורה: בסוף הקובץ.
create table if not exists product_merges (
  from_product_id uuid primary key references products(id) on delete cascade,
  into_product_id uuid not null references products(id) on delete cascade,
  note text,
  created_at timestamptz not null default now(),
  check (from_product_id <> into_product_id)
);
alter table product_merges enable row level security;
revoke all on product_merges from anon, authenticated;
grant select on product_merges to authenticated;
drop policy if exists "product_merges read CRM members" on product_merges;
create policy "product_merges read CRM members" on product_merges for select to authenticated
  using (exists (select 1 from team_members tm where lower(tm.email) = lower((select auth.jwt() ->> 'email'))));
drop policy if exists "mfa required" on product_merges;
create policy "mfa required" on product_merges as restrictive for all to authenticated using ((select mfa_ok()));
drop policy if exists "session max 7 days" on product_merges;
create policy "session max 7 days" on product_merges as restrictive for all to authenticated
  using ((select public.session_is_fresh())) with check ((select public.session_is_fresh()));

create or replace view product_stock with (security_invoker = true) as
WITH ord0 AS (
         SELECT
                CASE
                    WHEN o.product_id IS NOT NULL AND COALESCE(o.sku, ''::text) <> ''::text AND (EXISTS ( SELECT 1
                       FROM products px
                      WHERE px.id = o.product_id AND px.sku = o.sku)) THEN o.product_id
                    ELSE COALESCE(( SELECT p2.id
                       FROM products p2
                      WHERE COALESCE(o.sku, ''::text) <> ''::text AND p2.sku = o.sku
                      ORDER BY ((EXISTS ( SELECT 1
                               FROM products c
                              WHERE c.wc_parent_id = p2.wc_product_id))), (p2.wc_removed_at IS NOT NULL), p2.id
                     LIMIT 1), o.product_id)
                END AS pid,
            o.quantity,
            COALESCE(o.order_date, o.created_at) AS order_date,
            o.wc_status = 'completed'::text OR COALESCE(btrim(o.handling_status), ''::text) <> ''::text AS is_final
           FROM orders o
          WHERE (o.wc_status IS NULL OR (o.wc_status = ANY (ARRAY['processing'::text, 'completed'::text]))) AND NOT o.not_supplied
        ), ord AS (
         SELECT COALESCE(m.into_product_id, o0.pid) AS pid,
            o0.quantity,
            o0.order_date,
            o0.is_final
           FROM ord0 o0
             LEFT JOIN product_merges m ON m.from_product_id = o0.pid
        )
 SELECT p.id AS product_id,
    COALESCE(p.opening_stock, 0::numeric) AS opening,
    COALESCE(r.qty, 0::numeric) AS received,
    COALESCE(s.qty, 0::numeric) AS sold,
    COALESCE(p.opening_stock, 0::numeric) + COALESCE(r.qty, 0::numeric) - COALESCE(s.qty, 0::numeric) AS stock,
    COALESCE(w.qty, 0::numeric) AS incoming,
    COALESCE(t.qty, 0::numeric) AS sold_total,
    COALESCE(op.qty, 0::numeric) AS open_orders,
    COALESCE(rs.qty, 0::numeric) AS reserved
   FROM products p
     LEFT JOIN ( SELECT COALESCE(m.into_product_id, i.product_id) AS product_id,
            sum(i.quantity) AS qty
           FROM stock_receipt_items i
             JOIN stock_receipts h ON h.id = i.receipt_id
             LEFT JOIN product_merges m ON m.from_product_id = i.product_id
          WHERE COALESCE(h.status, 'סופק'::text) = 'סופק'::text
          GROUP BY (COALESCE(m.into_product_id, i.product_id))) r ON r.product_id = p.id
     LEFT JOIN ( SELECT ord.pid AS product_id,
            sum(ord.quantity) AS qty
           FROM ord
             JOIN products pp ON pp.id = ord.pid
          WHERE ord.order_date >= COALESCE(pp.stock_from, '-infinity'::timestamp with time zone)
          GROUP BY ord.pid) s ON s.product_id = p.id
     LEFT JOIN ( SELECT COALESCE(m.into_product_id, i.product_id) AS product_id,
            sum(i.quantity) AS qty
           FROM stock_receipt_items i
             JOIN stock_receipts h ON h.id = i.receipt_id
             LEFT JOIN product_merges m ON m.from_product_id = i.product_id
          WHERE h.status = 'בהמתנה לאספקה'::text
          GROUP BY (COALESCE(m.into_product_id, i.product_id))) w ON w.product_id = p.id
     LEFT JOIN ( SELECT ord.pid AS product_id,
            sum(ord.quantity) AS qty
           FROM ord
          WHERE ord.pid IS NOT NULL
          GROUP BY ord.pid) t ON t.product_id = p.id
     LEFT JOIN ( SELECT ord.pid AS product_id,
            sum(ord.quantity) AS qty
           FROM ord
          WHERE ord.pid IS NOT NULL AND NOT ord.is_final
          GROUP BY ord.pid) op ON op.product_id = p.id
     LEFT JOIN ( SELECT ord.pid AS product_id,
            sum(ord.quantity) AS qty
           FROM ord
             JOIN products pp ON pp.id = ord.pid
          WHERE NOT ord.is_final AND ord.order_date >= COALESCE(pp.stock_from, '-infinity'::timestamp with time zone)
          GROUP BY ord.pid) rs ON rs.product_id = p.id;

-- איחוד ראשון: "חנוכיית קריסטל גלית – שקוף עם זהב" נוצרה בטעות, יש רק "שקוף" (מק"ט UK59611)
insert into product_merges (from_product_id, into_product_id, note)
select f.id, t.id, 'וריאציה שנוצרה בטעות, יש רק "שקוף"'
from products f, products t
where f.wc_product_id = 3039 and t.wc_product_id = 3038 and f.sku = t.sku
on conflict (from_product_id) do nothing;

notify pgrst, 'reload schema';

-- חזרה אחורה: delete from product_merges; ואז להריץ את הגדרת ה-view מ-2026-11-15-open-orders-hold-stock.sql (ולבסוף drop table product_merges)
