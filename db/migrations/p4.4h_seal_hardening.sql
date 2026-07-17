-- ============================================================================
--  P4.4h — 구세대 봉인 하드닝 (아키텍트 확정 스펙 + 판정 회신 2026-07-17)
-- ============================================================================
--  실행: Supabase 대시보드 → SQL Editor → New query → 이 파일 전체 붙여넣기 → Run.
--  성격: 순수 추가(RPC 신설·교정) + REVOKE. 멱등(재실행 무해). 테이블 구조 무변경.
--
--  ⚠️ Run~배포 사이 몇 분간 라이브의 거래처·품목·환율·문의 저장이 일시 불가합니다
--     (봉인이 먼저 걸리고, RPC 를 호출하는 새 앱은 푸시 후 배포되므로).
--     조회·나머지 화면은 영향 없습니다.
--
--  ⚠️ Supabase SQL Editor 는 **마지막 문장 결과만** 표시한다 — 이 파일의 마지막
--     문장이 감사 SELECT 다. Run 후 결과표를 **드래그 복사해 회신**해 주세요
--     (기대값: '위반(쓰기권한 잔존)' 0행 + RPC prosecdef 전부 true).
--
--  하는 일 4가지:
--   1) RPC 신설 4종 — save_company·save_item·save_fx_rate·save_inquiry.
--      구세대 4화면(거래처·품목·환율·문의)의 직접 REST 쓰기를 대체한다.
--   2) uom 하드닝 — '클라이언트 uom 우선 채택'과 '임의 단위(PCS) 발명' 폐쇄.
--      전수 점검 결과 교정 4종: save_stock_adjustment·save_goods_receipt·
--      save_delivery·save_shipment_cargo. (역분개·취소 3종은 원행 uom 스냅샷
--      승계라 해당 없음. 문서 RPC 3종은 클라 unit 원문 저장 = 문서 원천 기록이라
--      해당 없음 — 원장 진입 시 이 파일의 서버 재해석이 공란·불일치를 거른다.)
--      규칙(P4.3f 의 서버 강제): 원천 라인 uom → products.unit → 저장 거부.
--      공란/공백 = 없음(nullif+btrim). 클라 uom 은 제공 시 일치 검사만.
--   3) 봉인 — 구세대 13개 테이블(companies·products·inquiries·quotations·
--      quotation_items·sales_orders·so_lines·purchase_orders·po_lines·
--      shipments·shipment_orders·milestones·doc_counters)의 쓰기 전면 회수
--      + fx_rates INSERT 회수(U/D 는 P4.1 기봉인) + 뷰 전체 쓰기 회수.
--      SELECT 는 전부 유지. 쓰기는 SECURITY DEFINER RPC 로만.
--   4) 고아 7종 봉인 + 인구조사 — 첫 Run 의 전면 스캔이 드러낸, 앱 참조 0건의
--      라이브 전용 테이블(claims·customs_declarations·orders·order_items·
--      payments·production_orders·shipments_legacy_20260714072446).
--      ★ 살아있는 13종과 달리 **SELECT 까지 전면 회수**(아키텍트 판정 2026-07-17):
--        anon 키는 클라이언트 공개 키라, 정체불명 데이터의 SELECT 유지는 무인증
--        공개 지속이다. DROP 은 이번 범위 제외 — 실사·처분은 백로그(인구조사가 입력).
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
--  1) RPC 신설 — save_company (거래처 저장: p_id 부재=INSERT / 존재=UPDATE)
-- ────────────────────────────────────────────────────────────────────────────
--  현행 거래처 화면(partners.ts)이 다루는 컬럼 그대로. 검증은 현행 폼 수준
--  (거래처명 필수)만 — 과잉 검증 신설 금지. 저장된 행 전체를 jsonb 로 반환.
--  company_type: null = '미분류' — UPDATE 에서 기존 분류를 보존한다(화면과 같은
--  규칙: 사용자가 의도적으로 분류를 고르기 전까지 원본을 덮어쓰지 않는다).
create or replace function public.save_company(
  p_name          text,
  p_id            uuid default null,
  p_company_type  text default null,
  p_country       text default null,
  p_city          text default null,
  p_address       text default null,
  p_contact_name  text default null,
  p_contact_email text default null,
  p_contact_phone text default null,
  p_currency      text default null,
  p_payment_terms text default null,
  p_incoterms     text default null,
  p_notes         text default null,
  p_active        boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.companies%rowtype;
begin
  if p_name is null or btrim(p_name) = '' then
    raise exception '거래처명은 필수 항목입니다.';
  end if;

  if p_id is null then
    insert into public.companies (
      company_name, company_type, country, city, address,
      contact_name, contact_email, contact_phone,
      currency, payment_terms, incoterms, notes, active, updated_at
    ) values (
      btrim(p_name),
      nullif(btrim(coalesce(p_company_type, '')), ''),
      nullif(btrim(coalesce(p_country, '')), ''),
      nullif(btrim(coalesce(p_city, '')), ''),
      nullif(btrim(coalesce(p_address, '')), ''),
      nullif(btrim(coalesce(p_contact_name, '')), ''),
      nullif(btrim(coalesce(p_contact_email, '')), ''),
      nullif(btrim(coalesce(p_contact_phone, '')), ''),
      nullif(btrim(coalesce(p_currency, '')), ''),
      nullif(btrim(coalesce(p_payment_terms, '')), ''),
      nullif(btrim(coalesce(p_incoterms, '')), ''),
      nullif(btrim(coalesce(p_notes, '')), ''),
      coalesce(p_active, true),
      now()
    )
    returning * into v_row;
  else
    update public.companies
       set company_name  = btrim(p_name),
           -- null(미분류)이면 기존 분류 보존 — 값이 온 경우에만 교체.
           company_type  = coalesce(nullif(btrim(coalesce(p_company_type, '')), ''), company_type),
           country       = nullif(btrim(coalesce(p_country, '')), ''),
           city          = nullif(btrim(coalesce(p_city, '')), ''),
           address       = nullif(btrim(coalesce(p_address, '')), ''),
           contact_name  = nullif(btrim(coalesce(p_contact_name, '')), ''),
           contact_email = nullif(btrim(coalesce(p_contact_email, '')), ''),
           contact_phone = nullif(btrim(coalesce(p_contact_phone, '')), ''),
           currency      = nullif(btrim(coalesce(p_currency, '')), ''),
           payment_terms = nullif(btrim(coalesce(p_payment_terms, '')), ''),
           incoterms     = nullif(btrim(coalesce(p_incoterms, '')), ''),
           notes         = nullif(btrim(coalesce(p_notes, '')), ''),
           active        = coalesce(p_active, active),
           updated_at    = now()
     where id = p_id
    returning * into v_row;
    if not found then
      raise exception '거래처를 찾을 수 없습니다: %', p_id;
    end if;
  end if;

  return to_jsonb(v_row);
end;
$$;

grant execute on function public.save_company(text, uuid, text, text, text, text, text, text, text, text, text, text, text, boolean) to anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
--  2) RPC 신설 — save_item (품목 저장)
-- ────────────────────────────────────────────────────────────────────────────
--  ★ unit 은 nullif(btrim(…),'') 로 정규화해 저장 — 빈 문자열('', ' ') 저장 금지.
--    uom 폴백 체인(라인 uom → products.unit)이 '' 를 유효 단위로 오인하는 구멍 차단.
--  표준단가는 폼과 같은 수준의 유한성 검사(NaN·Infinity 는 P4.1f 에서 확증된 함정).
create or replace function public.save_item(
  p_name           text,
  p_id             uuid default null,
  p_code           text default null,
  p_hs_code        text default null,
  p_unit           text default null,
  p_unit_price     numeric default null,
  p_currency       text default null,
  p_origin_country text default null,
  p_is_dangerous   boolean default false,
  p_lot_managed    boolean default false,
  p_serial_managed boolean default false,
  p_description    text default null,
  p_active         boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.products%rowtype;
begin
  if p_name is null or btrim(p_name) = '' then
    raise exception '품목명은 필수 항목입니다.';
  end if;
  if p_unit_price is not null
     and p_unit_price in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) then
    raise exception '표준단가는 숫자로 입력하세요. 받은 값: %', p_unit_price;
  end if;

  if p_id is null then
    insert into public.products (
      code, product_name, hs_code, unit, unit_price, currency,
      origin_country, is_dangerous, lot_managed, serial_managed,
      description, active, updated_at
    ) values (
      nullif(btrim(coalesce(p_code, '')), ''),
      btrim(p_name),
      nullif(btrim(coalesce(p_hs_code, '')), ''),
      nullif(btrim(coalesce(p_unit, '')), ''),          -- ★ 공란=없음(NULL) — '' 금지
      p_unit_price,
      nullif(btrim(coalesce(p_currency, '')), ''),
      nullif(btrim(coalesce(p_origin_country, '')), ''),
      coalesce(p_is_dangerous, false),
      coalesce(p_lot_managed, false),
      coalesce(p_serial_managed, false),
      nullif(btrim(coalesce(p_description, '')), ''),
      coalesce(p_active, true),
      now()
    )
    returning * into v_row;
  else
    update public.products
       set code           = nullif(btrim(coalesce(p_code, '')), ''),
           product_name   = btrim(p_name),
           hs_code        = nullif(btrim(coalesce(p_hs_code, '')), ''),
           unit           = nullif(btrim(coalesce(p_unit, '')), ''),  -- ★ 공란=없음
           unit_price     = p_unit_price,
           currency       = nullif(btrim(coalesce(p_currency, '')), ''),
           origin_country = nullif(btrim(coalesce(p_origin_country, '')), ''),
           is_dangerous   = coalesce(p_is_dangerous, false),
           lot_managed    = coalesce(p_lot_managed, false),
           serial_managed = coalesce(p_serial_managed, false),
           description    = nullif(btrim(coalesce(p_description, '')), ''),
           active         = coalesce(p_active, active),  -- null = 기존 유지(save_company 와 동일 규칙)
           updated_at     = now()
     where id = p_id
    returning * into v_row;
    if not found then
      raise exception '품목을 찾을 수 없습니다: %', p_id;
    end if;
  end if;

  return to_jsonb(v_row);
end;
$$;

grant execute on function public.save_item(text, uuid, text, text, text, numeric, text, text, boolean, boolean, boolean, text, boolean) to anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
--  3) RPC 신설 — save_fx_rate (환율 등록: 추가 전용 — UPDATE/DELETE 미제공)
-- ────────────────────────────────────────────────────────────────────────────
--  환율은 모든 금액 계산의 입력값 + 저장 후 불변(원칙 4·5) — anon 직접 INSERT 를
--  회수하고 이 RPC 로만 쌓는다(위조 환율 주입 차단). 현행 서비스(fxRates.ts)의
--  검증을 그대로 이관 + rate 양수 RAISE. 통화·환율 동시 수용(원칙 1-B).
--  ★ 100단위 고시 함정: 정규화(rate = 고시값 ÷ 고시단위)는 이제 이 함수가 유일한
--    계산 지점이다(round 6자리 — 서비스 round6 과 같은 규칙). 신규 제약 없음 —
--    기존 테이블 제약(not null)은 한국어 메시지로 표면화만 한다.
create or replace function public.save_fx_rate(
  p_base_currency  text,
  p_quote_currency text,
  p_quoted_rate    numeric,
  p_quote_unit     numeric default 1,
  p_rate_date      date default null,
  p_source         text default null,
  p_quoted_at      timestamptz default null,
  p_note           text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base  text;
  v_quote text;
  v_unit  numeric;
  v_rate  numeric;
  v_row   public.fx_rates%rowtype;
begin
  v_base := nullif(btrim(coalesce(p_base_currency, '')), '');
  if v_base is null then
    raise exception '기준통화가 비어 있습니다.';
  end if;

  v_quote := nullif(btrim(coalesce(p_quote_currency, '')), '');
  if v_quote is null then
    raise exception '대상통화를 선택하세요.';
  end if;
  if v_quote = v_base then
    raise exception '기준통화(%)는 대장에 등록할 필요가 없습니다 — 환율은 항상 1입니다.', v_base;
  end if;

  v_unit := coalesce(p_quote_unit, 1);
  if v_unit in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) or v_unit <= 0 then
    raise exception '고시단위는 0보다 큰 숫자여야 합니다.';
  end if;

  if p_quoted_rate is null
     or p_quoted_rate in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
     or p_quoted_rate <= 0 then
    raise exception '환율은 0보다 큰 숫자로 입력하세요.';
  end if;

  -- 정규화: 1단위 기준값. 예) 100엔당 905 → 9.05 (round6 — 서비스와 같은 규칙).
  v_rate := round(p_quoted_rate / v_unit, 6);
  if v_rate in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) or v_rate <= 0 then
    raise exception '정규화된 환율이 올바르지 않습니다.';
  end if;

  if p_rate_date is null then
    raise exception '고시일을 입력하세요.';
  end if;

  insert into public.fx_rates (
    base_currency, quote_currency, rate, quote_unit,
    rate_date, source, quoted_at, note
  ) values (
    v_base, v_quote, v_rate, v_unit,
    p_rate_date,
    nullif(btrim(coalesce(p_source, '')), ''),
    p_quoted_at,
    nullif(btrim(coalesce(p_note, '')), '')
  )
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

grant execute on function public.save_fx_rate(text, text, numeric, numeric, date, text, timestamptz, text) to anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
--  4) RPC 신설 — save_inquiry (문의 저장: p_id 부재=INSERT / 존재=UPDATE)
-- ────────────────────────────────────────────────────────────────────────────
--  문의는 문서 사슬의 기점(문의→견적 참조생성) — 열어두면 하류 참조 오염 경로가
--  남아 봉인 목록에 추가(판정 3). 검증은 현행 폼 수준(거래처·품목명·접수일 필수).
--  앱이 다루지 않는 컬럼(target_price 등)은 UPDATE 에서 건드리지 않는다.
create or replace function public.save_inquiry(
  p_company_id             uuid,
  p_product_name           text,
  p_inquiry_date           date,
  p_id                     uuid default null,
  p_product_id             uuid default null,
  p_hs_code                text default null,
  p_quantity               numeric default null,
  p_unit                   text default null,
  p_transport              text default null,
  p_destination_country    text default null,
  p_destination_port       text default null,
  p_destination_airport    text default null,
  p_incoterms              text default null,
  p_payment_terms          text default null,
  p_required_delivery_date date default null,
  p_sample_requested       boolean default false,
  p_nda_required           boolean default false,
  p_status                 text default 'received',
  p_notes                  text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.inquiries%rowtype;
begin
  if p_company_id is null then
    raise exception '거래처를 선택하세요.';
  end if;
  if p_product_name is null or btrim(p_product_name) = '' then
    raise exception '품목명을 입력하세요.';
  end if;
  if p_inquiry_date is null then
    raise exception '접수일을 입력하세요.';
  end if;
  if p_quantity is not null
     and (p_quantity in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
          or p_quantity < 0) then
    raise exception '수량은 0 이상 숫자로 입력하세요. 받은 값: %', p_quantity;
  end if;

  if p_id is null then
    insert into public.inquiries (
      company_id, inquiry_date, product_id, product_name, hs_code,
      quantity, unit, transport,
      destination_country, destination_port, destination_airport,
      incoterms, payment_terms, required_delivery_date,
      sample_requested, nda_required, status, notes, updated_at
    ) values (
      p_company_id,
      p_inquiry_date,
      p_product_id,
      btrim(p_product_name),
      nullif(btrim(coalesce(p_hs_code, '')), ''),
      p_quantity,
      nullif(btrim(coalesce(p_unit, '')), ''),          -- ★ 공란=없음 — uom 체인 규칙
      nullif(btrim(coalesce(p_transport, '')), ''),
      nullif(btrim(coalesce(p_destination_country, '')), ''),
      nullif(btrim(coalesce(p_destination_port, '')), ''),
      nullif(btrim(coalesce(p_destination_airport, '')), ''),
      nullif(btrim(coalesce(p_incoterms, '')), ''),
      nullif(btrim(coalesce(p_payment_terms, '')), ''),
      p_required_delivery_date,
      coalesce(p_sample_requested, false),
      coalesce(p_nda_required, false),
      coalesce(nullif(btrim(coalesce(p_status, '')), ''), 'received'),
      nullif(btrim(coalesce(p_notes, '')), ''),
      now()
    )
    returning * into v_row;
  else
    update public.inquiries
       set company_id             = p_company_id,
           inquiry_date           = p_inquiry_date,
           product_id             = p_product_id,
           product_name           = btrim(p_product_name),
           hs_code                = nullif(btrim(coalesce(p_hs_code, '')), ''),
           quantity               = p_quantity,
           unit                   = nullif(btrim(coalesce(p_unit, '')), ''),
           transport              = nullif(btrim(coalesce(p_transport, '')), ''),
           destination_country    = nullif(btrim(coalesce(p_destination_country, '')), ''),
           destination_port       = nullif(btrim(coalesce(p_destination_port, '')), ''),
           destination_airport    = nullif(btrim(coalesce(p_destination_airport, '')), ''),
           incoterms              = nullif(btrim(coalesce(p_incoterms, '')), ''),
           payment_terms          = nullif(btrim(coalesce(p_payment_terms, '')), ''),
           required_delivery_date = p_required_delivery_date,
           sample_requested       = coalesce(p_sample_requested, false),
           nda_required           = coalesce(p_nda_required, false),
           status                 = coalesce(nullif(btrim(coalesce(p_status, '')), ''), 'received'),
           notes                  = nullif(btrim(coalesce(p_notes, '')), ''),
           updated_at             = now()
     where id = p_id
    returning * into v_row;
    if not found then
      raise exception '문의를 찾을 수 없습니다: %', p_id;
    end if;
  end if;

  return to_jsonb(v_row);
end;
$$;

grant execute on function public.save_inquiry(uuid, text, date, uuid, uuid, text, numeric, text, text, text, text, text, text, text, date, boolean, boolean, text, text) to anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
--  5) uom 하드닝 ① — save_stock_adjustment (원천 라인 없음)
-- ────────────────────────────────────────────────────────────────────────────
--  coalesce(products.unit,'PCS') 제거 → 입력 unit → products.unit → 저장 거부.
--  ★ 시그니처에 p_uom(기본 null)을 추가한다 — CREATE OR REPLACE 는 인자 추가를
--    못 하므로(오버로드가 생겨 PostgREST 호출이 모호해짐) 구 시그니처를 drop 후
--    재생성한다. 앱 호출(명명 인자 7개)은 무변경으로 호환된다.
--  (잠긴 RPC 수정 — P4.4h 스펙이 아키텍트 명시 승인이다.)
drop function if exists public.save_stock_adjustment(uuid, text, numeric, text, text, date, text);

create or replace function public.save_stock_adjustment(
  p_item_id        uuid,
  p_movement_type  text,
  p_qty            numeric,
  p_warehouse_code text default 'MAIN',
  p_lot_no         text default null,
  p_moved_at       date default null,
  p_memo           text default null,
  p_uom            text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_master text;
  v_name   text;
  v_uom    text;
  v_qty    numeric;
  v_id     uuid;
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

  -- ★ P4.4h 단위 하드닝: 입력 unit → products.unit → 저장 거부('PCS' 발명 금지).
  --   공란/공백 = 없음(nullif+btrim) — '' 가 유효 단위로 오인되지 않게.
  select nullif(btrim(unit), ''), product_name into v_master, v_name
    from public.products where id = p_item_id;
  if not found then
    raise exception '품목을 찾을 수 없습니다: %', p_item_id;
  end if;
  v_uom := coalesce(nullif(btrim(coalesce(p_uom, '')), ''), v_master);
  if v_uom is null then
    raise exception '단위를 알 수 없어 저장할 수 없습니다: % — 입력 단위가 없고 품목 마스터에도 단위가 없습니다. 품목 마스터에서 단위를 입력한 뒤 다시 시도하세요.',
      coalesce(nullif(btrim(coalesce(v_name, '')), ''), p_item_id::text);
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

grant execute on function public.save_stock_adjustment(uuid, text, numeric, text, text, date, text, text) to anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
--  6) uom 하드닝 ② — save_goods_receipt (원천 라인 = 발주 라인)
-- ────────────────────────────────────────────────────────────────────────────
--  변경점은 단위 블록뿐: 클라 uom 우선 채택 + 'PCS' 폴백 →
--  서버 재해석(발주 라인 uom → products.unit → 거부) + 클라 uom 일치 검사.
--  나머지 본문은 P4.2f 확정본 그대로(결속·세대 도장·역분개 로직 무변경).
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
  v_master    text;
  v_client_uom text;
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

    -- ★ P4.4h 단위 하드닝(P4.3f 의 서버 강제): 발주 라인 uom → products.unit → 거부.
    --   클라 uom 은 채택하지 않는다 — 제공 시 재해석 결과와 일치해야 하며 불일치면 거부.
    --   공란/공백 = 없음(nullif+btrim).
    select nullif(btrim(unit), '') into v_master from public.products where id = v_item;
    if not found then
      raise exception '품목을 찾을 수 없습니다: % (%번째 줄)', v_item, v_no;
    end if;
    v_uom := coalesce(nullif(btrim(v_po_line.unit), ''), v_master);
    if v_uom is null then
      raise exception '단위를 알 수 없어 저장할 수 없습니다: % — 발주 라인과 품목 마스터 어디에도 단위가 없습니다. 품목 마스터에서 단위를 입력한 뒤 다시 시도하세요. (%번째 줄)',
        coalesce(v_po_line.product_name, '(이름 없음)'), v_no;
    end if;
    v_client_uom := nullif(btrim(coalesce(v_line->>'uom', '')), '');
    if v_client_uom is not null and v_client_uom <> v_uom then
      raise exception '보낸 단위(%)가 서버 해석 단위(%)와 다릅니다 — 화면을 새로고침한 뒤 다시 시도하세요. (%번째 줄: %)',
        v_client_uom, v_uom, v_no, coalesce(v_po_line.product_name, '(이름 없음)');
    end if;

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

-- ────────────────────────────────────────────────────────────────────────────
--  7) uom 하드닝 ③ — save_delivery (원천 라인 = 수주 라인)
-- ────────────────────────────────────────────────────────────────────────────
--  변경점은 단위 블록뿐(입고와 동일한 교정). 나머지 본문은 P4.3 확정본 그대로.
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
  v_master     text;
  v_client_uom text;
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

    -- ★ P4.4h 단위 하드닝(P4.3f 의 서버 강제): 수주 라인 uom → products.unit → 거부.
    --   클라 uom 은 채택하지 않는다 — 제공 시 재해석 결과와 일치해야 하며 불일치면 거부.
    select nullif(btrim(unit), '') into v_master from public.products where id = v_item;
    if not found then
      raise exception '품목을 찾을 수 없습니다: % (%번째 줄)', v_item, v_no;
    end if;
    v_uom := coalesce(nullif(btrim(v_so_line.unit), ''), v_master);
    if v_uom is null then
      raise exception '단위를 알 수 없어 저장할 수 없습니다: % — 수주 라인과 품목 마스터 어디에도 단위가 없습니다. 품목 마스터에서 단위를 입력한 뒤 다시 시도하세요. (%번째 줄)',
        coalesce(v_so_line.product_name, '(이름 없음)'), v_no;
    end if;
    v_client_uom := nullif(btrim(coalesce(v_line->>'uom', '')), '');
    if v_client_uom is not null and v_client_uom <> v_uom then
      raise exception '보낸 단위(%)가 서버 해석 단위(%)와 다릅니다 — 화면을 새로고침한 뒤 다시 시도하세요. (%번째 줄: %)',
        v_client_uom, v_uom, v_no, coalesce(v_so_line.product_name, '(이름 없음)');
    end if;

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

-- ────────────────────────────────────────────────────────────────────────────
--  8) uom 하드닝 ④ — save_shipment_cargo (원천 라인 = 수주/발주 라인)
-- ────────────────────────────────────────────────────────────────────────────
--  P4.4 는 공란만 거부했고 클라 uom 값 자체는 검증 없이 채택했다 → 서버 재해석
--  (주문 라인 uom → products.unit → 거부) + 클라 uom 일치 검사로 격상.
--  단위 검사를 주문 라인 검증 **뒤로** 옮긴다 — 연결 오류가 단위 오류보다 먼저
--  (서비스 uomResolution 이 요구하던 순서 — 오진 메시지 제거). 나머지 무변경.
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
  v_client_uom text;
  v_line_unit  text;
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
      v_line_unit := v_so.unit;
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
      v_line_unit := v_po.unit;
    end if;

    -- ★ P4.4h 단위 하드닝(P4.3f 의 서버 강제): 주문 라인 uom → products.unit → 거부.
    --   클라 uom 은 채택하지 않는다 — 제공 시 재해석 결과와 일치해야 하며 불일치면 거부.
    --   공란/공백 = 없음(nullif+btrim). 품목 미연결 라인은 주문 라인 단위만 본다.
    v_uom := nullif(btrim(coalesce(v_line_unit, '')), '');
    if v_uom is null and v_item is not null then
      select nullif(btrim(unit), '') into v_uom from public.products where id = v_item;
    end if;
    if v_uom is null then
      raise exception '단위를 알 수 없어 저장할 수 없습니다: % — 주문 라인과 품목 마스터 어디에도 단위가 없습니다. 품목 마스터에서 단위를 입력한 뒤 다시 시도하세요. (%번째 줄)',
        v_name, v_no;
    end if;
    v_client_uom := nullif(btrim(coalesce(v_line->>'uom', '')), '');
    if v_client_uom is not null and v_client_uom <> v_uom then
      raise exception '보낸 단위(%)가 서버 해석 단위(%)와 다릅니다 — 화면을 새로고침한 뒤 다시 시도하세요. (%번째 줄: %)',
        v_client_uom, v_uom, v_no, v_name;
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

-- ────────────────────────────────────────────────────────────────────────────
--  9) 봉인 — 구세대 13개 테이블 쓰기 전면 회수 + fx_rates INSERT 회수
-- ────────────────────────────────────────────────────────────────────────────
--  Supabase 는 public 스키마에 `alter default privileges … grant all` 을 걸어둔다.
--  → "부여하지 않음"으로는 못 막는다. 반드시 명시적 REVOKE 여야 한다(P4.1 확증).
--  SELECT 는 전부 유지. 쓰기는 위/기존 SECURITY DEFINER RPC 로만.
revoke all on public.companies        from anon, authenticated;
revoke all on public.products         from anon, authenticated;
revoke all on public.inquiries        from anon, authenticated;
revoke all on public.quotations       from anon, authenticated;
revoke all on public.quotation_items  from anon, authenticated;
revoke all on public.sales_orders     from anon, authenticated;
revoke all on public.so_lines         from anon, authenticated;
revoke all on public.purchase_orders  from anon, authenticated;
revoke all on public.po_lines         from anon, authenticated;
revoke all on public.shipments        from anon, authenticated;
revoke all on public.shipment_orders  from anon, authenticated;
revoke all on public.milestones       from anon, authenticated;
revoke all on public.doc_counters     from anon, authenticated;
-- fx_rates: INSERT 까지 회수(U/D/T 는 P4.1 기봉인) — 쓰기는 save_fx_rate 로만.
revoke all on public.fx_rates         from anon, authenticated;

grant select on public.companies        to anon, authenticated;
grant select on public.products         to anon, authenticated;
grant select on public.inquiries        to anon, authenticated;
grant select on public.quotations       to anon, authenticated;
grant select on public.quotation_items  to anon, authenticated;
grant select on public.sales_orders     to anon, authenticated;
grant select on public.so_lines         to anon, authenticated;
grant select on public.purchase_orders  to anon, authenticated;
grant select on public.po_lines         to anon, authenticated;
grant select on public.shipments        to anon, authenticated;
grant select on public.shipment_orders  to anon, authenticated;
grant select on public.milestones       to anon, authenticated;
grant select on public.doc_counters     to anon, authenticated;
grant select on public.fx_rates         to anon, authenticated;

--  뷰 전체 쓰기 회수 — 감사표 '위반 0행' 기대값을 실제로 만들기 위한 마감재.
--  뷰는 이 앱의 쓰기 대상이 아닌데도 Supabase 기본권한이 INSERT/UPDATE/DELETE 를
--  뿌린다(단순 뷰는 자동 갱신 가능이라 이론상 우회 경로도 된다). 동적으로 전부
--  회수해 라이브에만 존재하는 뷰까지 덮는다(SELECT 는 유지 — 순수 REVOKE, 멱등).
--  ⚠️ information_schema.views 는 materialized view 를 누락한다 — 아래 감사 스캔과
--     같은 기준(pg_class relkind 'v'·'m')으로 돌아야 스윕과 스캔이 어긋나지 않는다.
do $$
declare
  v record;
begin
  for v in
    select cls.relname
      from pg_class cls
      join pg_namespace n on n.oid = cls.relnamespace
     where n.nspname = 'public' and cls.relkind in ('v', 'm')
  loop
    execute format(
      'revoke insert, update, delete on public.%I from anon, authenticated',
      v.relname
    );
  end loop;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
--  9-b) 고아 7종 봉인 — SELECT 까지 전면 회수 (아키텍트 판정 2)
-- ────────────────────────────────────────────────────────────────────────────
--  앱 코드 참조 0건(전수 grep 확인)인 라이브 전용 테이블. ★ 살아있는 13종과
--  의도적으로 다른 처분이다: 13종은 화면이 읽으므로 SELECT 유지, 고아 7종은
--  읽을 화면 자체가 없고 anon 키가 클라이언트 공개 키라 SELECT 유지 = 정체불명
--  데이터의 무인증 공개 지속 → PUBLIC 포함 전면 회수(service_role 은 불변 —
--  실사·처분은 백로그 "고아 7종 실사·처분", 아래 10) 인구조사가 그 입력 자료).
--  존재 가드(to_regclass): 빈 DB 재구축(000→p4.4h)에는 이 테이블들이 없으므로
--  무해하게 지나간다. REVOKE 는 멱등 — 재실행 무해.
do $$
declare
  t text;
begin
  foreach t in array array[
    'claims', 'customs_declarations', 'orders', 'order_items',
    'payments', 'production_orders', 'shipments_legacy_20260714072446'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke all on public.%I from public, anon, authenticated', t);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

-- ── 되돌리기(rollback) — 권장 안 함(봉인 해제 + RPC 제거) ────────────────────
--   drop function if exists public.save_company(text, uuid, text, text, text, text, text, text, text, text, text, text, text, boolean);
--   drop function if exists public.save_item(text, uuid, text, text, text, numeric, text, text, boolean, boolean, boolean, text, boolean);
--   drop function if exists public.save_fx_rate(text, text, numeric, numeric, date, text, timestamptz, text);
--   drop function if exists public.save_inquiry(uuid, text, date, uuid, uuid, text, numeric, text, text, text, text, text, text, text, date, boolean, boolean, text, text);
--   -- save_stock_adjustment 는 p4.1f 본으로 재생성해야 한다(구 시그니처 drop 됨).
--   -- save_goods_receipt/save_delivery/save_shipment_cargo 는 p4.2f/p4.3/p4.4 본 재실행.
--   -- 봉인 해제(비권장): grant insert, update, delete on public.<테이블> to anon, authenticated;

-- ── 10) 감사 SELECT (마지막 문장 — 이 결과표를 드래그 복사해 회신해 주세요) ───
--  ① 전면 스캔: public 스키마의 모든 테이블·뷰 × anon/authenticated × I/U/D 중
--     권한이 true 로 남은 행만 출력 — **기대값 0행** (알려진 목록 나열 검사 아님).
--  ② 스캔 요약: 스캔한 객체 총수·조합수·위반 건수 — 위반 0행이 "스캔 실패"가
--     아니라 "전부 봉인됨"임을 수치로 증명한다(공허통과 방지).
--  ③ RPC prosecdef: 신설 4종 포함 전체 RPC 의 SECURITY DEFINER 여부 — 전부 true.
--  ④ 적용 결과: 신설 RPC 4종 존재 + save_stock_adjustment 오버로드 1개(모호성 없음).
--  ⑤ 고아 인구조사: 7종 각각 존재 여부·정확 행수(미존재 = 'absent') — DROP 판정의
--     입력 자료(백로그 "고아 7종 실사·처분"). 빈 DB 재구축에서는 전부 'absent'.
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
         'true'::text as 값
    from viol v
  union all
  select '스캔 요약', 'public 테이블·뷰 총수(0이면 스캔 실패)', count(*)::text from scan
  union all
  select '스캔 요약', '검사한 (객체×롤×권한) 조합수', (count(*) * 6)::text from scan
  union all
  select '스캔 요약', '위반 건수(0이 정상)', count(*)::text from viol
  union all
  select 'RPC prosecdef', p.proname::text, p.prosecdef::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'next_doc_number','fn_audit',
       'save_quotation','save_sales_order','save_purchase_order','save_shipment',
       'save_shipment_cargo',
       'save_goods_receipt','cancel_goods_receipt','save_delivery','cancel_delivery',
       'save_stock_adjustment','reverse_stock_movement',
       'save_company','save_item','save_fx_rate','save_inquiry',
       'fn_po_apply_receipt_status','fn_so_apply_delivery_status',
       'fn_block_po_line_delete_with_receipt','fn_block_so_line_delete_with_delivery',
       'fn_block_so_line_delete_with_shipment','fn_block_po_line_delete_with_shipment',
       'fn_shipment_order_unlink_guard'
     )
  union all
  select '적용 결과', '신설 RPC 4종 존재(4가 정상)',
         (select count(*)::text from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in ('save_company','save_item','save_fx_rate','save_inquiry'))
  union all
  select '적용 결과', 'save_stock_adjustment 오버로드 수(1이 정상 — 2면 모호성)',
         (select count(*)::text from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'save_stock_adjustment')
  union all
  -- 고아 인구조사 — count(*) 는 존재할 때만 실행된다(CASE 지연 평가 + query_to_xml
  -- 동적 SQL: 미존재 테이블을 정적으로 참조하면 파싱 단계에서 죽기 때문).
  select '고아 인구조사', o.tbl::text,
         case
           when to_regclass('public.' || o.tbl) is null then 'absent'
           else coalesce(
             (xpath('/row/cnt/text()',
                    query_to_xml(
                      format('select count(*) as cnt from %s',
                             to_regclass('public.' || o.tbl)),
                      false, true, '')))[1]::text,
             '0')
         end
    from (values
      ('claims'), ('customs_declarations'), ('orders'), ('order_items'),
      ('payments'), ('production_orders'), ('shipments_legacy_20260714072446')
    ) o(tbl)
) x
order by 구분, 항목;
