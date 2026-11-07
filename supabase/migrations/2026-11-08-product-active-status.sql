-- סטטוס מוצר: 'פעיל' (מפורסם באתר) או 'לא פעיל'. הסנכרון מעדכן אותו אוטומטית.
-- המרה של ערכים ישנים (לבדיקה / להזמנה / פעיל / הופסק).
update products set status = 'לא פעיל' where status = 'הופסק';
update products set status = 'פעיל' where status in ('לבדיקה', 'להזמנה') or status is null;
alter table products alter column status set default 'פעיל';
