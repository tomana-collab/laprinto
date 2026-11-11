-- אימות דו-שלבי, שלב 1 (בטוח להרצה מיד): מי שכבר הגדיר אפליקציית אימות חייב להשלים אותה בכל התחברות.
-- נאכף במסד, כך שטוקן של שלב ראשון בלבד (סיסמה, aal1) לא מקבל שום נתון — גם לא דרך ה-API ישירות.
-- מי שעוד לא הגדיר אימות ממשיך להיכנס כרגיל, ולכן אף אחד לא ננעל. הפורטל ידרוש ממנו להגדיר בכניסה הבאה.

create or replace function public.mfa_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select (auth.jwt() ->> 'aal') = 'aal2'
      or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified');
$$;
revoke all on function public.mfa_ok() from public, anon;
grant execute on function public.mfa_ok() to authenticated, service_role;

do $$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity loop
    execute format('drop policy if exists "mfa required" on public.%I', t.relname);
    execute format('create policy "mfa required" on public.%I as restrictive for all to authenticated
                    using ((select public.mfa_ok())) with check ((select public.mfa_ok()))', t.relname);
  end loop;
end $$;

drop policy if exists "mfa required" on storage.objects;
create policy "mfa required" on storage.objects as restrictive for all to authenticated
  using ((select public.mfa_ok())) with check ((select public.mfa_ok()));

notify pgrst, 'reload schema';

-- חזרה אחורה:
-- do $$ declare t record; begin
--   for t in select tablename from pg_policies where policyname = 'mfa required' and schemaname = 'public' loop
--     execute format('drop policy "mfa required" on public.%I', t.tablename);
--   end loop; end $$;
-- drop policy if exists "mfa required" on storage.objects;

-- שחזור גישה למשתמש שאיבד את הטלפון (מוחק את גורם האימות שלו; הוא יגדיר חדש בכניסה הבאה):
-- delete from auth.mfa_factors where user_id = (select id from auth.users where lower(email) = lower('user@example.com'));
