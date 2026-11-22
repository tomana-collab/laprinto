-- חברת משלוחים להזמנה (פרדי / הובלות / אנחנו), ב-CRM בלבד. עלות המשלוח ברווח נקבעת לפי החברה:
-- פרדי 50, הובלות 45, אנחנו 0 (ניתן לשינוי בהגדרות). בלי חברה: עלות המשלוח הכללית מההגדרות. לא משנה נתונים קיימים.
alter table orders add column if not exists shipping_company text not null default '';
insert into app_settings (key, value) values ('ship_cost_freddy', 50), ('ship_cost_hovalot', 45), ('ship_cost_us', 0)
  on conflict (key) do nothing;
notify pgrst, 'reload schema';
-- חזרה: alter table orders drop column shipping_company; delete from app_settings where key like 'ship_cost_%';
