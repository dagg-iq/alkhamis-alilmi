-- 32: الفهرسة كتابان معاً كحد أقصى (بطلب المالك): العامل يأخذ أجزاءً من أول كتابين في الطابور فقط،
-- وحين يكتمل أحدهما يدخل الثالث تلقائياً. آمن لإعادة التشغيل.
create or replace function public.claim_ingest_chunks(p_limit int, p_lease_seconds int default 240)
returns setof public.ingest_chunks language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.ingest_chunks c set status = 'running', lease_until = now() + make_interval(secs => p_lease_seconds), attempts = c.attempts + 1
  where c.id in (
    select x.id from public.ingest_chunks x
    where x.document_id in (
        -- أول كتابين ما زالت لهما أجزاء لم تكتمل (بترتيب الدخول للطابور)
        select d.id from public.documents d
        where d.queued_at is not null
          and exists (select 1 from public.ingest_chunks y where y.document_id = d.id and y.status in ('pending', 'running'))
        order by d.queued_at, d.id
        limit 2
      )
      and x.next_at <= now()
      and (x.status = 'pending' or (x.status = 'running' and x.lease_until < now()))
    order by (select d.queued_at from public.documents d where d.id = x.document_id), x.document_id, x.from_page
    limit p_limit
    for update of x skip locked
  )
  returning c.*;
end $$;
revoke execute on function public.claim_ingest_chunks(int, int) from public, anon, authenticated;
