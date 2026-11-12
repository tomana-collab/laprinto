-- מסך הגדרות: שמירת כתובת ה-webhook של Make (עדכון סטטוס הזמנה באתר) מתוך ה-CRM.
-- הכתובת נשמרת ב-Vault. הדפדפן לא יכול לקרוא אותה בחזרה — רק לדעת שהוגדרה ולראות את סופה.
-- הקריאה והכתיבה לאדמין בלבד.

create or replace function get_make_webhook_status() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u text;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select decrypted_secret into u from vault.decrypted_secrets where name = 'make_webhook_url';
  return jsonb_build_object('is_set', coalesce(u, '') <> '', 'tail', case when coalesce(u, '') <> '' then right(u, 6) end);
end $$;

create or replace function set_make_webhook_url(p_url text) returns void
language plpgsql security definer set search_path = '' as $$
declare sid uuid; u text := btrim(coalesce(p_url, ''));
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if u <> '' and u !~ '^https://[^\s]+$' then raise exception 'הכתובת חייבת להתחיל ב-https://'; end if;
  select id into sid from vault.secrets where name = 'make_webhook_url';
  if u = '' then
    if sid is not null then delete from vault.secrets where id = sid; end if;
  elsif sid is null then
    perform vault.create_secret(u, 'make_webhook_url', 'Make: order delivered → update order status on site');
  else
    perform vault.update_secret(sid, u);
  end if;
end $$;

revoke all on function get_make_webhook_status(), set_make_webhook_url(text) from public, anon;
grant execute on function get_make_webhook_status(), set_make_webhook_url(text) to authenticated;
notify pgrst, 'reload schema';
