-- הבדיקה היומית מול ארט יודאיקה מושהית עד שיימצא פתרון: אתר הספק חוסם בקשות מהשרת (הפניה ל-abuse.spd.co.il).
-- כבר הורץ בפרודקשן.
-- 1) ביטול התזמון היומי
select cron.unschedule(jobid) from cron.job where jobname = 'laprinto-supplier-stock';
-- 2) מחיקת רשומות הכישלון של הבדיקה (כדי שלא תופיע התראה בפורטל)
delete from job_runs where job_type = 'supplier_stock';
-- 3) בדיקת התקינות היומית לא מצפה לבדיקת מלאי ספק (אחרת תדווח שהיא "לא רצה")
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
-- להפעלה מחדש אחרי שיימצא פתרון: להחזיר ('supplier_stock', 'בדיקת מלאי ספק') ל-cron_health, לבטל את PAUSED בפונקציה supplier-stock-check, ולהריץ:
-- select cron.schedule('laprinto-supplier-stock', '0 4,5 * * *', $$select public.cron_start('supplier_stock', 'supplier-stock-check', 7, '{"start": true}'::jsonb)$$);
