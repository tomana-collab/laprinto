# Laprinto CRM — הגדרות פרויקט

## מה זה הפרויקט
CRM חדש לעסק laprinto. פרויקט נפרד לגמרי מ-[laprinto](../laprinto) (אתר האיקומרס ב-WordPress).

## חיבורים

### GitHub
- **Repo:** `git@github.com:tomana-collab/laprinto.git` (דרך host alias `github-laprinto-crm`)
- **אימות:** SSH דרך `~/.ssh/id_ed25519_laprinto_crm` (deploy key ייעודי, לא המפתח האישי)
- **Branch ראשי:** `main`

### Supabase
טרם הוקם — ממתין ל-Project URL + anon key (`.env` מקומי, ו-env vars ב-Vercel).

### Vercel
טרם חובר — יש לייבא את ה-repo מ-GitHub דרך Vercel dashboard.

## Stack טכנולוגי
| חבילה | תפקיד |
|---|---|
| React 18 + TypeScript + Vite | framework |
| Tailwind CSS 3 | styling |
| react-router-dom v6 | ניווט |
| @tanstack/react-query | data fetching |
| @supabase/supabase-js | backend / auth / DB |
| react-hook-form + zod | טפסים + validation |
| sonner | toast notifications |
| lucide-react | אייקונים |

(אותו סטאק כמו [portal-tomana](../portal-tomana), לפי בקשת המשתמש.)

## Git Workflow
```bash
git status
git add .
git commit -m "תיאור השינוי"
git push origin main
```

## פקודות
```bash
npm run dev      # פיתוח מקומי
npm run build    # בניה לפרודקשן
npm run lint     # בדיקת קוד
```
