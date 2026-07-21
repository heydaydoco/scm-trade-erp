-- ============================================================================
--  P5.1 — 통관신고 전표(수출 E6 · 수입 E9)   (커밋 a: 마이그레이션 + RPC 2종 + 가드)
-- ============================================================================
--  아키텍트 확정 스펙(P5.1) 반영. 재계획·재해석 금지.
--
--  · 범위: E6 수출통관 + E9 수입통관을 단일 전표 customs_declarations 로 구현.
--          헤더 온리(라인 없음), 인쇄물 없음(신고필증은 세관 발행물).
--          라인 전개·세액 배부는 F7(P8) 소관 — 이번 범위 밖. E5 적입은 P5.2 분리.
--  · 앵커: shipment_id hard FK(on delete restrict) — trade_documents.shipment_id 동형.
--          SPEC 의 "전표-대-전표 hard 홉 2개" 목록에 3번째로 명시 추가 대상(문서화는 커밋 e).
--  · 채번: doc_counters doc_type 'export_declaration'(ECD)·'import_declaration'(ICD),
--          공유 3-arg next_doc_number 재사용, period 는 서버 파생 온리
--          = to_char(coalesce(filing_date, KST 오늘),'YYYYMM'). 신규 1회 발번, 공백=정상.
--  · 세액(수입 전용): taxable_value·duty_amount·vat_amount·tax_currency 는 관세사 통지값
--          기록용 — 시스템 계산·단정 금지(SPEC 원칙 6). 세관 신고번호도 입력값만(발명 금지).
--  · 파생 저장 금지: 적재의무기한 컬럼 없음.
--          effective 기한 = coalesce(loading_deadline_extended, acceptance_date + 30일)
--          을 항상 계산으로만(서비스/기일엔진 — 커밋 b·d).
--  · 쓰기 경로: SECURITY DEFINER RPC 2종(save/cancel)뿐. 직접 테이블 쓰기 금지(출생 봉인).
--  · 가드: shipments 취소 시 비취소 신고가 있으면 차단(trg_shipments_cancel_trade_doc_guard
--          동형·별도 함수/트리거로 순수 추가). 기존 잠긴 트리거 함수는 무수정.
--          같은 테이블 BEFORE UPDATE 트리거 2개 공존 — PG 이름순 실행, 무해.
--
--  실행: Supabase 대시보드 → SQL Editor → New query → 붙여넣기 → Run.
--  성격: 순수 추가 · 멱등(if not exists / create or replace / drop-if-exists).
--
--  ⚠️ 실행 전제(사전조사 v2 + 라이브 확인 A~H 판정): 위반 0행 · 객체 총수 31 ·
--     next_doc_number 3-arg 단일 오버로드 · customs_declarations 부재(고아 없음) ·
--     신규 doc_type 카운터 부재 · shipments status/direction CHECK 실존.
--  ⚠️ 맨 끝 감사 SELECT 가 이 파일의 마지막 문장 — 결과표 전체를 드래그 복사해 회신한다.
--     기대: 위반 0행 · 객체 총수 32(기존 31 + 신규 1) · prosecdef 3종 true ·
--           신규 테이블 present · 카운터 2종 0행 · 제약·트리거 존재.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) customs_declarations — 통관신고 헤더 (수출/수입 단일 전표, 헤더 온리)
-- ----------------------------------------------------------------------------
create table if not exists public.customs_declarations (
  id                       uuid primary key default gen_random_uuid(),
  decl_doc_no              text not null
                           constraint customs_declarations_decl_doc_no_key unique,   -- 내부 채번(ECD/ICD)
  decl_type                text not null
                           constraint customs_declarations_decl_type_check
                           check (decl_type in ('export', 'import')),
  shipment_id              uuid not null
                           constraint customs_declarations_shipment_id_fkey
                           references public.shipments (id) on delete restrict,       -- hard FK 앵커
  status                   text not null default 'draft'
                           constraint customs_declarations_status_check
                           check (status in ('draft', 'filed', 'accepted', 'cancelled')),

  customs_decl_no          text,          -- 세관 발급 신고번호(내부 채번과 별개 — 입력값만)
  filing_date              date,          -- 신고일
  acceptance_date          date,          -- 수리일

  broker_name              text,          -- 관세사(자유 텍스트. companies 편입은 백로그)

  -- 수입 전용 세액 (관세사 통지값 기록용 — 시스템 계산·단정 금지)
  taxable_value            numeric,       -- 과세가격
  duty_amount              numeric,       -- 관세액
  vat_amount               numeric,       -- 부가세액
  tax_currency             text,          -- 세액 통화(세액 있으면 필수 — 불가분)

  -- 수출 전용
  loading_deadline_extended date,         -- 적재의무기한 연장승인일

  memo                     text,
  cancelled_at             timestamptz,
  cancel_reason            text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- 출생 봉인 (P4.4h 관례 — Supabase 기본권한 전권 함정, 명시적 REVOKE 만 유효)
revoke all on public.customs_declarations from anon, authenticated;
grant select on public.customs_declarations to anon, authenticated;

-- 인덱스: 선적 역조회 · (유형×상태) 목록 필터 · 수리일(기일엔진 조회)
create index if not exists idx_customs_declarations_shipment
  on public.customs_declarations (shipment_id);
create index if not exists idx_customs_declarations_type_status
  on public.customs_declarations (decl_type, status);
create index if not exists idx_customs_declarations_acceptance
  on public.customs_declarations (acceptance_date);

-- ----------------------------------------------------------------------------
-- 2) 감사 트리거 — 헤더 (P4.3 관례: 라인 없음이므로 헤더만)
-- ----------------------------------------------------------------------------
drop trigger if exists trg_audit_customs_declarations on public.customs_declarations;
create trigger trg_audit_customs_declarations
  after insert or update or delete on public.customs_declarations
  for each row execute function public.fn_audit();

-- ----------------------------------------------------------------------------
-- 3) 가드 — 비취소 신고가 있는 선적의 취소 차단 (별도 함수·트리거로 순수 추가)
-- ----------------------------------------------------------------------------
--  trg_shipments_cancel_trade_doc_guard 동형. 기존 잠긴 가드 함수는 수정하지 않는다.
create or replace function public.fn_block_shipment_cancel_with_customs_decl()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_no text;
begin
  if old.status is distinct from new.status and new.status = 'cancelled' then
    select d.decl_doc_no into v_no
      from public.customs_declarations d
     where d.shipment_id = new.id and d.status <> 'cancelled'
     limit 1;
    if v_no is not null then
      raise exception '통관신고(%)가 있는 선적은 취소할 수 없습니다. 먼저 해당 통관신고를 취소하세요.', v_no;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_shipments_cancel_customs_decl_guard on public.shipments;
create trigger trg_shipments_cancel_customs_decl_guard
  before update on public.shipments
  for each row execute function public.fn_block_shipment_cancel_with_customs_decl();

-- ----------------------------------------------------------------------------
-- 4) RPC — save_customs_declaration (SECURITY DEFINER, 유일 쓰기 경로)
-- ----------------------------------------------------------------------------
--  신규(p_id null): draft/filed/accepted 어느 상태로도 생성(사후 입력 실무 허용).
--  기존(p_id not null): draft→draft|filed|accepted, filed→filed|accepted. 역행 금지.
--    accepted 행 수정 전면 거부(취소 RPC만). cancelled 행 수정 거부.
--  앵커·유형 불변: 기존 행의 shipment_id·decl_type 는 변경 불가(내부 채번 정합).
create or replace function public.save_customs_declaration(
  p_id                        uuid,
  p_shipment_id               uuid,
  p_decl_type                 text,
  p_status                    text,
  p_customs_decl_no           text,
  p_filing_date               date,
  p_acceptance_date           date,
  p_broker_name               text,
  p_taxable_value             numeric,
  p_duty_amount               numeric,
  p_vat_amount                numeric,
  p_tax_currency              text,
  p_loading_deadline_extended date,
  p_memo                      text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shipment    public.shipments%rowtype;
  v_decl        public.customs_declarations%rowtype;
  v_decl_type   text;
  v_status      text;
  v_dir         text;
  v_customs_no  text;
  v_broker      text;
  v_tax_ccy     text;
  v_memo        text;
  v_has_tax     boolean;
  v_period      text;
  v_no          text;
  v_id          uuid;
begin
  -- ── 기본 인자 검증 ──────────────────────────────────────────────────────
  if p_shipment_id is null then
    raise exception '선적이 지정되지 않았습니다.';
  end if;

  v_decl_type := nullif(btrim(coalesce(p_decl_type, '')), '');
  if v_decl_type is null then
    raise exception '신고 유형이 지정되지 않았습니다.';
  end if;
  if v_decl_type not in ('export', 'import') then
    raise exception '신고 유형은 수출(export) 또는 수입(import)만 가능합니다. (받은 값: %)', v_decl_type;
  end if;

  v_status := nullif(btrim(coalesce(p_status, '')), '');
  if v_status is null then
    raise exception '상태가 지정되지 않았습니다.';
  end if;
  if v_status = 'cancelled' then
    raise exception '취소는 취소 기능(cancel_customs_declaration)으로만 가능합니다.';
  end if;
  if v_status not in ('draft', 'filed', 'accepted') then
    raise exception '상태 값이 올바르지 않습니다. (받은 값: %)', v_status;
  end if;

  -- 문자열 정규화 (공란/공백 = 없음)
  v_customs_no := nullif(btrim(coalesce(p_customs_decl_no, '')), '');
  v_broker     := nullif(btrim(coalesce(p_broker_name, '')), '');
  v_tax_ccy    := nullif(btrim(coalesce(p_tax_currency, '')), '');
  v_memo       := nullif(btrim(coalesce(p_memo, '')), '');

  -- ── 선적 잠금 + 검증 (동시성 베이스라인: 헤더 for update) ───────────────
  select * into v_shipment
    from public.shipments
   where id = p_shipment_id
   for update;
  if not found then
    raise exception '선적을 찾을 수 없습니다.';
  end if;
  if v_shipment.status = 'cancelled' then
    raise exception '취소된 선적에는 통관신고를 작성할 수 없습니다.';
  end if;

  -- 방향 일치: shipment.direction 이 not null 이고 decl_type 과 다르면 거부. null 이면 통과.
  v_dir := nullif(btrim(coalesce(v_shipment.direction, '')), '');
  if v_dir is not null and v_dir <> v_decl_type then
    raise exception '선적 방향(%)과 신고 유형(%)이 일치하지 않습니다.', v_dir, v_decl_type;
  end if;

  -- ── 세액 숫자 유효성 (음수·NaN·Infinity 거부) ───────────────────────────
  if p_taxable_value is not null
     and (p_taxable_value in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
          or p_taxable_value < 0) then
    raise exception '과세가격(taxable_value)은 0 이상의 유효한 숫자여야 합니다. (받은 값: %)', p_taxable_value;
  end if;
  if p_duty_amount is not null
     and (p_duty_amount in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
          or p_duty_amount < 0) then
    raise exception '관세액(duty_amount)은 0 이상의 유효한 숫자여야 합니다. (받은 값: %)', p_duty_amount;
  end if;
  if p_vat_amount is not null
     and (p_vat_amount in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
          or p_vat_amount < 0) then
    raise exception '부가세액(vat_amount)은 0 이상의 유효한 숫자여야 합니다. (받은 값: %)', p_vat_amount;
  end if;

  v_has_tax := (p_taxable_value is not null or p_duty_amount is not null or p_vat_amount is not null);

  -- ── 전용 필드 상호 거부 ─────────────────────────────────────────────────
  if v_decl_type = 'export' then
    if v_has_tax or v_tax_ccy is not null then
      raise exception '수출신고에는 세액·통화를 입력할 수 없습니다(수입 전용).';
    end if;
  else  -- import
    if p_loading_deadline_extended is not null then
      raise exception '수입신고에는 적재의무기한 연장승인일을 입력할 수 없습니다(수출 전용).';
    end if;
  end if;

  -- ── 금액-통화 불가분 ────────────────────────────────────────────────────
  if v_has_tax and v_tax_ccy is null then
    raise exception '세액을 입력하면 통화(tax_currency)가 필요합니다.';
  end if;
  if not v_has_tax and v_tax_ccy is not null then
    raise exception '세액이 없는데 통화만 입력되었습니다.';
  end if;

  -- ── 상태별 필수 필드 (filed 이상=신고일, accepted=+수리일+세관번호) ──────
  if v_status in ('filed', 'accepted') and p_filing_date is null then
    raise exception '신고(filed) 이상 상태에는 신고일(filing_date)이 필요합니다.';
  end if;
  if v_status = 'accepted' then
    if p_acceptance_date is null then
      raise exception '수리(accepted) 상태에는 수리일(acceptance_date)이 필요합니다.';
    end if;
    if v_customs_no is null then
      raise exception '수리(accepted) 상태에는 세관 신고번호가 필요합니다.';
    end if;
  end if;

  -- ── 날짜 정합 (수리일 < 신고일 거부, 같은 날 허용) ───────────────────────
  if p_filing_date is not null and p_acceptance_date is not null
     and p_acceptance_date < p_filing_date then
    raise exception '수리일(%)은 신고일(%)보다 빠를 수 없습니다.', p_acceptance_date, p_filing_date;
  end if;

  -- ── 분기: 신규 vs 기존 ──────────────────────────────────────────────────
  if p_id is null then
    -- 신규 발번 (period = 신고일 또는 KST 오늘의 YYYYMM)
    v_period := to_char(coalesce(p_filing_date, (now() at time zone 'Asia/Seoul')::date), 'YYYYMM');
    if v_decl_type = 'export' then
      v_no := public.next_doc_number('export_declaration', 'ECD', v_period);
    else
      v_no := public.next_doc_number('import_declaration', 'ICD', v_period);
    end if;

    insert into public.customs_declarations (
      decl_doc_no, decl_type, shipment_id, status,
      customs_decl_no, filing_date, acceptance_date, broker_name,
      taxable_value, duty_amount, vat_amount, tax_currency,
      loading_deadline_extended, memo
    ) values (
      v_no, v_decl_type, p_shipment_id, v_status,
      v_customs_no, p_filing_date, p_acceptance_date, v_broker,
      p_taxable_value, p_duty_amount, p_vat_amount, v_tax_ccy,
      p_loading_deadline_extended, v_memo
    ) returning id into v_id;
  else
    -- 기존 잠금 + 전이 매트릭스
    select * into v_decl
      from public.customs_declarations
     where id = p_id
     for update;
    if not found then
      raise exception '통관신고를 찾을 수 없습니다.';
    end if;

    if v_decl.shipment_id is distinct from p_shipment_id then
      raise exception '통관신고의 연결 선적은 변경할 수 없습니다.';
    end if;
    if v_decl.decl_type <> v_decl_type then
      raise exception '통관신고 유형(수출/수입)은 변경할 수 없습니다.';
    end if;

    if v_decl.status = 'cancelled' then
      raise exception '취소된 통관신고는 수정할 수 없습니다.';
    end if;
    if v_decl.status = 'accepted' then
      raise exception '수리 완료된 통관신고는 수정할 수 없습니다(취소만 가능).';
    end if;
    if v_decl.status = 'filed' and v_status = 'draft' then
      raise exception '신고 상태에서 작성중으로 되돌릴 수 없습니다. 취소 후 새로 작성하세요.';
    end if;

    update public.customs_declarations
       set status                    = v_status,
           customs_decl_no           = v_customs_no,
           filing_date               = p_filing_date,
           acceptance_date           = p_acceptance_date,
           broker_name               = v_broker,
           taxable_value             = p_taxable_value,
           duty_amount               = p_duty_amount,
           vat_amount                = p_vat_amount,
           tax_currency              = v_tax_ccy,
           loading_deadline_extended = p_loading_deadline_extended,
           memo                      = v_memo,
           updated_at                = now()
     where id = p_id;

    v_id := p_id;
    v_no := v_decl.decl_doc_no;
  end if;

  return jsonb_build_object('id', v_id, 'declDocNo', v_no, 'status', v_status);
end;
$$;

grant execute on function
  public.save_customs_declaration(uuid, uuid, text, text, text, date, date, text,
                                  numeric, numeric, numeric, text, date, text)
  to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5) RPC — cancel_customs_declaration (사유 필수. 삭제 없음. status 만 전환)
-- ----------------------------------------------------------------------------
create or replace function public.cancel_customs_declaration(
  p_id     uuid,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_decl   public.customs_declarations%rowtype;
  v_reason text;
begin
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception '취소 사유는 필수입니다.';
  end if;
  if p_id is null then
    raise exception '통관신고가 지정되지 않았습니다.';
  end if;

  select * into v_decl
    from public.customs_declarations
   where id = p_id
   for update;
  if not found then
    raise exception '통관신고를 찾을 수 없습니다.';
  end if;
  if v_decl.status = 'cancelled' then
    raise exception '이미 취소된 통관신고입니다. (번호: %)', v_decl.decl_doc_no;
  end if;

  update public.customs_declarations
     set status = 'cancelled',
         cancelled_at = now(),
         cancel_reason = v_reason,
         updated_at = now()
   where id = p_id;

  return jsonb_build_object('id', p_id, 'declDocNo', v_decl.decl_doc_no, 'status', 'cancelled');
end;
$$;

grant execute on function
  public.cancel_customs_declaration(uuid, text)
  to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6) PostgREST 스키마 리로드 + 전면 스캔 감사 (마지막 문장 — 결과표 회신용)
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
     and p.proname in ('save_customs_declaration', 'cancel_customs_declaration',
                       'fn_block_shipment_cancel_with_customs_decl')
)
select * from (
  select '1.봉인 전면 스캔'::text as 구분,
         (v.kind || ' ' || v.obj || ' × ' || v.role || ' × ' || v.priv)::text as 항목,
         '⚠️ true'::text as 값
    from viol v
  union all
  select '1.봉인 전면 스캔', 'public 테이블·뷰 총수(32가 기대 — 기존 31 + 신규 1)', count(*)::text from scan
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
  select '3.신설 객체 존재', 'customs_declarations',
         case when to_regclass('public.customs_declarations') is not null
              then 'present — ✅' else '⚠️ absent' end
  union all
  select '3.신설 객체 존재', 'RPC 2종 + 가드 함수 1종 수(3이 정상 — 오버로드 없음)', count(*)::text from newfn
  union all
  select '3.신설 객체 존재', 'idx_customs_declarations_shipment 인덱스(1이 정상)', count(*)::text
    from pg_indexes
   where schemaname = 'public' and indexname = 'idx_customs_declarations_shipment'
  union all
  select '3.신설 객체 존재', 'idx_customs_declarations_type_status 인덱스(1이 정상)', count(*)::text
    from pg_indexes
   where schemaname = 'public' and indexname = 'idx_customs_declarations_type_status'
  union all
  select '3.신설 객체 존재', 'idx_customs_declarations_acceptance 인덱스(1이 정상)', count(*)::text
    from pg_indexes
   where schemaname = 'public' and indexname = 'idx_customs_declarations_acceptance'
  union all
  select '3.신설 객체 존재', '발번 카운터 export_declaration 행 수(발번 전 0이 정상)', count(*)::text
    from public.doc_counters where doc_type = 'export_declaration'
  union all
  select '3.신설 객체 존재', '발번 카운터 import_declaration 행 수(발번 전 0이 정상)', count(*)::text
    from public.doc_counters where doc_type = 'import_declaration'
  union all
  select '4.제약 확인 — ' || c.conrelid::regclass::text,
         c.conname::text,
         pg_get_constraintdef(c.oid)
    from pg_constraint c
   where c.conrelid = 'public.customs_declarations'::regclass
  union all
  select '5.트리거 확인(2종·enabled)', t.tgname::text,
         'on ' || t.tgrelid::regclass::text
           || case t.tgenabled when 'O' then ' / enabled — ✅' else ' / ⚠️ ' || t.tgenabled::text end
    from pg_trigger t
   where not t.tgisinternal
     and t.tgname in ('trg_audit_customs_declarations',
                      'trg_shipments_cancel_customs_decl_guard')
  union all
  select '6.출생 봉인 상세(신규 1종)',
         'customs_declarations × ' || r.role || ' × ' || pr.priv,
         case
           when has_table_privilege(r.role, to_regclass('public.customs_declarations'), pr.priv) then
             case when pr.priv = 'SELECT' then 'true — ✅ 조회 허용' else '⚠️ true — 봉인 실패' end
           else
             case when pr.priv = 'SELECT' then '⚠️ false — 조회 불가' else 'false — ✅ 봉인' end
         end
    from (values ('anon'), ('authenticated')) r(role)
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) pr(priv)
) x
order by 구분, 항목;
