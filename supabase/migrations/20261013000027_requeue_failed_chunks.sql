-- 27: الأجزاء التي فشلت بسبب صفحة لا يعيدها النموذج (بيضاء/صورة) تعود للطابور: العامل الآن يكمّل هذه الصفحات فارغة
-- بعد المحاولة الثالثة بدل الفشل. آمن لإعادة التشغيل (يمس الأجزاء الفاشلة فقط، ولا يبقى منها إلا ما لم يُقرأ منه شيء).
update public.ingest_chunks
set status = 'pending', attempts = 2, next_at = now(), lease_until = null, last_error = 'أُعيد للطابور (تكميل الصفحات الفارغة)'
where status = 'failed';

update public.documents d
set queued_at = now(), ingest_status = 'running', ingest_error = null
where d.queued_at is null
  and exists (select 1 from public.ingest_chunks c where c.document_id = d.id and c.status = 'pending');
