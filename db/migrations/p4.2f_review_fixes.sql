-- ============================================================================
--  P4.2f — 적대검증 교정 (교착 해소 + 입고 결속 강화)
-- ============================================================================
--  실행: Supabase 대시보드 → SQL Editor → New query → 붙여넣기 → Run.
--  성격: 기존 P4.1/P4.2 함수 교체(내가 만든 것) + 멱등. 신규 테이블 없음.
--        잠금 객체(next_doc_number·fn_audit·save_*·기존 테이블 구조) 무변경.
--
--  P4.2 적대검증(5관점 → 지적별 반박 재검증) 12건 중 6건 기각, 확인된 실결함 4건 교정.
-- ============================================================================

-- ── 🔴 결함 1) 교착 — 전표가 만든 원장 행을 직접 역분개하면 복구 불가 ────────
--  재현: 입고 → /stock/movements 에서 그 GR_IN 에 [역분개] 버튼이 그대로 뜬다
--        (isReversible 은 REVERSAL 여부와 기역분개 여부만 봤다) → 누르면 성공.
--        재고는 0 이 되지만 goods_receipts.status 는 'normal' 이라
--        잔량 0 · 발주 'completed' · 잠금 유지 = 재고와 장부가 정면으로 어긋난다.
--        바로잡으려 [입고 취소] → cancel 이 이미 역분개된 행을 또 역분개 시도 →
--        '이미 역분개된 행입니다'(P0001) → **RPC 전체 롤백** → status='cancelled' 도 안 남는다.
--  결과: 입고는 영원히 취소 불가, 발주는 po_lines 가드에 막혀 영구 잠김. 앱 내 복구 경로 0.
--
--  교정 방향: (a) 애초에 못 하게 막고 (b) 이미 갇힌 데이터는 스스로 풀리게 한다.

-- (a) 전표가 만든 행은 원장에서 직접 되돌릴 수 없다 — "전표는 전표에서 취소".
--     ⚠️ 불리언 플래그로 예외를 두지 않는다 — RPC 가 anon 에 열려 있어 플래그를 그냥
--        true 로 넘기면 우회된다. 대신 cancel_goods_receipt 가 REVERSAL 을 **직접** 넣는다.
--     ref_doc_type is null 인 P4.1 수동 조정 행(INIT/ADJ_*)은 그대로 역분개된다.
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

  if v_src.movement_type = 'REVERSAL' then
    raise exception '역분개 행은 다시 역분개할 수 없습니다. 필요하면 재고 조정을 새로 등록하세요.';
  end if;

  -- ★ P4.2f: 전표(입고 등)가 만든 행은 여기서 되돌리지 않는다.
  --   원장만 되돌리면 전표 상태·잔량과 어긋나 복구 불가 상태가 된다.
  if v_src.ref_doc_type is not null then
    raise exception '전표에서 생성된 재고 기록은 원장에서 직접 되돌릴 수 없습니다. 해당 전표(입고 등)를 취소하세요.';
  end if;

  if exists (select 1 from public.stock_movements where reversal_of_id = p_movement_id) then
    raise exception '이미 역분개된 행입니다.';
  end if;

  insert into public.stock_movements (
    movement_type, item_id, qty, uom, warehouse_code, location_code, lot_no, serial_no,
    moved_at, ref_doc_type, ref_doc_id, ref_line_id, reversal_of_id, memo
  ) values (
    'REVERSAL', v_src.item_id, -v_src.qty, v_src.uom, v_src.warehouse_code,
    v_src.location_code, v_src.lot_no, v_src.serial_no,
    (now() at time zone 'Asia/Seoul')::date,
    v_src.ref_doc_type, v_src.ref_doc_id, v_src.ref_line_id, v_src.id,
    btrim(p_memo)
  )
  returning id into v_id;

  return v_id;

exception
  when unique_violation then
    raise exception '이미 역분개된 행입니다(동시 요청 차단).';
end;
$$;

-- (b) 입고 취소를 **멱등**하게 — 이미 역분개된 GR_IN 은 건너뛴다.
--     (a)의 가드가 재발을 막지만, 가드 이전에 이미 갇힌 입고는 이 skip 이 있어야 풀린다.
--     REVERSAL insert 를 직접 수행한다 — reverse_stock_movement 를 부르면 (a)의 가드에 막힌다.
--     이중 취소는 status 검사 + reversal_of_id UNIQUE 부분 인덱스가 여전히 차단한다.
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
  v_m  public.stock_movements%rowtype;
begin
  if p_memo is null or btrim(p_memo) = '' then
    raise exception '입고 취소 사유는 필수입니다. 왜 취소하는지 남겨야 합니다.';
  end if;

  select * into v_gr from public.goods_receipts where id = p_gr_id for update;
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

  for v_m in
    select m.* from public.stock_movements m
     where m.ref_doc_type  = 'goods_receipt'
       and m.ref_doc_id    = p_gr_id
       and m.movement_type = 'GR_IN'
       -- ★ 이미 역분개된 행은 건너뛴다(갇힌 데이터 자가 복구).
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
      '입고 취소(' || v_gr.gr_no || '): ' || btrim(p_memo)
    );
  end loop;

  perform public.fn_po_apply_receipt_status(v_gr.ref_doc_id);
end;
$$;

-- ── 결함 2·3·4) 입고 라인 결속 강화 ────────────────────────────────────────
--  2) itemId 가 발주 라인의 품목과 일치하는지 검증하지 않았다 → 볼트를 발주해놓고
--     너트를 입고해도 통과하고, 잔량은 정상으로 보인다(원장엔 너트가 쌓인다).
--     교정: **발주 라인의 product_id 를 쓴다.** 클라이언트가 보낸 itemId 를 신뢰하지 않는다.
--  3) poLineId 없이도 저장돼 재고만 늘고 잔량·가드에 안 잡히는 유령 입고가 가능했다.
--     교정: 이 RPC 는 발주 참조 입고 전용 → poLineId 필수.
--  4) v_po.status(:189)와 v_live(:207)가 서로 다른 스냅샷이라 세대 도장에 stale 값이
--     찍힐 수 있었다. 교정: 발주 행을 for update 로 잠그고 도장 시점에 상태를 다시 읽는다.
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
  -- ★ for update: 같은 발주에 동시 입고가 들어와도 직렬화된다.
  --   세대 도장이 stale 상태를 찍는 창(v_po 읽기 ↔ v_live 읽기 사이)을 닫는다.
  select * into v_po from public.purchase_orders where id = p_po_id for update;
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

  select count(*) into v_live
    from public.goods_receipts
   where ref_doc_id = p_po_id and status <> 'cancelled';

  -- 세대 도장 — 발주 행을 잠근 뒤 **다시 읽어** stale 값을 배제한다.
  v_stamp := case
               when v_live = 0
               then (select status from public.purchase_orders where id = p_po_id)
               else null
             end;

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
    v_po_line := null;   -- 매 줄 초기화 — 앞줄 값이 새면 안 된다
    v_qty := (v_line->>'qty')::numeric;

    if v_qty is null
       or v_qty in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
       or v_qty <= 0 then
      raise exception '입고 수량은 0보다 큰 유한한 숫자여야 합니다. (%번째 줄, 받은 값: %)', v_no, v_line->>'qty';
    end if;

    -- ★ 발주 라인 참조 필수 — 이 RPC 는 발주 참조 입고 전용이다.
    --   없으면 재고만 늘고 잔량·상태·잠금 어디에도 안 잡히는 유령 입고가 된다.
    if nullif(btrim(coalesce(v_line->>'poLineId', '')), '') is null then
      raise exception '입고 라인은 발주 라인을 참조해야 합니다. (%번째 줄)', v_no;
    end if;

    select * into v_po_line
      from public.po_lines
     where id = (v_line->>'poLineId')::uuid and po_id = p_po_id;
    if not found then
      raise exception '이 발주의 라인이 아닙니다. (%번째 줄)', v_no;
    end if;

    -- ★ 품목은 **발주 라인에서** 가져온다. 클라이언트가 보낸 itemId 를 신뢰하지 않는다
    --   (신뢰하면 볼트를 발주하고 너트를 입고해도 잔량이 정상으로 보인다).
    if v_po_line.product_id is null then
      raise exception '품목 마스터에 연결되지 않은 발주 라인은 입고할 수 없습니다(재고 원장은 등록 품목만 받는다). 먼저 품목을 등록하고 발주 라인을 연결하세요. (%번째 줄: %)',
        v_no, coalesce(v_po_line.product_name, '(이름 없음)');
    end if;
    v_item := v_po_line.product_id;

    select coalesce(unit, 'PCS') into v_uom from public.products where id = v_item;
    if not found then
      raise exception '품목을 찾을 수 없습니다: % (%번째 줄)', v_item, v_no;
    end if;
    v_uom := coalesce(nullif(btrim(v_line->>'uom'), ''), v_uom);

    insert into public.gr_lines (
      gr_id, line_no, po_line_id, item_id, item_name, qty, uom, lot_no, memo
    ) values (
      v_gr_id, v_no,
      v_po_line.id,
      v_item,
      coalesce(nullif(btrim(v_line->>'itemName'), ''), v_po_line.product_name),
      v_qty, v_uom,
      nullif(btrim(v_line->>'lotNo'), ''),
      nullif(btrim(v_line->>'memo'), '')
    )
    returning id into v_gr_line_id;

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

notify pgrst, 'reload schema';

-- ── 검증(선택) ──────────────────────────────────────────────────────────────
--  1) 전표 행 직접 역분개 차단 — 입고가 만든 GR_IN id 로:
--       select public.reverse_stock_movement('<GR_IN id>', '테스트');
--     → ERROR: 전표에서 생성된 재고 기록은 원장에서 직접 되돌릴 수 없습니다…
--  2) 수동 조정 행은 그대로 역분개된다(ref_doc_type is null) — /stock/movements 에서 확인.
--  3) 갇힌 입고 자가 복구: 이미 직접 역분개된 GR_IN 이 있는 입고도 [입고 취소]가 성공해야 한다.
