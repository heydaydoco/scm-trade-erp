-- ============================================================================
--  P4.5 — 무역서류(CI/PL) 실체화 · 발번 · 잠금 가드   (커밋 a: 마이그레이션+RPC+가드)
-- ============================================================================
--  아키텍트 확정 스펙 D1~D8 + 증보 판정(R1~R4·R-정정) 반영.
--
--  · D1: 한 번의 발행 = CI+PL 세트 = trade_documents 1행 = 번호 1개.
--        발번 카운터 키는 관례대로 doc_type='trade_document', 접두어 'CI'
--        → CI-YYYYMM-NNN (R2). 테이블 컬럼 doc_type CHECK('CI')는 별개 층위.
--        발행 후 불변 — 수정 없음. 취소(issued→cancelled)와 재발행(새 번호)만.
--  · R3: 상태값은 시스템 단일 케이스 관례에 따라 소문자 'issued'/'cancelled'.
--  · D2: 라인 전량 스냅샷. 인쇄 경로 라이브 재조회 0. 포인터는 전부 소프트.
--  · R-정정: packages_snapshot 포함 모든 집계는 "이 문서에 포함된 라인"만으로
--        구성한다(선적 전체 아님 — 혼합 선적에서 타 고객 물량 혼입 방지).
--  · 잠금 가드: 활성(issued) 문서가 있는 선적의 shipment_lines·shipment_parties
--        I/U/D 와 shipments 의 cancelled 전환을 즉시형 트리거로 차단(사유 '무역서류').
--        잠긴 RPC(save_shipment / save_shipment_cargo)는 무수정 — 이 스펙이 잠긴
--        테이블에 트리거 추가를 명시 승인. 선적의 다른 상태 전환·marks 수정은
--        가드가 차단하지 않는다(marks 는 문서에 스냅샷됨).
--        ※ 운영상 유의(적대검증 발견): marks 의 유일한 쓰기 경로인 save_shipment_cargo
--        는 라인·당사자를 항상 전량 재기록하므로, 활성 문서가 있는 동안 화물 화면
--        저장(marks만 고쳐도)은 라인 가드에 걸려 사실상 전면 동결된다. 가드 층위는
--        스펙 그대로이며, 해소는 "문서 취소 → 수정 → 재발행" 경로 — UI(커밋 c)가
--        이를 선행 안내한다. 별도 marks 전용 RPC 신설 여부는 아키텍트 판단 사항.
--  · 적대검증 반영 2건: (선적×고객×통화) 활성 문서 중복 방지(RPC 검증+부분 유니크
--        인덱스), discount 산식 방어(분모 재계산·0 이하 분모·음수 할인 경고·소계
--        초과 거부).
--  · 출생 봉인: Supabase 기본권한이 신규 테이블에 전권을 뿌리므로 생성 직후
--        명시적 REVOKE (P4.4h 관례). 쓰기 경로는 RPC 2종뿐.
--
--  ⚠️ 실행 전제(사전점검 2026-07-17 통과): 위반 0행 · 객체 총수 29 ·
--     next_doc_number 3-arg 단일 오버로드 · 카운터 잔여 0행 · 신규 테이블 2종 absent.
--  ⚠️ 맨 끝 감사 SELECT 가 이 파일의 마지막 문장 — 결과표 전체를 드래그 복사해
--     회신한다. 기대: 위반 0행 · 객체 총수 31 · prosecdef 4종 true · 제약·트리거 존재.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) trade_documents — CI+PL 세트 헤더 (스냅샷 전량 보유, 발행 후 불변)
-- ----------------------------------------------------------------------------
create table public.trade_documents (
  id                     uuid primary key default gen_random_uuid(),
  doc_type               text not null default 'CI'
                         constraint trade_documents_doc_type_check check (doc_type = 'CI'),
  doc_number             text not null
                         constraint trade_documents_doc_number_key unique,
  shipment_id            uuid not null
                         constraint trade_documents_shipment_id_fkey
                         references public.shipments (id) on delete restrict,
  customer_id            uuid not null,           -- 소프트 포인터 (Buyer 실체는 아래 스냅샷)
  currency               text not null,
  issue_date             date not null,           -- KST 달력일 (lib/date.ts 관례)

  incoterm               text,
  incoterm_place         text,
  payment_terms          text,
  remarks                text,

  -- Seller 스냅샷 (config 원천 — D7. 기본 5필드는 발행 검증 통과값만 저장)
  seller_name            text not null,
  seller_address         text not null,           -- 줄바꿈(\n) 결합 주소
  seller_country         text not null,
  seller_tel             text,                    -- tel·email 중 최소 1개는 RPC가 강제
  seller_email           text,
  seller_biz_reg_no      text not null,
  seller_bank_name       text,                    -- 은행·서명자는 선택 (없으면 섹션 생략)
  seller_account_no      text,
  seller_swift           text,
  seller_signatory_name  text,
  seller_signatory_title text,

  -- Buyer 스냅샷 (발행 시점 SO 고객 companies 미러 — 발명 없음)
  buyer_name             text not null,
  buyer_address          text,
  buyer_city             text,
  buyer_country          text,
  buyer_contact_name     text,
  buyer_email            text,
  buyer_phone            text,

  -- Consignee / Notify 스냅샷 (shipment_parties 미러 — 없으면 null)
  consignee_name         text,
  consignee_address      text,
  consignee_contact      text,
  notify_name            text,
  notify_address         text,
  notify_contact         text,

  -- 선적정보 스냅샷 (shipments 가 실제 가진 필드 범위 내)
  shipping_marks         text,
  shipment_no            text,
  transport              text,
  vessel_voyage          text,
  pol                    text,
  pod                    text,
  carrier                text,
  bl_no                  text,
  booking_no             text,
  container_no           text,

  -- 포장 스냅샷 (R-정정: 포함 라인만으로 구성 — [{shipmentLineId, itemName,
  --  packageCount, packageType, grossWeightKg, cbm}])
  packages_snapshot      jsonb not null default '[]'::jsonb,

  subtotal_amount        numeric not null,
  discount_amount        numeric not null default 0,
  total_amount           numeric not null,

  status                 text not null default 'issued'
                         constraint trade_documents_status_check
                         check (status in ('issued', 'cancelled')),
  cancelled_at           timestamptz,
  cancel_reason          text,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- 출생 봉인 (P4.4h 관례 — 기본권한 전권 함정, 명시적 REVOKE 만 유효)
revoke all on public.trade_documents from anon, authenticated;
grant select on public.trade_documents to anon, authenticated;

-- 잠금 가드가 매 행 조회하므로 활성 문서 탐색용 부분 인덱스
create index idx_trade_documents_shipment_issued
  on public.trade_documents (shipment_id)
  where status = 'issued';

-- 적대검증 반영: 같은 (선적×고객×통화) 활성 문서 중복 방지 백스톱.
-- D1 의 "취소 후 재발행" 모델상 생성 단위당 활성 세트는 1개다 — 더블클릭·재시도로
-- 활성 원본 2부가 생기는 것을 RPC 검증(1차)과 이 인덱스(레이스 백스톱)로 봉쇄한다.
-- cancelled 문서는 매칭되지 않으므로 취소 후 재발행은 정상 통과.
create unique index trade_documents_active_scope_key
  on public.trade_documents (shipment_id, customer_id, currency)
  where status = 'issued';

-- ----------------------------------------------------------------------------
-- 2) trade_document_lines — 라인 전량 스냅샷 (D2)
-- ----------------------------------------------------------------------------
create table public.trade_document_lines (
  id               uuid primary key default gen_random_uuid(),
  document_id      uuid not null
                   constraint trade_document_lines_document_id_fkey
                   references public.trade_documents (id) on delete cascade,
  line_no          integer not null,
  shipment_line_id uuid,                          -- 소프트 포인터 (추적용, FK 금지)
  order_line_id    uuid,                          -- 소프트 포인터 (so_lines — stale 가능)
  product_code     text,
  product_name     text not null,
  description      text,
  hs_code          text,
  origin_country   text,
  qty              numeric not null
                   constraint trade_document_lines_qty_check
                   check (qty > 0 and qty < 'Infinity'::numeric),
  uom              text not null,
  unit_price       numeric not null
                   constraint trade_document_lines_unit_price_check
                   check (unit_price >= 0 and unit_price < 'Infinity'::numeric),
  amount           numeric not null,
  net_weight       numeric
                   constraint trade_document_lines_net_weight_check
                   check (net_weight > 0 and net_weight < 'Infinity'::numeric),
  gross_weight     numeric
                   constraint trade_document_lines_gross_weight_check
                   check (gross_weight > 0 and gross_weight < 'Infinity'::numeric),
  constraint trade_document_lines_document_line_key unique (document_id, line_no)
);

-- 출생 봉인
revoke all on public.trade_document_lines from anon, authenticated;
grant select on public.trade_document_lines to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3) 감사 트리거 — 헤더만 (P4.3 관례: 라인 미부착)
-- ----------------------------------------------------------------------------
create trigger trg_audit_trade_documents
  after insert or update or delete on public.trade_documents
  for each row execute function public.fn_audit();

-- ----------------------------------------------------------------------------
-- 4) 잠금 가드 — 활성(issued) 문서가 있는 선적의 동결 (즉시형)
-- ----------------------------------------------------------------------------
--  · shipment_lines / shipment_parties: I/U/D 전면 차단.
--    (save_shipment_cargo 는 diff-upsert·전량교체라 무변경 저장도 행 UPDATE 를
--     일으킴 → 저장 자체가 차단된다 = 의도된 동결. UI 는 커밋 c 에서 선행 안내.)
--  · shipments: status 가 'cancelled' 로 "전환"될 때만 차단.
--    (잠긴 save_shipment 이 매 저장 status 를 원문 기록하므로 무전환 저장은 통과 —
--     운항 진행 등 다른 전환과 marks 수정도 통과.)
create or replace function public.fn_block_shipment_cargo_with_trade_doc()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shipment_id uuid;
  v_doc_no      text;
begin
  -- UPDATE 로 라인을 다른 선적으로 옮기는 경우 양쪽 모두 검사한다
  if tg_op = 'UPDATE' and old.shipment_id is distinct from new.shipment_id then
    select d.doc_number into v_doc_no
      from public.trade_documents d
     where d.shipment_id = old.shipment_id and d.status = 'issued'
     limit 1;
    if v_doc_no is not null then
      raise exception '무역서류(%)가 발행된 선적의 화물·당사자 정보는 수정할 수 없습니다. 먼저 해당 무역서류를 취소하세요.', v_doc_no;
    end if;
  end if;

  if tg_op = 'DELETE' then
    v_shipment_id := old.shipment_id;
  else
    v_shipment_id := new.shipment_id;
  end if;

  select d.doc_number into v_doc_no
    from public.trade_documents d
   where d.shipment_id = v_shipment_id
     and d.status = 'issued'
   limit 1;
  if v_doc_no is not null then
    raise exception '무역서류(%)가 발행된 선적의 화물·당사자 정보는 수정할 수 없습니다. 먼저 해당 무역서류를 취소하세요.', v_doc_no;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger trg_shipment_lines_trade_doc_guard
  before insert or update or delete on public.shipment_lines
  for each row execute function public.fn_block_shipment_cargo_with_trade_doc();

create trigger trg_shipment_parties_trade_doc_guard
  before insert or update or delete on public.shipment_parties
  for each row execute function public.fn_block_shipment_cargo_with_trade_doc();

create or replace function public.fn_block_shipment_cancel_with_trade_doc()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc_no text;
begin
  if old.status is distinct from new.status and new.status = 'cancelled' then
    select d.doc_number into v_doc_no
      from public.trade_documents d
     where d.shipment_id = new.id and d.status = 'issued'
     limit 1;
    if v_doc_no is not null then
      raise exception '무역서류(%)가 발행된 선적은 취소할 수 없습니다. 먼저 해당 무역서류를 취소하세요.', v_doc_no;
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_shipments_cancel_trade_doc_guard
  before update on public.shipments
  for each row execute function public.fn_block_shipment_cancel_with_trade_doc();

-- ----------------------------------------------------------------------------
-- 5) RPC — save_trade_document (SECURITY DEFINER, 단일 트랜잭션)
-- ----------------------------------------------------------------------------
--  qty·uom·단가·금액은 서버가 원천(shipment_lines→so_lines→products)에서
--  재해석·재계산한다(클라 값 불신). 폼은 보충 필드만 공급:
--  p_header = { incoterm, incotermPlace, paymentTerms, remarks,
--               seller: { name, addressLines[], country, tel, email, bizRegNo,
--                         bankName, accountNo, swift, signatoryName, signatoryTitle } }
--  p_lines  = [ { shipmentLineId, include(기본 true), hsCode?, originCountry?,
--                 netWeight?, grossWeight?, description? } ]
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
    packages_snapshot, subtotal_amount, discount_amount, total_amount, status
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
    nullif(btrim(coalesce(v_shipment.container_no, '')), ''),
    v_packages, v_subtotal, v_discount, v_total, 'issued'
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

grant execute on function
  public.save_trade_document(uuid, uuid, text, date, jsonb, jsonb)
  to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6) RPC — cancel_trade_document (R4: 사유 필수. 삭제 없음)
-- ----------------------------------------------------------------------------
create or replace function public.cancel_trade_document(
  p_id     uuid,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc    public.trade_documents%rowtype;
  v_reason text;
begin
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception '취소 사유는 필수입니다.';
  end if;
  if p_id is null then
    raise exception '무역서류가 지정되지 않았습니다.';
  end if;

  select * into v_doc
    from public.trade_documents
   where id = p_id
   for update;
  if not found then
    raise exception '무역서류를 찾을 수 없습니다.';
  end if;
  if v_doc.status <> 'issued' then
    raise exception '이미 취소된 무역서류입니다. (문서번호: %)', v_doc.doc_number;
  end if;

  update public.trade_documents
     set status = 'cancelled',
         cancelled_at = now(),
         cancel_reason = v_reason,
         updated_at = now()
   where id = p_id;

  return jsonb_build_object('id', p_id, 'docNumber', v_doc.doc_number, 'status', 'cancelled');
end;
$$;

grant execute on function
  public.cancel_trade_document(uuid, text)
  to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 7) PostgREST 스키마 리로드 + 전면 스캔 감사 (마지막 문장 — 결과표 회신용)
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
newfn as (
  select p.proname::text as fname,
         p.prosecdef,
         pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('save_trade_document', 'cancel_trade_document',
                       'fn_block_shipment_cargo_with_trade_doc',
                       'fn_block_shipment_cancel_with_trade_doc')
)
select * from (
  select '1.봉인 전면 스캔'::text as 구분,
         (v.kind || ' ' || v.obj || ' × ' || v.role || ' × ' || v.priv)::text as 항목,
         '⚠️ true'::text as 값
    from viol v
  union all
  select '1.봉인 전면 스캔', 'public 테이블·뷰 총수(31이 기대 — 기존 29 + 신규 2)', count(*)::text from scan
  union all
  select '1.봉인 전면 스캔', '검사한 (객체×롤×권한) 조합수', (count(*) * 6)::text from scan
  union all
  select '1.봉인 전면 스캔', '위반 건수(0이 정상)',
         case when count(*) = 0 then '0 — ✅ 봉인 정상' else count(*)::text || ' — ⚠️ 봉인 실패' end
    from viol
  union all
  select '2.신설 함수 prosecdef(전부 true)', f.fname || '(' || f.args || ')', f.prosecdef::text
    from newfn f
  union all
  select '3.신설 객체 존재', o.nm,
         case when to_regclass('public.' || o.nm) is not null
              then 'present — ✅' else '⚠️ absent' end
    from (values ('trade_documents'), ('trade_document_lines')) o(nm)
  union all
  select '3.신설 객체 존재', 'RPC 2종+가드 함수 2종 수(4가 정상 — 오버로드 없음)', count(*)::text from newfn
  union all
  select '3.신설 객체 존재', 'idx_trade_documents_shipment_issued 인덱스(1이 정상)',
         count(*)::text
    from pg_indexes
   where schemaname = 'public' and indexname = 'idx_trade_documents_shipment_issued'
  union all
  select '3.신설 객체 존재', 'trade_documents_active_scope_key 유니크 인덱스(1이 정상)',
         count(*)::text
    from pg_indexes
   where schemaname = 'public' and indexname = 'trade_documents_active_scope_key'
  union all
  select '3.신설 객체 존재', '발번 카운터 trade_document 행 수(발번 전 0이 정상)',
         count(*)::text
    from public.doc_counters
   where doc_type = 'trade_document'
  union all
  select '4.제약 확인 — ' || c.conrelid::regclass::text,
         c.conname::text,
         pg_get_constraintdef(c.oid)
    from pg_constraint c
   where c.conrelid in ('public.trade_documents'::regclass,
                        'public.trade_document_lines'::regclass)
  union all
  select '5.트리거 확인(4종·enabled)', t.tgname::text,
         'on ' || t.tgrelid::regclass::text
           || case t.tgenabled when 'O' then ' / enabled — ✅' else ' / ⚠️ ' || t.tgenabled::text end
    from pg_trigger t
   where not t.tgisinternal
     and t.tgname in ('trg_shipment_lines_trade_doc_guard',
                      'trg_shipment_parties_trade_doc_guard',
                      'trg_shipments_cancel_trade_doc_guard',
                      'trg_audit_trade_documents')
  union all
  select '6.출생 봉인 상세(신규 2종)',
         o.nm || ' × ' || r.role || ' × ' || pr.priv,
         case
           when has_table_privilege(r.role, to_regclass('public.' || o.nm), pr.priv) then
             case when pr.priv = 'SELECT' then 'true — ✅ 조회 허용' else '⚠️ true — 봉인 실패' end
           else
             case when pr.priv = 'SELECT' then '⚠️ false — 조회 불가' else 'false — ✅ 봉인' end
         end
    from (values ('trade_documents'), ('trade_document_lines')) o(nm)
    cross join (values ('anon'), ('authenticated')) r(role)
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) pr(priv)
) x
order by 구분, 항목;
