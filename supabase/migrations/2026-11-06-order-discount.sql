-- הנחת קופון בש"ח לכל שורת פריט בהזמנה (מחיר לפני הנחה פחות מחיר אחרי הנחה, כולל מע"מ).
-- להרצה ב-Supabase Dashboard > SQL Editor, ואז סנכרון הזמנות מחדש כדי למלא אותה להזמנות קיימות.
alter table orders add column if not exists discount_amount numeric default 0;
notify pgrst, 'reload schema';
