-- ============================================================================
--  권한 봉인 검증 — P4.1 원장 봉인 + P4.4h 구세대 전면 봉인  (읽기 전용 — SELECT만)
-- ============================================================================
--  ⚠️ 왜 `update ... set qty=999` 로 테스트하면 안 되는가:
--     Supabase SQL Editor 는 **테이블 소유자인 postgres 역할**로 실행된다(상단 Role 표시).
--     소유자는 권한 검사를 통째로 우회하므로 봉인이 걸려 있어도 UPDATE가 성공한다.
--     → 봉인은 anon/authenticated 에 대한 것이므로, 그 역할의 권한을 직접 물어봐야 한다.
--
--  has_table_privilege('anon', …) 는 역할 상속·PUBLIC 부여까지 전부 계산한 **실효 권한**을
--  돌려준다. information_schema 를 훑는 것보다 확정적이다.
--
--  기대값 (P4.5 이후):
--    · '위반(쓰기권한 잔존)' — **0행**. public 의 모든 테이블·뷰에서 anon/authenticated 의
--      INSERT/UPDATE/DELETE 가 전부 false 여야 한다(알려진 목록 나열이 아니라 전면 스캔).
--      쓰기는 SECURITY DEFINER RPC 로만: save_quotation·save_sales_order·
--      save_purchase_order·save_shipment·save_goods_receipt·save_delivery·
--      save_shipment_cargo·save_stock_adjustment·reverse_stock_movement·
--      cancel_* · save_company·save_item·save_fx_rate·save_inquiry (P4.4h 신설 4종)·
--      save_trade_document·cancel_trade_document (P4.5 신설 2종).
--    · 스캔은 동적 전면 스캔이라 P4.5 신규 2테이블(trade_documents·trade_document_lines)도
--      자동 포함된다 — 객체 총수 기대값은 29 → 31.
--    · '스캔 요약' — 객체 총수가 0이면 스캔 자체가 실패한 것(공허통과 방지 수치).
--    · fx_rates: INSERT 까지 봉인(P4.4h) — 과거 "select·insert true" 기대값은 폐기됨.
--    · audit_log: 쓰기 전부 false (insert 는 P4.2 에서 회수 — fn_audit 이 DEFINER 라 감사는 산다).
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
)
select * from (
  select '위반(쓰기권한 잔존)'::text as 구분,
         (v.kind || ' ' || v.obj || ' × ' || v.role || ' × ' || v.priv)::text as 항목,
         '⚠️ true'::text as 값
    from viol v
  union all
  select '스캔 요약', 'public 테이블·뷰 총수(0이면 스캔 실패)', count(*)::text from scan
  union all
  select '스캔 요약', '검사한 (객체×롤×권한) 조합수', (count(*) * 6)::text from scan
  union all
  select '스캔 요약', '위반 건수(0이 정상)',
         case when count(*) = 0 then '0 — ✅ 봉인 정상' else count(*)::text || ' — ⚠️ 봉인 실패' end
    from viol
) x
order by 구분, 항목;
