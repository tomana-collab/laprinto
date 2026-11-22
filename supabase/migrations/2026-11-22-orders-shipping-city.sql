-- עיר למשלוח כשדה נפרד (מהאתר, בסנכרון ההזמנות), לעמודת "עיר" ברשימת ההזמנות. לא משנה נתונים קיימים.
alter table orders add column if not exists shipping_city text not null default '';
notify pgrst, 'reload schema';
-- חזרה: alter table orders drop column shipping_city;
