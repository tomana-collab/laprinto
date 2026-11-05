-- ניהול מלאי: קליטת תעודות ספק (כניסה למלאי) + ירידה אוטומטית מהמלאי בכל מכירה.
-- להרצה ב-Supabase Dashboard > SQL Editor.
--
-- מלאי נוכחי = מלאי פתיחה + סך מה שנקלט בתעודות - סך מה שנמכר מאז stock_from
--   נמכר = שורות הזמנה במצב "בטיפול"/"הושלמה" (או הזמנה ידנית) שתאריכן >= stock_from
--   מלאי שלילי = חסר, כלומר סחורה שנמכרה ועדיין צריך להזמין / שעוד לא הגיעה מהספק.

alter table products add column if not exists opening_stock numeric default 0;           -- מלאי קיים בנקודת ההתחלה
alter table products add column if not exists stock_from timestamptz default now();      -- מכירות מתאריך זה ואילך יורדות מהמלאי
alter table products add column if not exists stock_min numeric default 0;               -- סף התראה ("מלאי נמוך")

create table if not exists stock_receipts (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references suppliers(id) on delete set null,
  doc_number text default '',            -- מספר תעודת משלוח / חשבונית ספק
  doc_date date default current_date,
  notes text default '',
  created_by text,
  created_at timestamptz default now()
);

create table if not exists stock_receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references stock_receipts(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  quantity numeric not null default 0,
  unit_cost numeric default 0            -- עלות ליחידה בתעודה (לפני מע"מ), לתיעוד
);
create index if not exists stock_receipt_items_product_idx on stock_receipt_items(product_id);
create index if not exists stock_receipt_items_receipt_idx on stock_receipt_items(receipt_id);

alter table stock_receipts enable row level security;
alter table stock_receipt_items enable row level security;
drop policy if exists "authenticated full access" on stock_receipts;
drop policy if exists "authenticated full access" on stock_receipt_items;
create policy "authenticated full access" on stock_receipts
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on stock_receipt_items
  for all to authenticated using (true) with check (true);

-- חישוב המלאי לכל מוצר
create or replace view product_stock with (security_invoker = true) as
select
  p.id as product_id,
  coalesce(p.opening_stock, 0) as opening,
  coalesce(r.qty, 0) as received,
  coalesce(s.qty, 0) as sold,
  coalesce(p.opening_stock, 0) + coalesce(r.qty, 0) - coalesce(s.qty, 0) as stock
from products p
left join (
  select product_id, sum(quantity) as qty from stock_receipt_items group by product_id
) r on r.product_id = p.id
left join (
  select o.product_id, sum(o.quantity) as qty
  from orders o
  join products pp on pp.id = o.product_id
  where (o.wc_status is null or o.wc_status in ('processing', 'completed'))
    and o.order_date >= coalesce(pp.stock_from, '-infinity'::timestamptz)
  group by o.product_id
) s on s.product_id = p.id;

grant select on product_stock to authenticated;

notify pgrst, 'reload schema';
