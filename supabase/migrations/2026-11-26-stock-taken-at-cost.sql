-- "נלקח בעלות": מוצרים שלקחנו מהמלאי ושילמנו עליהם מחיר עלות. נרשמים באותה טבלה כמו פחת (kind),
-- כך שהם יורדים מהמלאי בכל המערכת דרך product_stock בלי לשנות את ה-view. unit_price = כמה שולם ליחידה (נספר כהכנסה ברווח).
alter table public.stock_writeoffs
  add column if not exists kind text not null default 'פחת' check (kind in ('פחת', 'נלקח בעלות')),
  add column if not exists unit_price numeric;
notify pgrst, 'reload schema';
