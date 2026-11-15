-- 1) מלאי אצל הספק (ארט יודאיקה): בדיקה יומית מול אתר הספק בלבד (לא נוגעת באתר WooCommerce שלך) + דף הודעות חשובות.
-- 2) סנכרון מוצרים מהאתר עובר לפעם בשבוע (יום ראשון) או לחיצה ידנית. סנכרון הזמנות נשאר יומי.
-- לא מוחק ולא משנה נתונים קיימים. חזרה אחורה: בסוף הקובץ.

-- ───────────── עמודות מלאי ספק במוצרים ─────────────
-- הסנכרון מ-WooCommerce לא נוגע בעמודות האלה (הוא מעדכן רק שדות שמגיעים מהאתר)
alter table products
  add column if not exists supplier_stock_status text check (supplier_stock_status in ('in_stock', 'out_of_stock', 'not_found')),
  add column if not exists supplier_stock_checked_at timestamptz,
  add column if not exists supplier_stock_changed_at timestamptz; -- מתי הסטטוס השתנה בפועל (לא בבדיקה הראשונה)

-- ───────────── הודעות חשובות ─────────────
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                 -- supplier_out_of_stock | supplier_back_in_stock
  day date not null,                  -- יום (שעון ישראל): הודעה אחת לכל סוג ביום
  title text not null,
  body text,
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  read_at timestamptz,                -- ריק = לא נקראה (הדגל בתפריט)
  unique (kind, day)
);
create index if not exists notifications_unread on notifications (created_at desc) where read_at is null;

alter table notifications enable row level security;
revoke all on notifications from anon, authenticated;
grant select on notifications to authenticated;
grant update (read_at) on notifications to authenticated; -- המשתמש יכול רק לסמן נקראה/לא נקראה
drop policy if exists "notifications read CRM members" on notifications;
create policy "notifications read CRM members" on notifications for select to authenticated
  using (exists (select 1 from team_members tm where lower(tm.email) = lower((select auth.jwt() ->> 'email'))));
drop policy if exists "notifications mark read CRM members" on notifications;
create policy "notifications mark read CRM members" on notifications for update to authenticated
  using (exists (select 1 from team_members tm where lower(tm.email) = lower((select auth.jwt() ->> 'email'))))
  with check (exists (select 1 from team_members tm where lower(tm.email) = lower((select auth.jwt() ->> 'email'))));
-- אותה הגבלת סשן של 7 ימים כמו בשאר הטבלאות
drop policy if exists "session max 7 days" on notifications;
create policy "session max 7 days" on notifications as restrictive for all to authenticated
  using ((select public.session_is_fresh())) with check ((select public.session_is_fresh()));

-- ───────────── יומן משימות: מועד הריצה הבאה ─────────────
create or replace function public.job_runs_set_next() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.next_run_at := case new.job_type
    when 'price_scan' then public.next_local_weekly_run(8, 0)
    when 'supplier_stock' then public.next_local_run(7)
    when 'wc_sync' then public.next_local_run(6)
    else public.next_local_run(9) end;
  return new;
end $$;

-- ───────────── תזמונים ─────────────
-- מוצרים: יום ראשון בלבד (target=all). שאר הימים: הזמנות בלבד. cron_start מריץ רק בשעה 06:00 שעון ישראל.
select cron.schedule('laprinto-wc-sync', '0 3,4 * * 1-6',
  $$select public.cron_start('wc_sync', 'sync-wc-products', 6, '{"target": "orders"}'::jsonb)$$);
select cron.schedule('laprinto-wc-sync-weekly', '0 3,4 * * 0',
  $$select public.cron_start('wc_sync', 'sync-wc-products', 6, '{"target": "all"}'::jsonb)$$);
-- בדיקת מלאי ספק: כל יום ב-07:00 (פונה לאתר הספק בלבד)
select cron.schedule('laprinto-supplier-stock', '0 4,5 * * *',
  $$select public.cron_start('supplier_stock', 'supplier-stock-check', 7, '{"start": true}'::jsonb)$$);

-- ממשיך משימות בתור (סריקת מחירים / בדיקת מלאי ספק) שעדיין רצות
create or replace function public.cron_continue_scan() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.job_runs r where r.job_type = 'price_scan' and r.status = 'running'
             and coalesce(r.locked_until, '-infinity'::timestamptz) < now()) then
    perform public.call_edge('competitor-price-scan', '{"continue": true}'::jsonb);
  end if;
  if exists (select 1 from public.job_runs r where r.job_type = 'supplier_stock' and r.status = 'running'
             and coalesce(r.locked_until, '-infinity'::timestamptz) < now()) then
    perform public.call_edge('supplier-stock-check', '{"continue": true}'::jsonb);
  end if;
end $$;

-- בדיקת תקינות יומית: סריקת מחירים (שבועית) נבדקת רק ביום ראשון; בדיקת מלאי ספק יומית
create or replace function public.cron_health(local_hour int) returns void
language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'Asia/Jerusalem')::date;
  errs jsonb := '[]'::jsonb;
  checked int := 0;
  j record; r record;
begin
  if extract(hour from now() at time zone 'Asia/Jerusalem')::int <> local_hour then return; end if;
  if exists (select 1 from public.job_runs x where x.job_type = 'health_check'
             and (x.started_at at time zone 'Asia/Jerusalem')::date = today) then return; end if;

  update public.job_runs set status = 'failed', finished_at = now(), locked_until = null,
         errors = coalesce(errors, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('error', 'המשימה נתקעה ולא הסתיימה תוך שעתיים'))
  where status = 'running' and started_at < now() - interval '2 hours';

  for j in select * from (values ('wc_sync', 'סנכרון WooCommerce'), ('price_scan', 'סריקת מחירי מתחרים'), ('supplier_stock', 'בדיקת מלאי ספק')) as t(job_type, label) loop
    if j.job_type = 'price_scan' and extract(dow from today) <> 0 then continue; end if;
    checked := checked + 1;
    select * into r from public.job_runs x where x.job_type = j.job_type and x.trigger = 'cron'
      and (x.started_at at time zone 'Asia/Jerusalem')::date = today order by x.started_at desc limit 1;
    if not found then
      errs := errs || jsonb_build_array(jsonb_build_object('job', j.job_type, 'error', j.label || ': לא רצה היום במועד'));
    elsif r.status = 'failed' then
      errs := errs || jsonb_build_array(jsonb_build_object('job', j.job_type, 'error', j.label || ': נכשלה'));
    elsif r.status = 'running' and j.job_type = 'wc_sync' then
      errs := errs || jsonb_build_array(jsonb_build_object('job', j.job_type, 'error', j.label || ': עדיין רצה'));
    end if;
  end loop;

  insert into public.job_runs (job_type, status, trigger, finished_at, records_total, success_count, failure_count, errors)
  values ('health_check', case when jsonb_array_length(errs) = 0 then 'success' else 'failed' end, 'cron', now(),
          checked, checked - jsonb_array_length(errs), jsonb_array_length(errs), errs);
end $$;

notify pgrst, 'reload schema';

-- חזרה אחורה (להריץ אם צריך):
-- select cron.schedule('laprinto-wc-sync', '0 3,4 * * *', $$select public.cron_start('wc_sync', 'sync-wc-products', 6, '{"target": "all"}'::jsonb)$$);
-- select cron.unschedule('laprinto-wc-sync-weekly');
-- select cron.unschedule('laprinto-supplier-stock');
-- drop table if exists notifications;
-- alter table products drop column if exists supplier_stock_status, drop column if exists supplier_stock_checked_at, drop column if exists supplier_stock_changed_at;
