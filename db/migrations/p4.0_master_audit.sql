-- ============================================================================
--  P4.0-b — 마스터(거래처·품목)에 변경 이력 트리거 부착
-- ============================================================================
--  실행: Supabase 대시보드 → SQL Editor → New query → 붙여넣기 → Run.
--  성격: 순수 추가(기존 데이터·스키마·권한 무변경) + 멱등(drop if exists → create).
--
--  왜: SPEC I5는 "감사 추적 — **모든 변경 이력** ✅ 구현(P2.1)"이고 SPEC §8은 P2 완료를
--      선언했지만, 실제로 fn_audit이 붙은 곳은 전표 헤더 4개뿐이었다:
--        quotations(p2.1) · sales_orders(p2.2) · purchase_orders(p3.1) · shipments(p3.2)
--      companies·products 는 감사 밖이었다. 게다가 이 둘은 RPC가 아니라 앱이 직접
--      .update() 한다 → 표준단가를 고치거나 거래처를 비활성으로 바꿔도 누가 언제 무엇을
--      바꿨는지 기록이 전혀 없었다. "삭제 없음(active 토글)"은 지켰지만 "이력에 남는다"는
--      못 지킨 반쪽 상태. (2026-07-16 전수감사 확정 결함 ②)
--
--  범위: fn_audit을 **호출만** 한다. fn_audit 자체(p2.1의 라이브 잠금 객체)는 건드리지 않는다.
--        제네릭 트리거라 앱 코드 0줄로 붙는다 — P2.1이 노린 바로 그 설계 배당금이다.
--
--  ⚠️ inquiries 는 이번 범위가 아니다. 전표(문의)라 마스터와 성격이 다르고,
--     원 스펙이 companies·products 2개만 승인했다. 후속 단계에서 같은 2줄로 붙일 수 있다.
--
--  ⚠️ 라인/자식 테이블에는 붙이지 않는 규칙 유지(quotation_items 등):
--     저장 시 전량 DELETE+재INSERT 하므로 감사행이 폭주하고 시각적 '삭제' 모순이 생긴다.
--     companies·products 는 헤더급 단일 행 UPDATE라 이 문제가 없다.
-- ============================================================================

-- 1) 거래처 마스터
drop trigger if exists trg_audit_companies on public.companies;
create trigger trg_audit_companies
  after insert or update or delete on public.companies
  for each row execute function public.fn_audit();

-- 2) 품목 마스터
drop trigger if exists trg_audit_products on public.products;
create trigger trg_audit_products
  after insert or update or delete on public.products
  for each row execute function public.fn_audit();

-- PostgREST 스키마 캐시 갱신 (이 프로젝트의 알려진 함정).
notify pgrst, 'reload schema';

-- ── 검증(선택, Run 후 거래처 아무거나 열어 메모 한 글자 고쳐 저장한 뒤) ──────
--   select at, table_name, action, record_id
--     from public.audit_log
--    where table_name in ('companies','products')
--    order by at desc limit 5;
--   → 방금 저장한 거래처의 UPDATE 행 1건이 보이면 성공.
--   (화면으로는 /audit 에서 대상이 '거래처'로 표시된다.)

-- ── 되돌리기(rollback, 실행 시 이전 동작 그대로 복원) ───────────────────────
--   drop trigger if exists trg_audit_companies on public.companies;
--   drop trigger if exists trg_audit_products  on public.products;
