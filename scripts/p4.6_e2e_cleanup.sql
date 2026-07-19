-- ============================================================================
--  P4.6 E2E 표식 데이터 정리 — 1회성 SQL  (제안 · 아키텍트 승인 후 오너 Run)
-- ============================================================================
--  성격: 마이그레이션 밖 · 레포 기록(untracked) · **실행 전 제안**. 표식 'P46E2E'
--        풀체인(문의→견적→수주×2→발주→선적→입고→출고(취소)→CI(발행)) 전량 삭제.
--  실행: 아키텍트 승인 후 Supabase 대시보드 → SQL Editor → 붙여넣기 → Run.
--
--  ⚠️ 소유자(postgres) 실행이라 anon 쓰기봉인은 우회되나 **가드 트리거는 발화**한다.
--     그래서 삭제 순서가 결정적이다:
--       · 활성(issued) CI 가 있는 선적은 화물·당사자 삭제가 막힌다 → CI 먼저.
--       · trade_documents.shipment_id 는 ON DELETE RESTRICT → CI 먼저(선적 전).
--       · so_lines/po_lines 소비 가드(BEFORE DELETE) → 후속(선적라인·출고·입고)을 먼저.
--       · stock_movements.reversal_of_id self-FK → REVERSAL 먼저, 원행 나중.
--  ⚠️ 발번 공백(QT/SO/PO/SHP/GR/DLV/CI 카운터 소비분)은 롤백·재사용 금지 — 정상 상태.
--  ⚠️ audit_log 의 표식 관련 행(INSERT/UPDATE/DELETE 이력)은 **불변 기록이라 남긴다**(정상).
--
--  대상 id (E2E 상태 기준 — 앞 8자리 표기):
--    companies       : e141d94f (P46E2E 고객사) · 15c108a3 (P46E2E 공급사)
--    products        : 857c9772 (P46E2E 위젯)
--    inquiries       : e577b8cb
--    quotations      : d6dba4fe (QT-202607-001)
--    sales_orders    : 48bb17d3 (SO-202607-009) · d53ccb39 (SO-202607-010)
--    purchase_orders : 34bc2f13 (PO-202607-009)
--    shipments       : ebd32888 (SHP-202607-007)
--    goods_receipts  : 340af06c (GR-202607-005)
--    deliveries      : e16eba89 (DLV-202607-006, 취소)
--    trade_documents : d575c57e (CI-202607-005, 발행)
-- ============================================================================

begin;

-- ── 0) 참조 가드: 대상이 표식 행이 맞는지 확인(아니면 전체 롤백·실데이터 보호) ──
do $$
begin
  if not exists (select 1 from public.products
                 where id = '857c9772-09cb-4672-a82c-cb5d05f95757' and product_name = 'P46E2E 위젯') then
    raise exception '가드 실패: 품목 857c9772 가 표식(P46E2E 위젯)이 아님 — 중단';
  end if;
  if not exists (select 1 from public.companies
                 where id = 'e141d94f-ba15-4f7a-b2a4-82464693f89d' and company_name like 'P46E2E%') then
    raise exception '가드 실패: 거래처 e141d94f 가 표식이 아님 — 중단';
  end if;
  if not exists (select 1 from public.trade_documents
                 where id = 'd575c57e-a52f-488d-9ba1-478905110678' and seller_name like 'P46E2E%') then
    raise exception '가드 실패: CI d575c57e 가 표식 Seller 가 아님 — 중단';
  end if;
end $$;

-- ── 1) 무역서류(CI) — 활성 CI 가드 해제 + shipment RESTRICT 선결 (cascade: lines) ─
delete from public.trade_documents where id = 'd575c57e-a52f-488d-9ba1-478905110678';

-- ── 2) 재고 원장 — REVERSAL(self-FK) 먼저, 그다음 원행. 표식 품목으로 한정 ──────
delete from public.stock_movements
 where item_id = '857c9772-09cb-4672-a82c-cb5d05f95757' and movement_type = 'REVERSAL';
delete from public.stock_movements
 where item_id = '857c9772-09cb-4672-a82c-cb5d05f95757';

-- ── 3) 입고·출고 (cascade: gr_lines · delivery_lines) ────────────────────────
delete from public.goods_receipts where id = '340af06c-c5ad-453e-9a2b-feeb8d65f8db';
delete from public.deliveries      where id = 'e16eba89-c972-4fa5-84eb-428c17f162d1';

-- ── 4) 선적 (cascade: shipment_orders · shipment_lines · shipment_parties) ────
--     shipment_lines BEFORE DELETE 가드: 활성 CI 없음(1) → 통과.
--     shipment_orders 지연 unlink 가드: 커밋 시점 화물라인 없음 → 통과.
delete from public.shipments where id = 'ebd32888-0ad5-43d5-85c2-08715ada4ab2';

-- ── 5) 발주·수주 (cascade: po_lines · so_lines) — 소비 가드: 후속 전부 삭제됨 → 통과
delete from public.purchase_orders where id = '34bc2f13-48c6-482a-8180-667d1cbe224d';
delete from public.sales_orders
 where id in ('48bb17d3-5c11-4101-a16f-668904a3100c', 'd53ccb39-7f63-4379-935d-bce320cbf10d');

-- ── 6) 견적(cascade: quotation_items) · 문의 ─────────────────────────────────
delete from public.quotations where id = 'd6dba4fe-e9bb-453b-8e92-c7227274d29b';
delete from public.inquiries  where id = 'e577b8cb-e7da-401a-ae55-ff8a950e29c3';

-- ── 7) 마스터: 품목 · 거래처 (위에서 전 참조 삭제 → FK 자유) ──────────────────
delete from public.products  where id = '857c9772-09cb-4672-a82c-cb5d05f95757';
delete from public.companies
 where id in ('e141d94f-ba15-4f7a-b2a4-82464693f89d', '15c108a3-e2fc-47ac-a06d-83e061d6665b');

commit;

-- ── 8) 사후 검증 (마지막 문장 — 결과표 드래그 복사 회신) ─────────────────────
--     기대: 전부 0. 광역 표식(P46E2E) 잔존도 0. (audit_log 표식 이력은 불변이라 제외·정상)
--  ★ 검증 필터는 삭제문 UUID 와 **독립된 2요소**(전표번호)를 쓴다 — UUID 오기 시
--    "0행 삭제(잔존) + 검증 통과" 마스킹을 차단(삭제=UUID, 검증=번호). 문의는 미발번이라
--    UUID 유지(company_id NO ACTION FK 가 미삭제를 어차피 잡음).
select 'products (표식)'::text        as 대상, count(*)::int as 잔존 from public.products        where product_name like 'P46E2E%'
union all select 'companies (표식)',   count(*) from public.companies       where company_name like 'P46E2E%'
union all select 'inquiries',          count(*) from public.inquiries        where id = 'e577b8cb-e7da-401a-ae55-ff8a950e29c3'
union all select 'quotations',         count(*) from public.quotations       where quotation_number = 'QT-202607-001'
union all select 'sales_orders',       count(*) from public.sales_orders     where so_number in ('SO-202607-009', 'SO-202607-010')
union all select 'purchase_orders',    count(*) from public.purchase_orders  where po_number = 'PO-202607-009'
union all select 'shipments',          count(*) from public.shipments        where ship_number = 'SHP-202607-007'
union all select 'shipment_lines(고아)', count(*) from public.shipment_lines  where shipment_id in (select id from public.shipments where ship_number = 'SHP-202607-007')
union all select 'goods_receipts',     count(*) from public.goods_receipts   where gr_no = 'GR-202607-005'
union all select 'deliveries',         count(*) from public.deliveries       where delivery_no = 'DLV-202607-006'
union all select 'trade_documents',    count(*) from public.trade_documents  where doc_number = 'CI-202607-005'
union all select 'stock_movements(표식품목)', count(*) from public.stock_movements where item_id = '857c9772-09cb-4672-a82c-cb5d05f95757'
union all select 'trade_document_lines(광역 표식품명)', count(*) from public.trade_document_lines where product_name like 'P46E2E%'
order by 대상;
