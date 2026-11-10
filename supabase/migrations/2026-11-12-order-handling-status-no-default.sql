-- סטטוס טיפול: ברירת המחדל ריקה, משתנה רק כשבוחרים ידנית.
alter table orders alter column handling_status drop default;
-- אופציונלי: לנקות הזמנות שקיבלו "נקלט ובטיפול" אוטומטית מאז ההוספה (מוחק גם בחירות ידניות של הערך הזה):
-- update orders set handling_status = null where handling_status = 'נקלט ובטיפול';
notify pgrst, 'reload schema';
