-- ============================================================================
--  정합성 검산 세트 (SPEC §8 — "각 단계마다 정합성 테스트")
-- ============================================================================
--  성격: 읽기 전용. SELECT만 한다. 몇 번 돌려도 무해하다.
--  실행: Supabase 대시보드 → SQL Editor → New query → 붙여넣기 → Run.
--
--  읽는 법: 각 검사의 `결과` 열이 **전부 '정상'** 이면 통과.
--           '⚠️ N건' 이 하나라도 뜨면 그 검사 아래 상세 쿼리로 원인을 본다.
--
--  왜 SQL인가: 순수 로직(부호 매핑·KST·D-day)은 Vitest가 잡지만(npm test),
--  "DB에 실제로 쌓인 데이터가 원칙을 지키고 있는가"는 DB에서만 확인된다.
-- ============================================================================

-- ============================================================================
--  ⑦ 품목·창고·단위별 원장 합 = 현재고 (눈으로 보는 검산)
-- ============================================================================
--  ⚠️ 이 블록만 보려면 여기부터 세미콜론까지 드래그해서 Run 하세요.
--     (전체 Run 하면 Supabase 는 마지막 문장인 ①~⑧ 판정표만 보여줍니다)
--
--  마이너스는 "틀림"이 아니다 — 원칙 8(차단이 아니라 경고 후 허용).
--  다만 전기 누락 신호이므로 눈으로 본다.
--  같은 품목·창고에 단위가 여러 줄로 쪼개져 보이면 = 원장 단위 혼재(⑧에서 판정).
select
  v.item_code      as 품목코드,
  v.item_name      as 품목명,
  v.warehouse_code as 창고,
  v.uom            as 단위,
  v.on_hand        as 현재고,
  (select count(*) from public.stock_movements m
    where m.item_id = v.item_id
      and m.warehouse_code = v.warehouse_code
      and m.uom = v.uom)                        as 원장행수,
  case when v.on_hand < 0 then '⚠️ 마이너스(전기 누락 의심)' else '' end as 비고
from public.stock_on_hand v
order by (v.on_hand < 0) desc, v.item_code nulls last, v.warehouse_code, v.uom;


-- ============================================================================
--  합격 판정  (이 파일을 통째로 Run 하면 아래 결과가 나옵니다)
--  원장 ①~③ · 봉인 ④ⓔ · 재고/원장 ⑤~ⓒ · 무역서류 ㉮~㉰ · 적입 ㉱㉲ (P5.3 추가)
-- ============================================================================

-- ── ① 유형과 qty 부호가 어긋난 행 ───────────────────────────────────────────
--  규칙: INIT·ADJ_IN·GR_IN 은 +, ADJ_OUT·DLV_OUT 은 −.
--        REVERSAL 은 원행의 반대이므로 ± 둘 다 정상 → 검사에서 제외.
--  부호는 RPC가 유형으로 결정하므로(save_stock_adjustment) 여기 걸리면
--  누군가 RPC를 우회해 직접 INSERT 했다는 뜻이다(= 봉인 구멍).
select
  '① 유형↔부호 불일치' as 검사,
  case when count(*) = 0 then '정상' else '⚠️ ' || count(*) || '건' end as 결과
from public.stock_movements
where (movement_type in ('INIT','ADJ_IN','GR_IN')  and qty < 0)
   or (movement_type in ('ADJ_OUT','DLV_OUT')      and qty > 0)

union all

-- ── ①-b 비유한 수량 (NaN·±Infinity) ────────────────────────────────────────
--  ① 의 부호 비교(qty<0)로는 NaN 을 못 잡는다(NaN 은 모든 비교가 false).
--  NaN 이 한 행이라도 있으면 그 품목 현재고가 영구히 NaN 이 되고 역분개로도 복구 불가
--  (-NaN = NaN). P4.1f 의 CHECK 가 막지만, 그 CHECK 가 실제로 걸렸는지 여기서 확인한다.
select
  '①-b 비유한 수량(NaN/Inf)',
  case when count(*) = 0 then '정상' else '⚠️ ' || count(*) || '건' end
from public.stock_movements
where not (qty > '-Infinity'::numeric and qty < 'Infinity'::numeric)

union all

-- ── ② 역분개 행인데 원행 포인터가 없음 / 아닌데 있음 ────────────────────────
--  REVERSAL 은 반드시 reversal_of_id 를 가져야 하고, 그 외 유형은 가지면 안 된다.
select
  '② REVERSAL↔포인터 불일치',
  case when count(*) = 0 then '정상' else '⚠️ ' || count(*) || '건' end
from public.stock_movements
where (movement_type =  'REVERSAL' and reversal_of_id is null)
   or (movement_type <> 'REVERSAL' and reversal_of_id is not null)

union all

-- ── ③ REVERSAL 을 가리키는 REVERSAL (역분개의 역분개) ───────────────────────
--  사슬이 생기면 무엇이 무엇을 상쇄했는지 읽을 수 없다. RPC가 막지만 이중 확인.
select
  '③ 역분개의 역분개',
  case when count(*) = 0 then '정상' else '⚠️ ' || count(*) || '건' end
from public.stock_movements r
join public.stock_movements s on s.id = r.reversal_of_id
where r.movement_type = 'REVERSAL' and s.movement_type = 'REVERSAL'

union all

-- ── ③-b 한 행이 두 번 역분개됨 ──────────────────────────────────────────────
--  유니크 부분 인덱스(stock_movements_reversal_once_idx)가 원천 차단하므로
--  여기 걸리면 인덱스가 없다는 뜻이다.
select
  '③-b 이중 역분개',
  case when count(*) = 0 then '정상' else '⚠️ ' || count(*) || '건' end
from (
  select reversal_of_id
  from public.stock_movements
  where reversal_of_id is not null
  group by reversal_of_id
  having count(*) > 1
) d

union all

-- ── ④ 권한 봉인 — "불변을 주장하는" 3개 객체 ────────────────────────────────
--  Supabase 는 public 스키마에 `alter default privileges … grant all` 을 걸어둔다.
--  → 새 테이블도 만들자마자 anon 이 전권을 갖는다. "부여 안 함"으로는 못 막는다.
--  → 명시적 REVOKE 가 실제로 먹었는지 여기서 확인한다.
--
--  ⚠️ `update ... set` 을 직접 쳐보는 방식으로는 검증할 수 없다 —
--     SQL Editor 는 테이블 소유자(postgres)로 실행되어 권한 검사를 우회한다.
--     has_table_privilege 로 anon/authenticated 의 **실효 권한**을 직접 물어야 한다
--     (역할 상속·PUBLIC 부여까지 계산됨). 상세 표는 scripts/verify_seal.sql.

--   stock_movements: select 만 남아야 한다(insert 포함 전부 회수 — 쓰기는 RPC로만).
select
  '④-a 원장 쓰기권한 잔존',
  case when count(*) = 0 then '정상' else '⚠️ ' || count(*) || '건: ' || string_agg(role || '/' || priv, ', ') end
from (
  select r.role, p.priv
  from (values ('anon'),('authenticated')) as r(role)
  cross join (values ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE')) as p(priv)
  where has_table_privilege(r.role, 'public.stock_movements', p.priv)
) x

union all

--   fx_rates: 추가 전용 대장 → insert 는 유지, update/delete/truncate 는 0건이어야.
select
  '④-b fx_rates 변경권한 잔존',
  case when count(*) = 0 then '정상' else '⚠️ ' || count(*) || '건: ' || string_agg(role || '/' || priv, ', ') end
from (
  select r.role, p.priv
  from (values ('anon'),('authenticated')) as r(role)
  cross join (values ('UPDATE'),('DELETE'),('TRUNCATE')) as p(priv)
  where has_table_privilege(r.role, 'public.fx_rates', p.priv)
) x

union all

--   audit_log: 앱은 읽기만 → update/delete/truncate 0건이어야.
--   (insert 는 P4.2 에서 회수했다 → ⓓ 에서 함께 확인. fn_audit 이 SECURITY DEFINER 라
--    회수해도 트리거 기록은 정상 동작한다.)
select
  '④-c audit_log 변경권한 잔존',
  case when count(*) = 0 then '정상' else '⚠️ ' || count(*) || '건: ' || string_agg(role || '/' || priv, ', ') end
from (
  select r.role, p.priv
  from (values ('anon'),('authenticated')) as r(role)
  cross join (values ('UPDATE'),('DELETE'),('TRUNCATE')) as p(priv)
  where has_table_privilege(r.role, 'public.audit_log', p.priv)
) x

union all

-- ── ⑤ fn_audit 이 SECURITY DEFINER 인가 ────────────────────────────────────
--  DEFINER 여야 앱에 쓰기권한 없이도 트리거가 감사행을 남길 수 있다(P2.1의 전제).
--  INVOKER 로 바뀌어 있으면 audit_log insert 회수 시 감사 붙은 모든 저장이 죽는다.
select
  '⑤ fn_audit SECURITY DEFINER',
  case when bool_and(prosecdef) then '정상' else '⚠️ INVOKER!' end
from pg_proc
where proname = 'fn_audit' and pronamespace = 'public'::regnamespace

union all

-- ── ⑥ 원장에 감사 트리거가 붙지 않았는가 ────────────────────────────────────
--  원장 자체가 이미 append-only 감사기록이다. fn_audit 을 붙이면 이중 기록.
select
  '⑥ 원장 감사트리거 미부착',
  case when count(*) = 0 then '정상' else '⚠️ ' || count(*) || '건' end
from pg_trigger
where tgrelid = 'public.stock_movements'::regclass and not tgisinternal

union all

-- ── ⑧ 원장 단위 혼재 ────────────────────────────────────────────────────────
--  같은 품목·창고에 서로 다른 uom 행이 섞인 경우. 품목 마스터의 단위를 원장 기록 뒤에
--  바꾸면 발생한다(P4.1f 이전 뷰는 이걸 말없이 더해 거짓 숫자를 냈다).
--  ⚠️ 데이터 손상은 아니다 — 원장은 단위 스냅샷을 정확히 갖고 있고, 뷰가 행을 쪼개
--     사실대로 보여준다. 다만 그 품목의 "현재고 한 숫자"는 의미가 없으므로 정리 대상이다.
select
  '⑧ 원장 단위 혼재',
  case when count(*) = 0 then '정상' else '⚠️ ' || count(*) || '건' end
from (
  select item_id, warehouse_code
  from public.stock_movements
  group by item_id, warehouse_code
  having count(distinct uom) > 1
) d

union all

-- ── ⑨ 입고 원장 대사 (P4.2) ────────────────────────────────────────────────
--  살아있는 gr_lines 합 = 그 입고가 만든 GR_IN 원장합(REVERSAL 상쇄 후).
--  어긋나면 헤더-라인-원장 원자성이 깨졌다는 뜻(RPC 밖에서 손댄 흔적).
select
  '⑨ 입고↔원장 대사',
  case when count(*) = 0 then '정상' else '⚠️ ' || count(*) || '건' end
from (
  select g.id
  from public.goods_receipts g
  left join (
    select gr_id, sum(qty) as line_sum from public.gr_lines group by gr_id
  ) l on l.gr_id = g.id
  left join (
    -- 이 입고가 만든 GR_IN + 그 GR_IN 을 되돌린 REVERSAL 을 함께 합산 → 순증
    select m.ref_doc_id as gr_id,
           sum(m.qty) + coalesce(sum(rv.qty), 0) as ledger_sum
    from public.stock_movements m
    left join public.stock_movements rv on rv.reversal_of_id = m.id
    where m.ref_doc_type = 'goods_receipt' and m.movement_type = 'GR_IN'
    group by m.ref_doc_id
  ) v on v.gr_id = g.id
  where case when g.status = 'cancelled' then 0 else coalesce(l.line_sum, 0) end
        is distinct from coalesce(v.ledger_sum, 0)
) d

union all

-- ── ⑩ 발주 잔량 음수 (초과입고) ─────────────────────────────────────────────
--  ⚠️ 결함이 아니다 — 초과입고는 차단하지 않고 경고 후 허용한다(원칙 8과 같은 결).
--     다만 실물과 어긋난 신호이므로 목록으로 본다.
select
  '⑩ 발주 잔량 음수(초과입고)',
  case when count(*) = 0 then '정상' else '※ ' || count(*) || '건 (초과입고 — 허용됨)' end
from public.po_open_qty where open_qty < 0

union all

-- ── ⓐ 살아있는 입고가 있는데 발주 상태가 partial/completed 가 아님 ─────────
--  상태 전이는 RPC 내부에서만 일어난다. 어긋나면 사람이 손댔거나 전이가 안 돈 것.
select
  'ⓐ 입고 있는데 상태 미전이',
  case when count(*) = 0 then '정상' else '⚠️ ' || count(*) || '건' end
from public.purchase_orders po
where exists (
        select 1 from public.goods_receipts g
         where g.ref_doc_id = po.id and g.status <> 'cancelled')
  and po.status not in ('partial', 'completed')

union all

-- ── ⓑ 살아있는 입고가 0건인데 상태가 partial ────────────────────────────────
--  전량 취소 후 복귀가 안 된 것.
select
  'ⓑ 입고 0인데 partial',
  case when count(*) = 0 then '정상' else '⚠️ ' || count(*) || '건' end
from public.purchase_orders po
where po.status = 'partial'
  and not exists (
        select 1 from public.goods_receipts g
         where g.ref_doc_id = po.id and g.status <> 'cancelled')

union all

-- ── ⓒ 발주별 최초 GR 의 세대 도장이 비어 있음 ───────────────────────────────
--  세대를 여는 GR 은 반드시 po_status_before 를 남겨야 전량 취소 시 복귀할 수 있다.
--  비어 있으면 그 발주는 영원히 partial/completed 에 갇힌다.
select
  'ⓒ 최초 GR 도장 누락',
  case when count(*) = 0 then '정상' else '⚠️ ' || count(*) || '건' end
from (
  select distinct on (ref_doc_id) ref_doc_id, po_status_before
  from public.goods_receipts
  order by ref_doc_id, created_at
) f
where f.po_status_before is null

union all

-- ── ⓓ 입고 봉인 + audit_log insert 회수 확인 (P4.2) ────────────────────────
select
  'ⓓ 입고·감사 쓰기권한 잔존',
  case when count(*) = 0 then '정상' else '⚠️ ' || count(*) || '건: ' || string_agg(t || '/' || role || '/' || priv, ', ') end
from (
  select t.tbl as t, r.role, p.priv
  from (values ('goods_receipts'),('gr_lines')) as t(tbl)
  cross join (values ('anon'),('authenticated')) as r(role)
  cross join (values ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE')) as p(priv)
  where has_table_privilege(r.role, 'public.' || t.tbl, p.priv)
  union all
  -- audit_log 는 이제 insert 도 0 이어야 한다(P4.2에서 봉인).
  select 'audit_log', r.role, p.priv
  from (values ('anon'),('authenticated')) as r(role)
  cross join (values ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE')) as p(priv)
  where has_table_privilege(r.role, 'public.audit_log', p.priv)
  union all
  -- P4.3 출고 테이블도 select 만.
  select t.tbl, r.role, p.priv
  from (values ('deliveries'),('delivery_lines')) as t(tbl)
  cross join (values ('anon'),('authenticated')) as r(role)
  cross join (values ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE')) as p(priv)
  where has_table_privilege(r.role, 'public.' || t.tbl, p.priv)
) x

union all

-- ── ⑪ 출고 원장 대사 (P4.3) ────────────────────────────────────────────────
--  살아있는 delivery_lines 합 = 그 출고가 만든 DLV_OUT 원장합(REVERSAL 상쇄 후)의 절댓값.
--  DLV_OUT 은 음수라 부호를 맞춰 비교한다.
select
  '⑪ 출고↔원장 대사',
  case when count(*) = 0 then '정상' else '⚠️ ' || count(*) || '건' end
from (
  select d.id
  from public.deliveries d
  left join (
    select delivery_id, sum(qty) as line_sum from public.delivery_lines group by delivery_id
  ) l on l.delivery_id = d.id
  left join (
    select m.ref_doc_id as dlv_id,
           sum(m.qty) + coalesce(sum(rv.qty), 0) as ledger_sum
    from public.stock_movements m
    left join public.stock_movements rv on rv.reversal_of_id = m.id
    where m.ref_doc_type = 'delivery' and m.movement_type = 'DLV_OUT'
    group by m.ref_doc_id
  ) v on v.dlv_id = d.id
  where case when d.status = 'cancelled' then 0 else -coalesce(l.line_sum, 0) end
        is distinct from coalesce(v.ledger_sum, 0)
) d

union all

-- ── ⑫ 수주 잔량 음수 (초과출고) ─────────────────────────────────────────────
--  ⚠️ 결함이 아니다 — 초과출고는 경고 후 허용(원칙 8과 같은 결).
select
  '⑫ 수주 잔량 음수(초과출고)',
  case when count(*) = 0 then '정상' else '※ ' || count(*) || '건 (초과출고 — 허용됨)' end
from public.so_open_qty where open_qty < 0

union all

-- ── ⓐ' 살아있는 출고가 있는데 수주 상태가 partial/completed 가 아님 ────────
select
  'ⓐ'' 출고 있는데 상태 미전이',
  case when count(*) = 0 then '정상' else '⚠️ ' || count(*) || '건' end
from public.sales_orders so
where exists (
        select 1 from public.deliveries d
         where d.ref_doc_id = so.id and d.status <> 'cancelled')
  and so.status not in ('partial', 'completed')

union all

-- ── ⓑ' 살아있는 출고가 0건인데 상태가 partial ───────────────────────────────
select
  'ⓑ'' 출고 0인데 partial',
  case when count(*) = 0 then '정상' else '⚠️ ' || count(*) || '건' end
from public.sales_orders so
where so.status = 'partial'
  and not exists (
        select 1 from public.deliveries d
         where d.ref_doc_id = so.id and d.status <> 'cancelled')

union all

-- ── ⓒ' 수주별 최초 출고의 세대 도장이 비어 있음 ────────────────────────────
select
  'ⓒ'' 최초 출고 도장 누락',
  case when count(*) = 0 then '정상' else '⚠️ ' || count(*) || '건' end
from (
  select distinct on (ref_doc_id) ref_doc_id, so_status_before
  from public.deliveries
  order by ref_doc_id, created_at
) f
where f.so_status_before is null

union all

-- ── ㉮ 무역서류: 라인 금액 합 ≠ 헤더 소계 (P4.5) ────────────────────────────
--  subtotal_amount = Σ round2(라인) 이 발행 시점 계약이다(스냅샷). 어긋나면
--  스냅샷이 손상됐거나 RPC 를 우회해 라인을 직접 건드린 것이다(FK 로는 못 막는다).
--  round2 저장이라 십진 동치 — abs 차 > 0.005 만 위반으로 본다.
select
  '㉮ 무역서류 라인합↔소계',
  case when count(*) = 0 then '정상' else '⚠️ ' || count(*) || '건' end
from (
  select d.id
  from public.trade_documents d
  left join public.trade_document_lines l on l.document_id = d.id
  group by d.id, d.subtotal_amount
  having abs(coalesce(sum(l.amount), 0) - d.subtotal_amount) > 0.005
) x

union all

-- ── ㉯ 무역서류: 헤더 총액 ≠ 소계 − 할인 (P4.5) ──────────────────────────────
select
  '㉯ 무역서류 총액↔소계−할인',
  case when count(*) = 0 then '정상' else '⚠️ ' || count(*) || '건' end
from public.trade_documents d
where abs(d.total_amount - (d.subtotal_amount - d.discount_amount)) > 0.005

union all

-- ── ㉰ 무역서류: 활성(issued) 문서가 취소된 선적을 가리킴 (P4.5 가드) ─────────
--  취소 가드(trg_shipments_cancel_trade_doc_guard)가 원천 차단하지만, 발행 후
--  우회 취소가 있었는지 데이터로 재확인한다(FK 는 존재만 보장하지 상태는 못 본다).
select
  '㉰ 활성 무역서류↔취소 선적',
  case when count(*) = 0 then '정상' else '⚠️ ' || count(*) || '건' end
from public.trade_documents d
join public.shipments s on s.id = d.shipment_id
where d.status = 'issued' and s.status = 'cancelled'

union all

-- ── ㉱ 적입 스냅샷 자기일관: totals.packageCount ≠ Σ컨테이너.packageCount (P5.3) ─
--  발행 스냅샷은 동결 수치다 — 총계와 컨테이너 합이 어긋나면 스냅샷 생성 로직이
--  깨졌거나 저장 후 누가 jsonb 를 손댄 것이다. packageCount 는 정수라 정확 비교한다.
--  (G.W./CBM 은 6자리 정밀 동결값이라 같은 성질이나, 정수 축으로 대표 검산한다.)
select
  '㉱ 적입 스냅샷 총계 자기일관',
  case when count(*) = 0 then '정상' else '⚠️ ' || count(*) || '건' end
from (
  select d.id
  from public.trade_documents d
  where d.containers_snapshot is not null
    and jsonb_typeof(d.containers_snapshot->'containers') = 'array'
    and jsonb_array_length(d.containers_snapshot->'containers') > 0
    and (d.containers_snapshot->'totals'->>'packageCount')::numeric
        is distinct from
        (select coalesce(sum((c->>'packageCount')::numeric), 0)
           from jsonb_array_elements(d.containers_snapshot->'containers') c)
) x

union all

-- ── ㉲ 적입 과배분 현황 (P5.2 — 리포트, 위반 아님) ──────────────────────────
--  과배분(라인 포장수 초과)은 **서버가 허용**하는 정상 스펙이다(UI 경고만). 여기서는
--  차단이 아니라 **현황 리포트**로 센다 — '⚠️'가 아니라 참고 수치다(0 이어도 무방).
--  포장수 null 라인 배분은 판단 불가라 제외한다(초과로 단정하지 않는다).
select
  '㉲ 적입 과배분 현황(리포트)',
  case when count(*) = 0 then '없음' else count(*) || '개 라인(정상 — 서버 허용)' end
from (
  select a.shipment_line_id
  from public.shipment_container_allocations a
  join public.shipment_lines l on l.id = a.shipment_line_id
  where l.package_count is not null
  group by a.shipment_line_id, l.package_count
  having sum(a.allocated_package_count) > l.package_count
) x

union all

-- ── ⓔ 전면 봉인 잔존 스캔 (P4.4h) ──────────────────────────────────────────
--  알려진 목록 나열이 아니라 public 의 **모든 테이블·뷰**를 스캔한다 — 새로 생긴
--  객체가 Supabase 기본권한(grant all)을 들고 있으면 여기서 바로 걸린다.
--  기대값: 0건. 쓰기는 SECURITY DEFINER RPC 로만(구세대 4화면도 P4.4h 부터 RPC).
--  상세 표(위반 목록 + 스캔 수치)는 scripts/verify_seal.sql.
select
  'ⓔ 전면 봉인 잔존(테이블·뷰 전체)',
  case when count(*) = 0 then '정상' else '⚠️ ' || count(*) || '건: ' || string_agg(obj || '/' || role || '/' || priv, ', ') end
from (
  select cls.relname::text as obj, r.role, pr.priv
  from pg_class cls
  join pg_namespace n on n.oid = cls.relnamespace
  cross join (values ('anon'),('authenticated')) as r(role)
  cross join (values ('INSERT'),('UPDATE'),('DELETE')) as pr(priv)
  where n.nspname = 'public'
    and cls.relkind in ('r', 'p', 'v', 'm')
    and has_table_privilege(r.role, cls.oid, pr.priv)
) x;

-- ⬆ 이 판정표가 **파일의 마지막 결과**다 (Supabase SQL Editor 는 여러 문장을 실행해도
--   마지막 SELECT 의 결과만 Results 에 보여준다 → 합격 판정이 가려지지 않게 맨 뒤에 둔다).
--   품목별 눈검산(⑦)은 파일 앞부분에 있고, 보려면 그 블록만 드래그해서 Run 한다.
