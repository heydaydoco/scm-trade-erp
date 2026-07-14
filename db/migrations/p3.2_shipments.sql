-- ============================================================================
--  P3.2 — 선적 부킹(Shipment) + 마일스톤   (SPEC E1·E3·E4, 원칙 2·3·5·6, §5 무역 모델)
-- ============================================================================
--  실행: Supabase 대시보드 → SQL Editor → New query → 이 파일 전체 붙여넣기 → Run.
--  성격: 신규 테이블 3개 + RPC 1개 + 감사 트리거 1개 추가. 멱등(재실행 무해).
--
--  ⚠️ 이미 DB에 존재하는 라이브 객체는 재생성/오버로딩 금지:
--       next_doc_number(text,text,text) · save_quotation · save_sales_order · save_purchase_order
--       · fn_audit() · fx_rates · fx_rates_latest
--       · quotations/quotation_items · sales_orders/so_lines · purchase_orders/po_lines · companies
--     이 파일은 신규 객체(shipments, shipment_orders, milestones, save_shipment, 트리거)만 추가.
--
--  설계:
--   · 이번 범위 = 부킹 헤더 + 주문 M:N 연결 + 마일스톤(예정/실적). **얇게.**
--     shipment_lines(품목·수량)·shipment_parties(shipper/consignee)·금액/환율·무역서류(CI/PL)·S/I 인쇄는 P4.
--     → P3.2의 분할선적은 "주문↔선적 연결" 수준이고, **수량 배분 추적은 P4부터**(원칙 1 — 잔량 컬럼 없음).
--   · direction(export/import)은 라벨·목록필터·진입기본값일 뿐, 주문 연결을 제한하지 않는다.
--     3자무역·직송이면 한 선적에 SO(고객향)+PO(공급사발)가 동시에 걸린다. partner_id는 nullable(혼합 시 null).
--   · shipment_orders.order_id = SO/PO 어느 쪽이든 담아 order_type로 구분 → FK 아닌 소프트 포인터.
--     unique(shipment_id, order_type, order_id)로 같은 주문 중복 연결 차단.
--   · milestones = 기일엔진(P3.3) 원천. planned_date(예정, 실적 없음+임박)로 D-7/D-3/D-1 알림.
--   · save_sales_order 미러 원자 저장(번호+헤더+주문연결+마일스톤 한 트랜잭션, 실패 시 전부 롤백).
-- ============================================================================

-- 1) 선적 헤더 (부킹 + 일정 — 금액/품목 없음)
create table if not exists public.shipments (
  id             uuid primary key default gen_random_uuid(),
  ship_number    text,
  direction      text,                          -- 'export'/'import' (라벨·필터·기본값용, 연결 제한 아님)
  partner_id     uuid references public.companies (id),  -- 상대(수출=고객/수입=공급사). 혼합 선적이면 null
  forwarder      text,                          -- 포워더
  carrier        text,                          -- 선사/항공사
  transport      text,                          -- sea/air
  vessel_voyage  text,                          -- 선명/항차 또는 편명
  pol            text,                          -- 적출항(Port of Loading)
  pod            text,                          -- 도착항(Port of Discharge)
  booking_no     text,                          -- 포워더 부킹번호(핵심 외부 참조)
  bl_no          text,                          -- B/L 번호
  container_no   text,                          -- 컨테이너 번호(전용)
  incoterms      text,
  status         text        default 'draft',
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists shipments_partner_idx   on public.shipments (partner_id);
create index if not exists shipments_direction_idx  on public.shipments (direction);
create index if not exists shipments_date_idx        on public.shipments (created_at desc);

-- 2) 선적↔주문 M:N (분할선적 1주문→N선적, 합짐 N주문→1선적, 3자무역 SO+PO 혼합)
create table if not exists public.shipment_orders (
  id           uuid primary key default gen_random_uuid(),
  shipment_id  uuid not null references public.shipments (id) on delete cascade,
  order_type   text,                            -- 'SO'/'PO'
  order_id     uuid,                             -- 소프트 포인터(FK 아님 — SO/PO 양쪽 대응)
  order_number text                              -- 표시용 스냅샷
);
-- 같은 주문을 같은 선적에 중복 연결 차단(백스톱; 폼에서 1차 차단, save_shipment에서 친절 메시지)
create unique index if not exists shipment_orders_uniq
  on public.shipment_orders (shipment_id, order_type, order_id);
create index if not exists shipment_orders_order_idx
  on public.shipment_orders (order_type, order_id);   -- "이 주문의 선적" 역조회용

-- 3) 마일스톤 (기일엔진 P3.3 원천)
create table if not exists public.milestones (
  id           uuid primary key default gen_random_uuid(),
  shipment_id  uuid not null references public.shipments (id) on delete cascade,
  type         text,                            -- 코드테이블(서류마감·카고클로징·VGM·ETD·ETA…)
  planned_date date,                            -- 예정일(D-7/D-3/D-1 산정 기준)
  actual_date  date,                            -- 실적일(있으면 알림 종료)
  memo         text,
  sort_order   integer
);
create index if not exists milestones_shipment_idx on public.milestones (shipment_id, sort_order);
create index if not exists milestones_planned_idx  on public.milestones (planned_date);  -- 기일엔진 조회용

-- 4) 선적 저장 트랜잭션 함수 — save_sales_order 미러(번호+헤더+주문연결+마일스톤 원자)
create or replace function public.save_shipment(
  p_id         uuid,
  p_header     jsonb,
  p_orders     jsonb,
  p_milestones jsonb,
  p_period     text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid;
  v_number text;
begin
  -- 중복 연결 친절 차단(unique 제약이 최종 백스톱). 같은 (order_type, order_id)가 payload에 2번 이상이면 거부.
  if p_orders is not null and exists (
    select 1
    from jsonb_array_elements(p_orders) o
    where nullif(o->>'order_id','') is not null
    group by o->>'order_type', o->>'order_id'
    having count(*) > 1
  ) then
    raise exception '같은 주문이 한 선적에 중복으로 연결되었습니다.';
  end if;

  if p_id is null then
    v_number := next_doc_number('shipment', 'SHP', p_period);   -- 원칙 6: 공유 3-arg(오버로딩 금지)
    insert into shipments (
      ship_number, direction, partner_id, forwarder, carrier, transport,
      vessel_voyage, pol, pod, booking_no, bl_no, container_no,
      incoterms, status, notes, updated_at
    ) values (
      v_number,
      p_header->>'direction',
      nullif(p_header->>'partner_id','')::uuid,
      p_header->>'forwarder',
      p_header->>'carrier',
      p_header->>'transport',
      p_header->>'vessel_voyage',
      p_header->>'pol',
      p_header->>'pod',
      p_header->>'booking_no',
      p_header->>'bl_no',
      p_header->>'container_no',
      p_header->>'incoterms',
      p_header->>'status',
      p_header->>'notes',
      now()
    ) returning id into v_id;
  else
    v_id := p_id;
    update shipments set
      direction     = p_header->>'direction',
      partner_id    = nullif(p_header->>'partner_id','')::uuid,
      forwarder     = p_header->>'forwarder',
      carrier       = p_header->>'carrier',
      transport     = p_header->>'transport',
      vessel_voyage = p_header->>'vessel_voyage',
      pol           = p_header->>'pol',
      pod           = p_header->>'pod',
      booking_no    = p_header->>'booking_no',
      bl_no         = p_header->>'bl_no',
      container_no  = p_header->>'container_no',
      incoterms     = p_header->>'incoterms',
      status        = p_header->>'status',
      notes         = p_header->>'notes',
      updated_at    = now()
    where id = v_id;
    if not found then
      raise exception '선적을 찾을 수 없습니다: %', v_id;
    end if;
    delete from shipment_orders where shipment_id = v_id;
    delete from milestones      where shipment_id = v_id;
  end if;

  -- 주문 연결 insert (등록·수정 공통)
  insert into shipment_orders (shipment_id, order_type, order_id, order_number)
  select
    v_id,
    o->>'order_type',
    nullif(o->>'order_id','')::uuid,
    o->>'order_number'
  from jsonb_array_elements(coalesce(p_orders, '[]'::jsonb)) as o;

  -- 마일스톤 insert (등록·수정 공통)
  insert into milestones (shipment_id, type, planned_date, actual_date, memo, sort_order)
  select
    v_id,
    m->>'type',
    nullif(m->>'planned_date','')::date,
    nullif(m->>'actual_date','')::date,
    m->>'memo',
    (m->>'sort_order')::int
  from jsonb_array_elements(coalesce(p_milestones, '[]'::jsonb)) as m;

  return jsonb_build_object(
    'id', v_id,
    'ship_number', coalesce(v_number,
      (select ship_number from shipments where id = v_id))
  );
end;
$$;

-- 5) 감사 자동 상속 — P2.1 범용 트리거를 선적 헤더에 부착(태생부터 감사). 자식(주문연결·마일스톤)은 미부착(전량 교체).
drop trigger if exists trg_audit_shipments on public.shipments;
create trigger trg_audit_shipments
  after insert or update or delete on public.shipments
  for each row execute function public.fn_audit();

-- 6) 권한: 앱은 SELECT(읽기) + 저장은 RPC(save_shipment, SECURITY DEFINER)만.
grant select on public.shipments        to anon, authenticated;
grant select on public.shipment_orders  to anon, authenticated;
grant select on public.milestones       to anon, authenticated;
grant execute on function public.save_shipment(uuid, jsonb, jsonb, jsonb, text) to anon, authenticated;

-- 7) PostgREST 스키마 캐시 새로고침 — 새 RPC/테이블을 API가 즉시 인식하게 한다.
--    (없으면 "Could not find the function public.save_shipment ... in the schema cache" 발생)
notify pgrst, 'reload schema';

-- ── 검증(선택) ──────────────────────────────────────────────────────────────
--   select ship_number, direction, status from public.shipments order by created_at desc limit 5;

-- ── 되돌리기(rollback) ───────────────────────────────────────────────────────
--   drop trigger if exists trg_audit_shipments on public.shipments;
--   drop function if exists public.save_shipment(uuid, jsonb, jsonb, jsonb, text);
--   drop table if exists public.milestones;
--   drop table if exists public.shipment_orders;
--   drop table if exists public.shipments;
