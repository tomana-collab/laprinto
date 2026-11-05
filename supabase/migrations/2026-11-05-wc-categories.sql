-- קטגוריות מוצרים מסונכרנות מ-WooCommerce.
-- category = הקטגוריה הראשית (השורש בעץ הקטגוריות באתר), subcategory = הקטגוריה הספציפית.
-- להרצה ב-Supabase Dashboard > SQL Editor.
alter table products add column if not exists category text default '';
alter table products add column if not exists subcategory text default '';
notify pgrst, 'reload schema';
