# Laprinto CRM

מערכת פנימית לניהול העסק והאיקומרס: משימות, רעיונות, מוצרים ורווחיות, ספקים, הזדמנויות וטרנדים.

React + Vite בצד הלקוח, Supabase (Postgres + Auth) בצד השרת.

---

## 1. הקמת Supabase

1. היכנס ל-[supabase.com](https://supabase.com) → **New project**.
2. אחרי שהפרויקט מוקם, עבור ל-**SQL Editor** → New query, הדבק את כל תוכן הקובץ `supabase/schema.sql` שבתיקייה הזו, ולחץ Run.
   זה יוצר את כל הטבלאות (משימות, רעיונות, מוצרים, ספקים, הזדמנויות, טרנדים) כולל הרשאות (RLS).
3. עבור ל-**Authentication → Providers**, ודא ש-Email מופעל.
4. עבור ל-**Authentication → Users → Add user**, וצור שני משתמשים (אתה והשותף) עם אימייל וסיסמה. זה ה-login שתשתמשו בו בכניסה למערכת. **בטל את דרישת אימות האימייל** (Auto Confirm) כדי שלא יהיה צורך לאשר מייל.
5. עבור ל-**Project Settings → API**, והעתק:
   - `Project URL`
   - `anon public` key

## 2. הרצה מקומית

```bash
npm install
cp .env.example .env
# ערוך את .env והדבק את ה-URL וה-key מסעיף 1.5
npm run dev
```

האתר יעלה על `http://localhost:5173`.

## 3. העלאה ל-GitHub

```bash
git init
git add .
git commit -m "Laprinto CRM - initial"
git branch -M main
git remote add origin <כתובת הריפו שלך ב-GitHub>
git push -u origin main
```

**חשוב:** הקובץ `.env` לא עולה (מוגדר ב-`.gitignore`) כי הוא מכיל את מפתחות Supabase שלך.

## 4. פרסום אונליין (מומלץ: Vercel)

1. היכנס ל-[vercel.com](https://vercel.com) עם חשבון GitHub.
2. **New Project** → בחר את הריפו.
3. תחת **Environment Variables** הוסף את `VITE_SUPABASE_URL` ו-`VITE_SUPABASE_ANON_KEY` (אותם ערכים מ-`.env`).
4. Deploy. תקבל כתובת ציבורית שגם השותף שלך יכול להיכנס אליה ולהתחבר עם המשתמש שלו.

(אפשר גם GitHub Pages, אבל Vercel פשוט הרבה יותר לפרויקט Vite עם משתני סביבה.)

## מבנה המערכת

- `supabase/schema.sql` — כל הטבלאות וההרשאות
- `src/modules/moduleConfigs.js` — **כאן מגדירים כל מודול** (שדות, תוויות, סטטוסים). הוספת מודול חדש = בלוק חדש בקובץ הזה, בלי לכתוב UI נוסף
- `src/modules/GenericModule.jsx` — הרכיב שמציג רשימה, טופס הוספה/עריכה ומחיקה עבור כל מודול
- `src/pages/Login.jsx` — מסך ההתחברות
- `src/contexts/AuthContext.jsx` — ניהול המשתמש המחובר

## מודול המוצרים

לכל מוצר יש עלות, הוצאות נלוות ומחיר מכירה. **הרווח והמרווח (%) מחושבים אוטומטית במסד הנתונים** (generated columns ב-SQL) — לא צריך לחשב ידנית ולא ניתן "לשכוח" לעדכן אותם.

## הוספת מודול חדש בעתיד

1. הוסף טבלה חדשה ב-`supabase/schema.sql` (כולל RLS policy כמו הדוגמאות הקיימות).
2. הוסף בלוק חדש ב-`src/modules/moduleConfigs.js`.
3. הוסף את המפתח ל-`MODULE_ORDER`.

זהו — הרשימה, ההוספה, העריכה והמחיקה יעבדו אוטומטית.
