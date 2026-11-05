import { createContext, useContext } from 'react'

// ניווט בין מודולים ופתיחת רשומה לעריכה (למשל: מהזמנה אל המוצר שלה).
// ה-CRM לא משתמש ב-router, אז App מספק את הפונקציה דרך context.
const NavContext = createContext({ openRecord: () => {} })

export const NavProvider = NavContext.Provider
export const useNav = () => useContext(NavContext)
