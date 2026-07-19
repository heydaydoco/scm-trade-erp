-- ============================================================================
--  P4.6 사전 현실조사 — 라이브 실태 점검 (읽기 전용 · SELECT 만)
-- ============================================================================
--  성격: 읽기 전용. 데이터 무변경. 화면 영향 0. DDL·INSERT/UPDATE/DELETE·RPC 호출 없음.
--        오직 pg_catalog 메타 + 각 테이블 count/group by 만 훑는다.
--  실행: Supabase 대시보드 → SQL Editor → New query → 붙여넣기 → Run.
--        결과는 단일 표(섹션·항목·값) — 드래그 복사해 회신해 주세요.
--  ⚠️ 이 파일은 마이그레이션이 아니다(레포 untracked). 커밋하지 않는다.
--
--  섹션:
--   0. 봉인 기준선 — 전면 스캔 객체 총수(기대 31 = 테이블 24 + 뷰 7)·쓰기권한 위반(기대 0행).
--      드리프트(고아 잔존·신규 미봉인) 여부 확인.
--   1. 행수 — 전 전표·원장·기록 테이블 행수(조사 규모·빈 테이블 파악).
--   2. 소프트 포인터 고아 — 포인터 컬럼별 대상 부재 행수(기대 0. >0 이면 사슬 끊김 실재).
--   3. 인덱스 실태 — 참조·포인터 컬럼에 인덱스가 있는지(P4.6 역추적 쿼리 비용 판단).
--   4. 상태값 분포 — 전표별 status / stock_movements.movement_type(취소·역전 표현 판단 재료).
-- ============================================================================

with
-- ── 봉인 전면 스캔 (verify_seal.sql 과 동일 기법: has_table_privilege 실효권한) ──
scan as (
  select cls.oid,
         cls.relname::text as obj,
         case when cls.relkind in ('v','m') then '뷰' else '테이블' end as kind
    from pg_class cls
    join pg_namespace n on n.oid = cls.relnamespace
   where n.nspname = 'public'
     and cls.relkind in ('r','p','v','m')
),
viol as (
  select s.kind, s.obj, r.role, pr.priv
    from scan s
    cross join (values ('anon'),('authenticated')) r(role)
    cross join (values ('INSERT'),('UPDATE'),('DELETE')) pr(priv)
   where has_table_privilege(r.role, s.oid, pr.priv)
),
-- ── 인덱스 컬럼 지도 (indkey unnest → 컬럼별 최선 인덱스 위치) ──
idx_cols as (
  select t.relname as tbl, a.attname as col, i.relname as idxname, k.ord as pos
    from pg_index ix
    join pg_class i  on i.oid = ix.indexrelid
    join pg_class t  on t.oid = ix.indrelid
    join pg_namespace ns on ns.oid = t.relnamespace
    cross join lateral unnest(ix.indkey) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
   where ns.nspname = 'public' and a.attnum > 0
),
idx_use as (
  select tbl, col, min(pos)::int as best_pos,
         (array_agg(idxname order by pos))[1] as idxname
    from idx_cols
   group by tbl, col
),
-- ── 조사 대상 포인터·참조 컬럼 목록 (인덱스 실태 조회용) ──
ptr(tbl, col, note) as (
  values
    ('quotations','inquiry_id','문의→견적 역추적 (하드FK on delete set null)'),
    ('quotations','company_id','견적→거래처 (하드FK)'),
    ('quotation_items','quotation_id','견적 헤더→라인 정참조 (PK 외 인덱스?)'),
    ('sales_orders','ref_quotation_id','견적→수주 역추적 (소프트)'),
    ('so_lines','so_id','수주 헤더→라인 정참조'),
    ('so_lines','ref_quotation_line_id','견적라인→수주라인 역추적 (소프트)'),
    ('purchase_orders','ref_sales_order_id','수주→발주 역추적 (소프트)'),
    ('po_lines','po_id','발주 헤더→라인 정참조'),
    ('po_lines','ref_so_line_id','수주라인→발주라인 역추적 (소프트)'),
    ('shipment_orders','order_id','주문→선적 역추적 (폴리모픽 소프트 +order_type)'),
    ('shipment_lines','order_line_id','주문라인→선적라인 역추적 (폴리모픽 소프트 +order_type)'),
    ('shipment_lines','item_id','선적라인→품목 (소프트)'),
    ('milestones','shipment_id','선적→마일스톤 정참조'),
    ('gr_lines','po_line_id','발주라인→입고라인 역추적 (소프트)'),
    ('delivery_lines','so_line_id','수주라인→출고라인 역추적 (소프트)'),
    ('stock_movements','ref_doc_id','전표→원장 역추적 (폴리모픽 소프트 +ref_doc_type)'),
    ('stock_movements','ref_line_id','전표라인→원장 역추적 (폴리모픽 소프트)'),
    ('trade_documents','shipment_id','선적→무역서류 (하드FK on delete restrict)'),
    ('trade_documents','customer_id','무역서류→거래처 (소프트)'),
    ('trade_document_lines','document_id','무역서류 헤더→라인 정참조'),
    ('trade_document_lines','shipment_line_id','선적라인→무역서류라인 역추적 (소프트)'),
    ('trade_document_lines','order_line_id','수주라인→무역서류라인 역추적 (소프트)'),
    ('audit_log','record_id','전표→감사이력 (폴리모픽 text +table_name)')
)

-- ── 0. 봉인 기준선 ──────────────────────────────────────────────────────────
select '0. 봉인 기준선'::text as 섹션,
       'public 객체 총수(기대 31 = 테이블 24 + 뷰 7)'::text as 항목,
       count(*)::text as 값
  from scan
union all select '0. 봉인 기준선', '  ├ 테이블 수(기대 24)', count(*)::text from scan where kind='테이블'
union all select '0. 봉인 기준선', '  └ 뷰 수(기대 7)',      count(*)::text from scan where kind='뷰'
union all select '0. 봉인 기준선', '쓰기권한 위반 건수(기대 0)',
       case when count(*)=0 then '0 — ✅ 봉인 정상' else count(*)::text || ' — ⚠️ 드리프트' end
  from viol
union all
select '0. 봉인 기준선', '위반 상세: ' || kind || ' ' || obj || ' × ' || role || ' × ' || priv, '⚠️ true'
  from viol

-- ── 1. 행수 (전 전표·원장·기록 테이블) ──────────────────────────────────────
union all select '1. 행수', 'companies (거래처 마스터)',      count(*)::text from public.companies
union all select '1. 행수', 'products (품목 마스터)',          count(*)::text from public.products
union all select '1. 행수', 'inquiries (문의)',                count(*)::text from public.inquiries
union all select '1. 행수', 'quotations (견적)',               count(*)::text from public.quotations
union all select '1. 행수', 'quotation_items (견적라인)',      count(*)::text from public.quotation_items
union all select '1. 행수', 'sales_orders (수주)',             count(*)::text from public.sales_orders
union all select '1. 행수', 'so_lines (수주라인)',             count(*)::text from public.so_lines
union all select '1. 행수', 'purchase_orders (발주)',          count(*)::text from public.purchase_orders
union all select '1. 행수', 'po_lines (발주라인)',             count(*)::text from public.po_lines
union all select '1. 행수', 'shipments (선적)',                count(*)::text from public.shipments
union all select '1. 행수', 'shipment_orders (선적↔주문 M:N)', count(*)::text from public.shipment_orders
union all select '1. 행수', 'shipment_lines (선적 화물라인)',  count(*)::text from public.shipment_lines
union all select '1. 행수', 'shipment_parties (선적 당사자)',  count(*)::text from public.shipment_parties
union all select '1. 행수', 'milestones (마일스톤)',           count(*)::text from public.milestones
union all select '1. 행수', 'goods_receipts (입고)',           count(*)::text from public.goods_receipts
union all select '1. 행수', 'gr_lines (입고라인)',             count(*)::text from public.gr_lines
union all select '1. 행수', 'deliveries (출고)',               count(*)::text from public.deliveries
union all select '1. 행수', 'delivery_lines (출고라인)',       count(*)::text from public.delivery_lines
union all select '1. 행수', 'stock_movements (재고 원장)',     count(*)::text from public.stock_movements
union all select '1. 행수', 'trade_documents (무역서류)',      count(*)::text from public.trade_documents
union all select '1. 행수', 'trade_document_lines (무역서류라인)', count(*)::text from public.trade_document_lines
union all select '1. 행수', 'audit_log (감사이력)',            count(*)::text from public.audit_log
union all select '1. 행수', 'fx_rates (환율대장)',             count(*)::text from public.fx_rates
union all select '1. 행수', 'doc_counters (발번 카운터)',      count(*)::text from public.doc_counters

-- ── 2. 소프트 포인터 고아 검사 (기대 0. >0 = 사슬 끊김 실재) ─────────────────
union all select '2. 소프트포인터 고아', 'sales_orders.ref_quotation_id → quotations',
  (select count(*) from public.sales_orders x where x.ref_quotation_id is not null
     and not exists (select 1 from public.quotations y where y.id = x.ref_quotation_id))::text
union all select '2. 소프트포인터 고아', 'so_lines.ref_quotation_line_id → quotation_items (라인=stale 가능)',
  (select count(*) from public.so_lines x where x.ref_quotation_line_id is not null
     and not exists (select 1 from public.quotation_items y where y.id = x.ref_quotation_line_id))::text
union all select '2. 소프트포인터 고아', 'purchase_orders.ref_sales_order_id → sales_orders',
  (select count(*) from public.purchase_orders x where x.ref_sales_order_id is not null
     and not exists (select 1 from public.sales_orders y where y.id = x.ref_sales_order_id))::text
union all select '2. 소프트포인터 고아', 'po_lines.ref_so_line_id → so_lines (라인=stale 가능)',
  (select count(*) from public.po_lines x where x.ref_so_line_id is not null
     and not exists (select 1 from public.so_lines y where y.id = x.ref_so_line_id))::text
union all select '2. 소프트포인터 고아', 'shipment_orders.order_id(SO) → sales_orders',
  (select count(*) from public.shipment_orders x where x.order_type='SO' and x.order_id is not null
     and not exists (select 1 from public.sales_orders y where y.id = x.order_id))::text
union all select '2. 소프트포인터 고아', 'shipment_orders.order_id(PO) → purchase_orders',
  (select count(*) from public.shipment_orders x where x.order_type='PO' and x.order_id is not null
     and not exists (select 1 from public.purchase_orders y where y.id = x.order_id))::text
union all select '2. 소프트포인터 고아', 'shipment_lines.order_line_id(SO) → so_lines',
  (select count(*) from public.shipment_lines x where x.order_type='SO' and x.order_line_id is not null
     and not exists (select 1 from public.so_lines y where y.id = x.order_line_id))::text
union all select '2. 소프트포인터 고아', 'shipment_lines.order_line_id(PO) → po_lines',
  (select count(*) from public.shipment_lines x where x.order_type='PO' and x.order_line_id is not null
     and not exists (select 1 from public.po_lines y where y.id = x.order_line_id))::text
union all select '2. 소프트포인터 고아', 'shipment_lines.item_id → products (자유텍스트=null 정상)',
  (select count(*) from public.shipment_lines x where x.item_id is not null
     and not exists (select 1 from public.products y where y.id = x.item_id))::text
union all select '2. 소프트포인터 고아', 'shipment_parties.company_id → companies',
  (select count(*) from public.shipment_parties x where x.company_id is not null
     and not exists (select 1 from public.companies y where y.id = x.company_id))::text
union all select '2. 소프트포인터 고아', 'gr_lines.po_line_id → po_lines (라인=stale 가능)',
  (select count(*) from public.gr_lines x where x.po_line_id is not null
     and not exists (select 1 from public.po_lines y where y.id = x.po_line_id))::text
union all select '2. 소프트포인터 고아', 'delivery_lines.so_line_id → so_lines (라인=stale 가능)',
  (select count(*) from public.delivery_lines x where x.so_line_id is not null
     and not exists (select 1 from public.so_lines y where y.id = x.so_line_id))::text
union all select '2. 소프트포인터 고아', 'so_lines.product_id → products (소프트 품목링크)',
  (select count(*) from public.so_lines x where x.product_id is not null
     and not exists (select 1 from public.products y where y.id = x.product_id))::text
union all select '2. 소프트포인터 고아', 'po_lines.product_id → products (소프트 품목링크)',
  (select count(*) from public.po_lines x where x.product_id is not null
     and not exists (select 1 from public.products y where y.id = x.product_id))::text
union all select '2. 소프트포인터 고아', 'goods_receipts.ref_doc_id → purchase_orders',
  (select count(*) from public.goods_receipts x where x.ref_doc_id is not null
     and not exists (select 1 from public.purchase_orders y where y.id = x.ref_doc_id))::text
union all select '2. 소프트포인터 고아', 'deliveries.ref_doc_id → sales_orders',
  (select count(*) from public.deliveries x where x.ref_doc_id is not null
     and not exists (select 1 from public.sales_orders y where y.id = x.ref_doc_id))::text
union all select '2. 소프트포인터 고아', 'stock_movements.ref_doc_id(GR) → goods_receipts',
  (select count(*) from public.stock_movements x where x.ref_doc_type='goods_receipt' and x.ref_doc_id is not null
     and not exists (select 1 from public.goods_receipts y where y.id = x.ref_doc_id))::text
union all select '2. 소프트포인터 고아', 'stock_movements.ref_doc_id(DLV) → deliveries',
  (select count(*) from public.stock_movements x where x.ref_doc_type='delivery' and x.ref_doc_id is not null
     and not exists (select 1 from public.deliveries y where y.id = x.ref_doc_id))::text
union all select '2. 소프트포인터 고아', 'stock_movements.ref_line_id(GR) → gr_lines',
  (select count(*) from public.stock_movements x where x.ref_doc_type='goods_receipt' and x.ref_line_id is not null
     and not exists (select 1 from public.gr_lines y where y.id = x.ref_line_id))::text
union all select '2. 소프트포인터 고아', 'stock_movements.ref_line_id(DLV) → delivery_lines',
  (select count(*) from public.stock_movements x where x.ref_doc_type='delivery' and x.ref_line_id is not null
     and not exists (select 1 from public.delivery_lines y where y.id = x.ref_line_id))::text
union all select '2. 소프트포인터 고아', 'trade_documents.customer_id → companies',
  (select count(*) from public.trade_documents x where x.customer_id is not null
     and not exists (select 1 from public.companies y where y.id = x.customer_id))::text
union all select '2. 소프트포인터 고아', 'trade_document_lines.shipment_line_id → shipment_lines',
  (select count(*) from public.trade_document_lines x where x.shipment_line_id is not null
     and not exists (select 1 from public.shipment_lines y where y.id = x.shipment_line_id))::text
union all select '2. 소프트포인터 고아', 'trade_document_lines.order_line_id → so_lines',
  (select count(*) from public.trade_document_lines x where x.order_line_id is not null
     and not exists (select 1 from public.so_lines y where y.id = x.order_line_id))::text
union all select '2. 소프트포인터 고아', '[참고] quotations.inquiry_id → inquiries (하드FK=0 확정)',
  (select count(*) from public.quotations x where x.inquiry_id is not null
     and not exists (select 1 from public.inquiries y where y.id = x.inquiry_id))::text

-- ── 3. 인덱스 실태 (참조·포인터 컬럼) ───────────────────────────────────────
union all
select '3. 인덱스 실태', p.tbl || '.' || p.col || ' — ' || p.note,
       coalesce('있음: ' || iu.idxname || ' (컬럼위치 ' || iu.best_pos || ')', '없음 ❌')
  from ptr p
  left join idx_use iu on iu.tbl = p.tbl and iu.col = p.col

-- ── 4. 상태값 분포 (취소·역전·기계전용 partial 포함) ────────────────────────
union all select '4. 상태분포: inquiries',       coalesce(status,'(null)'), count(*)::text from public.inquiries       group by status
union all select '4. 상태분포: quotations',      coalesce(status,'(null)'), count(*)::text from public.quotations      group by status
union all select '4. 상태분포: sales_orders',    coalesce(status,'(null)'), count(*)::text from public.sales_orders    group by status
union all select '4. 상태분포: purchase_orders', coalesce(status,'(null)'), count(*)::text from public.purchase_orders group by status
union all select '4. 상태분포: shipments',       coalesce(status,'(null)'), count(*)::text from public.shipments       group by status
union all select '4. 상태분포: goods_receipts',  coalesce(status,'(null)'), count(*)::text from public.goods_receipts  group by status
union all select '4. 상태분포: deliveries',      coalesce(status,'(null)'), count(*)::text from public.deliveries      group by status
union all select '4. 상태분포: trade_documents', coalesce(status,'(null)'), count(*)::text from public.trade_documents group by status
union all select '4. 이동유형: stock_movements', movement_type,             count(*)::text from public.stock_movements group by movement_type

order by 섹션, 항목;
