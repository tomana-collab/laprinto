-- אחוז הנחה לשורה בתעודת ספק (על המחיר ליחידה).
alter table stock_receipt_items add column if not exists discount_percent numeric default 0;
notify pgrst, 'reload schema';
