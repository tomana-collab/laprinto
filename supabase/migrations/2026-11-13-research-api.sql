-- שדרוג מערכת, חלק 3: API מוגבל למחקר מתחרים (ChatGPT Pro).
-- הסוכן מקבל מפתח ייעודי משלו. המפתח נשמר במסד רק כ-hash, ואין לו שום גישה ל-service_role,
-- להזמנות, ללקוחות, לעלויות או לרווחיות — ה-Edge Function חושפת רק שדות מוצר ומתחרים.

create table if not exists research_api_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  key_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create table if not exists research_api_log (
  id bigint generated always as identity primary key,
  key_id uuid references research_api_keys(id) on delete set null,
  action text,
  ok boolean,
  detail text,
  at timestamptz not null default now()
);
create index if not exists research_api_log_key_at on research_api_log (key_id, at desc);

-- אין policies: רק השרת (service_role) ניגש לטבלאות האלה
alter table research_api_keys enable row level security;
alter table research_api_log enable row level security;
revoke all on research_api_keys, research_api_log from anon, authenticated;

-- יצירת מפתח חדש. להריץ ב-SQL Editor; המפתח מוצג פעם אחת בלבד ולא ניתן לשחזור.
create or replace function create_research_api_key(p_name text) returns text
language plpgsql security definer set search_path = '' as $$
declare k text := 'lpr_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  insert into public.research_api_keys (name, key_hash) values (p_name, encode(sha256(convert_to(k, 'utf8')), 'hex'));
  return k;
end $$;
revoke all on function create_research_api_key(text) from public, anon, authenticated;

-- אימות מפתח + הגבלת קצב (120 קריאות לדקה למפתח). מחזיר את מזהה המפתח או null.
create or replace function verify_research_key(p text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare kid uuid;
begin
  select id into kid from public.research_api_keys
  where key_hash = encode(sha256(convert_to(coalesce(p, ''), 'utf8')), 'hex') and revoked_at is null;
  if kid is null then return null; end if;
  if (select count(*) from public.research_api_log l where l.key_id = kid and l.at > now() - interval '1 minute') >= 120 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  update public.research_api_keys set last_used_at = now() where id = kid;
  return kid;
end $$;
revoke all on function verify_research_key(text) from public, anon, authenticated;
grant execute on function verify_research_key(text) to service_role;

-- ───────────── מחקר במנות + מחקר חוזר ─────────────
-- partial = נחקר חלקית ולא נמצאו מתחרים (לא נחשב "אין מתחרים"); חוזר למחקר אחרי 30 יום.
-- no_competitors = נבדקו כל החנויות הפעילות ולא נמצא; גם הוא נבדק שוב אחרי 30 יום.
alter table products
  add column if not exists next_research_at timestamptz,
  add column if not exists research_claimed_at timestamptz,   -- המוצר נמצא כרגע במנת מחקר פתוחה
  add column if not exists research_batch_id uuid;
alter table products drop constraint if exists products_research_status_check;
alter table products add constraint products_research_status_check
  check (research_status in ('pending', 'partial', 'researched', 'no_competitors'));

-- ממתינים למחקר: חדשים, או כאלה שהגיע מועד המחקר החוזר שלהם
create or replace view v_products_pending_research with (security_invoker = true) as
select p.id, p.wc_product_id, p.wc_parent_id, p.name, p.sku, p.category, p.subcategory, p.price,
       p.product_url, p.image_url, p.research_status, p.last_researched_at, p.next_research_at
from products p
where p.status = 'פעיל' and p.wc_removed_at is null
  and (p.research_status = 'pending' or (p.next_research_at is not null and p.next_research_at <= now()))
  and not exists (select 1 from products c where c.wc_parent_id = p.wc_product_id);
grant select on v_products_pending_research to authenticated;

-- ───────────── חנויות מתחרות מוצעות (לאישור אדמין; לא נכנסות אוטומטית ל-competitor_stores) ─────────────
create table if not exists competitor_store_candidates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text not null unique,
  evidence_url text,
  notes text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  proposed_via text not null default 'chatgpt_research',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
alter table competitor_store_candidates enable row level security;
revoke all on competitor_store_candidates from anon, authenticated;
grant select, update on competitor_store_candidates to authenticated;
drop policy if exists "store candidates read CRM members" on competitor_store_candidates;
create policy "store candidates read CRM members" on competitor_store_candidates for select to authenticated
  using (exists (select 1 from team_members tm where lower(tm.email) = lower((select auth.jwt() ->> 'email'))));
drop policy if exists "store candidates admin review" on competitor_store_candidates;
create policy "store candidates admin review" on competitor_store_candidates for update to authenticated
  using ((select is_admin())) with check ((select is_admin()));

notify pgrst, 'reload schema';

-- ביטול מפתח:  update research_api_keys set revoked_at = now() where name = '...';
