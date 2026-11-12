-- כשסטטוס הטיפול של הזמנה משתנה ל"הגיע ללקוח":
--   1) סטטוס ההזמנה (wc_status) הופך ל"הושלם" (לכל שורות אותה הזמנה)
--   2) נשלח webhook ל-Make, פעם אחת בלבד לכל הזמנה
-- כתובת ה-webhook נשמרת ב-Vault ולא בקוד. אם לא הוגדרה — ההזמנה עדיין עוברת ל"הושלם", ורק ה-webhook מדולג.
-- לא משנה מחירים, עלויות או נתונים קיימים.

alter table orders add column if not exists delivered_notified_at timestamptz;

create or replace function orders_on_delivered() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  url text;
  first_notify boolean;
begin
  if new.handling_status is distinct from 'הגיע ללקוח' or old.handling_status is not distinct from 'הגיע ללקוח' then
    return new;
  end if;

  -- שאר שורות אותה הזמנה: סטטוס ההזמנה הוא ברמת ההזמנה
  if new.wc_order_id is not null then
    update public.orders set wc_status = 'completed'
    where wc_order_id = new.wc_order_id and id <> new.id and wc_status is distinct from 'completed';
  end if;

  -- webhook פעם אחת לכל הזמנה
  first_notify := new.delivered_notified_at is null and not exists (
    select 1 from public.orders o
    where new.wc_order_id is not null and o.wc_order_id = new.wc_order_id and o.id <> new.id and o.delivered_notified_at is not null);
  if not first_notify then return new; end if;

  select decrypted_secret into url from vault.decrypted_secrets where name = 'make_webhook_url';
  if url is null or url = '' then return new; end if;

  perform net.http_post(
    url := url,
    body := jsonb_build_object('order_number', coalesce(new.order_number, new.wc_order_id::text)),
    headers := '{"content-type": "application/json"}'::jsonb,
    timeout_milliseconds := 10000);

  update public.orders set delivered_notified_at = now()
  where id = new.id or (new.wc_order_id is not null and wc_order_id = new.wc_order_id);
  return new;
end $$;
revoke all on function orders_on_delivered() from public, anon, authenticated;

-- BEFORE: סטטוס ההזמנה של השורה עצמה הופך ל"הושלם" באותה כתיבה
create or replace function orders_set_completed_on_delivered() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.handling_status = 'הגיע ללקוח' and old.handling_status is distinct from 'הגיע ללקוח' then
    new.wc_status := 'completed';
  end if;
  return new;
end $$;

drop trigger if exists trg_orders_completed_before on orders;
create trigger trg_orders_completed_before before update of handling_status on orders
  for each row execute function orders_set_completed_on_delivered();
drop trigger if exists trg_orders_delivered_after on orders;
create trigger trg_orders_delivered_after after update of handling_status on orders
  for each row execute function orders_on_delivered();

-- הגדרת כתובת ה-webhook של Make (להריץ פעם אחת; להחליף את הכתובת בכתובת מהסצנריו שלך):
--   select vault.create_secret('https://hook.eu2.make.com/XXXXXXXX', 'make_webhook_url', 'Make: order delivered');
-- החלפה אחר כך:
--   select vault.update_secret((select id from vault.secrets where name = 'make_webhook_url'), 'https://hook...');
