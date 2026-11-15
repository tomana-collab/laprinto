import { formatDateTime } from '../lib/format'

// מצב המלאי אצל הספק (ארט יודאיקה), כפי שנבדק בבדיקה היומית. מקור: products.supplier_stock_status
export const SUPPLIER_STOCK_LABEL = {
  in_stock: 'במלאי אצל הספק',
  out_of_stock: 'אזל אצל הספק',
  not_found: 'לא נמצא אצל הספק',
}

export function SupplierStock({ status, checkedAt }) {
  if (!status) return <span className="cmp-sub" title="עוד לא נבדק מול הספק">—</span>
  const when = checkedAt ? `נבדק: ${formatDateTime(checkedAt)}` : undefined
  return <span className={`sup-stock sup-${status}`} title={when}>{SUPPLIER_STOCK_LABEL[status] || status}</span>
}
