-- ============================================================================
--  P4.1 — 재고 원장 기반 (SPEC D1·D2·D3, 원칙 1 "재고는 숫자가 아니라 원장")
-- ============================================================================
--  실행: Supabase 대시보드 → SQL Editor → New query → 붙여넣기 → Run.
--  성격: 순수 추가(신규 테이블·뷰·함수) + 권한 봉인(REVOKE) + 멱등(재실행 무해).
--
--  ⚠️ 라이브 잠금 객체 — 이 파일은 건드리지 않는다:
--       기존 테이블 구조·데이터 · next_doc_number · fn_audit · save_* RPC 전부.
--     단, 이번 한정 승인된 예외: fx_rates·audit_log 의 **권한(REVOKE)만** 조정한다.
--     (구조·데이터·함수·트리거는 불가침)
--
--  핵심 사상 (원칙 1):
--    · 현재고라는 숫자를 어디에도 저장하지 않는다. 원장에 부호 있는 행만 쌓고
--      현재고 = SUM(qty). `items.qty = 47` 같은 수정 가능한 잔량 필드는 금지.
--    · 정정은 UPDATE가 아니라 **역분개**(반대부호 행 추가). 원장은 append-only.
--    · 기존 save_* 의 "라인 전량 DELETE 후 재INSERT" 패턴은 원장에 **절대 금지**.
--      → 그래서 앱에 INSERT 권한조차 주지 않고, 쓰기는 아래 RPC 2개로만 통과시킨다.
--    · 이번 원장은 **수량 원장**이다. 금액·평가(원가)는 없다(P8 Landed Cost 대상).
-- ============================================================================

-- ── 1) 원장 테이블 ──────────────────────────────────────────────────────────
--  ⚠️ SPEC 하드 제약(§8 P4 경고): lot_no·serial_no·location_code 칸을 **지금** 만든다.
--     기능 활성화는 P5지만, 원장은 append-only라 나중에 컬럼을 추가하면 백필이
--     원칙 위반 그 자체다(과거 물리 이동을 소급 취소·재전기할 방법이 없다).
--     → P4~P5 사이 모든 행의 로트·위치가 영구히 NULL이 되어 추적이 영원히 불가능해진다.
--     칸만 미리 열어두면 P5는 채우기만 하면 된다.
create table if not exists public.stock_movements (
  id              uuid primary key default gen_random_uuid(),

  -- 이동 유형(원칙 4 — 자유 텍스트 금지, 코드로만).
  --   INIT    기초재고 (+)      ADJ_IN  조정 증가 (+)     ADJ_OUT 조정 감소 (−)
  --   GR_IN   구매 입고 (+, P4.2)  DLV_OUT 판매 출고 (−, P4.3)
  --   REVERSAL 역분개 (원행의 반대부호 — 부호는 원행에 따라 ±)
  -- 6종을 지금 다 넣는 이유: P4.2/P4.3에서 CHECK를 재수정하면 그 사이 행이 흔들린다.
  movement_type   text not null
    check (movement_type in ('INIT','ADJ_IN','ADJ_OUT','GR_IN','DLV_OUT','REVERSAL')),

  item_id         uuid not null references public.products(id),
  qty             numeric not null check (qty <> 0),   -- 부호 포함(+입고/−출고). 0은 무의미.
  uom             text not null,                       -- 품목에서 스냅샷(마스터가 바뀌어도 과거 행 불변)

  warehouse_code  text not null default 'MAIN',
  location_code   text,        -- ⬇ 지금 만들고 P5에서 활성화 (위 경고 참조)
  lot_no          text,
  serial_no       text,

  moved_at        date not null,                       -- 증빙일(회계상 이동일). created_at과 다르다.

  -- 선행 전표 소프트 포인터(FK 아님 — P4.2 GR/P4.3 Delivery가 채운다).
  ref_doc_type    text,        -- 'GR' | 'DLV' | …
  ref_doc_id      uuid,
  ref_line_id     uuid,

  reversal_of_id  uuid references public.stock_movements(id),  -- 역분개 대상(self-FK)
  memo            text,
  created_at      timestamptz not null default now()
);

-- 현재고 집계용(품목×창고).
create index if not exists stock_movements_item_wh_idx
  on public.stock_movements (item_id, warehouse_code);
-- 전표 → 원장 역추적용(P4.2/P4.3 문서흐름).
create index if not exists stock_movements_ref_idx
  on public.stock_movements (ref_doc_type, ref_doc_id);
-- 기간 조회용.
create index if not exists stock_movements_moved_at_idx
  on public.stock_movements (moved_at);

-- ★ 이중 역분개를 DB가 원천 차단한다(레이스 포함).
--   RPC가 "이미 역분개됨"을 미리 검사하지만, 동시에 두 번 눌리면 두 검사 모두 통과할 수 있다.
--   이 유니크 인덱스가 최후 방어선 — 두 번째 INSERT가 반드시 실패한다.
--   부분 인덱스라 reversal_of_id가 null인 일반 행은 얼마든지 쌓인다.
create unique index if not exists stock_movements_reversal_once_idx
  on public.stock_movements (reversal_of_id) where reversal_of_id is not null;

-- ── 2) 봉인: 원장은 앱이 직접 쓸 수 없다 ────────────────────────────────────
--  Supabase는 public 스키마에 `alter default privileges … grant all` 을 걸어둔다.
--  → 새 테이블도 만들자마자 anon 이 insert/update/delete/truncate 를 갖는다.
--  → "부여하지 않음"으로는 못 막는다. 반드시 명시적 REVOKE 여야 한다.
--  원장 쓰기 경로는 아래 SECURITY DEFINER RPC 2개뿐이다.
revoke all on public.stock_movements from anon, authenticated;
grant select on public.stock_movements to anon, authenticated;

-- 같은 이유로, "불변을 주장하는" 기존 객체 2개도 이번에 봉인한다.
-- (구조·데이터·함수·트리거는 건드리지 않는다 — 권한만.)

--  fx_rates: 추가 전용 대장(P2.3). 정정은 UPDATE가 아니라 새 행.
--    select·insert 는 유지 — 앱이 직접 INSERT 하는 설계다(단일 행이라 RPC 불필요).
revoke update, delete, truncate on public.fx_rates from anon, authenticated;

--  audit_log: 추가 전용 감사 원장(P2.1). 앱은 읽기만 해야 한다.
--    ⚠️ insert 는 회수하지 않는다(이번 지시). fn_audit 이 SECURITY DEFINER 라
--       기록은 함수 소유자 권한으로 수행되므로 insert 회수해도 감사는 안 죽지만,
--       봉인 범위는 지시대로 update/delete/truncate 에 한정한다. (보고 참조)
revoke update, delete, truncate on public.audit_log from anon, authenticated;

-- ── 3) 현재고 뷰 — 저장하지 않고 매번 합산한다(원칙 1) ──────────────────────
--  역분개는 반대부호 "행"이므로 별도 필터 없이 SUM 만으로 정확하다.
--  (원행을 지우거나 플래그로 감추지 않는다 → 이력이 그대로 남는다.)
create or replace view public.stock_on_hand as
select
  m.item_id,
  p.code                  as item_code,
  p.product_name          as item_name,
  coalesce(p.unit, 'PCS') as uom,
  m.warehouse_code,
  sum(m.qty)              as on_hand
from public.stock_movements m
join public.products p on p.id = m.item_id
group by m.item_id, p.code, p.product_name, p.unit, m.warehouse_code;

grant select on public.stock_on_hand to anon, authenticated;

-- ── 4) RPC: 재고 조정 (기초재고·조정 증가·조정 감소) ────────────────────────
--  부호는 **호출자가 아니라 이 함수가** 유형으로 결정한다.
--  → 화면은 항상 양수만 보내고, "감소인데 +30" 같은 모순이 구조적으로 불가능해진다.
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
  -- 이 RPC로는 조정 3종만 만든다. GR_IN/DLV_OUT은 P4.2/P4.3의 전표가, REVERSAL은 아래 함수가.
  if p_movement_type not in ('INIT','ADJ_IN','ADJ_OUT') then
    raise exception '이 기능으로는 기초재고(INIT)·조정 증가(ADJ_IN)·조정 감소(ADJ_OUT)만 만들 수 있습니다. 받은 값: %', p_movement_type;
  end if;

  if p_qty is null or p_qty <= 0 then
    raise exception '수량은 0보다 큰 값이어야 합니다(증가/감소는 유형으로 정합니다). 받은 값: %', p_qty;
  end if;

  if p_memo is null or btrim(p_memo) = '' then
    raise exception '사유(메모)는 필수입니다. 재고를 왜 조정하는지 남겨야 나중에 추적할 수 있습니다.';
  end if;

  -- 단위는 품목 마스터에서 스냅샷(마스터가 바뀌어도 과거 원장 행은 불변).
  select coalesce(unit, 'PCS') into v_uom from public.products where id = p_item_id;
  if not found then
    raise exception '품목을 찾을 수 없습니다: %', p_item_id;
  end if;

  -- ★ 부호 결정: 감소만 음수.
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
    -- 증빙일 기본값은 반드시 한국 날짜(서버는 UTC로 돈다 — P4.0-a와 같은 규칙).
    coalesce(p_moved_at, (now() at time zone 'Asia/Seoul')::date),
    btrim(p_memo)
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- ── 5) RPC: 역분개 (정정의 유일한 수단 — 원칙 1) ────────────────────────────
--  "잘못 입력했으면 수정이 아니라 역방향 이동 + 재입력."
--  원행은 절대 건드리지 않는다. 반대부호 행을 하나 더 쌓을 뿐이다.
create or replace function public.reverse_stock_movement(
  p_movement_id uuid,
  p_memo        text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src public.stock_movements%rowtype;
  v_id  uuid;
begin
  if p_memo is null or btrim(p_memo) = '' then
    raise exception '역분개 사유는 필수입니다. 왜 되돌리는지 남겨야 합니다.';
  end if;

  select * into v_src from public.stock_movements where id = p_movement_id;
  if not found then
    raise exception '역분개할 원장 행을 찾을 수 없습니다: %', p_movement_id;
  end if;

  -- 역분개의 역분개는 만들지 않는다(사슬이 생기면 무엇이 상쇄됐는지 읽을 수 없다).
  -- 되돌린 걸 다시 되돌리려면 조정을 새로 넣는다.
  if v_src.movement_type = 'REVERSAL' then
    raise exception '역분개 행은 다시 역분개할 수 없습니다. 필요하면 재고 조정을 새로 등록하세요.';
  end if;

  if exists (select 1 from public.stock_movements where reversal_of_id = p_movement_id) then
    raise exception '이미 역분개된 행입니다.';
  end if;

  insert into public.stock_movements (
    movement_type, item_id, qty, uom, warehouse_code, location_code, lot_no, serial_no,
    moved_at, ref_doc_type, ref_doc_id, ref_line_id, reversal_of_id, memo
  ) values (
    'REVERSAL',
    v_src.item_id,
    -v_src.qty,                 -- ★ 반대 부호
    v_src.uom,                  -- 원행의 스냅샷을 그대로 승계(현재 마스터 값이 아니라)
    v_src.warehouse_code,
    v_src.location_code,
    v_src.lot_no,
    v_src.serial_no,
    -- 역분개는 "오늘 일어난 사건"이다. 원행의 증빙일을 베끼면 과거 기간이 다시 흔들린다.
    (now() at time zone 'Asia/Seoul')::date,
    v_src.ref_doc_type,         -- 어느 전표에서 비롯됐는지는 승계(문서흐름 추적용)
    v_src.ref_doc_id,
    v_src.ref_line_id,
    v_src.id,
    btrim(p_memo)
  )
  returning id into v_id;

  return v_id;

exception
  -- 동시에 두 번 눌린 경우: 유니크 인덱스가 두 번째를 막는다 → 한국어로 바꿔 돌려준다.
  when unique_violation then
    raise exception '이미 역분개된 행입니다(동시 요청 차단).';
end;
$$;

grant execute on function public.save_stock_adjustment(uuid, text, numeric, text, text, date, text) to anon, authenticated;
grant execute on function public.reverse_stock_movement(uuid, text) to anon, authenticated;

-- PostgREST 스키마 캐시 갱신 (이 프로젝트의 알려진 함정 — 없으면 새 RPC를 못 찾는다).
notify pgrst, 'reload schema';

-- ── 검증(선택) ──────────────────────────────────────────────────────────────
--  전체 검산 세트는 scripts/checks.sql 참조.
--
--  1) 봉인 확인 — 아래는 **반드시 에러**가 나야 정상(anon 으로 실행 시):
--       update public.stock_movements set qty = 999;   -- permission denied
--       delete from public.stock_movements;            -- permission denied
--
--  2) fn_audit security 속성 확인:
--       select p.proname, p.prosecdef as is_security_definer
--         from pg_proc p where p.proname = 'fn_audit';
--       → is_security_definer = true 여야 한다.
--
--  3) 원장이 감사 대상이 아님을 확인(원장 자체가 감사기록이라 fn_audit 미부착):
--       select tgname from pg_trigger
--        where tgrelid = 'public.stock_movements'::regclass and not tgisinternal;
--       → 0행이 정상.

-- ── 되돌리기(rollback) ──────────────────────────────────────────────────────
--   drop function if exists public.reverse_stock_movement(uuid, text);
--   drop function if exists public.save_stock_adjustment(uuid, text, numeric, text, text, date, text);
--   drop view if exists public.stock_on_hand;
--   drop table if exists public.stock_movements;
--   -- 권한 봉인 복원(원상: Supabase 기본 전권):
--   --   grant all on public.fx_rates  to anon, authenticated;
--   --   grant all on public.audit_log to anon, authenticated;
