-- 30: عدد الصفحات المقروءة فعلاً (ingested_pages = المتتالية من ١ فقط، فكتاب قُرئت صفحاته ١٧–١٠٤ كان يظهر «٠»). آمن لإعادة التشغيل.
alter table public.documents add column if not exists read_pages int;
update public.documents d set read_pages = (select count(*) from public.document_pages p where p.document_id = d.id)
where read_pages is null;
