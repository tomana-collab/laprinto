-- ============================================================
-- Laprinto CRM — סכמת מסד נתונים ל-Supabase
-- הרץ את כל הקובץ הזה ב- Supabase Dashboard > SQL Editor > New query
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- משימות ----------
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text default '',
  assignee text default '',
  priority text default 'רגילה',        -- נמוכה / רגילה / גבוהה
  status text default 'לביצוע',          -- לביצוע / בתהליך / הושלם
  due_date date,
  created_by text,
  created_at timestamptz default now()
);

-- ---------- רעיונות ----------
create table if not exists ideas (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text default '',
  tag text default '',
  created_by text,
  created_at timestamptz default now()
);

-- ---------- מוצרים (עם חישוב רווח אוטומטי) ----------
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text default 'לבדיקה',           -- לבדיקה / להזמנה / פעיל / הופסק
  cost numeric default 0,                 -- עלות ליחידה (ספק)
  extra_expenses numeric default 0,       -- הוצאות נלוות (משלוח, פרסום ליחידה וכו')
  price numeric default 0,                -- מחיר מכירה
  supplier text default '',
  notes text default '',
  profit numeric generated always as (price - cost - extra_expenses) stored,
  margin_percent numeric generated always as (
    case when price > 0 then round(((price - cost - extra_expenses) / price) * 100, 1) else 0 end
  ) stored,
  created_by text,
  created_at timestamptz default now()
);

-- ---------- ספקים ----------
create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_person text default '',
  phone text default '',
  email text default '',
  products_supplied text default '',
  terms text default '',
  notes text default '',
  created_by text,
  created_at timestamptz default now()
);

-- ---------- הזדמנויות ----------
create table if not exists opportunities (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text default '',
  status text default 'חדש',              -- חדש / בבדיקה / במגעים / סגור-הצלחה / סגור-נכשל
  value numeric default 0,
  created_by text,
  created_at timestamptz default now()
);

-- ---------- טרנדים ----------
create table if not exists trends (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text default '',
  link text default '',
  source text default '',
  created_by text,
  created_at timestamptz default now()
);

-- ---------- משתמשים (צוות) ----------
create table if not exists team_members (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text default '',
  email text default '',
  role text default 'עובד',               -- עובד / אדמין (תיוג בלבד — לא מייצר login, ראו הערה ב-README)
  created_by text,
  created_at timestamptz default now()
);

-- ---------- הוצאות ----------
create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text default 'תפעול',          -- תפעול / שיווק / משלוחים / ציוד / אחר
  amount numeric default 0,
  supplier_id uuid references suppliers(id) on delete set null,
  paid_by uuid references team_members(id) on delete set null,
  expense_date date,
  payment_method text default 'אשראי',    -- מזומן / אשראי / העברה בנקאית
  status text default 'ממתין לתשלום',      -- ממתין לתשלום / שולם
  receipt_path text,                      -- נתיב הקובץ ב-Storage bucket "attachments"
  notes text default '',
  created_by text,
  created_at timestamptz default now()
);

-- ---------- Storage: קבצים מצורפים (חשבוניות וכו') ----------
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

create policy "attachments authenticated insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'attachments');
create policy "attachments authenticated select" on storage.objects
  for select to authenticated using (bucket_id = 'attachments');
create policy "attachments authenticated delete" on storage.objects
  for delete to authenticated using (bucket_id = 'attachments');

-- ============================================================
-- Row Level Security
-- כל משתמש מחובר (authenticated) יכול לראות/לערוך הכל.
-- זה מתאים לצוות סגור וקטן (אתה + שותף) שמתחברים עם login.
-- ============================================================
alter table tasks enable row level security;
alter table ideas enable row level security;
alter table products enable row level security;
alter table suppliers enable row level security;
alter table opportunities enable row level security;
alter table trends enable row level security;
alter table expenses enable row level security;
alter table team_members enable row level security;

create policy "authenticated full access" on tasks
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on ideas
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on products
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on suppliers
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on opportunities
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on trends
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on expenses
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on team_members
  for all to authenticated using (true) with check (true);
