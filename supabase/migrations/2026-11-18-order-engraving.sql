-- חריטה אישית בהזמנות: סימון שורות עם חריטה והטקסט עצמו, בנפרד משאר פרטי השורה.
-- הסנכרון הבא של ההזמנות ממלא את זה מחדש מהאתר (לפי שדה שהשם שלו מכיל "חריטה" או "התאמה אישית").
alter table orders add column if not exists engraving text not null default '';
alter table orders add column if not exists has_engraving boolean not null default false;

-- מילוי ראשוני מההזמנות הקיימות (הערכה לפי הטקסט השמור; הסנכרון הבא מדייק)
update orders set engraving = personalization, has_engraving = true
where personalization ~ '(^|\n)[^\n:]*(חריטה|התאמה אישית)[^\n:]*:\s*\S'
  and personalization !~ '(^|\n)[^\n:]*(חריטה|התאמה אישית)[^\n:]*:\s*(ללא|לא|אין)(\s|$)';

create index if not exists orders_has_engraving on orders (has_engraving) where has_engraving;
notify pgrst, 'reload schema';
-- חזרה: alter table orders drop column engraving, drop column has_engraving;
