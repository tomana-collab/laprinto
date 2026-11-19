// סינון קטגוריה: '' = הכול, 'קטגוריה' = כל הקטגוריה, 'קטגוריה>תת' = תת קטגוריה בלבד
export const inCategory = (r, sel) => {
  if (!sel) return true
  const [c, sc] = sel.split('>')
  return r.category === c && (!sc || r.subcategory === sc)
}
