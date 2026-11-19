-- החלפת מוצר בהזמנה: השורה החדשה (ידנית) מצביעה על השורה שהיא מחליפה.
-- המחיר וההנחה עוברים לשורה החדשה, והמכירה של השורה שהוחלפה (מסומנת "לא לספק") לא נספרת — כדי שהסכום לא ייספר פעמיים.
-- מוסיף עמודה בלבד. הסנכרון מהאתר לא שולח אותה, ולכן לא דורס אותה.
alter table orders add column if not exists replaces_line_id uuid references orders(id) on delete set null;
-- שורה ידנית נשארת ללא חיוב (מחיר 0), חוץ משורה שמחליפה מוצר: היא מקבלת את מחיר המוצר שהוחלף
alter table orders drop constraint if exists orders_manual_line_free;
alter table orders add constraint orders_manual_line_free check (not manual_line or replaces_line_id is not null or coalesce(price, 0) = 0);
notify pgrst, 'reload schema';
-- חזרה: alter table orders drop constraint orders_manual_line_free, drop column replaces_line_id;
--        alter table orders add constraint orders_manual_line_free check (not manual_line or coalesce(price, 0) = 0);
