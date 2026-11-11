-- אימות דו-שלבי, שלב 2: חובה לכולם. להריץ רק אחרי שכל המשתמשים הגדירו אפליקציית אימות!
-- בדיקה לפני ההרצה — כל משתמש חייב להופיע עם verified_factors = 1 לפחות:
--   select u.email, count(f.id) filter (where f.status = 'verified') as verified_factors
--   from auth.users u left join auth.mfa_factors f on f.user_id = u.id group by u.email;
-- אחרי ההרצה, התחברות בלי שלב שני לא מקבלת שום נתון, גם אם למשתמש אין עדיין גורם אימות
-- (הוא עדיין יכול להתחבר ולהגדיר אחד — הרישום נעשה מול שירות ההזדהות ולא מול הטבלאות).

-- המיגרציה נעצרת בעצמה אם יש משתמש בלי גורם אימות מאומת
do $$
declare missing text;
begin
  select string_agg(u.email, ', ') into missing
  from auth.users u
  where not exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified');
  if missing is not null then
    raise exception 'לא הופעל: למשתמשים הבאים אין עדיין אימות דו-שלבי: %', missing;
  end if;
end $$;

create or replace function public.mfa_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select (auth.jwt() ->> 'aal') = 'aal2';
$$;

notify pgrst, 'reload schema';

-- חזרה לשלב 1: להריץ שוב את 2026-11-14-mfa-step1-enforce-enrolled.sql
