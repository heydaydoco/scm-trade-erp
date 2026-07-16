-- ============================================================================
--  P4.2 — 입고(GR) : 발주 참조생성 · 원장 전기 · 잔량 · 부분입고 · 취소=역분개
-- ============================================================================
--  실행: Supabase 대시보드 → SQL Editor → New query → 붙여넣기 → Run.
--  성격: 순수 추가(신규 테이블·뷰·함수·트리거) + audit_log 권한 봉인 + 멱등.
--
--  ⚠️ 라이브 잠금 객체 무변경: next_doc_number · fn_audit · save_* RPC ·
--     기존 테이블 구조(purchase_orders·po_lines 등)를 재생성/수정하지 않는다.
--     (purchase_orders.status 의 **값** 자동전환은 P4.2 스펙이 요구한 동작이며
--      스키마 변경이 아니다. 전환은 아래 RPC 내부에서만 일어난다.)
-- ============================================================================

-- ── 0) audit_log 봉인 (승인됨) ──────────────────────────────────────────────
--  P2.1 은 `grant select` 만 했지만 Supabase 기본권한(alter default privileges …
--  grant all)이 이미 전권을 뿌려서 **앱이 가짜 이력을 INSERT 할 수 있었다**
--  → P2.1 의 "앱은 위조·삭제 불가"(원칙 5) 주장이 실제로 깨져 있었다.
--  fn_audit 은 SECURITY DEFINER 라 함수 소유자 권한으로 기록하므로,
--  anon 의 insert 를 회수해도 감사 트리거는 정상 동작한다(라이브 확인: prosecdef=true).
revoke insert, update, delete, truncate on public.audit_log from anon, authenticated;
-- select 는 유지 — /audit 읽기 화면.

-- ── 1) 입고 헤더 ────────────────────────────────────────────────────────────
--  부분입고 = 같은 발주에 GR 여러 건(헤더가 여러 개). 라인 분할이 아니다.
create table if not exists public.goods_receipts (
  id              uuid primary key default gen_random_uuid(),
  gr_no           text not null unique,          -- GR-YYYYMM-NNN (원칙 6 원자 발번)
  receipt_date    date not null,                 -- 증빙일(KST 오늘 기본)
  status          text not null default 'normal'
                    check (status in ('normal','cancelled')),
  warehouse_code  text not null default 'MAIN',

  -- 발주 1건 소프트 포인터(FK 아님 — 선행전표 참조는 스냅샷 포인터, 기존 모듈과 동일 관례)
  ref_doc_type    text not null default 'purchase_order'
                    check (ref_doc_type = 'purchase_order'),
  ref_doc_id      uuid not null,

  -- ★ 세대(generation) 도장: **살아있는 GR 이 0건인 상태에서 생성된 GR** 만
  --   그 시점 발주 상태를 기록한다(세대를 여는 GR). 그 외는 null.
  --   전량 취소 → 발주 수정(sent 로) → 새 GR 이면 새 세대가 열리고 다시 도장.
  --   복귀 시 "가장 이른 GR" 이 아니라 "**도장이 있는 GR 중 가장 최근 것**"을 쓴다
  --   (가장 이른 것을 쓰면 다세대에서 옛 세대 값으로 잘못 되돌아간다).
  po_status_before text,

  memo            text,
  created_at      timestamptz not null default now()
);
create index if not exists goods_receipts_ref_idx    on public.goods_receipts (ref_doc_id, status);
create index if not exists goods_receipts_date_idx    on public.goods_receipts (receipt_date desc);
create index if not exists goods_receipts_stamp_idx   on public.goods_receipts (ref_doc_id, created_at desc)
  where po_status_before is not null;

-- ── 2) 입고 라인 ────────────────────────────────────────────────────────────
create table if not exists public.gr_lines (
  id           uuid primary key default gen_random_uuid(),
  gr_id        uuid not null references public.goods_receipts (id) on delete cascade,
  line_no      integer not null,
  po_line_id   uuid,                       -- 소프트 포인터(FK 아님) — 발주 라인
  item_id      uuid not null references public.products (id),  -- 원장이 요구하는 실품목
  item_name    text,                       -- 스냅샷(마스터가 바뀌어도 과거 입고 불변)
  qty          numeric not null check (qty > 0 and qty < 'Infinity'::numeric),
  uom          text not null,              -- 스냅샷
  lot_no       text,                       -- 칸은 지금, 활성화는 P5
  memo         text
);
create index if not exists gr_lines_gr_idx      on public.gr_lines (gr_id, line_no);
create index if not exists gr_lines_po_line_idx on public.gr_lines (po_line_id);

-- 봉인: 쓰기는 아래 RPC(SECURITY DEFINER)로만. 앱엔 INSERT 권한조차 주지 않는다.
revoke all on public.goods_receipts from anon, authenticated;
revoke all on public.gr_lines        from anon, authenticated;
grant select on public.goods_receipts to anon, authenticated;
grant select on public.gr_lines       to anon, authenticated;

-- 감사 상속(헤더만 — 라인은 관례상 미부착).
drop trigger if exists trg_audit_goods_receipts on public.goods_receipts;
create trigger trg_audit_goods_receipts
  after insert or update or delete on public.goods_receipts
  for each row execute function public.fn_audit();

-- ── 3) 잔량 뷰 (원칙 1 — 잔량은 컬럼이 아니라 계산) ─────────────────────────
--  발주수량 − Σ(취소 아닌 GR 라인 수량). received_qty 를 po_lines 에 저장하지 않는다.
create or replace view public.po_open_qty as
select
  l.id                                                       as po_line_id,
  l.po_id,
  l.sort_order,
  l.product_id,
  l.product_name,
  l.unit,
  coalesce(l.quantity, 0)                                    as ordered_qty,
  coalesce(r.received_qty, 0)                                as received_qty,
  coalesce(l.quantity, 0) - coalesce(r.received_qty, 0)      as open_qty
from public.po_lines l
left join (
  select gl.po_line_id, sum(gl.qty) as received_qty
  from public.gr_lines gl
  join public.goods_receipts g on g.id = gl.gr_id
  where g.status <> 'cancelled'          -- 취소된 입고는 없던 일
  group by gl.po_line_id
) r on r.po_line_id = l.id;

-- 발주 헤더 롤업(목록·상태 판정용).
create or replace view public.po_open_summary as
select
  po_id,
  sum(ordered_qty)                          as ordered_qty,
  sum(received_qty)                         as received_qty,
  sum(open_qty)                             as open_qty,
  count(*) filter (where open_qty > 0)      as open_lines,
  count(*)                                  as total_lines
from public.po_open_qty
group by po_id;

grant select on public.po_open_qty     to anon, authenticated;
grant select on public.po_open_summary to anon, authenticated;

-- ── 4) 발주 상태 전이 (기계 전용 — 사람 손 금지) ────────────────────────────
--  저장·취소 공용. **매번 살아있는 GR 로 재계산**한다(누적 델타 금지 — 어긋나면 복구 불가).
--    잔량 0        → completed
--    0 < 입고 < 발주 → partial   (기계 전용 상태 — 발주 폼 선택지에 노출 안 함)
--    입고 0        → 도장(po_status_before)이 있는 GR 중 **가장 최근** 것의 값으로 복귀
create or replace function public.fn_po_apply_receipt_status(p_po_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ordered  numeric;
  v_received numeric;
  v_next     text;
begin
  select coalesce(sum(ordered_qty), 0), coalesce(sum(received_qty), 0)
    into v_ordered, v_received
    from public.po_open_qty where po_id = p_po_id;

  if v_received = 0 then
    -- 세대를 연 GR 의 도장으로 복귀. 그 GR 자신이 취소됐어도 메모는 유효하다.
    select po_status_before into v_next
      from public.goods_receipts
     where ref_doc_id = p_po_id and po_status_before is not null
     order by created_at desc
     limit 1;
    if v_next is null then
      return;  -- 방어: 도장이 없으면 건드리지 않는다(checks.sql ⓒ가 감시).
    end if;
  elsif v_received >= v_ordered then
    v_next := 'completed';
  else
    v_next := 'partial';
  end if;

  update public.purchase_orders
     set status = v_next, updated_at = now()
   where id = p_po_id and status is distinct from v_next;
end;
$$;

-- ── 5) 입고 저장 (원자: 헤더 + 라인 + 원장 전기) ────────────────────────────
create or replace function public.save_goods_receipt(
  p_po_id          uuid,
  p_lines          jsonb,
  p_receipt_date   date default null,
  p_warehouse_code text default 'MAIN',
  p_memo           text default null,
  p_period         text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po        public.purchase_orders%rowtype;
  v_gr_id     uuid;
  v_gr_no     text;
  v_stamp     text;
  v_live      integer;
  v_date      date;
  v_period    text;
  v_wh        text;
  v_line      jsonb;
  v_no        integer := 0;
  v_qty       numeric;
  v_item      uuid;
  v_uom       text;
  v_po_line   public.po_lines%rowtype;
  v_gr_line_id uuid;
begin
  select * into v_po from public.purchase_orders where id = p_po_id;
  if not found then
    raise exception '발주를 찾을 수 없습니다: %', p_po_id;
  end if;
  if v_po.status = 'cancelled' then
    raise exception '취소된 발주는 입고할 수 없습니다.';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception '입고 품목이 최소 1건 필요합니다.';
  end if;

  v_date   := coalesce(p_receipt_date, (now() at time zone 'Asia/Seoul')::date);
  v_period := coalesce(p_period, to_char(v_date, 'YYYYMM'));
  v_wh     := coalesce(nullif(btrim(p_warehouse_code), ''), 'MAIN');

  -- ★ 세대 도장: 살아있는 GR 이 0건일 때 생성되는 GR 만 발주의 현재 상태를 기록.
  --   동시 생성으로 둘 다 도장해도 같은 값이라 무해(락 불필요).
  select count(*) into v_live
    from public.goods_receipts
   where ref_doc_id = p_po_id and status <> 'cancelled';
  v_stamp := case when v_live = 0 then v_po.status else null end;

  v_gr_no := public.next_doc_number('goods_receipt', 'GR', v_period);

  insert into public.goods_receipts (
    gr_no, receipt_date, status, warehouse_code,
    ref_doc_type, ref_doc_id, po_status_before, memo
  ) values (
    v_gr_no, v_date, 'normal', v_wh,
    'purchase_order', p_po_id, v_stamp, nullif(btrim(p_memo), '')
  )
  returning id into v_gr_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_no  := v_no + 1;
    -- ★ 매 줄마다 초기화 — 안 하면 앞줄의 발주라인 값(품목명 등)이 새어 들어온다.
    v_po_line := null;
    v_qty := (v_line->>'qty')::numeric;

    if v_qty is null
       or v_qty in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
       or v_qty <= 0 then
      raise exception '입고 수량은 0보다 큰 유한한 숫자여야 합니다. (%번째 줄, 받은 값: %)', v_no, v_line->>'qty';
    end if;

    -- 발주 라인 참조 유효성 — 다른 발주의 라인을 붙이는 것을 막는다.
    if (v_line->>'poLineId') is not null then
      select * into v_po_line
        from public.po_lines
       where id = (v_line->>'poLineId')::uuid and po_id = p_po_id;
      if not found then
        raise exception '이 발주의 라인이 아닙니다. (%번째 줄)', v_no;
      end if;
    end if;

    -- 원장은 실제 품목을 요구한다(stock_movements.item_id 는 products FK, not null).
    -- 발주 라인의 품목이 자유텍스트(product_id null)면 입고할 수 없다.
    v_item := nullif(v_line->>'itemId', '')::uuid;
    if v_item is null then
      raise exception '품목 마스터에 연결되지 않은 발주 라인은 입고할 수 없습니다(재고 원장은 등록 품목만 받는다). 먼저 품목을 등록하고 발주 라인을 연결하세요. (%번째 줄: %)',
        v_no, coalesce(v_po_line.product_name, v_line->>'itemName', '(이름 없음)');
    end if;

    select coalesce(unit, 'PCS') into v_uom from public.products where id = v_item;
    if not found then
      raise exception '품목을 찾을 수 없습니다: % (%번째 줄)', v_item, v_no;
    end if;
    v_uom := coalesce(nullif(btrim(v_line->>'uom'), ''), v_uom);

    insert into public.gr_lines (
      gr_id, line_no, po_line_id, item_id, item_name, qty, uom, lot_no, memo
    ) values (
      v_gr_id, v_no,
      nullif(v_line->>'poLineId', '')::uuid,
      v_item,
      coalesce(nullif(btrim(v_line->>'itemName'), ''), v_po_line.product_name),
      v_qty, v_uom,
      nullif(btrim(v_line->>'lotNo'), ''),
      nullif(btrim(v_line->>'memo'), '')
    )
    returning id into v_gr_line_id;

    -- ★ 원장 전기 — 입고는 (+). 같은 트랜잭션이라 헤더·라인·원장이 함께 롤백된다
    --   (원장만 남거나 라인만 남는 상태가 존재할 수 없다).
    insert into public.stock_movements (
      movement_type, item_id, qty, uom, warehouse_code, lot_no,
      moved_at, ref_doc_type, ref_doc_id, ref_line_id, memo
    ) values (
      'GR_IN', v_item, v_qty, v_uom, v_wh,
      nullif(btrim(v_line->>'lotNo'), ''),
      v_date, 'goods_receipt', v_gr_id, v_gr_line_id, v_gr_no
    );
  end loop;

  perform public.fn_po_apply_receipt_status(p_po_id);

  return jsonb_build_object('id', v_gr_id, 'grNo', v_gr_no);
end;
$$;

-- ── 6) 입고 취소 (= 원장 역분개, 원행 불변) ─────────────────────────────────
--  status='cancelled' + 이 GR 이 만든 GR_IN 각각에 REVERSAL 생성.
--  이중 취소는 reversal_of_id UNIQUE 부분 인덱스가 원천 차단한다(레이스 포함).
create or replace function public.cancel_goods_receipt(
  p_gr_id uuid,
  p_memo  text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gr public.goods_receipts%rowtype;
  v_m  record;
begin
  if p_memo is null or btrim(p_memo) = '' then
    raise exception '입고 취소 사유는 필수입니다. 왜 취소하는지 남겨야 합니다.';
  end if;

  select * into v_gr from public.goods_receipts where id = p_gr_id;
  if not found then
    raise exception '입고를 찾을 수 없습니다: %', p_gr_id;
  end if;
  if v_gr.status <> 'normal' then
    raise exception '이미 취소된 입고입니다.';
  end if;

  update public.goods_receipts
     set status = 'cancelled',
         memo   = coalesce(memo || ' / ', '') || '취소: ' || btrim(p_memo)
   where id = p_gr_id;

  -- 이 입고가 만든 원장 행을 각각 역분개(기존 RPC 재사용 → 검증 로직 공유).
  for v_m in
    select id from public.stock_movements
     where ref_doc_type = 'goods_receipt'
       and ref_doc_id   = p_gr_id
       and movement_type = 'GR_IN'
     order by created_at
  loop
    perform public.reverse_stock_movement(
      v_m.id, '입고 취소(' || v_gr.gr_no || '): ' || btrim(p_memo)
    );
  end loop;

  perform public.fn_po_apply_receipt_status(v_gr.ref_doc_id);
end;
$$;

grant execute on function public.save_goods_receipt(uuid, jsonb, date, text, text, text) to anon, authenticated;
grant execute on function public.cancel_goods_receipt(uuid, text) to anon, authenticated;
-- fn_po_apply_receipt_status 는 앱이 직접 부를 일이 없다(전이는 위 두 RPC 안에서만).
revoke execute on function public.fn_po_apply_receipt_status(uuid) from anon, authenticated;

-- ── 7) 잔량 소비 가드 (원칙 5 의 P4 이행분 — DB 하드 가드) ──────────────────
--  save_purchase_order 는 저장 시 `delete from po_lines where po_id = …` 로
--  라인을 **전량 삭제 후 재작성**한다. 그대로 두면 입고가 참조하던 발주 라인이
--  조용히 사라지고 새 id 로 다시 생겨 gr_lines.po_line_id 소프트 포인터가 끊긴다.
--  → 이 트리거가 그 DELETE 를 막아, **잠긴 save_purchase_order 를 수정하지 않고도**
--    참조된 발주의 수정·취소 저장이 물리적으로 실패한다. 순수 추가.
create or replace function public.fn_block_po_line_delete_with_receipt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cnt integer;
begin
  select count(*) into v_cnt
    from public.gr_lines gl
    join public.goods_receipts g on g.id = gl.gr_id
   where gl.po_line_id = old.id and g.status <> 'cancelled';

  if v_cnt > 0 then
    raise exception '입고 %건이 참조 중인 발주는 수정·취소할 수 없습니다. 먼저 해당 입고를 취소하세요. (품목: %)',
      v_cnt, coalesce(old.product_name, '(이름 없음)');
  end if;
  return old;
end;
$$;

drop trigger if exists trg_po_lines_receipt_guard on public.po_lines;
create trigger trg_po_lines_receipt_guard
  before delete on public.po_lines
  for each row execute function public.fn_block_po_line_delete_with_receipt();

notify pgrst, 'reload schema';

-- ── 검증(선택) ──────────────────────────────────────────────────────────────
--  전체 검산은 scripts/checks.sql (ⓐ·ⓑ·ⓒ·⑨·⑩ 포함).
--
--  1) 가드 확인 — 입고가 있는 발주를 화면에서 수정 저장하면 한국어 예외가 떠야 정상.
--  2) 봉인 확인:
--       select has_table_privilege('anon','public.goods_receipts','INSERT');  -- false
--       select has_table_privilege('anon','public.audit_log','INSERT');       -- false ★이번에 닫힘
--
-- ── 되돌리기(rollback) ──────────────────────────────────────────────────────
--   drop trigger if exists trg_po_lines_receipt_guard on public.po_lines;
--   drop function if exists public.fn_block_po_line_delete_with_receipt();
--   drop function if exists public.cancel_goods_receipt(uuid, text);
--   drop function if exists public.save_goods_receipt(uuid, jsonb, date, text, text, text);
--   drop function if exists public.fn_po_apply_receipt_status(uuid);
--   drop view if exists public.po_open_summary;
--   drop view if exists public.po_open_qty;
--   drop trigger if exists trg_audit_goods_receipts on public.goods_receipts;
--   drop table if exists public.gr_lines;
--   drop table if exists public.goods_receipts;
--   grant insert on public.audit_log to anon, authenticated;  -- 봉인 해제(권장 안 함)
