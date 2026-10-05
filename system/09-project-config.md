# إعدادات المشروع الفعلية (معلومات عامة فقط)

> ⚠️ هذا الملف في GitHub — لا يُكتب فيه أبداً: كلمات السر، `Secret key`، `service_role`، مفتاح Gemini، مفاتيح R2.

## Supabase
| | القيمة |
|---|---|
| Organization | saey |
| Project ref | `yjxhprmtyuqnbgraocar` |
| Project URL | `https://yjxhprmtyuqnbgraocar.supabase.co` |
| Dashboard | https://supabase.com/dashboard/project/yjxhprmtyuqnbgraocar |
| Google callback (يُلصق في Google Cloud) | `https://yjxhprmtyuqnbgraocar.supabase.co/auth/v1/callback` |
| Edge functions | `https://yjxhprmtyuqnbgraocar.supabase.co/functions/v1/<name>` |
| Push webhook | `https://yjxhprmtyuqnbgraocar.supabase.co/functions/v1/push` |

### المفاتيح العامة (آمنة في التطبيق — محمية بـ RLS)
- **anon public**:
  `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlqeGhwcm10eXVxbmJncmFvY2FyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyMjUwMzUsImV4cCI6MjEwNjgwMTAzNX0.uKov_hUtVxVSv7-8DNN9ycwRNHN4egtfMmrNTeU7vMk`
- **Publishable key**: `sb_publishable_GbrDxCOxuIW8-jEJ0DzHLg_iclXuE4i`

## متغيرات البيئة
```
# apps/mobile/.env
EXPO_PUBLIC_SUPABASE_URL=https://yjxhprmtyuqnbgraocar.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon public أعلاه>

# apps/admin/.env.local  و  Netlify → Environment variables
VITE_SUPABASE_URL=https://yjxhprmtyuqnbgraocar.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public أعلاه>
```
