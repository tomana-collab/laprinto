-- היקף השוואת המחירים: רק מוצרים שיש להם מק"ט, שיש מהם במחסן (פנוי + שמור להזמנות), ושהקטגוריה שלהם לא הוחרגה.
-- קטגוריות מוחרגות נקבעות מתוך מסך השוואת המחירים (טבלת cmp_excluded_categories): שם שמתאים לקטגוריה הראשית,
-- לתת הקטגוריה או לאחת מקטגוריות האתר של המוצר. חל על התצוגה, על סריקת המחירים האוטומטית ועל ה-API של המחקר.
create table if not exists cmp_excluded_categories (
  name text primary key,
  created_at timestamptz not null default now(),
  created_by text not null default ''
);
alter table cmp_excluded_categories enable row level security;
revoke all on cmp_excluded_categories from anon, authenticated;
grant select, insert, delete on cmp_excluded_categories to authenticated;
drop policy if exists "cmp_excluded_categories CRM members" on cmp_excluded_categories;
create policy "cmp_excluded_categories CRM members" on cmp_excluded_categories for all to authenticated
  using (exists (select 1 from team_members tm where lower(tm.email) = lower((select auth.jwt() ->> 'email'))))
  with check (exists (select 1 from team_members tm where lower(tm.email) = lower((select auth.jwt() ->> 'email'))));
drop policy if exists "mfa required" on cmp_excluded_categories;
create policy "mfa required" on cmp_excluded_categories as restrictive for all to authenticated using ((select mfa_ok()));
drop policy if exists "session max 7 days" on cmp_excluded_categories;
create policy "session max 7 days" on cmp_excluded_categories as restrictive for all to authenticated
  using ((select public.session_is_fresh())) with check ((select public.session_is_fresh()));

-- מארזי יין ואלכוהול לא בהשוואה (אין מוצרים כאלה אצל המתחרים)
insert into cmp_excluded_categories (name, created_by) values ('מארזי יין', 'system'), ('מארזי וויסקי', 'system'), ('אניס', 'system')
  on conflict (name) do nothing;

create or replace view v_cmp_scope with (security_invoker = true) as
select p.id
from products p
left join product_merges m on m.from_product_id = p.id
left join product_stock ps on ps.product_id = coalesce(m.into_product_id, p.id)
where p.status = 'פעיל' and p.wc_removed_at is null
  and coalesce(btrim(p.sku), '') <> ''
  and coalesce(ps.stock, 0) + coalesce(ps.reserved, 0) > 0
  and not exists (
    select 1 from cmp_excluded_categories e
    where e.name = p.category or e.name = p.subcategory
       or (jsonb_typeof(p.wc_categories) = 'array' and p.wc_categories ? e.name));
grant select on v_cmp_scope to authenticated;

-- סריקת המחירים האוטומטית: רק התאמות של מוצרים שבהיקף
create or replace view v_competitor_price_targets as
 SELECT o.id AS offer_id, p.id AS product_id, p.sku AS my_sku, s.name AS store_name, s.domain AS store_domain,
    o.product_url AS competitor_url, o.competitor_sku, o.match_type, o.review_status, o.competitor_title,
    o.competitor_image_url, o.engraving_notes, o.package_notes, o.shipping_notes, o.price_scan_enabled,
    o.approval_method, o.sku_verification_source
   FROM competitor_offers o
     JOIN products p ON p.id = o.product_id
     JOIN competitor_stores s ON s.id = o.store_id
  WHERE o.review_status = 'approved' AND s.enabled = true AND o.price_scan_enabled = true
    AND p.id IN (SELECT id FROM v_cmp_scope);

notify pgrst, 'reload schema';
-- חזרה: להריץ את הגדרת v_competitor_price_targets בלי התנאי האחרון; drop view v_cmp_scope; drop table cmp_excluded_categories;
