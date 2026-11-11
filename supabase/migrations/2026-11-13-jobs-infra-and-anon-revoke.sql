-- שדרוג מערכת, חלק 1: תשתית משימות מתוזמנות + הסרת הרשאות anon.
-- לא משנה ולא מוחק נתונים קיימים. אפשר לחזור אחורה עם הבלוק שבסוף הקובץ.

-- 1) הרחבות לתזמון ולקריאה ל-Edge Functions ללא משתמש מחובר
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2) יומן הרצות של משימות (סנכרון, סריקת מחירים, בדיקת תקינות)
create table if not exists job_runs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,                 -- wc_sync | price_scan | health_check
  status text not null default 'running', -- running | success | partial | failed
  trigger text not null default 'cron',   -- cron | manual
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  records_total integer default 0,
  success_count integer default 0,
  failure_count integer default 0,
  errors jsonb default '[]'::jsonb,
  next_run_at timestamptz
);
create index if not exists job_runs_type_started on job_runs (job_type, started_at desc);
-- מניעת הרצה כפולה: רק הרצה פעילה אחת לכל סוג משימה
create unique index if not exists job_runs_one_running on job_runs (job_type) where status = 'running';

alter table job_runs enable row level security;
-- קריאה בלבד לחברי צוות (להצגת סטטוס והתראות בפורטל). כתיבה רק מהשרת (service_role עוקף RLS)
drop policy if exists "job_runs read CRM members" on job_runs;
create policy "job_runs read CRM members" on job_runs for select to authenticated
  using (exists (select 1 from team_members tm where lower(tm.email) = lower((select auth.jwt() ->> 'email'))));
revoke all on job_runs from anon, authenticated;
grant select on job_runs to authenticated;

-- 3) הקשחה: משתמש לא מחובר (anon) לא צריך שום הרשאה על הטבלאות.
--    ה-RLS כבר חוסם אותו היום; זו שכבת הגנה נוספת.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

notify pgrst, 'reload schema';

-- חזרה אחורה (להריץ רק אם צריך):
-- grant all on all tables in schema public to anon;
-- grant all on all sequences in schema public to anon;
-- drop table if exists job_runs;
