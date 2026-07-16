-- ============================================================================
--  P4.4 — 선적 화물(shipment_lines) · 당사자 스냅샷(shipment_parties) · S/I 기반
-- ============================================================================
--  실행: Supabase 대시보드 → SQL Editor → New query → 붙여넣기 → Run.
--  성격: 순수 추가(신규 2테이블·뷰·RPC·가드 트리거) + 멱등(재실행 무해)
--        + 아키텍트 승인 잠금 예외 3건(아래 ⑤) — 그 외 기존 객체 무수정.
--
--  ⚠️ 라이브 잠금 객체 무수정: next_doc_number · fn_audit · save_shipment ·
--     기존 가드 트리거(trg_po_lines_receipt_guard·trg_so_lines_delivery_guard) ·
--     기존 테이블 구조. 선적은 **물류 전표** — 재고 원장 전기 없음(GR/DLV 전용),
--     금액·환율 없음(P4는 수량 전용).
--
--  ⚠️ Supabase SQL Editor 는 **마지막 문장 결과만** 표시한다 — 이 파일의 마지막
--     문장이 감사 SELECT 다. Run 후 아래 결과표를 **드래그 복사해 회신**해 주세요
--     (하드닝 여부는 아키텍트가 이 표를 보고 결정합니다).
-- ============================================================================

-- ── 1) 선적 화물 라인 ───────────────────────────────────────────────────────
--  주문 헤더 단위였던 연결(shipment_orders)에 **품목·수량 배분**을 붙인다.
--  order_line_id 는 소프트 포인터(FK 아님 — 기존 모듈 관례), 참조 유효성은 RPC 가 검사.
--  item_id 도 소프트 — 원장 전기가 없으므로 자유텍스트 품목도 선적할 수 있다.
create table if not exists public.shipment_lines (
  id              uuid primary key default gen_random_uuid(),
  shipment_id     uuid not null references public.shipments (id) on delete cascade,
  order_type      text not null check (order_type in ('SO','PO')),
  order_line_id   uuid,                    -- 소프트 포인터 (so_lines.id | po_lines.id)
  item_id         uuid,                    -- 소프트 (products.id — 미연결 허용)
  item_name       text not null,           -- 스냅샷
  -- NaN/Infinity 차단은 P4.1f 확립 패턴(NaN 은 모든 비교에서 '크다' — qty>0 만으로 못 막는다)
  qty             numeric not null check (qty > 0 and qty < 'Infinity'::numeric),
  uom             text not null,           -- 스냅샷 — P4.3f 체인(라인→마스터→거부)으로 서비스가 해석
  package_count   integer check (package_count is null or package_count >= 0),
  package_type    text,
  gross_weight_kg numeric check (gross_weight_kg is null
                                 or (gross_weight_kg >= 0 and gross_weight_kg < 'Infinity'::numeric)),
  cbm             numeric check (cbm is null or (cbm >= 0 and cbm < 'Infinity'::numeric)),
  memo            text
);
create index if not exists shipment_lines_shp_idx
  on public.shipment_lines (shipment_id);
create index if not exists shipment_lines_order_line_idx
  on public.shipment_lines (order_type, order_line_id);

-- ── 2) 선적 당사자 스냅샷 ───────────────────────────────────────────────────
--  인쇄(S/I)는 **이 스냅샷만** 본다 — 거래처 마스터를 나중에 고쳐도 과거 서류가
--  소급 변경되지 않는다(P4.4 조사에서 확인된 live-조회 구조의 교정).
--  company_id 는 출처 기록용 소프트 포인터일 뿐, 인쇄가 다시 조회하지 않는다.
create table if not exists public.shipment_parties (
  id          uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments (id) on delete cascade,
  role        text not null check (role in ('shipper','consignee','notify')),
  company_id  uuid,                        -- 소프트 — 어느 거래처에서 떠온 스냅샷인지
  name        text not null,
  address     text,
  contact     text,
  unique (shipment_id, role)
);
create index if not exists shipment_parties_shp_idx
  on public.shipment_parties (shipment_id);

-- ── 3) 봉인 — 쓰기는 SECURITY DEFINER RPC 로만 (Supabase 기본권한 함정 대응) ──
--  "부여 안 함"으로는 아무것도 못 막는다 — 명시적 REVOKE 만 유효(P4.1 확증).
revoke all on public.shipment_lines   from anon, authenticated;
revoke all on public.shipment_parties from anon, authenticated;
grant select on public.shipment_lines   to anon, authenticated;
grant select on public.shipment_parties to anon, authenticated;

-- ── 4) 선적 잔량 뷰 (원칙 1 — 잔량은 컬럼이 아니라 계산) ─────────────────────
--  주문라인별 기선적 수량. 취소된 선적은 없던 일. 선적잔량 = 주문라인 수량 − shipped_qty
--  (산식·프리필·초과 판정은 docFlow 기존 순수함수를 서비스에서 재사용한다).
create or replace view public.shipment_line_totals as
select
  sl.order_type,
  sl.order_line_id,
  sum(sl.qty) as shipped_qty
from public.shipment_lines sl
join public.shipments s on s.id = sl.shipment_id
where s.status is distinct from 'cancelled'
  and sl.order_line_id is not null
group by sl.order_type, sl.order_line_id;

grant select on public.shipment_line_totals to anon, authenticated;

-- ── 5) 잠금 예외 3건 (아키텍트 명시 승인 — 그 외 기존 객체 무수정) ───────────
-- ⑤-① shipping_marks 컬럼 (nullable 순수 추가)
alter table public.shipments add column if not exists shipping_marks text;

-- ⑤-② ship_number UNIQUE 인덱스 — 중복이 이미 있으면 생성을 **생략**하고
--      아래 감사 SELECT 가 중복 건수를 표기한다(멱등·안전 우선).
do $$
begin
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'shipments_ship_number_unique'
  ) then
    if not exists (
      select 1 from public.shipments
       where ship_number is not null
       group by ship_number having count(*) > 1
    ) then
      create unique index shipments_ship_number_unique
        on public.shipments (ship_number) where ship_number is not null;
    end if;
  end if;
end $$;

-- ⑤-③ status·direction CHECK — 위반 행이 있으면 **생략**하고 감사 SELECT 가 표기.
--      (CHECK 는 null 을 통과시키므로 기존 null 행은 안전)
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'shipments_status_check'
       and conrelid = 'public.shipments'::regclass
  ) then
    if not exists (
      select 1 from public.shipments
       where status is not null
         and status not in ('draft','booked','shipped','arrived','cancelled')
    ) then
      alter table public.shipments
        add constraint shipments_status_check
        check (status in ('draft','booked','shipped','arrived','cancelled'));
    end if;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'shipments_direction_check'
       and conrelid = 'public.shipments'::regclass
  ) then
    if not exists (
      select 1 from public.shipments
       where direction is not null and direction not in ('export','import')
    ) then
      alter table public.shipments
        add constraint shipments_direction_check
        check (direction in ('export','import'));
    end if;
  end if;
end $$;

-- ── 6) RPC: 화물 내역·당사자·마킹 저장 (트랜잭션 1개) ───────────────────────
--  ★ 라인은 **diff-upsert** — 들어온 id 는 UPDATE, 무id 는 INSERT, 빠진 기존행만
--    DELETE. 전량교체 금지: 구 save_shipment 의 삭제·재생성이 id 를 갈아치우는
--    안티패턴의 재생산을 막고, P4.6 문서흐름 추적의 출처(라인 id)를 안정시킨다.
--  parties 는 전량교체 허용(참조자 없음·≤3행). marks 는 헤더 행 데이터 update.
--  구 save_shipment 는 무수정 — 이 RPC 는 헤더·주문연결·마일스톤을 건드리지 않는다.
create or replace function public.save_shipment_cargo(
  p_shipment_id    uuid,
  p_lines          jsonb,
  p_parties        jsonb,
  p_shipping_marks text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shp        public.shipments%rowtype;
  v_line       jsonb;
  v_party      jsonb;
  v_no         integer := 0;
  v_id         uuid;
  v_qty        numeric;
  v_uom        text;
  v_order_type text;
  v_line_ref   uuid;
  v_item       uuid;
  v_name       text;
  v_pkg        integer;
  v_wt         numeric;
  v_cbm        numeric;
  v_keep       uuid[] := '{}'::uuid[];
  v_role       text;
  v_seen_roles text[] := '{}'::text[];
  v_parent     uuid;
  v_so         public.so_lines%rowtype;
  v_po         public.po_lines%rowtype;
begin
  -- for update: 같은 선적에 동시 저장이 들어와도 직렬화.
  select * into v_shp from public.shipments where id = p_shipment_id for update;
  if not found then
    raise exception '선적을 찾을 수 없습니다: %', p_shipment_id;
  end if;
  if v_shp.status = 'cancelled' then
    raise exception '취소된 선적에는 화물 내역을 저장할 수 없습니다.';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception '화물 라인 payload 형식이 잘못됐습니다(배열 필요).';
  end if;
  if p_parties is null or jsonb_typeof(p_parties) <> 'array' then
    raise exception '당사자 payload 형식이 잘못됐습니다(배열 필요).';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_no := v_no + 1;

    v_qty := (v_line->>'qty')::numeric;
    if v_qty is null
       or v_qty in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
       or v_qty <= 0 then
      raise exception '선적 수량은 0보다 큰 유한한 숫자여야 합니다. (%번째 줄, 받은 값: %)',
        v_no, v_line->>'qty';
    end if;

    -- 단위는 서비스가 P4.3f 체인(주문라인 uom → products.unit → 거부)으로 해석해
    -- 보낸다. 여기서는 마지막 방어선으로 비어 있으면 거부('PCS' 발명 금지).
    v_uom := nullif(btrim(coalesce(v_line->>'uom', '')), '');
    if v_uom is null then
      raise exception '단위를 알 수 없어 저장할 수 없습니다: % — 주문 라인과 품목 마스터 어디에도 단위가 없습니다. 품목 마스터에서 단위를 입력한 뒤 다시 시도하세요. (%번째 줄)',
        coalesce(nullif(btrim(coalesce(v_line->>'itemName','')),''), '(이름 없음)'), v_no;
    end if;

    v_order_type := v_line->>'orderType';
    if v_order_type is null or v_order_type not in ('SO', 'PO') then
      raise exception '주문 유형은 SO 또는 PO 여야 합니다. (%번째 줄, 받은 값: %)',
        v_no, coalesce(v_line->>'orderType', '(없음)');
    end if;

    -- 주문 라인 참조 필수 — 없으면 잔량·가드 어디에도 안 잡히는 유령 화물이 된다.
    v_line_ref := nullif(btrim(coalesce(v_line->>'orderLineId', '')), '')::uuid;
    if v_line_ref is null then
      raise exception '선적 화물 라인은 주문 라인을 참조해야 합니다. (%번째 줄)', v_no;
    end if;

    -- 주문 라인 실존 + 그 부모 주문이 **현재 이 선적에 연결**돼 있어야 한다.
    -- 품목 스냅샷은 주문 라인에서 가져온다(클라이언트 값 불신 — P4.2f 결).
    -- ★ 부모 주문 헤더를 for update 로 잠근다(P4.2f·P4.3 확립 패턴) — 잠긴
    --   save_sales_order/save_purchase_order 의 "라인 전량 DELETE+재작성"과
    --   직렬화하지 않으면, 이쪽의 라인 실존 검증과 저쪽의 BEFORE DELETE 가드가
    --   서로의 미커밋 행을 못 보는 창에서 둘 다 통과해 **삭제된 라인을 가리키는
    --   유령 화물 라인**이 생긴다(잔량·가드 동시 무력화). 잠금 후 재읽기가 진짜 검증.
    if v_order_type = 'SO' then
      select so_id into v_parent from public.so_lines where id = v_line_ref;
      if not found then
        raise exception '수주 라인을 찾을 수 없습니다. (%번째 줄)', v_no;
      end if;
      perform 1 from public.sales_orders where id = v_parent for update;
      select * into v_so from public.so_lines where id = v_line_ref;
      if not found then
        raise exception '주문이 방금 수정되어 라인이 바뀌었습니다. 화면을 새로고침한 뒤 다시 시도하세요. (%번째 줄)', v_no;
      end if;
      if not exists (
        select 1 from public.shipment_orders
         where shipment_id = p_shipment_id and order_type = 'SO' and order_id = v_so.so_id
      ) then
        raise exception '이 선적에 연결되지 않은 수주의 라인입니다. 먼저 위 폼에서 주문을 연결하세요. (%번째 줄)', v_no;
      end if;
      v_item := v_so.product_id;
      v_name := coalesce(nullif(btrim(coalesce(v_line->>'itemName','')),''),
                         v_so.product_name, '(이름 없음)');
    else
      select po_id into v_parent from public.po_lines where id = v_line_ref;
      if not found then
        raise exception '발주 라인을 찾을 수 없습니다. (%번째 줄)', v_no;
      end if;
      perform 1 from public.purchase_orders where id = v_parent for update;
      select * into v_po from public.po_lines where id = v_line_ref;
      if not found then
        raise exception '주문이 방금 수정되어 라인이 바뀌었습니다. 화면을 새로고침한 뒤 다시 시도하세요. (%번째 줄)', v_no;
      end if;
      if not exists (
        select 1 from public.shipment_orders
         where shipment_id = p_shipment_id and order_type = 'PO' and order_id = v_po.po_id
      ) then
        raise exception '이 선적에 연결되지 않은 발주의 라인입니다. 먼저 위 폼에서 주문을 연결하세요. (%번째 줄)', v_no;
      end if;
      v_item := v_po.product_id;
      v_name := coalesce(nullif(btrim(coalesce(v_line->>'itemName','')),''),
                         v_po.product_name, '(이름 없음)');
    end if;

    -- 물류 수치 — null 허용, 값이 오면 유한·비음수만(NaN 은 >=0 비교를 통과한다).
    v_pkg := nullif(btrim(coalesce(v_line->>'packageCount', '')), '')::integer;
    if v_pkg is not null and v_pkg < 0 then
      raise exception '포장 수는 0 이상이어야 합니다. (%번째 줄, 받은 값: %)', v_no, v_pkg;
    end if;
    v_wt := nullif(btrim(coalesce(v_line->>'grossWeightKg', '')), '')::numeric;
    if v_wt is not null
       and (v_wt in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) or v_wt < 0) then
      raise exception '총중량(kg)은 0 이상의 유한한 숫자여야 합니다. (%번째 줄, 받은 값: %)', v_no, v_line->>'grossWeightKg';
    end if;
    v_cbm := nullif(btrim(coalesce(v_line->>'cbm', '')), '')::numeric;
    if v_cbm is not null
       and (v_cbm in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) or v_cbm < 0) then
      raise exception 'CBM 은 0 이상의 유한한 숫자여야 합니다. (%번째 줄, 받은 값: %)', v_no, v_line->>'cbm';
    end if;

    v_id := nullif(btrim(coalesce(v_line->>'id', '')), '')::uuid;
    if v_id is not null then
      -- ★ shipment_id 스코프 필수 — 다른 선적의 라인 id 로 UPDATE 를 우회하지 못하게.
      update public.shipment_lines
         set order_type      = v_order_type,
             order_line_id   = v_line_ref,
             item_id         = v_item,
             item_name       = v_name,
             qty             = v_qty,
             uom             = v_uom,
             package_count   = v_pkg,
             package_type    = nullif(btrim(coalesce(v_line->>'packageType', '')), ''),
             gross_weight_kg = v_wt,
             cbm             = v_cbm,
             memo            = nullif(btrim(coalesce(v_line->>'memo', '')), '')
       where id = v_id and shipment_id = p_shipment_id;
      if not found then
        raise exception '이 선적의 화물 라인이 아닙니다. (%번째 줄)', v_no;
      end if;
    else
      insert into public.shipment_lines (
        shipment_id, order_type, order_line_id, item_id, item_name,
        qty, uom, package_count, package_type, gross_weight_kg, cbm, memo
      ) values (
        p_shipment_id, v_order_type, v_line_ref, v_item, v_name,
        v_qty, v_uom, v_pkg,
        nullif(btrim(coalesce(v_line->>'packageType', '')), ''),
        v_wt, v_cbm,
        nullif(btrim(coalesce(v_line->>'memo', '')), '')
      )
      returning id into v_id;
    end if;
    v_keep := v_keep || v_id;
  end loop;

  -- diff 의 DELETE: payload 에서 빠진 기존 행만 지운다(빈 배열 = 전부 삭제 의사).
  delete from public.shipment_lines
   where shipment_id = p_shipment_id and id <> all (v_keep);

  -- 당사자 스냅샷 — 전량교체(참조자 없음, 최대 3행).
  -- 중복 role 판정은 루프 안에서 한다 — count(distinct) 선차단은 null role 을
  -- 세지 않아 "역할 누락"을 "중복"으로 오진한다(역할 검증이 먼저다).
  delete from public.shipment_parties where shipment_id = p_shipment_id;
  for v_party in select * from jsonb_array_elements(p_parties)
  loop
    v_role := v_party->>'role';
    if v_role is null or v_role not in ('shipper', 'consignee', 'notify') then
      raise exception '당사자 역할은 shipper·consignee·notify 중 하나여야 합니다. (받은 값: %)',
        coalesce(v_party->>'role', '(없음)');
    end if;
    if v_role = any (v_seen_roles) then
      raise exception '같은 역할(%)의 당사자가 두 번 들어왔습니다.', v_role;
    end if;
    v_seen_roles := v_seen_roles || v_role;
    if nullif(btrim(coalesce(v_party->>'name', '')), '') is null then
      raise exception '당사자 이름은 필수입니다. (역할: %)', v_role;
    end if;
    insert into public.shipment_parties (shipment_id, role, company_id, name, address, contact)
    values (
      p_shipment_id,
      v_role,
      nullif(btrim(coalesce(v_party->>'companyId', '')), '')::uuid,
      btrim(v_party->>'name'),
      nullif(btrim(coalesce(v_party->>'address', '')), ''),
      nullif(btrim(coalesce(v_party->>'contact', '')), '')
    );
  end loop;

  -- 마킹 — shipments 헤더의 행 데이터 update (DDL 아님, 잠금 무관).
  update public.shipments
     set shipping_marks = nullif(btrim(coalesce(p_shipping_marks, '')), ''),
         updated_at     = now()
   where id = p_shipment_id;

  return jsonb_build_object(
    'id', p_shipment_id,
    'lineCount', (select count(*) from public.shipment_lines where shipment_id = p_shipment_id),
    'partyCount', (select count(*) from public.shipment_parties where shipment_id = p_shipment_id)
  );
end;
$$;

grant execute on function public.save_shipment_cargo(uuid, jsonb, jsonb, text) to anon, authenticated;

-- ── 7) 소비 가드 (원칙 5 — DB 하드 가드 2겹. 서비스·UI 겹은 앱 코드에서) ─────
-- 7-a) 살아있는 선적 화물이 참조하는 주문 라인은 삭제 불가.
--      기존 P4.2/P4.3 가드 트리거는 무수정 — **별개 이름으로 추가**한다.
--      save_sales_order/save_purchase_order 의 "라인 전량 DELETE 후 재작성"이
--      이 트리거에 걸려, 잠긴 RPC 를 고치지 않고도 주문 수정이 물리적으로 실패한다.
create or replace function public.fn_block_so_line_delete_with_shipment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cnt integer;
begin
  select count(*) into v_cnt
    from public.shipment_lines sl
    join public.shipments s on s.id = sl.shipment_id
   where sl.order_type = 'SO'
     and sl.order_line_id = old.id
     and s.status is distinct from 'cancelled';

  if v_cnt > 0 then
    raise exception '선적 화물 %건이 참조 중인 수주는 수정·취소할 수 없습니다. 먼저 해당 선적의 화물 내역에서 이 수주의 라인을 지우거나 선적을 취소하세요. (품목: %)',
      v_cnt, coalesce(old.product_name, '(이름 없음)');
  end if;
  return old;
end;
$$;

drop trigger if exists trg_so_lines_shipment_guard on public.so_lines;
create trigger trg_so_lines_shipment_guard
  before delete on public.so_lines
  for each row execute function public.fn_block_so_line_delete_with_shipment();

create or replace function public.fn_block_po_line_delete_with_shipment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cnt integer;
begin
  select count(*) into v_cnt
    from public.shipment_lines sl
    join public.shipments s on s.id = sl.shipment_id
   where sl.order_type = 'PO'
     and sl.order_line_id = old.id
     and s.status is distinct from 'cancelled';

  if v_cnt > 0 then
    raise exception '선적 화물 %건이 참조 중인 발주는 수정·취소할 수 없습니다. 먼저 해당 선적의 화물 내역에서 이 발주의 라인을 지우거나 선적을 취소하세요. (품목: %)',
      v_cnt, coalesce(old.product_name, '(이름 없음)');
  end if;
  return old;
end;
$$;

drop trigger if exists trg_po_lines_shipment_guard on public.po_lines;
create trigger trg_po_lines_shipment_guard
  before delete on public.po_lines
  for each row execute function public.fn_block_po_line_delete_with_shipment();

-- 7-b) 화물 라인이 남아 있는 주문 연결(shipment_orders)은 해제 불가.
--      ★ 반드시 **지연(DEFERRABLE INITIALLY DEFERRED)** — 잠긴 구 save_shipment 가
--        매 저장마다 주문연결을 전량 삭제·재삽입하므로, 즉시형이면 정상 저장까지
--        전부 오탐한다. 지연형은 **커밋 시점의 최종 상태**로 판정한다:
--        삭제된 (shipment_id, order_type, order_id) 가 재삽입돼 있으면 통과(전량교체),
--        정말 사라졌고 그 주문 소속 살아있는 화물 라인이 남아 있으면 거부.
create or replace function public.fn_shipment_order_unlink_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 최종 상태에 같은 연결이 재존재(새 id 로 재삽입 포함)하면 전량교체다 — 통과.
  if exists (
    select 1 from public.shipment_orders
     where shipment_id = old.shipment_id
       and order_type  = old.order_type
       and order_id    = old.order_id
  ) then
    return null;
  end if;

  if old.order_type = 'SO' and exists (
    select 1
      from public.shipment_lines sl
      join public.so_lines l on l.id = sl.order_line_id
      join public.shipments s on s.id = sl.shipment_id
     where sl.shipment_id = old.shipment_id
       and sl.order_type  = 'SO'
       and l.so_id        = old.order_id
       and s.status is distinct from 'cancelled'
  ) then
    raise exception '화물 라인이 남아 있는 주문 연결은 해제할 수 없습니다. 먼저 화물 내역에서 % 의 라인을 지우세요.',
      coalesce(old.order_number, '해당 수주');
  end if;

  if old.order_type = 'PO' and exists (
    select 1
      from public.shipment_lines sl
      join public.po_lines l on l.id = sl.order_line_id
      join public.shipments s on s.id = sl.shipment_id
     where sl.shipment_id = old.shipment_id
       and sl.order_type  = 'PO'
       and l.po_id        = old.order_id
       and s.status is distinct from 'cancelled'
  ) then
    raise exception '화물 라인이 남아 있는 주문 연결은 해제할 수 없습니다. 먼저 화물 내역에서 % 의 라인을 지우세요.',
      coalesce(old.order_number, '해당 발주');
  end if;

  return null;
end;
$$;

drop trigger if exists trg_shipment_orders_unlink_guard on public.shipment_orders;
create constraint trigger trg_shipment_orders_unlink_guard
  after delete on public.shipment_orders
  deferrable initially deferred
  for each row execute function public.fn_shipment_order_unlink_guard();

notify pgrst, 'reload schema';

-- ── 되돌리기(rollback) ──────────────────────────────────────────────────────
--   drop trigger if exists trg_shipment_orders_unlink_guard on public.shipment_orders;
--   drop function if exists public.fn_shipment_order_unlink_guard();
--   drop trigger if exists trg_po_lines_shipment_guard on public.po_lines;
--   drop function if exists public.fn_block_po_line_delete_with_shipment();
--   drop trigger if exists trg_so_lines_shipment_guard on public.so_lines;
--   drop function if exists public.fn_block_so_line_delete_with_shipment();
--   drop function if exists public.save_shipment_cargo(uuid, jsonb, jsonb, text);
--   drop view if exists public.shipment_line_totals;
--   alter table public.shipments drop constraint if exists shipments_direction_check;
--   alter table public.shipments drop constraint if exists shipments_status_check;
--   drop index if exists public.shipments_ship_number_unique;
--   alter table public.shipments drop column if exists shipping_marks;
--   drop table if exists public.shipment_parties;
--   drop table if exists public.shipment_lines;

-- ── 8) 감사 SELECT (마지막 문장 — 이 결과표를 드래그 복사해 회신해 주세요) ────
--  ① 우리 RPC 전부의 SECURITY DEFINER 여부(prosecdef)
--  ② 주요 테이블의 anon 실효 쓰기 권한(has_table_privilege — 역할 상속까지 계산)
--  ③ 잠금 예외 3건의 적용 결과(생략됐다면 사유 수치 포함)
--  하드닝(봉인 확장) 결정은 아키텍트가 이 표를 보고 내린다 — 이 파일은 신규 2테이블만 봉인한다.
select * from (
  select 'RPC prosecdef'::text as 구분, p.proname::text as 항목, p.prosecdef::text as 값
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'next_doc_number','fn_audit',
       'save_quotation','save_sales_order','save_purchase_order','save_shipment',
       'save_shipment_cargo',
       'save_goods_receipt','cancel_goods_receipt','save_delivery','cancel_delivery',
       'save_stock_adjustment','reverse_stock_movement',
       'fn_po_apply_receipt_status','fn_so_apply_delivery_status',
       'fn_block_po_line_delete_with_receipt','fn_block_so_line_delete_with_delivery',
       'fn_block_so_line_delete_with_shipment','fn_block_po_line_delete_with_shipment',
       'fn_shipment_order_unlink_guard'
     )
  union all
  select ('anon ' || pr.priv)::text, t.tbl::text,
         has_table_privilege('anon', 'public.' || t.tbl, pr.priv)::text
    from (values
      ('shipments'),('shipment_orders'),('milestones'),
      ('shipment_lines'),('shipment_parties'),
      ('doc_counters'),('stock_movements'),
      ('goods_receipts'),('gr_lines'),('deliveries'),('delivery_lines'),
      ('audit_log'),('fx_rates'),
      ('quotations'),('quotation_items'),
      ('sales_orders'),('so_lines'),('purchase_orders'),('po_lines'),
      ('companies'),('products')
    ) t(tbl)
    cross join (values ('INSERT'),('UPDATE'),('DELETE')) pr(priv)
  union all
  select '적용 결과', 'ship_number UNIQUE 인덱스 생성됨',
         (exists(select 1 from pg_indexes
                  where schemaname = 'public'
                    and indexname = 'shipments_ship_number_unique'))::text
  union all
  select '적용 결과', 'ship_number 중복 건수(0이 정상 — 생략 사유)',
         (select count(*)::text from (
            select ship_number from public.shipments
             where ship_number is not null
             group by ship_number having count(*) > 1) d)
  union all
  select '적용 결과', 'shipments.status CHECK 생성됨',
         (exists(select 1 from pg_constraint
                  where conname = 'shipments_status_check'
                    and conrelid = 'public.shipments'::regclass))::text
  union all
  select '적용 결과', 'status 위반 행수(0이 정상 — 생략 사유)',
         (select count(*)::text from public.shipments
           where status is not null
             and status not in ('draft','booked','shipped','arrived','cancelled'))
  union all
  select '적용 결과', 'shipments.direction CHECK 생성됨',
         (exists(select 1 from pg_constraint
                  where conname = 'shipments_direction_check'
                    and conrelid = 'public.shipments'::regclass))::text
  union all
  select '적용 결과', 'direction 위반 행수(0이 정상 — 생략 사유)',
         (select count(*)::text from public.shipments
           where direction is not null and direction not in ('export','import'))
  union all
  select '적용 결과', 'shipments.shipping_marks 컬럼 존재',
         (exists(select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'shipments'
                    and column_name = 'shipping_marks'))::text
) x
order by 구분, 항목;
