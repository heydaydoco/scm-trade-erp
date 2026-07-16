-- ============================================================================
--  000 — 베이스라인: P1.1/P1.2 시절 대시보드에서 직접 만들어진 5개 테이블
-- ============================================================================
--  ⚠️ 라이브 DB에서는 전부 no-op 이다.
--     모든 문장이 `if not exists` 라서, 이미 있는 객체는 건드리지 않고 조용히 지나간다.
--     데이터·제약·권한·RLS 무변경. 실수로 여러 번 Run 해도 무해하다.
--
--  왜 필요한가 (P4.0-c):
--     companies · products · inquiries · quotations · quotation_items 이 5개는
--     저장소에 생성 SQL이 없고 Supabase DB에만 존재했다. p1.3/p1.4는 ALTER만 한다.
--     → 빈 DB에 마이그레이션을 순서대로 돌리면 p1.3에서 즉시 실패했다(재구축 불가).
--     이 파일이 그 구멍을 메워, 000 → p1.1 → p1.3 → … 순서로 빈 DB가 재구축된다.
--
--  출처: 라이브 DB의 pg_catalog 조회 결과 그대로(2026-07-16).
--        조회 도구는 db/migrations/_p4.0c_inspect_live_schema.sql (읽기 전용).
--        P1.1이 next_doc_number를 소급 기록한 것과 같은 성격의 "관측 기반 재구성"이다.
--
--  실행: Supabase 대시보드 → SQL Editor → New query → 붙여넣기 → Run.
-- ============================================================================
--
--  ※ 제약 이름에 대하여
--    제약을 `alter table add constraint` 로 쓰면 재실행 시 "already exists" 로 죽는다.
--    그래서 전부 create table 안에 인라인으로 넣었다 — PostgreSQL이 자동으로 붙이는
--    이름(companies_pkey, inquiries_company_id_fkey, quotations_quotation_number_key …)이
--    라이브의 실제 제약 이름과 정확히 일치하므로, 재구축된 DB가 라이브와 같은 모양이 된다.
--
--  ※ 권한(grant)에 대하여 — 의도적으로 넣지 않았다
--    라이브의 5개 테이블은 anon/authenticated/service_role 에게
--    select·insert·update·delete·truncate·references·trigger 가 전부 부여돼 있다.
--    5개가 완전히 동일한 것은 누가 손으로 준 게 아니라 Supabase가 public 스키마에 걸어둔
--    `alter default privileges … grant all on tables` 의 결과다(새 프로젝트에서도 자동 적용).
--    따라서 재구축 시 별도 grant 없이 같은 상태가 된다.
--    → 이 권한 폭이 적절한지(특히 anon 의 delete/truncate)는 SPEC I6 권한(P8)에서 다룬다.
--      여기서 명시적으로 재현하면 그 상태를 저장소가 "의도"로 승인해버리므로 남기지 않는다.
--
--  ※ RLS: 5개 테이블 모두 비활성(라이브 확인). P8 권한 단계의 대상.
-- ============================================================================

-- ── 1) companies — 거래처 마스터 (도메인 Partner로 매핑, 원칙 7) ─────────────
--    company_type: buyer/supplier/both  → 서비스가 customer/supplier/both 로 매핑.
--    ⚠️ SPEC A3가 명시한 biz_reg_no(사업자번호)·credit_limit(신용한도) 칸이 없다.
--       P4.0-d에서 SPEC 서술을 실물에 맞게 정정하고 백로그로 옮긴다.
create table if not exists public.companies (
  id            uuid primary key default gen_random_uuid(),
  company_name  text not null,
  company_type  text,
  country       text,
  city          text,
  address       text,
  contact_name  text,
  contact_email text,
  contact_phone text,
  currency      text default 'USD'::text,
  payment_terms text,
  incoterms     text,
  notes         text,
  created_at    timestamp with time zone default now(),
  updated_at    timestamp with time zone default now(),
  active        boolean not null default true,
  constraint companies_company_type_check
    check (company_type = any (array['buyer'::text, 'supplier'::text, 'both'::text]))
);

-- ── 2) products — 품목 마스터 (도메인 Item으로 매핑) ─────────────────────────
--    code·origin_country·is_dangerous·lot_managed·serial_managed·active·updated_at 은
--    p1.3_items.sql 이 ALTER로 추가한 컬럼이다. 여기 이미 포함돼 있으므로
--    빈 DB에서 p1.3의 `add column if not exists` 는 no-op가 된다(순서 안전).
--    ⚠️ lot_managed/serial_managed 는 P4.2 재고 원장이 읽을 플래그다(활성화는 P5).
create table if not exists public.products (
  id             uuid primary key default gen_random_uuid(),
  product_name   text not null,
  hs_code        text,
  unit           text default 'PCS'::text,
  description    text,
  created_at     timestamp with time zone default now(),
  unit_price     numeric,
  currency       text default 'USD'::text,
  active         boolean not null default true,
  code           text,
  origin_country text,
  is_dangerous   boolean not null default false,
  lot_managed    boolean not null default false,
  serial_managed boolean not null default false,
  updated_at     timestamp with time zone not null default now()
);

-- 품목코드 중복 방지 (code가 있는 행만 — 코드 없는 품목은 여러 개 허용).
create unique index if not exists products_code_unique
  on public.products using btree (code) where (code is not null);

-- ── 3) inquiries — 문의 (P1.4에서 이식) ──────────────────────────────────────
--    company_id: 거래처 정식 참조(임베드 조인으로 거래처명 표시).
--    product_id: 품목 소프트 링크 — 미등록 품목은 product_name 자유텍스트로 두고 null.
--                on delete set null 이라 품목이 지워져도 문의는 남는다.
create table if not exists public.inquiries (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid references public.companies(id),
  inquiry_date           date default current_date,
  product_name           text,
  hs_code                text,
  quantity               numeric,
  unit                   text,
  target_price           numeric,
  currency               text default 'USD'::text,
  incoterms              text,
  destination_country    text,
  destination_port       text,
  required_delivery_date date,
  sample_requested       boolean default false,
  sample_sent_date       date,
  nda_required           boolean default false,
  nda_signed_date        date,
  status                 text default 'received'::text,
  notes                  text,
  created_at             timestamp with time zone default now(),
  updated_at             timestamp with time zone default now(),
  payment_terms          text,
  destination_airport    text,
  transport              text default 'sea'::text,
  product_id             uuid references public.products(id) on delete set null,
  constraint inquiries_status_check
    check (status = any (array['received'::text, 'reviewing'::text, 'quoted'::text,
                               'negotiating'::text, 'won'::text, 'lost'::text, 'on_hold'::text]))
);

create index if not exists inquiries_product_id_idx
  on public.inquiries using btree (product_id);

-- ── 4) quotations — 견적 헤더 (P1.5, 헤더-라인의 첫 등장) ────────────────────
--    quotation_number UNIQUE: 원자적 발번(원칙 6)의 마지막 방어선.
--      next_doc_number가 원자적으로 번호를 주지만, 만에 하나 중복이 만들어지면
--      여기서 저장이 실패한다(조용한 중복이 아니라 시끄러운 에러 = 올바른 동작).
--    exchange_rate: 확정 시점 스냅샷(원칙 1-B). fx_rates를 FK로 물지 않는다.
create table if not exists public.quotations (
  id                  uuid primary key default gen_random_uuid(),
  quotation_number    text not null unique,
  inquiry_id          uuid references public.inquiries(id) on delete set null,
  company_id          uuid references public.companies(id) on delete set null,
  quotation_date      date default current_date,
  valid_until         date,
  currency            text default 'USD'::text,
  exchange_rate       numeric default 1,
  incoterms           text,
  payment_terms       text,
  destination_country text,
  destination_port    text,
  destination_airport text,
  transport           text default 'sea'::text,
  subtotal            numeric default 0,
  discount            numeric default 0,
  total_amount        numeric default 0,
  status              text default 'draft'::text,
  notes               text,
  terms_conditions    text,
  created_at          timestamp with time zone default now(),
  updated_at          timestamp with time zone default now(),
  constraint quotations_status_check
    check (status = any (array['draft'::text, 'sent'::text, 'approved'::text,
                               'rejected'::text, 'expired'::text]))
);

-- ── 5) quotation_items — 견적 라인 (원칙 2: 합계는 항상 라인의 합) ───────────
--    quotation_id on delete cascade: save_quotation이 저장 시 라인을 전량 DELETE 후
--    재INSERT 하는 패턴의 근거. (⚠️ 이 "전량 교체" 패턴은 P4.2 재고 원장에는
--     절대 쓰지 않는다 — 원장은 append-only, 정정은 역분개다. 원칙 1.)
create table if not exists public.quotation_items (
  id           uuid primary key default gen_random_uuid(),
  quotation_id uuid references public.quotations(id) on delete cascade,
  product_id   uuid references public.products(id) on delete set null,
  product_name text not null,
  hs_code      text,
  description  text,
  quantity     numeric not null default 0,
  unit         text default 'PCS'::text,
  unit_price   numeric not null default 0,
  amount       numeric not null default 0,
  sort_order   integer default 0,
  created_at   timestamp with time zone default now()
);

-- PostgREST 스키마 캐시 갱신 (이 프로젝트의 알려진 함정 — 없으면 새 객체를 못 찾는다).
notify pgrst, 'reload schema';

-- ── 검증(선택) ──────────────────────────────────────────────────────────────
--   select table_name from information_schema.tables
--    where table_schema='public'
--      and table_name in ('companies','products','inquiries','quotations','quotation_items')
--    order by table_name;
--   → 5행이 나오면 정상(라이브에서는 원래 있던 그대로).
