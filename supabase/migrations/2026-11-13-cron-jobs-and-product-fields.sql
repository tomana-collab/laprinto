-- שדרוג מערכת, חלק 2: תזמונים יומיים (סנכרון 06:00, סריקת מחירים 08:00, בדיקת תקינות 09:00 — שעון ישראל),
-- שדות מוצר נוספים מהאתר, וסימון מוצרים שממתינים למחקר מתחרים.
-- לא מוחק ולא משנה מחירים, עלויות או התאמות מתחרים. דורש את חלק 1 (2026-11-13-jobs-infra-and-anon-revoke.sql).

-- ───────────── 1) שדות מוצר נוספים (מסונכרנים מ-WooCommerce) ─────────────
alter table products
  add column if not exists description text,
  add column if not exists short_description text,
  add column if not exists images jsonb,
  add column if not exists attributes jsonb,
  add column if not exists dimensions jsonb,
  add column if not exists weight text,
  add column if not exists stock_status text,
  add column if not exists stock_quantity numeric,
  add column if not exists wc_type text,
  add column if not exists wc_categories jsonb,
  add column if not exists wc_modified_at timestamptz,
  add column if not exists wc_removed_at timestamptz,          -- הוסר מהחנות; ההיסטוריה נשמרת
  add column if not exists research_status text default 'pending',
  add column if not exists last_researched_at timestamptz,
  add column if not exists research_notes text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'products_research_status_check') then
    alter table products add constraint products_research_status_check
      check (research_status in ('pending', 'researched', 'no_competitors'));
  end if;
end $$;

-- מוצרים שכבר יש להם התאמת מתחרה נחשבים "נחקרו"; כל השאר ממתינים למחקר
update products p set research_status = 'researched'
where research_status is distinct from 'researched'
  and exists (select 1 from competitor_offers o where o.product_id = p.id);
update products set research_status = 'pending' where research_status is null;

-- מוצרים פעילים שממתינים למחקר מתחרים (בלי מוצרי אב שיש להם וריאציות)
create or replace view v_products_pending_research with (security_invoker = true) as
select p.id, p.wc_product_id, p.wc_parent_id, p.name, p.sku, p.category, p.subcategory, p.price,
       p.product_url, p.image_url, p.research_status, p.last_researched_at
from products p
where p.status = 'פעיל' and p.wc_removed_at is null and p.research_status = 'pending'
  and not exists (select 1 from products c where c.wc_parent_id = p.wc_product_id);
grant select on v_products_pending_research to authenticated;

-- ───────────── 2) יומן המשימות: שדות לתור ולנעילה ─────────────
alter table job_runs
  add column if not exists cursor text,
  add column if not exists locked_until timestamptz,
  add column if not exists meta jsonb default '{}'::jsonb;

-- מועד ההרצה המתוזמנת הבאה בשעה נתונה לפי שעון ישראל
create or replace function next_local_run(h int) returns timestamptz
language sql stable set search_path = '' as $$
  select case when t > now() then t else ((d + 1) + make_time(h, 0, 0)) at time zone 'Asia/Jerusalem' end
  from (select (now() at time zone 'Asia/Jerusalem')::date as d) x,
       lateral (select (x.d + make_time(h, 0, 0)) at time zone 'Asia/Jerusalem' as t) y;
$$;

create or replace function job_runs_set_next() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.next_run_at := public.next_local_run(case new.job_type when 'wc_sync' then 6 when 'price_scan' then 8 else 9 end);
  return new;
end $$;
drop trigger if exists trg_job_runs_set_next on job_runs;
create trigger trg_job_runs_set_next before insert or update on job_runs
  for each row execute function job_runs_set_next();

-- ───────────── 3) סוד פנימי לקריאות מתוזמנות (נוצר ונשמר ב-Vault, לא יוצא מהמסד) ─────────────
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'cron_secret') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'cron_secret', 'Laprinto CRM: scheduled jobs → Edge Functions');
  end if;
end $$;

-- ה-Edge Function מאמתת את הסוד מולנו (רק service_role רשאי לקרוא לפונקציה)
create or replace function verify_cron_secret(p text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'cron_secret' and decrypted_secret = p);
$$;
revoke all on function verify_cron_secret(text) from public, anon, authenticated;
grant execute on function verify_cron_secret(text) to service_role;

-- קריאה ל-Edge Function של הפרויקט עם הסוד הפנימי
create or replace function call_edge(fn text, body jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare s text;
begin
  select decrypted_secret into s from vault.decrypted_secrets where name = 'cron_secret';
  perform net.http_post(
    url := 'https://oicyoddiruiryktaupem.supabase.co/functions/v1/' || fn,
    body := body,
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', s),
    timeout_milliseconds := 15000);
end $$;
revoke all on function call_edge(text, jsonb) from public, anon, authenticated;

-- מפעיל משימה יומית רק בשעה המקומית הנכונה (pg_cron עובד ב-UTC; שעון קיץ/חורף מטופל כאן) ורק פעם ביום
create or replace function cron_start(job text, fn text, local_hour int, body jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare today date := (now() at time zone 'Asia/Jerusalem')::date;
begin
  if extract(hour from now() at time zone 'Asia/Jerusalem')::int <> local_hour then return; end if;
  if exists (select 1 from public.job_runs r where r.job_type = job and r.trigger = 'cron'
             and (r.started_at at time zone 'Asia/Jerusalem')::date = today) then return; end if;
  perform public.call_edge(fn, body);
end $$;
revoke all on function cron_start(text, text, int, jsonb) from public, anon, authenticated;

-- ממשיך סריקת מחירים שעדיין רצה (התור מתקדם בקבוצות)
create or replace function cron_continue_scan() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.job_runs r where r.job_type = 'price_scan' and r.status = 'running'
             and coalesce(r.locked_until, '-infinity'::timestamptz) < now()) then
    perform public.call_edge('competitor-price-scan', '{"continue": true}'::jsonb);
  end if;
end $$;
revoke all on function cron_continue_scan() from public, anon, authenticated;
grant execute on function cron_continue_scan() to service_role;

-- בדיקת תקינות יומית: משימה תקועה, משימה שלא רצה במועד, משימה שנכשלה
create or replace function cron_health(local_hour int) returns void
language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'Asia/Jerusalem')::date;
  errs jsonb := '[]'::jsonb;
  j record; r record;
begin
  if extract(hour from now() at time zone 'Asia/Jerusalem')::int <> local_hour then return; end if;
  if exists (select 1 from public.job_runs x where x.job_type = 'health_check'
             and (x.started_at at time zone 'Asia/Jerusalem')::date = today) then return; end if;

  update public.job_runs set status = 'failed', finished_at = now(), locked_until = null,
         errors = coalesce(errors, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('error', 'המשימה נתקעה ולא הסתיימה תוך שעתיים'))
  where status = 'running' and started_at < now() - interval '2 hours';

  for j in select * from (values ('wc_sync', 'סנכרון WooCommerce'), ('price_scan', 'סריקת מחירי מתחרים')) as t(job_type, label) loop
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
          2, 2 - jsonb_array_length(errs), jsonb_array_length(errs), errs);
end $$;
revoke all on function cron_health(int) from public, anon, authenticated;

-- ───────────── 4) התזמונים עצמם (cron.schedule מעדכן משימה קיימת באותו שם — אין כפילויות) ─────────────
-- שתי שעות UTC לכל משימה מכסות שעון קיץ וחורף; הפונקציות מריצות רק בשעה המקומית הנכונה.
select cron.schedule('laprinto-wc-sync', '0 3,4 * * *',
  $$select public.cron_start('wc_sync', 'sync-wc-products', 6, '{"target": "all"}'::jsonb)$$);
select cron.schedule('laprinto-price-scan', '0 5,6 * * *',
  $$select public.cron_start('price_scan', 'competitor-price-scan', 8, '{"start": true}'::jsonb)$$);
select cron.schedule('laprinto-price-scan-continue', '*/2 * * * *', $$select public.cron_continue_scan()$$);
select cron.schedule('laprinto-health-check', '0 6,7 * * *', $$select public.cron_health(9)$$);
select cron.schedule('laprinto-cron-log-cleanup', '30 1 * * 0',
  $$delete from cron.job_run_details where end_time < now() - interval '14 days'$$);

notify pgrst, 'reload schema';

-- חזרה אחורה (להריץ רק אם צריך) — מבטל את התזמונים; העמודות החדשות לא מזיקות ואפשר להשאיר:
-- select cron.unschedule(jobname) from cron.job where jobname like 'laprinto-%';
