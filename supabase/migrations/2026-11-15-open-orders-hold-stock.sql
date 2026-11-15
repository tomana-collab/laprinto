-- הזמנה פתוחה מחזיקה מלאי: כל הזמנה שבטיפול באתר או שהושלמה (ולא סומנה "לא לספק") יורדת מהמלאי מיד,
-- גם לפני שנקבע לה סטטוס טיפול ב-CRM. כך המלאי שמוצג הוא מה שנשאר פנוי אחרי ההזמנות הפתוחות, ומלאי שלילי = חוסר.
-- עמודה חדשה reserved = כמה יחידות מתוך "sold" שמורות להזמנות פתוחות (בלי סטטוס טיפול). מלאי פיזי במחסן = stock + reserved.
-- open_orders (הוזמן בהזמנות פתוחות, להשלמת מוצרים) נשאר כמו קודם. לא משנה ולא מוחק נתונים, רק את חישוב ה-view.
create or replace view product_stock with (security_invoker = true) as
WITH ord AS (
         SELECT
                CASE
                    WHEN o.product_id IS NOT NULL AND COALESCE(o.sku, ''::text) <> ''::text AND (EXISTS ( SELECT 1
                       FROM products px
                      WHERE px.id = o.product_id AND px.sku = o.sku)) THEN o.product_id
                    ELSE COALESCE(( SELECT p2.id
                       FROM products p2
                      WHERE COALESCE(o.sku, ''::text) <> ''::text AND p2.sku = o.sku
                      ORDER BY ((EXISTS ( SELECT 1
                               FROM products c
                              WHERE c.wc_parent_id = p2.wc_product_id))), (p2.wc_removed_at IS NOT NULL), p2.id
                     LIMIT 1), o.product_id)
                END AS pid,
            o.quantity,
            COALESCE(o.order_date, o.created_at) AS order_date,
            o.wc_status = 'completed'::text OR COALESCE(btrim(o.handling_status), ''::text) <> ''::text AS is_final
           FROM orders o
          WHERE (o.wc_status IS NULL OR (o.wc_status = ANY (ARRAY['processing'::text, 'completed'::text]))) AND NOT o.not_supplied
        )
 SELECT p.id AS product_id,
    COALESCE(p.opening_stock, 0::numeric) AS opening,
    COALESCE(r.qty, 0::numeric) AS received,
    COALESCE(s.qty, 0::numeric) AS sold,
    COALESCE(p.opening_stock, 0::numeric) + COALESCE(r.qty, 0::numeric) - COALESCE(s.qty, 0::numeric) AS stock,
    COALESCE(w.qty, 0::numeric) AS incoming,
    COALESCE(t.qty, 0::numeric) AS sold_total,
    COALESCE(op.qty, 0::numeric) AS open_orders,
    COALESCE(rs.qty, 0::numeric) AS reserved
   FROM products p
     LEFT JOIN ( SELECT i.product_id,
            sum(i.quantity) AS qty
           FROM stock_receipt_items i
             JOIN stock_receipts h ON h.id = i.receipt_id
          WHERE COALESCE(h.status, 'סופק'::text) = 'סופק'::text
          GROUP BY i.product_id) r ON r.product_id = p.id
     LEFT JOIN ( SELECT ord.pid AS product_id,
            sum(ord.quantity) AS qty
           FROM ord
             JOIN products pp ON pp.id = ord.pid
          WHERE ord.order_date >= COALESCE(pp.stock_from, '-infinity'::timestamp with time zone)
          GROUP BY ord.pid) s ON s.product_id = p.id
     LEFT JOIN ( SELECT i.product_id,
            sum(i.quantity) AS qty
           FROM stock_receipt_items i
             JOIN stock_receipts h ON h.id = i.receipt_id
          WHERE h.status = 'בהמתנה לאספקה'::text
          GROUP BY i.product_id) w ON w.product_id = p.id
     LEFT JOIN ( SELECT ord.pid AS product_id,
            sum(ord.quantity) AS qty
           FROM ord
          WHERE ord.pid IS NOT NULL
          GROUP BY ord.pid) t ON t.product_id = p.id
     LEFT JOIN ( SELECT ord.pid AS product_id,
            sum(ord.quantity) AS qty
           FROM ord
          WHERE ord.pid IS NOT NULL AND NOT ord.is_final
          GROUP BY ord.pid) op ON op.product_id = p.id
     LEFT JOIN ( SELECT ord.pid AS product_id,
            sum(ord.quantity) AS qty
           FROM ord
             JOIN products pp ON pp.id = ord.pid
          WHERE NOT ord.is_final AND ord.order_date >= COALESCE(pp.stock_from, '-infinity'::timestamp with time zone)
          GROUP BY ord.pid) rs ON rs.product_id = p.id;

-- חזרה אחורה: להריץ שוב את ההגדרה מ-2026-11-15-order-not-supplied.sql (בלי העמודה reserved: drop view product_stock cascade לפני כן)
