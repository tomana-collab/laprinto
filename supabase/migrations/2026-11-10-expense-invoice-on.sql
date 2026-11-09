-- הוצאות: על שם מי החשבונית (חברה / אדם).
alter table expenses add column if not exists invoice_on text default '';
notify pgrst, 'reload schema';
