-- ============================================================================
--  P5.3a — CI/PL 적입 스냅샷에서 VGM 제거 (§4 판정 다 · 개정 2호)
-- ============================================================================
--  save_trade_document 본문만 CREATE OR REPLACE 로 교체한다. 시그니처 6인자 무변경 ·
--  grant 무접촉 · 신규 객체 0 → 봉인 기준선 **34 불변**.
--
--  · 배경: 공동적입(한 물리 컨테이너에 여러 고객 라인)에서 VGM(=컨테이너 총질량)은
--    타 고객 물량 합산 정량이라, 고객 A 의 CI/PL 에 실으면 `VGM − A 비례 G.W.` 로
--    B 물량이 역산 노출된다(적대검증 headline). 인쇄만 숨기면 trade_documents 는
--    select 봉인이 개방(grant select)이라 데이터가 남아 그대로 유출 → **스냅샷
--    데이터 층에서 vgmKg 키 자체를 뺀다**.
--  · 유지: containerNo · containerType · sealNo = 공유 물리 사실(수취·통관 필수,
--    정량 유출 없음). 공동적입의 '존재'가 번호 공유로 드러나는 것은 허용.
--  · VGM 의 자리는 S/I(포워더·선사 방향) — S/I 는 무접촉(라이브 전량 표시 유지).
--
--  · p5.3_doc_container_snapshot.sql(1차)은 **무수정** — 실행 이력의 정본이다.
--    이 파일이 그 위에 덧씌운다(create or replace). per_container 산술은 1차와
--    동일(비례 몫 = 정수 스케일 div, 나눗셈 무근사) — 이번 변경은 vgmKg 필드 제거뿐.
--    TS↔SQL 산식 동치는 그대로 유지된다(BigInt 시뮬레이션 3만 건 재검산 불일치 0).
--
--  실행: Supabase 대시보드 → SQL Editor → New query → 붙여넣기 → Run.
--  성격: 순수 교체(기존 RPC 본문만) · 멱등(create or replace). 기존 객체·컬럼 무수정.
--
--  ⚠️ 실행 전제(P5.3 1차 반영 후 · 헤더 명시 방식):
--     · save_trade_document(uuid,uuid,text,date,jsonb,jsonb) 실존 · 오버로드 1
--     · trade_documents.containers_snapshot 컬럼 실존(1차에서 추가됨)
--     · public 테이블·뷰 총수 34 · 봉인 위반 0
--  ⚠️ 맨 끝 감사 SELECT 가 이 파일의 마지막 문장 — 결과표 전체를 드래그 복사해 회신한다.
--     기대: 위반 0 · 객체 34(변동 0) · prosecdef true · 오버로드 1 ·
--           save_trade_document 소스 내 'vgmKg' 문자열 **0건**.
-- ============================================================================

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
  -- P5.3 적입 스냅샷용 (개정 2호: VGM 필드 없음)
  v_doc_lines    uuid[] := '{}';
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

  -- ── 선적 잠금 + 검증 ────────────────────────────────────────────────────
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

  -- ── Seller 검증 (D7) ────────────────────────────────────────────────────
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

  -- ── Buyer 검증 + 스냅샷 원천 ────────────────────────────────────────────
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

  -- ── Consignee / Notify 스냅샷 원천 ──────────────────────────────────────
  select p.name, p.address, p.contact
    into v_c_name, v_c_address, v_c_contact
    from public.shipment_parties p
   where p.shipment_id = p_shipment_id and p.role = 'consignee';
  select p.name, p.address, p.contact
    into v_n_name, v_n_address, v_n_contact
    from public.shipment_parties p
   where p.shipment_id = p_shipment_id and p.role = 'notify';

  -- ── 라인 재해석·재계산 ──────────────────────────────────────────────────
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

    if v_sl.order_type <> 'SO' then
      raise exception '수입(PO) 라인은 무역서류 대상이 아닙니다. (%번째 줄, 품목: %)', v_item.ord, v_sl.item_name;
    end if;

    continue when v_sl.qty is null or v_sl.qty <= 0;

    if v_sl.order_line_id is null then
      raise exception '주문 라인 연결이 없어 발행할 수 없습니다. (%번째 줄, 품목: %)', v_item.ord, v_sl.item_name;
    end if;
    select * into v_ol
      from public.so_lines
     where id = v_sl.order_line_id;
    if not found then
      raise exception '주문 라인을 찾을 수 없습니다(주문 재저장으로 연결이 끊어졌을 수 있음). (%번째 줄, 품목: %)', v_item.ord, v_sl.item_name;
    end if;

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

    if v_ol.product_id is not null then
      select * into v_prod
        from public.products
       where id = v_ol.product_id;
    end if;

    v_uom := coalesce(
      nullif(btrim(coalesce(v_sl.uom, '')), ''),
      nullif(btrim(coalesce(v_ol.unit, '')), ''),
      nullif(btrim(coalesce(v_prod.unit, '')), ''));
    if v_uom is null then
      raise exception '단위를 알 수 없어 발행할 수 없습니다. (%번째 줄, 품목: %)', v_item.ord, v_sl.item_name;
    end if;

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

    v_packages := v_packages || jsonb_build_object(
      'shipmentLineId', v_sl.id,
      'itemName', v_sl.item_name,
      'packageCount', v_sl.package_count,
      'packageType', nullif(btrim(coalesce(v_sl.package_type, '')), ''),
      'grossWeightKg', v_sl.gross_weight_kg,
      'cbm', v_sl.cbm);

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

  -- ── D3: 할인 비례 배분 ──────────────────────────────────────────────────
  for v_idx in 1 .. coalesce(array_length(v_so_ids, 1), 0) loop
    select so.discount, so.so_number
      into v_so_discount, v_so_number
      from public.sales_orders so
     where so.id = v_so_ids[v_idx];
    if v_so_discount is not null
       and v_so_discount in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) then
      raise exception '주문 할인 값이 유효하지 않습니다. (주문: %, 받은 값: %)', coalesce(v_so_number, v_so_ids[v_idx]::text), v_so_discount;
    end if;

    select coalesce(sum(coalesce(l.amount,
                                 round(coalesce(l.quantity, 0) * coalesce(l.unit_price, 0), 2))), 0)
      into v_so_total
      from public.so_lines l
     where l.so_id = v_so_ids[v_idx];
    if v_so_total in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) then
      raise exception '주문 라인 금액 합이 유효하지 않습니다. (주문: %)', coalesce(v_so_number, v_so_ids[v_idx]::text);
    end if;

    if v_so_total <= 0 then
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
  if v_discount > v_subtotal then
    raise exception '배분된 할인(%)이 소계(%)를 초과합니다. 주문 할인과 라인 금액을 확인하세요.', v_discount, v_subtotal;
  end if;
  v_total := round(v_subtotal - v_discount, 2);

  -- ══ P5.3 적입 스냅샷 (문서 스코프 — P2·P3, 개정 2호: VGM 필드 없음) ═══════════
  --  실측 필드는 번호·타입·씰 3개만 담는다. VGM 은 담지 않는다(§4) — 공동적입
  --  정량 유출 차단. 비례 몫 산술은 1차와 동일(정수 스케일 div, 나눗셈 무근사).
  select coalesce(array_agg((t.val->>'shipmentLineId')::uuid), '{}'::uuid[])
    into v_doc_lines
    from jsonb_array_elements(v_rows) as t(val);

  with scoped as (
    select a.container_id,
           a.id                      as alloc_id,
           a.created_at              as alloc_created_at,
           a.shipment_line_id,
           a.allocated_package_count as apc,
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
      left join public.shipment_lines l on l.id = a.shipment_line_id
     where c.shipment_id = p_shipment_id
       and a.shipment_line_id = any (v_doc_lines)
  ),
  per_container as (
    select c.id, c.container_no, c.container_type, c.seal_no, c.created_at,
           sum(s.apc)                                    as package_count,
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
     group by c.id, c.container_no, c.container_type, c.seal_no, c.created_at
  )
  select
    coalesce(
      jsonb_agg(jsonb_build_object(
        -- 실측 3필드(번호·타입·씰). VGM 제거(§4).
        'containerNo',   p.container_no,
        'containerType', p.container_type,
        'sealNo',        p.seal_no,
        'allocations',   coalesce(p.allocations, '[]'::jsonb),
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

  v_snapshot := jsonb_build_object('containers', v_containers, 'totals', v_ctn_totals);
  -- ══════════════════════════════════════════════════════════════════════════

  -- ── 발번 ────────────────────────────────────────────────────────────────
  v_date := coalesce(p_issue_date, (now() at time zone 'Asia/Seoul')::date);
  v_period := to_char(v_date, 'YYYYMM');
  v_no := public.next_doc_number('trade_document', 'CI', v_period);

  -- ── 헤더 삽입 ────────────────────────────────────────────────────────────
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
    -- container_no: shipments 레거시 잔존값(사장 계보) — 적입 신규 값 아님(D9).
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

-- grant 무접촉(§B) — 시그니처 동일이라 기존 grant 존속.

-- ----------------------------------------------------------------------------
-- PostgREST 스키마 리로드 + 전수 감사 (마지막 문장 — 결과표 회신용)
-- ----------------------------------------------------------------------------
notify pgrst, 'reload schema';

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
  select p.oid,
         p.proname::text as fname,
         p.prosecdef,
         pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'save_trade_document'
)
select * from (
  select '1.봉인 전면 스캔'::text as 구분,
         (v.kind || ' ' || v.obj || ' × ' || v.role || ' × ' || v.priv)::text as 항목,
         '⚠️ true'::text as 값
    from viol v
  union all
  select '1.봉인 전면 스캔', 'public 테이블·뷰 총수(34 기대 — 변동 0)', count(*)::text from scan
  union all
  select '1.봉인 전면 스캔', '위반 건수(0이 정상)',
         case when count(*) = 0 then '0 — ✅ 봉인 정상' else count(*)::text || ' — ⚠️ 봉인 실패' end
    from viol
  union all
  select '2.함수', 'save_trade_document 오버로드 수(1이 정상)', count(*)::text from fn
  union all
  select '2.함수', 'prosecdef(true 기대)', string_agg(f.prosecdef::text, ',') from fn f
  union all
  select '2.함수', '시그니처', string_agg(f.args, ' | ') from fn f
  union all
  -- 핵심 검증: 교체된 소스에 'vgmKg' 문자열이 0건이어야 한다(스냅샷 데이터 층 제거 확인).
  select '3.VGM 제거 확인', 'save_trade_document 소스 내 ''vgmKg'' 출현수(0 기대)',
         (select count(*)::text
            from fn f
           where pg_get_functiondef(f.oid) like '%vgmKg%')
  union all
  select '4.현황(읽기전용)', '무역서류 총 건수', count(*)::text from public.trade_documents
) x
order by 구분, 항목;
