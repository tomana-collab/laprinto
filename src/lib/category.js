// סינון קטגוריה לפי שם: '' = הכול. מוצר נכלל אם הקטגוריה הראשית, תת הקטגוריה או אחת מקטגוריות האתר שלו (wc_categories) בשם הזה.
// כך "חנוכיות" מציג את כל החנוכיות, גם אם באתר הן תחת קטגוריות ראשיות שונות (למשל "חנוכה 2026" ו"חגים ומועדים").
export const inCategory = (r, sel) => {
  if (!sel) return true
  return r.category === sel || r.subcategory === sel || (r.wc_categories || []).includes(sel)
}

// אפשרויות לבחירה: קטגוריות ראשיות, ואחריהן תתי קטגוריות (כל שם פעם אחת)
export function categoryOptions(rows) {
  const by = (a, b) => a.localeCompare(b, 'he')
  const roots = [...new Set(rows.map(r => r.category).filter(Boolean))].sort(by)
  const subs = [...new Set(rows.map(r => r.subcategory).filter(s => s && !roots.includes(s)))].sort(by)
  return { roots, subs }
}
