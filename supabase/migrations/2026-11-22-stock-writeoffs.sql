-- פחת: מוצר שנשבר / נפל / נפגם / אבד. נרשם עם סיבה וכמות, יורד מהמלאי, ושווי ההפסד נשמר לפי עלות המוצר באותו רגע.
-- הטבלה stock_writeoffs + עמודת writeoff ב-view product_stock (המלאי = פתיחה + נקלט − נמכר − פחת). לא משנה נתונים קיימים.
create table if not exists stock_writeoffs (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  quantity numeric not null check (quantity > 0),
  reason text not null default '',
  unit_cost numeric not null default 0, -- עלות ליחידה כולל מע"מ (אחרי הנחת ספק) ברגע הרישום
  created_at timestamptz not null default now(),
  created_by text not null default ''
);
create index if not exists stock_writeoffs_product on stock_writeoffs (product_id);
alter table stock_writeoffs enable row level security;
revoke all on stock_writeoffs from anon, authenticated;
grant select, insert, delete on stock_writeoffs to authenticated;
drop policy if exists "stock_writeoffs CRM members" on stock_writeoffs;
create policy "stock_writeoffs CRM members" on stock_writeoffs for all to authenticated
  using (exists (select 1 from team_members tm where lower(tm.email) = lower((select auth.jwt() ->> 'email'))))
  with check (exists (select 1 from team_members tm where lower(tm.email) = lower((select auth.jwt() ->> 'email'))));
drop policy if exists "mfa required" on stock_writeoffs;
create policy "mfa required" on stock_writeoffs as restrictive for all to authenticated using ((select mfa_ok()));
drop policy if exists "session max 7 days" on stock_writeoffs;
create policy "session max 7 days" on stock_writeoffs as restrictive for all to authenticated
  using ((select public.session_is_fresh())) with check ((select public.session_is_fresh()));
alter publication supabase_realtime add table stock_writeoffs;

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
    COALESCE(p.opening_stock, 0::numeric) + COALESCE(r.qty, 0::numeric) - COALESCE(s.qty, 0::numeric) - COALESCE(wo.qty, 0::numeric) AS stock,
    COALESCE(w.qty, 0::numeric) AS incoming,
    COALESCE(t.qty, 0::numeric) AS sold_total,
    COALESCE(op.qty, 0::numeric) AS open_orders,
    COALESCE(rs.qty, 0::numeric) AS reserved,
    COALESCE(wo.qty, 0::numeric) AS writeoff
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
          GROUP BY ord.pid) rs ON rs.product_id = p.id
     LEFT JOIN ( SELECT COALESCE(m.into_product_id, x.product_id) AS product_id,
            sum(x.quantity) AS qty
           FROM stock_writeoffs x
             LEFT JOIN product_merges m ON m.from_product_id = x.product_id
          GROUP BY (COALESCE(m.into_product_id, x.product_id))) wo ON wo.product_id = p.id;

notify pgrst, 'reload schema';
-- חזרה: להריץ שוב את הגדרת ה-view הקודמת (בלי wo ובלי writeoff), ואז: drop table stock_writeoffs;
