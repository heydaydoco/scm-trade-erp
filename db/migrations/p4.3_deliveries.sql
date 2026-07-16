-- ============================================================================
--  P4.3 — 출고(Delivery) : 수주 참조생성 · 원장 전기 · 잔량 · 부분출고 · 취소=역분개
-- ============================================================================
--  실행: Supabase 대시보드 → SQL Editor → New query → 붙여넣기 → Run.
--  성격: 순수 추가(신규 테이블·뷰·함수·트리거) + 소급 점검 + 멱등.
--
--  ⚠️ 라이브 잠금 객체 무변경: next_doc_number · fn_audit · save_* RPC ·
--     기존 테이블 구조(sales_orders·so_lines 등)를 재생성/수정하지 않는다.
--     (sales_orders.status 의 **값** 자동전환은 P4.3 스펙이 요구한 동작이며 스키마 변경이 아니다.)
--
--  P4.2 입고(GR)의 정확한 미러 + 차이 3개:
--    ① 부호가 음수(DLV_OUT) → 마이너스 재고 경고(원칙 8, 차단 아님)
--    ② 가드 대상이 so_lines
--    ③ 거래명세서 인쇄
--
--  🔑 교착 방지는 이미 확보돼 있다 — P4.2f 가 reverse_stock_movement 에
--     "ref_doc_type is not null 이면 거부" 가드를 넣었다. DLV_OUT 은 ref_doc_type='delivery'
--     라 자동으로 원장 직접 역분개가 막힌다. 따라서 cancel_delivery 는 REVERSAL 을
--     **직접 insert** 한다(reverse_stock_movement 를 부르면 그 가드에 막힌다).
-- ============================================================================

-- ── 0) 소급 점검 (P4.2 누락분 — 이미 돼 있으면 전부 no-op) ─────────────────
--  봉인: 이미 p4.2 에서 했으나 멱등이므로 다시 선언해 확실히 한다.
revoke all on public.goods_receipts from anon, authenticated;
revoke all on public.gr_lines        from anon, authenticated;
grant select on public.goods_receipts to anon, authenticated;
grant select on public.gr_lines       to anon, authenticated;

--  감사: goods_receipts 헤더 트리거(멱등 — drop → create).
drop trigger if exists trg_audit_goods_receipts on public.goods_receipts;
create trigger trg_audit_goods_receipts
  after insert or update or delete on public.goods_receipts
  for each row execute function public.fn_audit();

-- ── 1) 출고 헤더 ────────────────────────────────────────────────────────────
--  부분출고 = 같은 수주에 출고 여러 건(헤더가 여러 개). 라인 분할이 아니다.
create table if not exists public.deliveries (
  id              uuid primary key default gen_random_uuid(),
  delivery_no     text not null unique,          -- DLV-YYYYMM-NNN (원칙 6 원자 발번)
  delivery_date   date not null,                 -- 증빙일(KST 오늘 기본)
  status          text not null default 'normal'
                    check (status in ('normal','cancelled')),
  warehouse_code  text not null default 'MAIN',

  -- 수주 1건 소프트 포인터(FK 아님 — 선행전표 참조는 스냅샷 포인터, 기존 모듈 관례)
  ref_doc_type    text not null default 'sales_order'
                    check (ref_doc_type = 'sales_order'),
  ref_doc_id      uuid not null,

  -- ★ 세대(generation) 도장 — P4.2 규칙 그대로.
  --   살아있는 출고가 0건인 상태에서 생성되는 출고(=세대를 여는 출고)만 도장.
  --   복귀는 "도장이 있는 출고 중 **가장 최근**" 것 — "가장 이른" 은 다세대에서 틀린다.
  so_status_before text,

  memo            text,
  created_at      timestamptz not null default now()
);
create index if not exists deliveries_ref_idx   on public.deliveries (ref_doc_id, status);
create index if not exists deliveries_date_idx  on public.deliveries (delivery_date desc);
create index if not exists deliveries_stamp_idx on public.deliveries (ref_doc_id, created_at desc)
  where so_status_before is not null;

-- ── 2) 출고 라인 ────────────────────────────────────────────────────────────
create table if not exists public.delivery_lines (
  id           uuid primary key default gen_random_uuid(),
  delivery_id  uuid not null references public.deliveries (id) on delete cascade,
  line_no      integer not null,
  so_line_id   uuid,                       -- 소프트 포인터(FK 아님) — 수주 라인
  item_id      uuid not null references public.products (id),
  item_name    text,                       -- 스냅샷
  qty          numeric not null check (qty > 0 and qty < 'Infinity'::numeric),
  uom          text not null,              -- 스냅샷
  lot_no       text,                       -- 칸은 지금, 활성화는 P5
  memo         text
);
create index if not exists delivery_lines_dlv_idx     on public.delivery_lines (delivery_id, line_no);
create index if not exists delivery_lines_so_line_idx on public.delivery_lines (so_line_id);

-- 봉인: 쓰기는 RPC(SECURITY DEFINER)로만. 앱엔 INSERT 권한조차 주지 않는다.
revoke all on public.deliveries      from anon, authenticated;
revoke all on public.delivery_lines  from anon, authenticated;
grant select on public.deliveries     to anon, authenticated;
grant select on public.delivery_lines to anon, authenticated;

-- 감사 상속(헤더만 — 라인은 관례상 미부착).
drop trigger if exists trg_audit_deliveries on public.deliveries;
create trigger trg_audit_deliveries
  after insert or update or delete on public.deliveries
  for each row execute function public.fn_audit();

-- ── 3) 잔량 뷰 (원칙 1 — 잔량은 컬럼이 아니라 계산) ─────────────────────────
--  ★ SPEC 의 심장: "잔량 = so_lines.qty − Σ(delivery_lines.qty)".
--    shipped_qty 를 so_lines 에 저장하지 않는다.
create or replace view public.so_open_qty as
select
  l.id                                                   as so_line_id,
  l.so_id,
  l.sort_order,
  l.product_id,
  l.product_name,
  l.unit,
  l.unit_price,                                           -- 거래명세서 표시용(출고엔 저장 안 함)
  coalesce(l.quantity, 0)                                as ordered_qty,
  coalesce(d.shipped_qty, 0)                             as shipped_qty,
  coalesce(l.quantity, 0) - coalesce(d.shipped_qty, 0)   as open_qty
from public.so_lines l
left join (
  select dl.so_line_id, sum(dl.qty) as shipped_qty
  from public.delivery_lines dl
  join public.deliveries dv on dv.id = dl.delivery_id
  where dv.status <> 'cancelled'          -- 취소된 출고는 없던 일
  group by dl.so_line_id
) d on d.so_line_id = l.id;

create or replace view public.so_open_summary as
select
  so_id,
  sum(ordered_qty)                       as ordered_qty,
  sum(shipped_qty)                       as shipped_qty,
  sum(open_qty)                          as open_qty,
  count(*) filter (where open_qty > 0)   as open_lines,
  count(*)                               as total_lines
from public.so_open_qty
group by so_id;

grant select on public.so_open_qty     to anon, authenticated;
grant select on public.so_open_summary to anon, authenticated;

-- ── 4) 수주 상태 전이 (기계 전용 — 사람 손 금지) ────────────────────────────
--  매번 살아있는 출고로 재계산(누적 델타 금지). partial 은 폼 선택지에 노출하지 않는다.
create or replace function public.fn_so_apply_delivery_status(p_so_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ordered numeric;
  v_shipped numeric;
  v_next    text;
begin
  select coalesce(sum(ordered_qty), 0), coalesce(sum(shipped_qty), 0)
    into v_ordered, v_shipped
    from public.so_open_qty where so_id = p_so_id;

  if v_shipped = 0 then
    select so_status_before into v_next
      from public.deliveries
     where ref_doc_id = p_so_id and so_status_before is not null
     order by created_at desc
     limit 1;
    if v_next is null then
      return;  -- 방어: 도장이 없으면 건드리지 않는다(checks.sql ⓒ가 감시).
    end if;
  elsif v_shipped >= v_ordered then
    v_next := 'completed';
  else
    v_next := 'partial';
  end if;

  update public.sales_orders
     set status = v_next, updated_at = now()
   where id = p_so_id and status is distinct from v_next;
end;
$$;

-- ── 5) 출고 저장 (원자: 헤더 + 라인 + 원장 전기) ────────────────────────────
--  ⚠️ 마이너스 재고는 **막지 않는다**(원칙 8) — 경고는 화면이 저장 전에 띄운다.
--     제조·무역은 입고 전기가 늦는 게 현실이라 차단하면 출고 자체를 못 친다.
create or replace function public.save_delivery(
  p_so_id          uuid,
  p_lines          jsonb,
  p_delivery_date  date default null,
  p_warehouse_code text default 'MAIN',
  p_memo           text default null,
  p_period         text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_so         public.sales_orders%rowtype;
  v_dlv_id     uuid;
  v_dlv_no     text;
  v_stamp      text;
  v_live       integer;
  v_date       date;
  v_period     text;
  v_wh         text;
  v_line       jsonb;
  v_no         integer := 0;
  v_qty        numeric;
  v_item       uuid;
  v_uom        text;
  v_so_line    public.so_lines%rowtype;
  v_dlv_line_id uuid;
begin
  -- for update: 같은 수주에 동시 출고가 들어와도 직렬화. 세대 도장 stale 창을 닫는다.
  select * into v_so from public.sales_orders where id = p_so_id for update;
  if not found then
    raise exception '수주를 찾을 수 없습니다: %', p_so_id;
  end if;
  if v_so.status = 'cancelled' then
    raise exception '취소된 수주는 출고할 수 없습니다.';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception '출고 품목이 최소 1건 필요합니다.';
  end if;

  v_date   := coalesce(p_delivery_date, (now() at time zone 'Asia/Seoul')::date);
  v_period := coalesce(p_period, to_char(v_date, 'YYYYMM'));
  v_wh     := coalesce(nullif(btrim(p_warehouse_code), ''), 'MAIN');

  select count(*) into v_live
    from public.deliveries
   where ref_doc_id = p_so_id and status <> 'cancelled';

  -- 세대 도장 — 수주 행을 잠근 뒤 다시 읽어 stale 값을 배제한다.
  v_stamp := case
               when v_live = 0
               then (select status from public.sales_orders where id = p_so_id)
               else null
             end;

  v_dlv_no := public.next_doc_number('delivery', 'DLV', v_period);

  insert into public.deliveries (
    delivery_no, delivery_date, status, warehouse_code,
    ref_doc_type, ref_doc_id, so_status_before, memo
  ) values (
    v_dlv_no, v_date, 'normal', v_wh,
    'sales_order', p_so_id, v_stamp, nullif(btrim(p_memo), '')
  )
  returning id into v_dlv_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_no := v_no + 1;
    v_so_line := null;   -- 매 줄 초기화 — 앞줄 값이 새면 안 된다
    v_qty := (v_line->>'qty')::numeric;

    if v_qty is null
       or v_qty in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
       or v_qty <= 0 then
      raise exception '출고 수량은 0보다 큰 유한한 숫자여야 합니다. (%번째 줄, 받은 값: %)', v_no, v_line->>'qty';
    end if;

    -- 수주 라인 참조 필수 — 없으면 재고만 줄고 잔량·상태·잠금 어디에도 안 잡히는 유령 출고가 된다.
    if nullif(btrim(coalesce(v_line->>'soLineId', '')), '') is null then
      raise exception '출고 라인은 수주 라인을 참조해야 합니다. (%번째 줄)', v_no;
    end if;

    select * into v_so_line
      from public.so_lines
     where id = (v_line->>'soLineId')::uuid and so_id = p_so_id;
    if not found then
      raise exception '이 수주의 라인이 아닙니다. (%번째 줄)', v_no;
    end if;

    -- ★ 품목은 **수주 라인에서** 가져온다. 클라이언트가 보낸 itemId 를 신뢰하지 않는다.
    if v_so_line.product_id is null then
      raise exception '품목 마스터에 연결되지 않은 수주 라인은 출고할 수 없습니다(재고 원장은 등록 품목만 받는다). 먼저 품목을 등록하고 수주 라인을 연결하세요. (%번째 줄: %)',
        v_no, coalesce(v_so_line.product_name, '(이름 없음)');
    end if;
    v_item := v_so_line.product_id;

    select coalesce(unit, 'PCS') into v_uom from public.products where id = v_item;
    if not found then
      raise exception '품목을 찾을 수 없습니다: % (%번째 줄)', v_item, v_no;
    end if;
    v_uom := coalesce(nullif(btrim(v_line->>'uom'), ''), v_uom);

    insert into public.delivery_lines (
      delivery_id, line_no, so_line_id, item_id, item_name, qty, uom, lot_no, memo
    ) values (
      v_dlv_id, v_no,
      v_so_line.id,
      v_item,
      coalesce(nullif(btrim(v_line->>'itemName'), ''), v_so_line.product_name),
      v_qty, v_uom,
      nullif(btrim(v_line->>'lotNo'), ''),
      nullif(btrim(v_line->>'memo'), '')
    )
    returning id into v_dlv_line_id;

    -- ★ 원장 전기 — 출고는 (−). 부호는 여기서 정한다(화면은 양수만 보낸다).
    --   마이너스 재고가 되더라도 막지 않는다(원칙 8).
    insert into public.stock_movements (
      movement_type, item_id, qty, uom, warehouse_code, lot_no,
      moved_at, ref_doc_type, ref_doc_id, ref_line_id, memo
    ) values (
      'DLV_OUT', v_item, -v_qty, v_uom, v_wh,
      nullif(btrim(v_line->>'lotNo'), ''),
      v_date, 'delivery', v_dlv_id, v_dlv_line_id, v_dlv_no
    );
  end loop;

  perform public.fn_so_apply_delivery_status(p_so_id);

  return jsonb_build_object('id', v_dlv_id, 'deliveryNo', v_dlv_no);
end;
$$;

-- ── 6) 출고 취소 (= 원장 역분개, 원행 불변) ─────────────────────────────────
--  ⚠️ reverse_stock_movement 를 부르지 않는다 — P4.2f 가드가 전표 발생 행을 거부한다.
--     REVERSAL 을 직접 insert 한다. 이미 역분개된 행은 건너뛴다(멱등 — 갇힌 데이터 자가복구).
create or replace function public.cancel_delivery(
  p_delivery_id uuid,
  p_memo        text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dlv public.deliveries%rowtype;
  v_m   public.stock_movements%rowtype;
begin
  if p_memo is null or btrim(p_memo) = '' then
    raise exception '출고 취소 사유는 필수입니다. 왜 취소하는지 남겨야 합니다.';
  end if;

  select * into v_dlv from public.deliveries where id = p_delivery_id for update;
  if not found then
    raise exception '출고를 찾을 수 없습니다: %', p_delivery_id;
  end if;
  if v_dlv.status <> 'normal' then
    raise exception '이미 취소된 출고입니다.';
  end if;

  update public.deliveries
     set status = 'cancelled',
         memo   = coalesce(memo || ' / ', '') || '취소: ' || btrim(p_memo)
   where id = p_delivery_id;

  for v_m in
    select m.* from public.stock_movements m
     where m.ref_doc_type  = 'delivery'
       and m.ref_doc_id    = p_delivery_id
       and m.movement_type = 'DLV_OUT'
       and not exists (
         select 1 from public.stock_movements r where r.reversal_of_id = m.id
       )
     order by m.created_at
  loop
    insert into public.stock_movements (
      movement_type, item_id, qty, uom, warehouse_code, location_code, lot_no, serial_no,
      moved_at, ref_doc_type, ref_doc_id, ref_line_id, reversal_of_id, memo
    ) values (
      'REVERSAL', v_m.item_id, -v_m.qty, v_m.uom, v_m.warehouse_code,
      v_m.location_code, v_m.lot_no, v_m.serial_no,
      (now() at time zone 'Asia/Seoul')::date,
      v_m.ref_doc_type, v_m.ref_doc_id, v_m.ref_line_id, v_m.id,
      '출고 취소(' || v_dlv.delivery_no || '): ' || btrim(p_memo)
    );
  end loop;

  perform public.fn_so_apply_delivery_status(v_dlv.ref_doc_id);
end;
$$;

grant execute on function public.save_delivery(uuid, jsonb, date, text, text, text) to anon, authenticated;
grant execute on function public.cancel_delivery(uuid, text) to anon, authenticated;

-- ── 7) 잔량 소비 가드 (원칙 5 — P4.2 미러) ─────────────────────────────────
--  save_sales_order 는 저장 시 so_lines 를 전량 DELETE 후 재작성한다. 그대로 두면
--  출고가 참조하던 수주 라인이 조용히 사라지고 새 id 로 다시 생겨 소프트 포인터가 끊긴다.
--  → 이 트리거가 그 DELETE 를 막아, **잠긴 save_sales_order 를 수정하지 않고도**
--    참조된 수주의 수정·취소 저장이 물리적으로 실패한다. 순수 추가.
create or replace function public.fn_block_so_line_delete_with_delivery()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cnt integer;
begin
  select count(*) into v_cnt
    from public.delivery_lines dl
    join public.deliveries d on d.id = dl.delivery_id
   where dl.so_line_id = old.id and d.status <> 'cancelled';

  if v_cnt > 0 then
    raise exception '출고 %건이 참조 중인 수주는 수정·취소할 수 없습니다. 먼저 해당 출고를 취소하세요. (품목: %)',
      v_cnt, coalesce(old.product_name, '(이름 없음)');
  end if;
  return old;
end;
$$;

drop trigger if exists trg_so_lines_delivery_guard on public.so_lines;
create trigger trg_so_lines_delivery_guard
  before delete on public.so_lines
  for each row execute function public.fn_block_so_line_delete_with_delivery();

notify pgrst, 'reload schema';

-- ── 검증(선택) ──────────────────────────────────────────────────────────────
--  전체 검산은 scripts/checks.sql.
--  1) 봉인:  select has_table_privilege('anon','public.deliveries','INSERT');   -- false
--  2) 교착 방지(P4.2f 가드 상속 확인) — 출고가 만든 DLV_OUT id 로:
--       select public.reverse_stock_movement('<DLV_OUT id>', '테스트');
--     → ERROR: 전표에서 생성된 재고 기록은 원장에서 직접 되돌릴 수 없습니다…
--
-- ── 되돌리기(rollback) ──────────────────────────────────────────────────────
--   drop trigger if exists trg_so_lines_delivery_guard on public.so_lines;
--   drop function if exists public.fn_block_so_line_delete_with_delivery();
--   drop function if exists public.cancel_delivery(uuid, text);
--   drop function if exists public.save_delivery(uuid, jsonb, date, text, text, text);
--   drop function if exists public.fn_so_apply_delivery_status(uuid);
--   drop view if exists public.so_open_summary;
--   drop view if exists public.so_open_qty;
--   drop trigger if exists trg_audit_deliveries on public.deliveries;
--   drop table if exists public.delivery_lines;
--   drop table if exists public.deliveries;
