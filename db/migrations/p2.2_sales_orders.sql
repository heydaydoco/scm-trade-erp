-- ============================================================================
--  P2.2 — 수주(Sales Order) + 주문확인서   (SPEC B3, 원칙 2·3·5·6, §5 sales_orders 모델)
-- ============================================================================
--  실행: Supabase 대시보드 → SQL Editor → New query → 이 파일 전체 붙여넣기 → Run.
--  성격: 신규 테이블 2개 + RPC 1개 + 감사 트리거 1개 추가. 멱등(재실행 무해).
--
--  ⚠️ 이미 DB에 존재하는 라이브 객체는 재생성/오버로딩 금지:
--       next_doc_number(text,text,text) · save_quotation(...) · fn_audit()
--       · quotations · quotation_items · companies
--     이 파일은 신규 객체(sales_orders, so_lines, save_sales_order, 트리거)만 추가.
--
--  설계(앞선 다중에이전트 P2 설계 결정):
--   · save_quotation(p1.5)을 그대로 미러 — 같은 3-arg next_doc_number('sales_order','SO',period).
--   · 잔량/출고수량은 컬럼으로 저장하지 않음(원칙 1) — Delivery(P4)에서 Σ로 파생.
--   · ref_quotation_id = 참조 출처(견적). 견적은 삭제 안 되므로(원칙 5) 소프트 포인터로 충분.
--   · ref_quotation_line_id = FK 아님(견적 재저장 시 quotation_items 하드삭제로 FK가 깨짐 → 스냅샷 포인터).
--   · exchange_rate = 확정시점 스냅샷(원칙 1-B). fx_source/fx_quoted_at는 P2.3 환율대장 연결용(지금 null).
-- ============================================================================

-- 1) 수주 헤더 (견적 헤더 미러 + 수주 고유 필드)
create table if not exists public.sales_orders (
  id                      uuid primary key default gen_random_uuid(),
  so_number               text,
  ref_quotation_id        uuid,                       -- 참조생성 출처(견적). 소프트 포인터
  partner_id              uuid references public.companies (id),  -- PostgREST 임베드용 명시적 FK
  order_date              date,
  requested_delivery_date date,
  currency                text,
  exchange_rate           numeric      default 1,     -- 원칙 1-B: 확정시점 고정
  fx_source               text,                        -- P2.3용(지금 null)
  fx_quoted_at            timestamptz,                 -- P2.3용(지금 null)
  incoterms               text,
  payment_terms           text,
  destination_country     text,
  destination_port        text,
  destination_airport     text,
  transport               text,
  subtotal                numeric      default 0,      -- 표시·인쇄용 스냅샷(진실은 라인, 원칙 2)
  discount                numeric      default 0,
  total_amount            numeric      default 0,
  status                  text         default 'draft',
  notes                   text,
  terms_conditions        text,
  created_at              timestamptz  not null default now(),
  updated_at              timestamptz  not null default now()
);
create index if not exists sales_orders_partner_idx      on public.sales_orders (partner_id);
create index if not exists sales_orders_ref_quotation_idx on public.sales_orders (ref_quotation_id);
create index if not exists sales_orders_date_idx          on public.sales_orders (order_date desc);

-- 2) 수주 라인 (견적 라인 미러 + ref_quotation_line_id)
create table if not exists public.so_lines (
  id                    uuid primary key default gen_random_uuid(),
  so_id                 uuid not null references public.sales_orders (id) on delete cascade,
  product_id            uuid,                          -- 품목 소프트 링크
  product_name          text,
  hs_code               text,
  description           text,
  quantity              numeric,
  unit                  text,
  unit_price            numeric,
  amount                numeric,
  ref_quotation_line_id uuid,                          -- FK 아님(스냅샷 포인터)
  sort_order            integer
);
create index if not exists so_lines_so_idx on public.so_lines (so_id, sort_order);

-- 3) 수주 저장 트랜잭션 함수 — save_quotation 미러(번호발번+헤더+라인 원자, 실패 시 전부 롤백)
create or replace function public.save_sales_order(
  p_id     uuid,
  p_header jsonb,
  p_lines  jsonb,
  p_period text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid;
  v_number text;
begin
  if p_id is null then
    v_number := next_doc_number('sales_order', 'SO', p_period);   -- 원칙 6: 공유 3-arg(오버로딩 금지)
    insert into sales_orders (
      so_number, ref_quotation_id, partner_id, order_date, requested_delivery_date,
      currency, exchange_rate, fx_source, fx_quoted_at, incoterms, payment_terms,
      destination_country, destination_port, destination_airport, transport,
      subtotal, discount, total_amount, status, notes, terms_conditions, updated_at
    ) values (
      v_number,
      nullif(p_header->>'ref_quotation_id','')::uuid,
      nullif(p_header->>'partner_id','')::uuid,
      nullif(p_header->>'order_date','')::date,
      nullif(p_header->>'requested_delivery_date','')::date,
      p_header->>'currency',
      coalesce((p_header->>'exchange_rate')::numeric, 1),
      p_header->>'fx_source',
      nullif(p_header->>'fx_quoted_at','')::timestamptz,
      p_header->>'incoterms',
      p_header->>'payment_terms',
      p_header->>'destination_country',
      p_header->>'destination_port',
      p_header->>'destination_airport',
      p_header->>'transport',
      (p_header->>'subtotal')::numeric,
      (p_header->>'discount')::numeric,
      (p_header->>'total_amount')::numeric,
      p_header->>'status',
      p_header->>'notes',
      p_header->>'terms_conditions',
      now()
    ) returning id into v_id;
  else
    v_id := p_id;
    update sales_orders set
      ref_quotation_id        = nullif(p_header->>'ref_quotation_id','')::uuid,
      partner_id              = nullif(p_header->>'partner_id','')::uuid,
      order_date              = nullif(p_header->>'order_date','')::date,
      requested_delivery_date = nullif(p_header->>'requested_delivery_date','')::date,
      currency                = p_header->>'currency',
      exchange_rate           = coalesce((p_header->>'exchange_rate')::numeric, 1),
      fx_source               = p_header->>'fx_source',
      fx_quoted_at            = nullif(p_header->>'fx_quoted_at','')::timestamptz,
      incoterms               = p_header->>'incoterms',
      payment_terms           = p_header->>'payment_terms',
      destination_country     = p_header->>'destination_country',
      destination_port        = p_header->>'destination_port',
      destination_airport     = p_header->>'destination_airport',
      transport               = p_header->>'transport',
      subtotal                = (p_header->>'subtotal')::numeric,
      discount                = (p_header->>'discount')::numeric,
      total_amount            = (p_header->>'total_amount')::numeric,
      status                  = p_header->>'status',
      notes                   = p_header->>'notes',
      terms_conditions        = p_header->>'terms_conditions',
      updated_at              = now()
    where id = v_id;
    if not found then
      raise exception '수주를 찾을 수 없습니다: %', v_id;
    end if;
    delete from so_lines where so_id = v_id;
  end if;

  -- 라인 insert (등록·수정 공통)
  insert into so_lines (
    so_id, product_id, product_name, hs_code, description,
    quantity, unit, unit_price, amount, ref_quotation_line_id, sort_order
  )
  select
    v_id,
    nullif(l->>'product_id','')::uuid,
    l->>'product_name',
    l->>'hs_code',
    l->>'description',
    (l->>'quantity')::numeric,
    l->>'unit',
    (l->>'unit_price')::numeric,
    (l->>'amount')::numeric,
    nullif(l->>'ref_quotation_line_id','')::uuid,
    (l->>'sort_order')::int
  from jsonb_array_elements(p_lines) as l;

  return jsonb_build_object(
    'id', v_id,
    'so_number', coalesce(v_number,
      (select so_number from sales_orders where id = v_id))
  );
end;
$$;

-- 4) 감사 자동 상속 — P2.1 범용 트리거를 수주 헤더에 부착(코드 0줄, 태생부터 감사). so_lines는 미부착(라인 전량 교체).
drop trigger if exists trg_audit_sales_orders on public.sales_orders;
create trigger trg_audit_sales_orders
  after insert or update or delete on public.sales_orders
  for each row execute function public.fn_audit();

-- 5) 권한: 앱은 SELECT(읽기) + 저장은 RPC(save_sales_order, SECURITY DEFINER)만. 직접 위조 쓰기 불가.
grant select on public.sales_orders to anon, authenticated;
grant select on public.so_lines    to anon, authenticated;
grant execute on function public.save_sales_order(uuid, jsonb, jsonb, text) to anon, authenticated;

-- 6) PostgREST 스키마 캐시 새로고침 — 새 RPC를 API가 즉시 인식하게 한다.
--    (없으면 "Could not find the function public.save_sales_order ... in the schema cache" 발생)
notify pgrst, 'reload schema';

-- ── 검증(선택) ──────────────────────────────────────────────────────────────
--   select so_number, status, total_amount from public.sales_orders order by created_at desc limit 5;

-- ── 되돌리기(rollback) ───────────────────────────────────────────────────────
--   drop trigger if exists trg_audit_sales_orders on public.sales_orders;
--   drop function if exists public.save_sales_order(uuid, jsonb, jsonb, text);
--   drop table if exists public.so_lines;
--   drop table if exists public.sales_orders;
