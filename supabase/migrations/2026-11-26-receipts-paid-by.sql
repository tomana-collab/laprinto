-- קליטת תעודות: מי שילם לספק (רועי / אמיר / לפרינטו)
alter table public.stock_receipts add column if not exists paid_by text;
notify pgrst, 'reload schema';
