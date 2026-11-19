-- החלפת מוצר בהזמנה: השורה החדשה (ידנית) מצביעה על השורה שהיא מחליפה.
-- המחיר וההנחה עוברים לשורה החדשה, והמכירה של השורה שהוחלפה (מסומנת "לא לספק") לא נספרת — כדי שהסכום לא ייספר פעמיים.
-- מוסיף עמודה בלבד. הסנכרון מהאתר לא שולח אותה, ולכן לא דורס אותה.
alter table orders add column if not exists replaces_line_id uuid references orders(id) on delete set null;
notify pgrst, 'reload schema';
-- חזרה: alter table orders drop column replaces_line_id;
