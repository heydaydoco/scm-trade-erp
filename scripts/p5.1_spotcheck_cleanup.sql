-- ============================================================================
--  P5.1 스팟체크 잔여물 정리 (1회성) — 파괴적 SQL 규칙(사전 가드 + 독립 사후검증)
-- ----------------------------------------------------------------------------
--  대상(P51 표식 테스트 데이터, 오너 직권 지시 스팟체크 클코 대행분):
--    · 통관신고 ECD-202607-001  (6da81e31-0a88-48a5-9a7f-4888dab376c6, cancelled)
--    · 선적     SHP-202607-008  (c95e46b6-10a8-41d8-a870-304a6071eb2d, draft)
--  실행: Supabase 대시보드 → SQL Editor → New query → 붙여넣기 → Run → 결과표 전체 회신.
--  ⚠️ audit_log 의 P51 이력행과 발번 공백(SHP 8번·ECD 1번 소비분)은 불변·정상 — 건드리지 않음.
--  ⚠️ 사전 가드 4종 중 하나라도 어긋나면 raise 로 전체 트랜잭션 중단(오삭제 방지).
--
--  ✅ 2026-07-21 오너 Run 완료 · 사후검증 8대상 전부 잔존 0
--     (가드 4종 통과 → 삭제 실행 → 번호·표식·구 선적 자식 4테이블 전부 0행 확인).
-- ============================================================================

do $$
declare
  v_decl uuid := '6da81e31-0a88-48a5-9a7f-4888dab376c6';
  v_ship uuid := 'c95e46b6-10a8-41d8-a870-304a6071eb2d';
  v_n int;
begin
  -- 가드 ① 신고 UUID 행이 기대 번호 + P51 표식과 정확히 일치(1건)
  select count(*) into v_n from public.customs_declarations
   where id = v_decl and decl_doc_no = 'ECD-202607-001' and memo like 'P51-spotcheck%';
  if v_n <> 1 then
    raise exception '가드①실패: 신고 %가 ECD-202607-001 + P51 표식과 불일치(매칭 %건). 중단.', v_decl, v_n;
  end if;

  -- 가드 ② 선적 UUID 행이 기대 번호 + P51 표식과 정확히 일치(1건)
  select count(*) into v_n from public.shipments
   where id = v_ship and ship_number = 'SHP-202607-008' and notes like 'P51-spotcheck%';
  if v_n <> 1 then
    raise exception '가드②실패: 선적 %가 SHP-202607-008 + P51 표식과 불일치(매칭 %건). 중단.', v_ship, v_n;
  end if;

  -- 가드 ③ 해당 선적에 대상 외 통관신고가 없어야(0건)
  select count(*) into v_n from public.customs_declarations
   where shipment_id = v_ship and id <> v_decl;
  if v_n <> 0 then
    raise exception '가드③실패: 선적 %에 대상 외 통관신고 %건 존재. 중단.', v_ship, v_n;
  end if;

  -- 가드 ④ 해당 선적에 무역서류가 없어야(0건 — 있으면 삭제가 RESTRICT 로 막히거나 실데이터 위험)
  select count(*) into v_n from public.trade_documents where shipment_id = v_ship;
  if v_n <> 0 then
    raise exception '가드④실패: 선적 %에 무역서류 %건 존재. 중단.', v_ship, v_n;
  end if;

  -- 삭제: 통관신고 먼저(shipments RESTRICT 해제) → 선적(자식 CASCADE)
  delete from public.customs_declarations where id = v_decl;
  delete from public.shipments where id = v_ship;

  raise notice '정리 완료: 통관신고 % · 선적 % 삭제.', v_decl, v_ship;
end $$;

-- ── 독립 사후검증 (삭제 UUID 아닌 식별자 기준 — 전부 0 이어야 정상) ─────────────
select * from (
  select '1.신고번호 ECD-202607-001 잔존(0 정상)'::text as 검증,
         (select count(*) from public.customs_declarations where decl_doc_no = 'ECD-202607-001')::text as 값
  union all
  select '2.선적번호 SHP-202607-008 잔존(0 정상)',
         (select count(*) from public.shipments where ship_number = 'SHP-202607-008')::text
  union all
  select '3.P51 통관신고 표식 스윕(0 정상)',
         (select count(*) from public.customs_declarations where memo like 'P51-spotcheck%' or broker_name like 'P51%')::text
  union all
  select '4.P51 선적 표식 스윕(0 정상)',
         (select count(*) from public.shipments where notes like 'P51-spotcheck%')::text
  union all
  select '5.구 선적 자식 shipment_orders(0 정상)',
         (select count(*) from public.shipment_orders where shipment_id = 'c95e46b6-10a8-41d8-a870-304a6071eb2d')::text
  union all
  select '6.구 선적 자식 shipment_lines(0 정상)',
         (select count(*) from public.shipment_lines where shipment_id = 'c95e46b6-10a8-41d8-a870-304a6071eb2d')::text
  union all
  select '7.구 선적 자식 shipment_parties(0 정상)',
         (select count(*) from public.shipment_parties where shipment_id = 'c95e46b6-10a8-41d8-a870-304a6071eb2d')::text
  union all
  select '8.구 선적 자식 milestones(0 정상)',
         (select count(*) from public.milestones where shipment_id = 'c95e46b6-10a8-41d8-a870-304a6071eb2d')::text
) x
order by 검증;
