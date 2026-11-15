-- סריקת מחירי מתחרים: פעם בשבוע (יום ראשון 08:00 שעון ישראל) במקום כל יום. אפשר תמיד להריץ ידנית מהמסך.
-- לא נוגע בנתונים. הסנכרון היומי של WooCommerce (06:00) ובדיקת התקינות (09:00) נשארים יומיים.

-- 1) התזמון: 05:00 ו-06:00 UTC ביום ראשון (cron_start מריץ רק כשהשעה בישראל היא 08:00 — מכסה שעון קיץ/חורף)
select cron.schedule('laprinto-price-scan', '0 5,6 * * 0',
  $$select public.cron_start('price_scan', 'competitor-price-scan', 8, '{"start": true}'::jsonb)$$);

-- 2) "סריקה הבאה" במסך: יום ראשון הקרוב ב-08:00
create or replace function public.next_local_weekly_run(h int, dow int) returns timestamptz
language sql stable set search_path = '' as $$
  select case when t > now() then t else t + interval '7 days' end
  from (select (now() at time zone 'Asia/Jerusalem')::date as d) x,
       lateral (select ((x.d + ((dow - extract(dow from x.d)::int + 7) % 7)) + make_time(h, 0, 0)) at time zone 'Asia/Jerusalem' as t) y;
$$;

create or replace function public.job_runs_set_next() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.next_run_at := case new.job_type
    when 'price_scan' then public.next_local_weekly_run(8, 0)
    when 'wc_sync' then public.next_local_run(6)
    else public.next_local_run(9) end;
  return new;
end $$;

update public.job_runs set next_run_at = public.next_local_weekly_run(8, 0) where job_type = 'price_scan';

-- 3) בדיקת התקינות: סריקת המחירים נבדקת רק ביום ראשון (בשאר הימים היא לא אמורה לרוץ)
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

  for j in select * from (values ('wc_sync', 'סנכרון WooCommerce'), ('price_scan', 'סריקת מחירי מתחרים')) as t(job_type, label) loop
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

-- חזרה ליומי: select cron.schedule('laprinto-price-scan', '0 5,6 * * *', $$select public.cron_start('price_scan', 'competitor-price-scan', 8, '{"start": true}'::jsonb)$$);
