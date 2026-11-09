-- הוצאות: סימון "דווח לרו"ח".
alter table expenses add column if not exists reported_to_accountant boolean default false;
update expenses set reported_to_accountant = false where reported_to_accountant is null;
notify pgrst, 'reload schema';
