-- 22: أقفال الحصة اليومية القديمة كانت حتى ٣:٠٠ فجراً بغداد (منتصف ليل UTC)، لكن Google تجدد الحصة
-- منتصف ليل كاليفورنيا (١٠:٠٠ صباحاً بغداد صيفاً، ١١:٠٠ شتاءً). نمدّ القفل القائم إلى التجدد الصحيح
-- فلا يضيع طلب على نموذج منتهٍ عند ٣ فجراً. آمن لإعادة التشغيل.
update public.ai_key_blocks
set blocked_until = (((now() at time zone 'America/Los_Angeles')::date + 1)::timestamp at time zone 'America/Los_Angeles') + interval '30 seconds',
    updated_at = now()
where reason like '%اليومية%'
  and blocked_until > now()
  and blocked_until < ((now() at time zone 'America/Los_Angeles')::date + 1)::timestamp at time zone 'America/Los_Angeles';
