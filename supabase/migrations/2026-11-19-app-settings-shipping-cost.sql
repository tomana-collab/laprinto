-- הגדרות כלליות של המערכת (מפתח / ערך). כרגע: עלות משלוח להזמנה (₪), שיורדת מהרווח בכל הזמנה שנשלחת (לא איסוף עצמי).
-- קריאה לכל חברי הצוות, עדכון לאדמין בלבד. לא משנה נתונים קיימים.
create table if not exists app_settings (
  key text primary key,
  value numeric,
  updated_at timestamptz not null default now(),
  updated_by text not null default ''
);
insert into app_settings (key, value) values ('shipping_cost', 0) on conflict (key) do nothing;

alter table app_settings enable row level security;
revoke all on app_settings from anon, authenticated;
grant select, update (value, updated_at, updated_by) on app_settings to authenticated;
drop policy if exists "app_settings read CRM members" on app_settings;
create policy "app_settings read CRM members" on app_settings for select to authenticated
  using (exists (select 1 from team_members tm where lower(tm.email) = lower((select auth.jwt() ->> 'email'))));
drop policy if exists "app_settings update admins" on app_settings;
create policy "app_settings update admins" on app_settings for update to authenticated
  using (exists (select 1 from team_members tm where lower(tm.email) = lower((select auth.jwt() ->> 'email')) and tm.role = 'אדמין'))
  with check (exists (select 1 from team_members tm where lower(tm.email) = lower((select auth.jwt() ->> 'email')) and tm.role = 'אדמין'));
drop policy if exists "mfa required" on app_settings;
create policy "mfa required" on app_settings as restrictive for all to authenticated using ((select mfa_ok()));
drop policy if exists "session max 7 days" on app_settings;
create policy "session max 7 days" on app_settings as restrictive for all to authenticated
  using ((select public.session_is_fresh())) with check ((select public.session_is_fresh()));
notify pgrst, 'reload schema';
-- חזרה: drop table app_settings;
