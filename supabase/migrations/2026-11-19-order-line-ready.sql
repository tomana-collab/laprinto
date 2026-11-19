-- מוכן למשלוח לכל מוצר בהזמנה (נחרט / נארז): מתי ומי סימן. לסדר בלבד: לא משנה סטטוס, מלאי או כסף.
-- הסנכרון מהאתר לא שולח את העמודות האלה, ולכן לא דורס אותן.
alter table orders add column if not exists ready_at timestamptz;
alter table orders add column if not exists ready_by text not null default '';
notify pgrst, 'reload schema';
-- חזרה: alter table orders drop column ready_at, drop column ready_by;
