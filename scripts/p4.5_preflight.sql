-- ============================================================================
--  P4.5 사전점검 (읽기 전용 — SELECT만, 상태 변경 없음)
-- ============================================================================
--  마이그레이션 작성 전 라이브 DB 실사. 기대값:
--    · 1.봉인 드리프트 — 위반 0건 · 객체 총수 29 (P4.4h 기준선 유지 확인)
--    · 2.발번 함수 — 오버로드 1 · prosecdef true · (p_doc_type text, p_prefix text, p_period text)
--    · 3.발번 카운터 — trade_document/CI 계열 기존 행 0 (있으면 첫 발번이 001이 아니게 됨)
--    · 4.신규 테이블 선점검 — trade_documents/trade_document_lines 둘 다 absent
--    · 5.제약 실존 — shipments status/direction CHECK 2건 + 정의문에 'cancelled' 포함
--      (P4.4가 조건부 생성했으므로 실존 확인 — 잠금 가드가 status 판정에 의존)
--    · 6.데이터 현황 — 참고용(발행 폼 폴백 UX 판단 자료), 기대값 없음
-- ============================================================================

with scan as (
  select cls.oid,
         cls.relname::text as obj,
         case when cls.relkind in ('v', 'm') then '뷰' else '테이블' end as kind
    from pg_class cls
    join pg_namespace n on n.oid = cls.relnamespace
   where n.nspname = 'public'
     and cls.relkind in ('r', 'p', 'v', 'm')
),
viol as (
  select s.kind, s.obj, r.role, pr.priv
    from scan s
    cross join (values ('anon'), ('authenticated')) r(role)
    cross join (values ('INSERT'), ('UPDATE'), ('DELETE')) pr(priv)
   where has_table_privilege(r.role, s.oid, pr.priv)
),
ndn as (
  select p.oid, p.prosecdef, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'next_doc_number'
)
select * from (
  select '1.봉인 드리프트'::text as 구분,
         (v.kind || ' ' || v.obj || ' × ' || v.role || ' × ' || v.priv)::text as 항목,
         '⚠️ true'::text as 값
    from viol v
  union all
  select '1.봉인 드리프트', 'public 테이블·뷰 총수(29가 기준선)', count(*)::text from scan
  union all
  select '1.봉인 드리프트', '위반 건수(0이 정상)',
         case when count(*) = 0 then '0 — ✅ 봉인 정상' else count(*)::text || ' — ⚠️ 드리프트' end
    from viol
  union all
  select '2.발번 함수', 'next_doc_number 오버로드 수(1이 정상)', count(*)::text from ndn
  union all
  select '2.발번 함수', 'prosecdef(true가 정상)',
         coalesce((select bool_and(prosecdef)::text from ndn), 'absent')
  union all
  select '2.발번 함수', '시그니처',
         coalesce((select string_agg(args, ' | ') from ndn), 'absent')
  union all
  select '2.발번 함수', 'anon EXECUTE(참고)',
         coalesce((select has_function_privilege('anon', oid, 'execute')::text
                     from ndn limit 1), 'absent')
  union all
  select '3.발번 카운터', 'trade_document/CI 계열 기존 행 수(0이 정상)',
         count(*)::text
    from public.doc_counters
   where doc_type in ('trade_document', 'CI', 'commercial_invoice')
  union all
  select '3.발번 카운터', '기존 행 상세: ' || dc.doc_type || ' / ' || dc.period,
         'last_no=' || dc.last_no::text
    from public.doc_counters dc
   where dc.doc_type in ('trade_document', 'CI', 'commercial_invoice')
  union all
  select '4.신규 테이블 선점검', o.tbl,
         case when to_regclass('public.' || o.tbl) is null
              then 'absent — ✅ 생성 가능'
              else '⚠️ 이미 존재' end
    from (values ('trade_documents'), ('trade_document_lines')) o(tbl)
  union all
  select '5.제약 실존', c.conname::text, pg_get_constraintdef(c.oid)
    from pg_constraint c
   where c.conrelid = 'public.shipments'::regclass
     and c.conname in ('shipments_status_check', 'shipments_direction_check')
  union all
  select '5.제약 실존', 'shipments status/direction CHECK 수(2가 정상)',
         count(*)::text
    from pg_constraint c
   where c.conrelid = 'public.shipments'::regclass
     and c.conname in ('shipments_status_check', 'shipments_direction_check')
  union all
  select '5.제약 실존', 'shipments_ship_number_unique 인덱스(1이 정상)',
         count(*)::text
    from pg_indexes
   where schemaname = 'public' and indexname = 'shipments_ship_number_unique'
  union all
  select '6.데이터 현황(참고)', 'a. 미취소 선적 수',
         count(*)::text
    from public.shipments s
   where s.status <> 'cancelled'
  union all
  select '6.데이터 현황(참고)', 'b. 그중 SO 화물 라인 보유 선적 수',
         count(distinct s.id)::text
    from public.shipments s
    join public.shipment_lines sl on sl.shipment_id = s.id and sl.order_type = 'SO'
   where s.status <> 'cancelled'
  union all
  select '6.데이터 현황(참고)', 'c. 미취소 선적에 연결된 SO 중 통화 공란 건수',
         count(*)::text
    from public.shipment_orders so_link
    join public.shipments s on s.id = so_link.shipment_id
    join public.sales_orders so on so.id = so_link.order_id
   where so_link.order_type = 'SO'
     and s.status <> 'cancelled'
     and nullif(btrim(coalesce(so.currency, '')), '') is null
  union all
  select '6.데이터 현황(참고)', 'd. 미취소 선적 중 consignee 미입력 수',
         count(*)::text
    from public.shipments s
   where s.status <> 'cancelled'
     and not exists (select 1 from public.shipment_parties p
                      where p.shipment_id = s.id and p.role = 'consignee')
  union all
  select '6.데이터 현황(참고)', 'e. 미취소 선적 중 notify 미입력 수',
         count(*)::text
    from public.shipments s
   where s.status <> 'cancelled'
     and not exists (select 1 from public.shipment_parties p
                      where p.shipment_id = s.id and p.role = 'notify')
  union all
  select '6.데이터 현황(참고)', 'f. so_lines hs_code 충전(충전 / 전체)',
         count(*) filter (where nullif(btrim(coalesce(hs_code, '')), '') is not null)::text
           || ' / ' || count(*)::text
    from public.so_lines
  union all
  select '6.데이터 현황(참고)', 'g. products origin_country 충전(충전 / 전체)',
         count(*) filter (where nullif(btrim(coalesce(origin_country, '')), '') is not null)::text
           || ' / ' || count(*)::text
    from public.products
) x
order by 구분, 항목;
