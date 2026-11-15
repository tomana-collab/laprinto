-- הבדיקה היומית מול ארט יודאיקה מושהית: אתר הספק חסם את הבקשות מהשרת (הפניה ל-abuse.spd.co.il) ולכן הבדיקה לא עובדת משם.
-- כבר הורץ בפרודקשן. כדי להפעיל מחדש אחרי שיימצא פתרון (קובץ מלאי מהספק / הרצה ממקום אחר):
-- select cron.schedule('laprinto-supplier-stock', '0 4,5 * * *', $$select public.cron_start('supplier_stock', 'supplier-stock-check', 7, '{"start": true}'::jsonb)$$);
select cron.unschedule('laprinto-supplier-stock');
