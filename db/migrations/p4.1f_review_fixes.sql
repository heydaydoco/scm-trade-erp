-- ============================================================================
--  P4.1f — 적대검증 교정 (원장 무결성 2건)
-- ============================================================================
--  실행: Supabase 대시보드 → SQL Editor → New query → 붙여넣기 → Run.
--  성격: 기존 P4.1 객체만 수정(신규 테이블 없음) + 멱등(재실행 무해).
--        라이브 잠금 객체(next_doc_number·fn_audit·save_* )는 건드리지 않는다.
--
--  P4.1 다중에이전트 적대검증(원자성·불변성·이중역분개·KST 4관점 → 지적별 반박 재검증)
--  결과 9건 중 5건 기각, 확인된 실결함 2건을 교정한다.
-- ============================================================================

-- ── 결함 1) NaN·Infinity 수량이 가드를 통과해 원장을 영구 오염 ─────────────
--  Postgres numeric 에서 NaN 은 **모든 non-NaN 보다 크다**.
--    → `p_qty <= 0` 가 NaN 에 대해 false → 통과.
--    → 테이블 CHECK `qty <> 0` 도 `NaN <> 0` = true → 통과. 행이 박힌다.
--  결과: stock_on_hand.on_hand = sum(qty) = NaN 이 되어 현재고가 영구히 NaN.
--  ★ 역분개로도 복구 불가: reverse 는 -v_src.qty = -NaN = NaN 을 넣어 합이 그대로 NaN.
--    "역분개가 정정의 유일한 수단"인데 그 수단이 이 행에는 듣지 않는다.
--  ★ 탐지도 안 됨: getNegativeStockCount 의 on_hand < 0 은 NaN 에 false.
--  도달 경로: anon 키로 REST 직접 호출(POST /rest/v1/rpc/save_stock_adjustment,
--            {"p_qty":"NaN"}). 앱 화면으로는 불가능하지만 RPC 는 anon 에 열려 있고,
--            봉인 설계상 "RPC 입력 검증이 마지막 방어선"이므로 실재하는 구멍이다.

-- (a) 테이블 CHECK — 모든 쓰기 경로를 한 곳에서 덮는다(P4.2 GR_IN·P4.3 DLV_OUT 포함).
--     `create table if not exists` 는 기존 테이블에 CHECK 를 다시 걸지 않으므로 alter 로.
--     NaN  → `NaN  < 'Infinity'`  = false → 거부
--     Inf  → `Inf  < 'Infinity'`  = false → 거부
--     -Inf → `-Inf > '-Infinity'` = false → 거부
alter table public.stock_movements
  drop constraint if exists stock_movements_qty_finite;
alter table public.stock_movements
  add constraint stock_movements_qty_finite
  check (qty > '-Infinity'::numeric and qty < 'Infinity'::numeric);

-- (b) RPC 가드 — CHECK 만 있으면 사용자에게 raw constraint violation 이 뜬다.
--     한국어 에러를 위해 가드도 확장. (PG numeric 은 NaN = NaN 이 true 라 `in` 이 동작한다.
--      `not (p_qty > 0)` 은 NaN > 0 = true 라 무력하므로 쓰면 안 된다.)
create or replace function public.save_stock_adjustment(
  p_item_id        uuid,
  p_movement_type  text,
  p_qty            numeric,
  p_warehouse_code text default 'MAIN',
  p_lot_no         text default null,
  p_moved_at       date default null,
  p_memo           text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uom text;
  v_qty numeric;
  v_id  uuid;
begin
  if p_movement_type not in ('INIT','ADJ_IN','ADJ_OUT') then
    raise exception '이 기능으로는 기초재고(INIT)·조정 증가(ADJ_IN)·조정 감소(ADJ_OUT)만 만들 수 있습니다. 받은 값: %', p_movement_type;
  end if;

  -- ★ NaN·Infinity 를 여기서 잡는다(P4.1f). 순서 주의: NaN 비교는 <= 로 못 잡는다.
  if p_qty is null
     or p_qty in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
     or p_qty <= 0 then
    raise exception '수량은 0보다 큰 유한한 숫자여야 합니다(증가/감소는 유형으로 정합니다). 받은 값: %', p_qty;
  end if;

  if p_memo is null or btrim(p_memo) = '' then
    raise exception '사유(메모)는 필수입니다. 재고를 왜 조정하는지 남겨야 나중에 추적할 수 있습니다.';
  end if;

  select coalesce(unit, 'PCS') into v_uom from public.products where id = p_item_id;
  if not found then
    raise exception '품목을 찾을 수 없습니다: %', p_item_id;
  end if;

  v_qty := case when p_movement_type = 'ADJ_OUT' then -p_qty else p_qty end;

  insert into public.stock_movements (
    movement_type, item_id, qty, uom, warehouse_code, lot_no, moved_at, memo
  ) values (
    p_movement_type,
    p_item_id,
    v_qty,
    v_uom,
    coalesce(nullif(btrim(p_warehouse_code), ''), 'MAIN'),
    nullif(btrim(p_lot_no), ''),
    coalesce(p_moved_at, (now() at time zone 'Asia/Seoul')::date),
    btrim(p_memo)
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- ── 결함 2) 뷰가 원장의 uom 스냅샷을 버리고 현재 마스터 unit 을 붙인다 ──────
--  P4.1 뷰는 `coalesce(p.unit,'PCS') as uom` + `group by ... p.unit ...` 이었다.
--  p 는 p.id = m.item_id 로 1:1 조인이라 p.unit 은 item_id 에 함수 종속 →
--  group by 에 넣어도 그룹 입도가 늘지 않는다. 즉 **m.uom 은 뷰 어디에도 없었다.**
--
--  시나리오: 품목 X(unit='PCS')에 INIT +100 → 원장 행 uom='PCS'.
--            오너가 /items 에서 단위를 'KG'로 변경(가드 없음) → ADJ_OUT 10 → 원장 행 uom='KG'.
--            → 뷰: on_hand=90, uom='KG' → 화면 "90 KG"
--            → 원장 화면: "+100 PCS", "−10 KG"  ← 두 화면이 정면으로 모순
--            실제로는 100 PCS − 10 KG 라 애초에 합산이 성립하지 않는 값이다.
--
--  ★ 이건 마이그레이션이 스스로 3곳에서 선언한 불변식("마스터가 바뀌어도 과거 행 불변",
--    RPC 의 uom 스냅샷, 역분개의 v_src.uom 승계)을 뷰만 위반한 것이다.
--  교정: 원장 스냅샷으로 집계한다. 단위가 섞이면 **말없이 더하지 않고 행을 쪼갠다**
--        (거짓 숫자 하나보다 사실 두 줄이 낫다 — 원칙 1: 원장이 진실).
create or replace view public.stock_on_hand as
select
  m.item_id,
  p.code         as item_code,
  p.product_name as item_name,
  m.uom,                        -- ★ 마스터가 아니라 원장 스냅샷 (not null)
  m.warehouse_code,
  sum(m.qty)     as on_hand
from public.stock_movements m
join public.products p on p.id = m.item_id
group by m.item_id, p.code, p.product_name, m.uom, m.warehouse_code;

grant select on public.stock_on_hand to anon, authenticated;

notify pgrst, 'reload schema';

-- ── 검증(선택) ──────────────────────────────────────────────────────────────
--  1) NaN 거부 확인 — 반드시 한국어 에러가 나야 정상:
--       select public.save_stock_adjustment(
--         (select id from public.products limit 1), 'INIT', 'NaN'::numeric, 'MAIN', null, null, 'test');
--     → ERROR: 수량은 0보다 큰 유한한 숫자여야 합니다...
--
--  2) 단위 혼재 탐지 (scripts/checks.sql ⑧ 과 동일):
--       select item_id, warehouse_code, count(distinct uom)
--         from public.stock_movements group by 1,2 having count(distinct uom) > 1;
--     → 0행이 정상. 나오면 그 품목은 원장에 두 단위가 섞여 있다(뷰가 행을 쪼개 보여준다).
