-- ============================================================================
--  P1.1 — 원자적 전표 발번 (원칙 6)   ※ 소급 기록 (RETROACTIVE DOCUMENTATION) ※
-- ============================================================================
--  이 객체들은 P1.1에서 Supabase 대시보드에서 직접 만들어졌고, repo에는 기록이
--  없었다. P1.5 착수 시 실데이터로 계약을 확인하고(2026-06-30) 이 파일로 남긴다.
--
--  ⚠️ 재실행 불필요 — 이미 DB에 존재한다. 아래는 "관측된 계약"의 재구성이며,
--     권위 있는 정의는 DB에 있다.
--  ⚠️ 다른 시그니처(예: 2-arg, 정수 반환)로 새로 만들지 말 것 — PostgreSQL
--     오버로딩으로 두 함수가 공존하며 카운터가 분기된다. 새 전표유형(SO/PO 등)은
--     같은 3-arg 함수에 다른 doc_type/prefix로 호출한다.
--
--  실데이터로 검증한 계약:
--    next_doc_number('quotation','QT','202606')  →  'QT-202606-001'  (NNN 3자리)
--    카운터는 doc_counters(doc_type, period)별로 원자적 증가(행잠금).
--    견적 호출 규약: doc_type='quotation' (←'QT'가 아님), prefix='QT', period='YYYYMM'
-- ============================================================================

-- 전표유형 + 월(YYYYMM)별 카운터
create table if not exists public.doc_counters (
  doc_type text    not null,
  period   text    not null,            -- 'YYYYMM'
  last_no  integer not null default 0,
  primary key (doc_type, period)
);

-- 완성 문자열을 반환하는 3-arg 발번 함수 (P1.5 견적이 이 함수를 호출)
create or replace function public.next_doc_number(
  p_doc_type text,
  p_prefix   text,
  p_period   text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_no integer;
begin
  insert into public.doc_counters (doc_type, period, last_no)
  values (p_doc_type, p_period, 1)
  on conflict (doc_type, period)
    do update set last_no = public.doc_counters.last_no + 1
  returning last_no into v_no;
  return p_prefix || '-' || p_period || '-' || lpad(v_no::text, 3, '0');
end;
$$;

grant execute on function public.next_doc_number(text, text, text) to anon, authenticated;
