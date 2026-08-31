# Laprinto CRM — הגדרות פרויקט

## מה זה הפרויקט
CRM פנימי לעסק laprinto: משימות, רעיונות, מוצרים ורווחיות, ספקים, הזדמנויות, טרנדים. פרויקט נפרד לגמרי מ-[laprinto](../laprinto) (אתר האיקומרס ב-WordPress) ומ-[portal-tomana](../portal-tomana) (ה-CRM של חברת טומנה).

הקוד המקורי נוצר עם Claude (claude.ai, לא Claude Code) והוטמע ב-2026-08-31 — זהו הבסיס בפועל, לא שלד גנרי.

## חיבורים

### GitHub
- **Repo:** `git@github.com:tomana-collab/laprinto.git` (דרך host alias `github-laprinto-crm`)
- **אימות:** SSH דרך `~/.ssh/id_ed25519_laprinto_crm` (deploy key ייעודי, לא המפתח האישי)
- **Branch ראשי:** `main`
- הערה: הריפו יושב בארגון `tomana-collab`, אך המשתמש הוא היחיד עם גישת אדמין שם — אין בעיית גישה.

### Supabase
טרם הוקם. שלבים ב-[README.md](./README.md#1-הקמת-supabase): פרויקט חדש → הרצת `supabase/schema.sql` ב-SQL Editor → יצירת משתמשים ידנית ב-Authentication → Users → העתקת Project URL + anon key ל-`.env`.

### Vercel
טרם חובר — יש לייבא את ה-repo מ-GitHub דרך Vercel dashboard ולהוסיף את משתני הסביבה.

## Stack טכנולוגי בפועל
| חבילה | תפקיד |
|---|---|
| React 18 + Vite (JS רגיל, **לא** TypeScript) | framework |
| CSS ידני (`src/styles.css`), **לא** Tailwind | styling |
| ניווט בין מודולים לפי state בסיידבר, **לא** react-router | ניווט |
| קריאות ישירות ל-`@supabase/supabase-js`, **לא** TanStack Query | data fetching |
| טפסים כ-controlled state רגיל, **לא** react-hook-form/zod | טפסים |

**חשוב:** זה שונה בכוונה מהסטאק של [portal-tomana](../portal-tomana) (שם יש TS+Tailwind+router+TanStack Query). המשתמש בחר להטמיע את המערכת המוכנה מה-ZIP כמו שהיא במקום לבזבז זמן על מיגרציה לסטאק אחר — כלי פנימי קטן, לא צריך את כל המנגנון.

## מבנה
- `supabase/schema.sql` — כל הטבלאות (tasks, ideas, products, suppliers, opportunities, trends) + RLS ("authenticated full access" על הכל — מתאים לצוות סגור וקטן)
- `src/modules/moduleConfigs.js` — **הגדרת כל מודול** (שדות, תוויות, סטטוסים). מודול חדש = בלוק חדש כאן, בלי UI נוסף
- `src/modules/GenericModule.jsx` — רכיב CRUD גנרי אחד שמשרת את כל המודולים
- `src/pages/Login.jsx` + `src/contexts/AuthContext.jsx` — Auth
- מודול המוצרים: `profit` ו-`margin_percent` הם generated columns ב-SQL (מחושבים אוטומטית ב-DB)

## Git Workflow
```bash
git status
git add .
git commit -m "תיאור השינוי"
git push origin main
```

## פקודות
```bash
npm install
cp .env.example .env   # למלא לאחר הקמת Supabase
npm run dev
npm run build
```
