-- נלקח בעלות: מי לקח (אמיר / רועי / נטלי / לינוי / שונות)
alter table public.stock_writeoffs add column if not exists taken_by text;
notify pgrst, 'reload schema';
