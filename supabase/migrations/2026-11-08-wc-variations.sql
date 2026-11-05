-- וריאציות מהאתר (צבע/גודל...) מסונכרנות כמוצרים נפרדים, כל אחת עם מק"ט משלה.
-- wc_parent_id = מזהה המוצר הראשי באתר.
alter table products add column if not exists wc_parent_id bigint;
notify pgrst, 'reload schema';
