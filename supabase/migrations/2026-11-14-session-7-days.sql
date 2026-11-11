-- אבטחה: כל התחברות תקפה 7 ימים לכל היותר, נאכף בצד השרת (לא טיימר בדפדפן).
-- בתוכנית החינמית של Supabase אין הגדרת "Time-box sessions", ולכן האכיפה נעשית כאן בשתי שכבות:
--  1) pg_cron מוחק כל שעה סשנים בני יותר מ-7 ימים. מחיקת סשן מבטלת גם את ה-refresh token שלו,
--     כך שאי אפשר להאריך אותו.
--  2) policy מגביל (restrictive) על כל הטבלאות: בקשה עם סשן שנמחק / בן יותר מ-7 ימים נחסמת מיד,
--     גם אם ה-access token שלה עדיין לא פג (עד שעה). זה גם מה שהופך "ניתוק מכל המכשירים" למיידי.
-- לא נוגע בנתונים. משתמש עם סשן ישן פשוט יתבקש להתחבר מחדש.

-- בדיקה מקדימה: אם אין הרשאה לטבלת הסשנים, המיגרציה נעצרת כאן ולא משנה כלום
do $$ begin
  perform 1 from auth.sessions limit 1;
  delete from auth.sessions where false;
end $$;

create or replace function public.session_is_fresh() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select s.created_at > now() - interval '7 days'
    from auth.sessions s
    where s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid
  ), false);
$$;
revoke all on function public.session_is_fresh() from public, anon;
grant execute on function public.session_is_fresh() to authenticated, service_role;

-- policy מגביל על כל טבלה ב-public שיש בה RLS (כולל טבלאות שיתווספו עד להרצה)
do $$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity loop
    execute format('drop policy if exists "session max 7 days" on public.%I', t.relname);
    execute format('create policy "session max 7 days" on public.%I as restrictive for all to authenticated
                    using ((select public.session_is_fresh())) with check ((select public.session_is_fresh()))', t.relname);
  end loop;
end $$;

-- קבצים מצורפים (Storage)
drop policy if exists "session max 7 days" on storage.objects;
create policy "session max 7 days" on storage.objects as restrictive for all to authenticated
  using ((select public.session_is_fresh())) with check ((select public.session_is_fresh()));

select cron.schedule('laprinto-session-expiry', '7 * * * *',
  $$delete from auth.sessions where created_at < now() - interval '7 days'$$);

notify pgrst, 'reload schema';

-- חזרה אחורה (להריץ אם משתמשים נחסמים בטעות):
-- do $$ declare t record; begin
--   for t in select tablename from pg_policies where policyname = 'session max 7 days' and schemaname = 'public' loop
--     execute format('drop policy "session max 7 days" on public.%I', t.tablename);
--   end loop; end $$;
-- drop policy if exists "session max 7 days" on storage.objects;
-- select cron.unschedule('laprinto-session-expiry');
