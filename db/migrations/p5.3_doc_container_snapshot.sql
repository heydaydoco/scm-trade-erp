-- ============================================================================
--  P5.3 — CI/PL 적입 스냅샷 (containers_snapshot) + 발행 RPC 본문 교체
-- ============================================================================
--  아키텍트 확정 스펙(P5.3) + 스펙 개정 1호(판정 ①·②) 반영. 재해석 금지.
--
--  · P1: save_trade_document 는 **CREATE OR REPLACE 단독**. DROP 금지.
--        시그니처 6인자 무변경 · grant 무접촉 · 신규 테이블 0 · 신규 RPC 0
--        → 봉인 기준선 객체 총수 **34 불변**.
--  · P2: 스냅샷 스코프 = **문서 포함 라인 기준**. '이 문서에 포함된 라인'에 배분이
--        1건 이상 걸린 컨테이너만 담고, 각 컨테이너에는 그 문서 라인의 배분만 담는다.
--        배분 0건·타 라인만 배분된 컨테이너는 제외 — 혼합 선적에서 타 고객 물량
--        정보가 상대 문서로 새는 경로를 원천 차단한다. S/I(라이브)는 전량 표시 유지.
--  · P3: 발행 스냅샷 = **발행 시점 사실의 동결**(서버측 할인 배분과 같은 계보).
--        RPC 가 문서 스코프 파생 수치까지 계산해 저장하고 인쇄는 계산 0·읽기만 한다.
--        P5.2 판정 ④(파생 저장 금지)는 **라이브 테이블·화면 규율**로 그대로 유지 —
--        발행 스냅샷은 그 위반이 아니라 별개 계보다(SPEC v3.0 에 경계 문장 명문화).
--  · D1·D2: `trade_documents.containers_snapshot jsonb` 1개 신설. **NULL 허용·
--        default 없음** — 3상태를 만든다:
--          NULL       = P5.3 이전 발행(헤더는 container_no 스칼라 폴백)
--          빈 구조    = 적입 스코프 0건으로 발행(폴백 금지·섹션 생략)
--          값         = 적입 있음
--        신규 발행은 이 RPC 가 **항상 객체를 기록**한다.
--  · D6: 적입 2테이블 발행잠금 **비승격**(P5.2 '화인 동급' 판정 계승) — 이 파일은
--        트리거를 만들지도 고치지도 않는다.
--  · D9: `trade_documents.container_no` 스칼라는 **사장 계보 유지**. 이 RPC 는
--        스칼라에 적입에서 온 **신규 값을 주입하지 않는다**(아래 ⑵-c 참조).
--
--  ⚠️ 반올림(판정 ①): 비례 몫의 의미론 = **몫의 참값** 기준 half away from zero ·
--     소수 6자리 · 비음수 도메인. TS(containerLogic)·SQL 양측이 이 의미론을
--     **정확 십진(정수 스케일) 산술**로 구현해 동치를 달성한다.
--     여기서는 `round(a*b/c, 6)` 을 쓰지 않는다 — PG numeric 나눗셈은 결과 스케일을
--     select_div_scale() 로 **골라 반올림**하므로 중간 스케일이 결과를 오염할 수 있다.
--     대신 분자를 10^6 배해 정수 몫으로 떨어뜨린다:
--         div(v*p*10^6*2 + w, w*2) * 0.000001
--     = trunc(v*p*10^6/w + 1/2) — 비음수 도메인에서 floor 와 같고, 곱셈·덧셈은
--     numeric 에서 무손실이며 div() 는 정확 절단이다. 나눗셈이 한 번도 근사되지 않는다.
--     동치 계약(픽스처)은 `src/services/containerLogic.test.ts` ⑥·⑦ 이 성문화한다.
--
--  실행: Supabase 대시보드 → SQL Editor → New query → 붙여넣기 → Run.
--  성격: 순수 추가(컬럼 1개 + 기존 RPC 본문 교체) · 멱등
--        (add column if not exists / create or replace). 기존 객체 무수정.
--
--  ⚠️ 실행 전제(P5.2 종결 기준선 · 헤더 명시 방식):
--     · public 테이블·뷰 총수 **34** · 봉인 위반 0행
--     · `save_trade_document(uuid,uuid,text,date,jsonb,jsonb)` 실존 · 오버로드 1
--     · `trade_documents.containers_snapshot` **부재**(있어도 add column if not
--       exists 로 무해 — 재실행 안전)
--     · `shipment_containers` · `shipment_container_allocations` 실존
--  ⚠️ 맨 끝 감사 SELECT 가 이 파일의 마지막 문장 — 결과표 전체를 드래그 복사해 회신한다.
--     기대: 위반 0행 · 객체 총수 **34(변동 0)** · prosecdef true ·
--           containers_snapshot present(jsonb·nullable·default 없음) ·
--           save_trade_document 오버로드 1.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) 컬럼 신설 — containers_snapshot (D1·D2)
-- ----------------------------------------------------------------------------
--  NOT NULL 도 default 도 주지 않는다. 기존 행이 NULL 로 남아야 "P5.3 이전 발행"이
--  식별된다(default '[]' 를 주면 기발행분과 '적입 0건 발행'이 구분 불가능해진다).
alter table public.trade_documents
  add column if not exists containers_snapshot jsonb;

comment on column public.trade_documents.containers_snapshot is
  'P5.3 적입 스냅샷(문서 스코프). NULL=P5.3 이전 발행 / {"containers":[],...}=적입 0건 / 값=적입 있음. 발행 시 동결, 이후 불변.';

-- ----------------------------------------------------------------------------
-- 2) RPC 본문 교체 — save_trade_document (시그니처 무변경, CREATE OR REPLACE 단독)
-- ----------------------------------------------------------------------------
--  P4.5 원본 대비 변경점은 아래 3곳뿐이다(기존 로직 diff 최소 원칙):
--   ⑵-a  선언부에 v_doc_lines · v_containers · v_ctn_totals · v_snapshot 추가
--   ⑵-b  총액 확정 직후 '적입 스냅샷(문서 스코프)' 블록 신설
--   ⑵-c  헤더 INSERT 에 containers_snapshot 컬럼·값 1개 추가
--        (container_no 스칼라 대입 줄은 **손대지 않았다** — 사장 계보 유지.
--         그 값은 shipments 의 레거시 잔존값이지 적입에서 온 신규 값이 아니다.)
--  나머지 검증·재계산·발번·라인 삽입 로직은 P4.5 원문 그대로다.
create or replace function public.save_trade_document(
  p_shipment_id uuid,
  p_customer_id uuid,
  p_currency    text,
  p_issue_date  date,
  p_header      jsonb,
  p_lines       jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shipment     public.shipments%rowtype;
  v_buyer        public.companies%rowtype;
  v_sl           public.shipment_lines%rowtype;
  v_ol           public.so_lines%rowtype;
  v_prod         public.products%rowtype;
  v_seller       jsonb;
  v_item         record;
  v_include      boolean;
  v_sl_id        uuid;
  v_seen         uuid[] := '{}';
  v_line_no      integer := 0;
  v_zero_price   integer := 0;
  v_rows         jsonb := '[]'::jsonb;
  v_packages     jsonb := '[]'::jsonb;
  v_warnings     jsonb := '[]'::jsonb;
  v_so_ids       uuid[] := '{}';
  v_so_amounts   numeric[] := '{}';
  v_idx          integer;
  v_so_partner   uuid;
  v_so_currency  text;
  v_so_discount  numeric;
  v_so_number    text;
  v_so_total     numeric;
  v_uom          text;
  v_price        numeric;
  v_amount       numeric;
  v_nw           numeric;
  v_gw           numeric;
  v_hs           text;
  v_origin       text;
  v_desc         text;
  v_pcode        text;
  v_pname        text;
  v_subtotal     numeric := 0;
  v_discount     numeric := 0;
  v_total        numeric;
  v_date         date;
  v_period       text;
  v_no           text;
  v_dup_no       text;
  v_doc_id       uuid;
  v_currency     text;
  -- ⑵-a P5.3 적입 스냅샷용
  v_doc_lines    uuid[] := '{}';   -- 이 문서에 실제로 들어간 화물 라인 집합(P2 스코프)
  v_containers   jsonb;
  v_ctn_totals   jsonb;
  v_snapshot     jsonb;
  -- Seller 스냅샷 값
  v_s_name text; v_s_address text; v_s_country text; v_s_tel text;
  v_s_email text; v_s_brn text; v_s_bank text; v_s_account text; v_s_swift text;
  v_s_sign_name text; v_s_sign_title text;
  -- Buyer/당사자 스냅샷 값
  v_b_name text;
  v_c_name text; v_c_address text; v_c_contact text;
  v_n_name text; v_n_address text; v_n_contact text;
  -- 알려진 플레이스홀더 (src/config/company.ts 초기값 — D7 발행 거부 판정)
  v_placeholders text[] := array[
    'Your Company Co., Ltd.',
    '123 Example-ro, Gangnam-gu',
    'Seoul 06000, Republic of Korea',
    '+82-2-0000-0000',
    'sales@yourcompany.com',
    '000-00-00000'
  ];
begin
  -- ── 기본 인자 검증 ──────────────────────────────────────────────────────
  if p_shipment_id is null then
    raise exception '선적이 지정되지 않았습니다.';
  end if;
  if p_customer_id is null then
    raise exception '고객이 지정되지 않았습니다.';
  end if;
  v_currency := nullif(btrim(coalesce(p_currency, '')), '');
  if v_currency is null then
    raise exception '통화가 지정되지 않았습니다.';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception '라인 목록(p_lines)이 배열이 아닙니다.';
  end if;

  -- ── 선적 잠금 + 검증 (동시성 베이스라인: 헤더 for update) ───────────────
  select * into v_shipment
    from public.shipments
   where id = p_shipment_id
   for update;
  if not found then
    raise exception '선적을 찾을 수 없습니다.';
  end if;
  if v_shipment.status = 'cancelled' then
    raise exception '취소된 선적에는 무역서류를 발행할 수 없습니다.';
  end if;

  -- 적대검증 반영: 같은 (선적×고객×통화) 활성 문서 중복 방지 (더블클릭·재시도).
  -- 발행은 선적 헤더 락으로 직렬화되므로 이 검사는 레이스 없이 확정적이다.
  select d.doc_number into v_dup_no
    from public.trade_documents d
   where d.shipment_id = p_shipment_id
     and d.customer_id = p_customer_id
     and d.currency = v_currency
     and d.status = 'issued'
   limit 1;
  if v_dup_no is not null then
    raise exception '이 (선적×고객×통화)에는 이미 발행된 무역서류(%)가 있습니다. 먼저 취소한 후 재발행하세요.', v_dup_no;
  end if;

  -- ── Seller 검증 (D7: 플레이스홀더/공란 거부) ────────────────────────────
  v_seller := p_header->'seller';
  if v_seller is null or jsonb_typeof(v_seller) <> 'object' then
    raise exception '당사(Seller) 정보가 전달되지 않았습니다.';
  end if;

  v_s_name  := nullif(btrim(coalesce(v_seller->>'name', '')), '');
  v_s_country := nullif(btrim(coalesce(v_seller->>'country', '')), '');
  v_s_tel   := nullif(btrim(coalesce(v_seller->>'tel', '')), '');
  v_s_email := nullif(btrim(coalesce(v_seller->>'email', '')), '');
  v_s_brn   := nullif(btrim(coalesce(v_seller->>'bizRegNo', '')), '');
  v_s_bank  := nullif(btrim(coalesce(v_seller->>'bankName', '')), '');
  v_s_account := nullif(btrim(coalesce(v_seller->>'accountNo', '')), '');
  v_s_swift := nullif(btrim(coalesce(v_seller->>'swift', '')), '');
  v_s_sign_name  := nullif(btrim(coalesce(v_seller->>'signatoryName', '')), '');
  v_s_sign_title := nullif(btrim(coalesce(v_seller->>'signatoryTitle', '')), '');

  if jsonb_typeof(coalesce(v_seller->'addressLines', 'null'::jsonb)) = 'array' then
    select string_agg(t.line, e'\n' order by t.ord)
      into v_s_address
      from (select nullif(btrim(x.value), '') as line, x.ordinality as ord
              from jsonb_array_elements_text(v_seller->'addressLines')
                   with ordinality as x(value, ordinality)) t
     where t.line is not null;
  end if;

  if v_s_name is null then
    raise exception '당사(Seller) 상호가 비어 있습니다. src/config/company.ts 를 설정한 후 발행하세요.';
  end if;
  if v_s_address is null then
    raise exception '당사(Seller) 주소가 비어 있습니다. src/config/company.ts 를 설정한 후 발행하세요.';
  end if;
  if v_s_country is null then
    raise exception '당사(Seller) 국가가 비어 있습니다. src/config/company.ts 를 설정한 후 발행하세요.';
  end if;
  if v_s_tel is null and v_s_email is null then
    raise exception '당사(Seller) 연락처(전화 또는 이메일)가 비어 있습니다. src/config/company.ts 를 설정한 후 발행하세요.';
  end if;
  if v_s_brn is null then
    raise exception '당사(Seller) 사업자등록번호가 비어 있습니다. src/config/company.ts 를 설정한 후 발행하세요.';
  end if;
  if v_s_name = any(v_placeholders)
     or v_s_tel = any(v_placeholders)
     or v_s_email = any(v_placeholders)
     or v_s_brn = any(v_placeholders)
     or exists (select 1
                  from jsonb_array_elements_text(v_seller->'addressLines') x
                 where btrim(x.value) = any(v_placeholders)) then
    raise exception '당사(Seller) 정보가 플레이스홀더 상태입니다. src/config/company.ts 에 실제 값을 설정한 후 발행하세요.';
  end if;

  -- ── Buyer 검증 + 스냅샷 원천 (상호 없으면 거부 — 주소 공란은 허용) ──────
  select * into v_buyer
    from public.companies
   where id = p_customer_id;
  if not found then
    raise exception '고객 회사를 찾을 수 없습니다.';
  end if;
  v_b_name := nullif(btrim(coalesce(v_buyer.company_name, '')), '');
  if v_b_name is null then
    raise exception '고객 상호가 비어 있어 발행할 수 없습니다.';
  end if;

  -- ── Consignee / Notify 스냅샷 원천 (없으면 null 유지) ────────────────────
  select p.name, p.address, p.contact
    into v_c_name, v_c_address, v_c_contact
    from public.shipment_parties p
   where p.shipment_id = p_shipment_id and p.role = 'consignee';
  select p.name, p.address, p.contact
    into v_n_name, v_n_address, v_n_contact
    from public.shipment_parties p
   where p.shipment_id = p_shipment_id and p.role = 'notify';

  -- ── 라인 재해석·재계산 (클라 값 불신 — 보충 필드만 수용) ─────────────────
  for v_item in
    select t.val, t.ord
      from jsonb_array_elements(p_lines) with ordinality as t(val, ord)
  loop
    begin
      v_include := coalesce((v_item.val->>'include')::boolean, true);
    exception when invalid_text_representation then
      raise exception '포함 여부(include) 값이 유효하지 않습니다. (%번째 줄, 받은 값: %)', v_item.ord, v_item.val->>'include';
    end;
    continue when not v_include;

    v_sl := null; v_ol := null; v_prod := null;

    begin
      v_sl_id := nullif(btrim(coalesce(v_item.val->>'shipmentLineId', '')), '')::uuid;
    exception when invalid_text_representation then
      raise exception '화물 라인 참조(shipmentLineId)가 유효하지 않습니다. (%번째 줄, 받은 값: %)', v_item.ord, v_item.val->>'shipmentLineId';
    end;
    if v_sl_id is null then
      raise exception '화물 라인 참조가 없습니다. (%번째 줄)', v_item.ord;
    end if;
    if v_sl_id = any(v_seen) then
      raise exception '같은 화물 라인이 중복 포함되었습니다. (%번째 줄)', v_item.ord;
    end if;
    v_seen := v_seen || v_sl_id;

    select * into v_sl
      from public.shipment_lines
     where id = v_sl_id and shipment_id = p_shipment_id;
    if not found then
      raise exception '이 선적의 화물 라인을 찾을 수 없습니다. (%번째 줄)', v_item.ord;
    end if;

    -- D4: SO 연결 라인만 (수입 서류는 공급자 발행 — 우리 문서 아님)
    if v_sl.order_type <> 'SO' then
      raise exception '수입(PO) 라인은 무역서류 대상이 아닙니다. (%번째 줄, 품목: %)', v_item.ord, v_sl.item_name;
    end if;

    -- qty ≤ 0 원천 라인 자동 제외 (DB CHECK 상 발생 불가 — 방어적 필터)
    continue when v_sl.qty is null or v_sl.qty <= 0;

    -- 주문 라인 해석 (단가·스코프의 원천 — 소실 시 발명 금지, RAISE)
    if v_sl.order_line_id is null then
      raise exception '주문 라인 연결이 없어 발행할 수 없습니다. (%번째 줄, 품목: %)', v_item.ord, v_sl.item_name;
    end if;
    select * into v_ol
      from public.so_lines
     where id = v_sl.order_line_id;
    if not found then
      raise exception '주문 라인을 찾을 수 없습니다(주문 재저장으로 연결이 끊어졌을 수 있음). (%번째 줄, 품목: %)', v_item.ord, v_sl.item_name;
    end if;

    -- D4: (고객, 통화) 스코프 검증 — 라인 단위로 강제
    select so.partner_id, so.currency, so.so_number
      into v_so_partner, v_so_currency, v_so_number
      from public.sales_orders so
     where so.id = v_ol.so_id;
    if not found then
      raise exception '주문을 찾을 수 없습니다. (%번째 줄, 품목: %)', v_item.ord, v_sl.item_name;
    end if;
    if v_so_partner is distinct from p_customer_id then
      raise exception '선택한 고객의 주문 라인이 아닙니다. (%번째 줄, 주문: %)', v_item.ord, coalesce(v_so_number, v_ol.so_id::text);
    end if;
    if nullif(btrim(coalesce(v_so_currency, '')), '') is null then
      raise exception '주문에 통화가 지정되지 않아 발행할 수 없습니다. (%번째 줄, 주문: %)', v_item.ord, coalesce(v_so_number, v_ol.so_id::text);
    end if;
    if btrim(v_so_currency) <> v_currency then
      raise exception '주문 통화(%)가 문서 통화(%)와 다릅니다. (%번째 줄, 주문: %)', btrim(v_so_currency), v_currency, v_item.ord, coalesce(v_so_number, v_ol.so_id::text);
    end if;

    -- 품목 마스터 (폴백 원천 — 소프트 포인터라 없을 수 있음)
    if v_ol.product_id is not null then
      select * into v_prod
        from public.products
       where id = v_ol.product_id;
    end if;

    -- uom 체인: shipment_line.uom → order_line.unit → products.unit → RAISE (발명 금지)
    v_uom := coalesce(
      nullif(btrim(coalesce(v_sl.uom, '')), ''),
      nullif(btrim(coalesce(v_ol.unit, '')), ''),
      nullif(btrim(coalesce(v_prod.unit, '')), ''));
    if v_uom is null then
      raise exception '단위를 알 수 없어 발행할 수 없습니다. (%번째 줄, 품목: %)', v_item.ord, v_sl.item_name;
    end if;

    -- 단가: so_lines 가 계약 원천 (마스터 단가로 대체하지 않는다)
    v_price := v_ol.unit_price;
    if v_price is null
       or v_price in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
       or v_price < 0 then
      raise exception '단가를 확인할 수 없습니다. (%번째 줄, 품목: %, 단가: %)', v_item.ord, v_sl.item_name, v_price;
    end if;
    if v_price = 0 then
      v_zero_price := v_zero_price + 1;
    end if;

    v_amount := round(v_sl.qty * v_price, 2);
    v_subtotal := v_subtotal + v_amount;

    -- 보충 필드 (폼 값 우선 → 원천 폴백 → 공란 허용. 값 발명 금지)
    v_hs := coalesce(
      nullif(btrim(coalesce(v_item.val->>'hsCode', '')), ''),
      nullif(btrim(coalesce(v_ol.hs_code, '')), ''),
      nullif(btrim(coalesce(v_prod.hs_code, '')), ''));
    v_origin := coalesce(
      nullif(btrim(coalesce(v_item.val->>'originCountry', '')), ''),
      nullif(btrim(coalesce(v_prod.origin_country, '')), ''));
    v_desc := coalesce(
      nullif(btrim(coalesce(v_item.val->>'description', '')), ''),
      nullif(btrim(coalesce(v_ol.description, '')), ''));
    v_pname := coalesce(
      nullif(btrim(coalesce(v_ol.product_name, '')), ''),
      v_sl.item_name);
    v_pcode := nullif(btrim(coalesce(v_prod.code, '')), '');

    -- 중량 (D5·R1: 폼 직접 입력 — 양수만, 부분 입력 처리는 인쇄 규칙 몫)
    begin
      v_nw := nullif(btrim(coalesce(v_item.val->>'netWeight', '')), '')::numeric;
      v_gw := nullif(btrim(coalesce(v_item.val->>'grossWeight', '')), '')::numeric;
    exception when invalid_text_representation then
      raise exception '중량 값이 숫자가 아닙니다. (%번째 줄, N.W.: %, G.W.: %)', v_item.ord, v_item.val->>'netWeight', v_item.val->>'grossWeight';
    end;
    if v_nw is not null
       and (v_nw in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) or v_nw <= 0) then
      raise exception '순중량(N.W.)은 양수여야 합니다. (%번째 줄, 받은 값: %)', v_item.ord, v_nw;
    end if;
    if v_gw is not null
       and (v_gw in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) or v_gw <= 0) then
      raise exception '총중량(G.W.)은 양수여야 합니다. (%번째 줄, 받은 값: %)', v_item.ord, v_gw;
    end if;

    v_line_no := v_line_no + 1;
    v_rows := v_rows || jsonb_build_object(
      'lineNo', v_line_no,
      'shipmentLineId', v_sl.id,
      'orderLineId', v_sl.order_line_id,
      'productCode', v_pcode,
      'productName', v_pname,
      'description', v_desc,
      'hsCode', v_hs,
      'originCountry', v_origin,
      'qty', v_sl.qty,
      'uom', v_uom,
      'unitPrice', v_price,
      'amount', v_amount,
      'netWeight', v_nw,
      'grossWeight', v_gw);

    -- R-정정: 포장 스냅샷은 포함 라인만 (S/I 스칼라 원천 → jsonb 구성)
    v_packages := v_packages || jsonb_build_object(
      'shipmentLineId', v_sl.id,
      'itemName', v_sl.item_name,
      'packageCount', v_sl.package_count,
      'packageType', nullif(btrim(coalesce(v_sl.package_type, '')), ''),
      'grossWeightKg', v_sl.gross_weight_kg,
      'cbm', v_sl.cbm);

    -- D3: 주문별 문서 포함 금액 누적 (할인 비례 배분용)
    v_idx := array_position(v_so_ids, v_ol.so_id);
    if v_idx is null then
      v_so_ids := v_so_ids || v_ol.so_id;
      v_so_amounts := v_so_amounts || v_amount;
    else
      v_so_amounts[v_idx] := v_so_amounts[v_idx] + v_amount;
    end if;
  end loop;

  if v_line_no = 0 then
    raise exception '발행할 라인이 없습니다(포함된 라인 0건).';
  end if;
  if v_zero_price > 0 then
    v_warnings := v_warnings
      || to_jsonb(format('단가 0원 라인 %s건이 포함되었습니다.', v_zero_price));
  end if;

  -- ── D3: discount = Σ 주문별 round2(주문 discount × 문서 포함 금액 ÷ 주문 전체 금액) ──
  for v_idx in 1 .. coalesce(array_length(v_so_ids, 1), 0) loop
    select so.discount, so.so_number
      into v_so_discount, v_so_number
      from public.sales_orders so
     where so.id = v_so_ids[v_idx];
    if v_so_discount is not null
       and v_so_discount in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) then
      raise exception '주문 할인 값이 유효하지 않습니다. (주문: %, 받은 값: %)', coalesce(v_so_number, v_so_ids[v_idx]::text), v_so_discount;
    end if;

    -- 분모 = 주문 전체 라인 금액합. 적대검증 반영: amount 가 null 인 라인은
    -- qty×단가로 재계산해 합산한다(분모 축소 → 할인 과배분 방지, 서버 재계산 원칙).
    select coalesce(sum(coalesce(l.amount,
                                 round(coalesce(l.quantity, 0) * coalesce(l.unit_price, 0), 2))), 0)
      into v_so_total
      from public.so_lines l
     where l.so_id = v_so_ids[v_idx];
    if v_so_total in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) then
      raise exception '주문 라인 금액 합이 유효하지 않습니다. (주문: %)', coalesce(v_so_number, v_so_ids[v_idx]::text);
    end if;

    if v_so_total <= 0 then
      -- 스펙 D3: 라인 금액 총합 0(적대검증 반영: 0 이하) → discount 0 처리 + 경고
      if coalesce(v_so_discount, 0) <> 0 then
        v_warnings := v_warnings
          || to_jsonb(format('주문 %s: 라인 금액 합(%s)이 0 이하라 할인(%s)을 배분하지 않았습니다.',
                             coalesce(v_so_number, v_so_ids[v_idx]::text), v_so_total, v_so_discount));
      end if;
    else
      if coalesce(v_so_discount, 0) < 0 then
        v_warnings := v_warnings
          || to_jsonb(format('주문 %s: 할인이 음수(%s)입니다 — 주문 데이터 확인이 필요합니다.',
                             coalesce(v_so_number, v_so_ids[v_idx]::text), v_so_discount));
      end if;
      v_discount := v_discount
        + round(coalesce(v_so_discount, 0) * v_so_amounts[v_idx] / v_so_total, 2);
    end if;
  end loop;

  v_subtotal := round(v_subtotal, 2);
  v_discount := round(v_discount, 2);
  -- 적대검증 반영: 배분 할인이 소계를 초과하면(비정상 데이터 — 총액 음수) 발행 거부
  if v_discount > v_subtotal then
    raise exception '배분된 할인(%)이 소계(%)를 초과합니다. 주문 할인과 라인 금액을 확인하세요.', v_discount, v_subtotal;
  end if;
  v_total := round(v_subtotal - v_discount, 2);

  -- ══ ⑵-b P5.3: 적입 스냅샷 (문서 스코프 — P2·P3) ═══════════════════════════
  --  스코프 축은 **실제로 문서에 들어간 라인**(v_rows)이다. v_seen 이 아니다 —
  --  v_seen 은 qty<=0 방어 필터로 걸러진 라인도 품고 있어 문서 라인 집합과 다르다.
  select coalesce(array_agg((t.val->>'shipmentLineId')::uuid), '{}'::uuid[])
    into v_doc_lines
    from jsonb_array_elements(v_rows) as t(val);

  with scoped as (
    -- 이 문서 라인에 걸린 배분만. 컨테이너는 이 선적 소속만(타 선적 차단).
    select a.container_id,
           a.id                      as alloc_id,
           a.created_at              as alloc_created_at,
           a.shipment_line_id,
           a.allocated_package_count as apc,
           -- 비례 몫 = 정확 십진(정수 스케일). 나눗셈 근사 없음 — 헤더 주석 참조.
           -- 원값·분모가 없으면 몫을 만들지 않는다(null = 산출 불가, 0 과 다르다).
           case
             when l.package_count is null or l.package_count <= 0
                  or l.gross_weight_kg is null then null
             else div(l.gross_weight_kg * a.allocated_package_count * 1000000 * 2
                        + l.package_count::numeric,
                      l.package_count::numeric * 2) * 0.000001
           end as gw_share,
           case
             when l.package_count is null or l.package_count <= 0
                  or l.cbm is null then null
             else div(l.cbm * a.allocated_package_count * 1000000 * 2
                        + l.package_count::numeric,
                      l.package_count::numeric * 2) * 0.000001
           end as cbm_share
      from public.shipment_container_allocations a
      join public.shipment_containers c on c.id = a.container_id
      -- left join: FK 상 결손은 불가하지만 TS 의 '모르는 라인' 의미론과 정렬한다.
      left join public.shipment_lines l on l.id = a.shipment_line_id
     where c.shipment_id = p_shipment_id
       and a.shipment_line_id = any (v_doc_lines)
  ),
  per_container as (
    -- inner join scoped: 문서 라인 배분이 **1건 이상**인 컨테이너만 남는다
    -- (배분 0건·타 라인만 배분된 컨테이너는 여기서 자연 탈락 = P2).
    select c.id, c.container_no, c.container_type, c.seal_no, c.vgm_kg, c.created_at,
           sum(s.apc)                                    as package_count,
           -- 피가산 항이 전부 6자리 십진이라 합도 6자리 — round 는 항등(안전 표기).
           round(coalesce(sum(s.gw_share), 0), 6)        as gross_weight_kg,
           round(coalesce(sum(s.cbm_share), 0), 6)       as cbm,
           bool_or(s.gw_share is null)                   as gw_incomplete,
           bool_or(s.cbm_share is null)                  as cbm_incomplete,
           (select jsonb_agg(jsonb_build_object(
                     'shipmentLineId', s2.shipment_line_id,
                     'allocatedPackageCount', s2.apc)
                   order by s2.alloc_created_at, s2.alloc_id)
              from scoped s2
             where s2.container_id = c.id)               as allocations
      from public.shipment_containers c
      join scoped s on s.container_id = c.id
     where c.shipment_id = p_shipment_id
     group by c.id, c.container_no, c.container_type, c.seal_no, c.vgm_kg, c.created_at
  )
  select
    coalesce(
      jsonb_agg(jsonb_build_object(
        -- 실측 4필드는 원문 그대로(정규화·대문자 강제 금지 — P5.2 입력 기록 원칙)
        'containerNo',   p.container_no,
        'containerType', p.container_type,
        'sealNo',        p.seal_no,
        'vgmKg',         p.vgm_kg,
        'allocations',   coalesce(p.allocations, '[]'::jsonb),
        -- 문서 스코프 동결 수치
        'packageCount',  p.package_count,
        'grossWeightKg', p.gross_weight_kg,
        'cbm',           p.cbm,
        'gwIncomplete',  p.gw_incomplete,
        'cbmIncomplete', p.cbm_incomplete)
      order by p.created_at, p.id),
      '[]'::jsonb),
    jsonb_build_object(
      'packageCount',  coalesce(sum(p.package_count), 0),
      'grossWeightKg', round(coalesce(sum(p.gross_weight_kg), 0), 6),
      'cbm',           round(coalesce(sum(p.cbm), 0), 6),
      'gwIncomplete',  coalesce(bool_or(p.gw_incomplete), false),
      'cbmIncomplete', coalesce(bool_or(p.cbm_incomplete), false))
    into v_containers, v_ctn_totals
    from per_container p;

  -- 적입 스코프 0건도 **객체를 기록**한다(D2·D5) — NULL 은 'P5.3 이전 발행' 전용.
  v_snapshot := jsonb_build_object('containers', v_containers, 'totals', v_ctn_totals);
  -- ══════════════════════════════════════════════════════════════════════════

  -- ── 발번 (RPC 트랜잭션 내 — R2: 카운터 키 'trade_document', 접두어 'CI') ──
  v_date := coalesce(p_issue_date, (now() at time zone 'Asia/Seoul')::date);
  v_period := to_char(v_date, 'YYYYMM');
  v_no := public.next_doc_number('trade_document', 'CI', v_period);

  -- ── 헤더 삽입 (스냅샷 전량 기록) ─────────────────────────────────────────
  insert into public.trade_documents (
    doc_type, doc_number, shipment_id, customer_id, currency, issue_date,
    incoterm, incoterm_place, payment_terms, remarks,
    seller_name, seller_address, seller_country, seller_tel, seller_email,
    seller_biz_reg_no, seller_bank_name, seller_account_no, seller_swift,
    seller_signatory_name, seller_signatory_title,
    buyer_name, buyer_address, buyer_city, buyer_country,
    buyer_contact_name, buyer_email, buyer_phone,
    consignee_name, consignee_address, consignee_contact,
    notify_name, notify_address, notify_contact,
    shipping_marks, shipment_no, transport, vessel_voyage, pol, pod,
    carrier, bl_no, booking_no, container_no,
    packages_snapshot, containers_snapshot,
    subtotal_amount, discount_amount, total_amount, status
  ) values (
    'CI', v_no, p_shipment_id, p_customer_id, v_currency, v_date,
    nullif(btrim(coalesce(p_header->>'incoterm', '')), ''),
    nullif(btrim(coalesce(p_header->>'incotermPlace', '')), ''),
    nullif(btrim(coalesce(p_header->>'paymentTerms', '')), ''),
    nullif(btrim(coalesce(p_header->>'remarks', '')), ''),
    v_s_name, v_s_address, v_s_country, v_s_tel, v_s_email,
    v_s_brn, v_s_bank, v_s_account, v_s_swift,
    v_s_sign_name, v_s_sign_title,
    v_b_name,
    nullif(btrim(coalesce(v_buyer.address, '')), ''),
    nullif(btrim(coalesce(v_buyer.city, '')), ''),
    nullif(btrim(coalesce(v_buyer.country, '')), ''),
    nullif(btrim(coalesce(v_buyer.contact_name, '')), ''),
    nullif(btrim(coalesce(v_buyer.contact_email, '')), ''),
    nullif(btrim(coalesce(v_buyer.contact_phone, '')), ''),
    v_c_name, v_c_address, v_c_contact,
    v_n_name, v_n_address, v_n_contact,
    nullif(btrim(coalesce(v_shipment.shipping_marks, '')), ''),
    nullif(btrim(coalesce(v_shipment.ship_number, '')), ''),
    nullif(btrim(coalesce(v_shipment.transport, '')), ''),
    nullif(btrim(coalesce(v_shipment.vessel_voyage, '')), ''),
    nullif(btrim(coalesce(v_shipment.pol, '')), ''),
    nullif(btrim(coalesce(v_shipment.pod, '')), ''),
    nullif(btrim(coalesce(v_shipment.carrier, '')), ''),
    nullif(btrim(coalesce(v_shipment.bl_no, '')), ''),
    nullif(btrim(coalesce(v_shipment.booking_no, '')), ''),
    -- ⑵-c container_no: P4.5 원문 그대로. shipments 의 **레거시 잔존값**이지
    --     적입에서 온 신규 값이 아니다(D9 '사장 계보 유지·신규 주입 금지').
    nullif(btrim(coalesce(v_shipment.container_no, '')), ''),
    v_packages, v_snapshot,
    v_subtotal, v_discount, v_total, 'issued'
  ) returning id into v_doc_id;

  -- ── 라인 삽입 ────────────────────────────────────────────────────────────
  for v_item in select t.val from jsonb_array_elements(v_rows) as t(val)
  loop
    insert into public.trade_document_lines (
      document_id, line_no, shipment_line_id, order_line_id,
      product_code, product_name, description, hs_code, origin_country,
      qty, uom, unit_price, amount, net_weight, gross_weight
    ) values (
      v_doc_id,
      (v_item.val->>'lineNo')::integer,
      (v_item.val->>'shipmentLineId')::uuid,
      (v_item.val->>'orderLineId')::uuid,
      v_item.val->>'productCode',
      v_item.val->>'productName',
      v_item.val->>'description',
      v_item.val->>'hsCode',
      v_item.val->>'originCountry',
      (v_item.val->>'qty')::numeric,
      v_item.val->>'uom',
      (v_item.val->>'unitPrice')::numeric,
      (v_item.val->>'amount')::numeric,
      (v_item.val->>'netWeight')::numeric,
      (v_item.val->>'grossWeight')::numeric
    );
  end loop;

  return jsonb_build_object('id', v_doc_id, 'docNumber', v_no, 'warnings', v_warnings);
end;
$$;

-- grant 무접촉(P1) — 시그니처가 같으므로 P4.5 의 grant 가 그대로 살아 있다.
-- (재부여도 하지 않는다: 권한 표면을 건드리지 않는 것이 이 단계의 계약이다.)

-- ----------------------------------------------------------------------------
-- 3) PostgREST 스키마 리로드 (신규 컬럼 인식)
-- ----------------------------------------------------------------------------
notify pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- 4) 전면 스캔 감사 + 읽기전용 현황 (마지막 문장 — 결과표 회신용)
-- ----------------------------------------------------------------------------
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
),
fn as (
  select p.proname::text as fname,
         p.prosecdef,
         pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('save_trade_document', 'cancel_trade_document',
                       'save_shipment_containers')
)
select * from (
  select '1.봉인 전면 스캔'::text as 구분,
         (v.kind || ' ' || v.obj || ' × ' || v.role || ' × ' || v.priv)::text as 항목,
         '⚠️ true'::text as 값
    from viol v
  union all
  select '1.봉인 전면 스캔', 'public 테이블·뷰 총수(34가 기대 — P5.3 변동 0)', count(*)::text from scan
  union all
  select '1.봉인 전면 스캔', '검사한 (객체×롤×권한) 조합수', (count(*) * 6)::text from scan
  union all
  select '1.봉인 전면 스캔', '위반 건수(0이 정상)',
         case when count(*) = 0 then '0 — ✅ 봉인 정상' else count(*)::text || ' — ⚠️ 봉인 실패' end
    from viol
  union all
  select '2.함수 prosecdef(전부 true)', f.fname || '(' || f.args || ')', f.prosecdef::text
    from fn f
  union all
  select '2.함수 prosecdef(전부 true)', 'save_trade_document 오버로드 수(1이 정상)',
         count(*)::text
    from fn f where f.fname = 'save_trade_document'
  union all
  select '3.신설 컬럼', 'trade_documents.containers_snapshot 존재(present 기대)',
         case when exists (select 1 from information_schema.columns
                            where table_schema = 'public'
                              and table_name = 'trade_documents'
                              and column_name = 'containers_snapshot')
              then 'present — ✅' else '⚠️ absent' end
  union all
  select '3.신설 컬럼', 'containers_snapshot 타입·NULL 허용·default(jsonb / YES / 없음 기대)',
         coalesce((select c.data_type || ' / ' || c.is_nullable || ' / '
                          || coalesce(c.column_default, '(없음)')
                     from information_schema.columns c
                    where c.table_schema = 'public'
                      and c.table_name = 'trade_documents'
                      and c.column_name = 'containers_snapshot'), '⚠️ absent')
  union all
  select '3.신설 컬럼', 'trade_documents 컬럼 총수(55가 기대 — 기존 54 + 신규 1)',
         count(*)::text
    from information_schema.columns
   where table_schema = 'public' and table_name = 'trade_documents'
  union all
  -- 읽기전용 현황 ① — 기발행 문서(= containers_snapshot NULL 로 남을 행)
  select '4.현황(읽기전용)',
         '무역서류 상태별 건수 — ' || d.status,
         count(*)::text || '건 (containers_snapshot NULL: '
           || count(*) filter (where d.containers_snapshot is null)::text || ')'
    from public.trade_documents d
   group by d.status
  union all
  select '4.현황(읽기전용)', '무역서류 총 건수(0이면 기발행분 없음)',
         count(*)::text from public.trade_documents
  union all
  -- 읽기전용 현황 ② — Seller 플레이스홀더(발행 D7 거부 여부의 DB 측 흔적)
  select '4.현황(읽기전용)',
         'Seller 플레이스홀더 흔적이 있는 기발행 문서 수(0이 정상)',
         count(*)::text
    from public.trade_documents d
   where d.seller_name in ('Your Company Co., Ltd.')
      or d.seller_tel in ('+82-2-0000-0000')
      or d.seller_email in ('sales@yourcompany.com')
      or d.seller_biz_reg_no in ('000-00-00000')
  union all
  select '4.현황(읽기전용)', '적입 보유 선적 수 / 컨테이너 행수 / 배분 행수',
         (select count(distinct shipment_id)::text from public.shipment_containers)
           || ' / ' || (select count(*)::text from public.shipment_containers)
           || ' / ' || (select count(*)::text from public.shipment_container_allocations)
) x
order by 구분, 항목;
