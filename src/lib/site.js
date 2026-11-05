// כתובות באתר WooCommerce (אתר האיקומרס). אפשר לדרוס עם VITE_WC_SITE_URL ב-.env.
const SITE = (import.meta.env.VITE_WC_SITE_URL || 'https://laprinto.co.il').replace(/\/$/, '')

// עריכת מוצר בממשק הניהול של ווקומרס
export const wpProductEditUrl = wcProductId =>
  wcProductId ? `${SITE}/wp-admin/post.php?post=${wcProductId}&action=edit` : null

// עריכת הזמנה בממשק הניהול (HPOS — ברירת המחדל בווקומרס חדש)
export const wpOrderEditUrl = wcOrderId =>
  wcOrderId ? `${SITE}/wp-admin/admin.php?page=wc-orders&action=edit&id=${wcOrderId}` : null
