-- ============================================================
-- Laprinto CRM — סכמת מסד נתונים ל-Supabase
-- הרץ את כל הקובץ הזה ב- Supabase Dashboard > SQL Editor > New query
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- משימות ----------
-- assignee_id (FK ל-team_members) מתווסף אחרי טבלת team_members, למטה בקובץ
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text default '',
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

alter table tasks add column if not exists assignee_id uuid references team_members(id) on delete set null;

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

-- ============================================================
-- הרשאות: is_admin() בודקת אם המשתמש המחובר מקושר (לפי מייל) לשורה
-- ב-team_members עם role='אדמין'. משמשת גם למדיניות team_members
-- עצמה (מי יכול לערוך תפקידים) וגם לחסימת expenses/attachments
-- לעובדים שאינם אדמין.
-- ============================================================
create or replace function is_admin()
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1 from team_members
    where lower(email) = lower(auth.email()) and role = 'אדמין'
  );
$$;

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

create policy "attachments admin insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'attachments' and (select is_admin()));
create policy "attachments admin select" on storage.objects
  for select to authenticated using (bucket_id = 'attachments' and (select is_admin()));
create policy "attachments admin delete" on storage.objects
  for delete to authenticated using (bucket_id = 'attachments' and (select is_admin()));

-- ============================================================
-- Row Level Security
-- ברירת מחדל: כל משתמש מחובר (authenticated) יכול לראות/לערוך הכל.
-- מתאים לצוות סגור וקטן. חריגים: expenses/attachments (אדמין בלבד),
-- ועריכת team_members עצמה (רק אדמין קובע מי אדמין).
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

create policy "expenses admin only" on expenses
  for all to authenticated using ((select is_admin())) with check ((select is_admin()));

-- team_members: כולם רואים את הרשימה, רק אדמין מוסיף/עורך/מוחק
-- (אחרת עובד יכול לשנות את עצמו לאדמין דרך הטופס)
create policy "team_members select all" on team_members
  for select to authenticated using (true);
create policy "team_members admin insert" on team_members
  for insert to authenticated with check ((select is_admin()));
create policy "team_members admin update" on team_members
  for update to authenticated using ((select is_admin())) with check ((select is_admin()));
create policy "team_members admin delete" on team_members
  for delete to authenticated using ((select is_admin()));

-- עובד יכול לערוך את עצמו (שם/טלפון), אבל לא לקדם את עצמו לאדמין (מוגן ע"י הטריגר למטה)
drop policy if exists "team_members self update" on team_members;
create policy "team_members self update" on team_members
  for update to authenticated
  using (lower(email) = lower(auth.email()))
  with check (lower(email) = lower(auth.email()));

create or replace function protect_team_member_role()
returns trigger
language plpgsql
as $$
begin
  if new.role is distinct from old.role and not (select is_admin()) then
    new.role := old.role;
  end if;
  return new;
end;
$$;

drop trigger if exists team_members_protect_role on team_members;
create trigger team_members_protect_role
before update on team_members
for each row execute function protect_team_member_role();

-- ============================================================
-- הרשמה עצמית (Login.jsx, מצב "הרשמה"): auth.signUp() חסום ברמת ה-DB
-- למי שהמייל שלו לא כבר קיים ב-team_members. נרשם דרך Authentication →
-- Hooks → "Before User Created" בדשבורד (לא ניתן להגדיר ב-SQL בלבד).
-- ============================================================
create or replace function public.check_team_member_before_signup(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  new_email text := event->'user'->>'email';
begin
  if not exists (select 1 from team_members where lower(email) = lower(new_email)) then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'האימייל הזה לא רשום ברשימת המשתמשים. פנה למנהל המערכת שיוסיף אותך קודם בסקשן "משתמשים".'
      )
    );
  end if;
  return jsonb_build_object();
end;
$$;

grant execute on function public.check_team_member_before_signup to supabase_auth_admin;
revoke execute on function public.check_team_member_before_signup from authenticated, anon, public;
