-- הזמנה ידנית לקד"מ (מתנה / שיווק): ללא חיוב (מחיר 0), אבל יורדת מהמלאי ועלותה נספרת ברווח. לא משנה נתונים קיימים.
alter table orders add column if not exists is_promo boolean not null default false;
notify pgrst, 'reload schema';
-- חזרה: alter table orders drop column is_promo;
