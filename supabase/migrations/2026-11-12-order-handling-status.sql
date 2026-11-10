-- הזמנות: סטטוס טיפול פנימי (נפרד מהסטטוס באתר). הסנכרון לא נוגע בעמודה הזאת.
alter table orders add column if not exists handling_status text;
-- הזמנות חדשות נכנסות כ"נקלט ובטיפול"; הזמנות קיימות נשארות ריקות
alter table orders alter column handling_status set default 'נקלט ובטיפול';
notify pgrst, 'reload schema';
