-- تصحيح لمرة واحدة (يُشغَّل من lectures-sql.yml عند تغيير هذا الملف):
-- فحص فعلي للمفاتيح (Health check، ١٥/١٠ ١١:١٦ UTC): 3.5 Flash يعمل على ٦ مفاتيح من ٨ والخفيفة على الكل،
-- لكن القاعدة تقفل النماذج القوية «انتهت الحصة اليومية» حتى الغد فلا يستعملها المساعد. نحذف هذه الأقفال؛
-- النموذج المنتهي فعلاً يُقفل من جديد تلقائياً عند أول 429.
delete from public.ai_key_blocks
where model in ('gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.8-flash')
  and blocked_until > now();
select model, count(*) as still_blocked from public.ai_key_blocks where blocked_until > now() group by 1;
