-- =====================================================================
--  Trade ERP — SAP급 데이터 아키텍처 (Phase 1: Foundation)
--  대상: PostgreSQL / Supabase
--  성격: 멱등(idempotent) · 가산(additive). 기존 데이터를 파괴하지 않습니다.
--        몇 번을 다시 실행해도 안전합니다.
--
--  구성
--   0) 공통(확장/트리거)
--   1) 조직 구조        (Enterprise Structure)
--   2) 번호 범위        (Number Ranges, SAP NRIV)
--   3) 마스터 데이터    (Business Partner / Material / BOM / Payment Terms)
--   4) 문서 흐름·상태   (Document Flow VBFA / Status Management)
--   5) 재무·회계        (GL Accounts / Journal Entries / AR Aging)
--   6) 통제·워크플로우  (Users / Roles / Authorizations / Approvals / Audit)
--   7) 기존 거래 문서 보강 (orders/quotations/... 컬럼 추가)
--   8) 시드 데이터      (조직·번호범위·계정과목·역할·결제조건 등)
--   9) 분석 뷰          (AR aging / document flow)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) 공통
-- ---------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- updated_at 자동 갱신 트리거 함수
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------
-- 1) 조직 구조 (Enterprise Structure)
--    Client > Company Code(회사코드/법인·FI 단위) > Sales Org / Plant
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_company_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT UNIQUE NOT NULL,            -- 예: '1000'
  name        TEXT NOT NULL,
  currency    TEXT DEFAULT 'KRW',
  country     TEXT DEFAULT 'KR',
  tax_number  TEXT,
  address     TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS org_sales_orgs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT UNIQUE NOT NULL,        -- 예: 'EXP'
  name            TEXT NOT NULL,
  company_code_id UUID REFERENCES org_company_codes(id),
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS org_plants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT UNIQUE NOT NULL,        -- 예: 'P100'
  name            TEXT NOT NULL,
  company_code_id UUID REFERENCES org_company_codes(id),
  address         TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 2) 번호 범위 (Number Ranges) — 문서번호 채번을 DB에서 원자적으로 관리
--    next_number('sales_order') => 'SO-2026-0001'
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS number_ranges (
  object      TEXT PRIMARY KEY,                -- 예: 'sales_order'
  prefix      TEXT NOT NULL DEFAULT '',        -- 예: 'SO'
  current_no  BIGINT NOT NULL DEFAULT 0,
  width       INT  NOT NULL DEFAULT 4,
  year_reset  BOOLEAN NOT NULL DEFAULT TRUE,   -- 매년 0001로 리셋
  last_year   INT
);

CREATE OR REPLACE FUNCTION next_number(p_object TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  r       number_ranges%ROWTYPE;
  v_year  INT := EXTRACT(YEAR FROM now())::INT;
  v_no    BIGINT;
BEGIN
  SELECT * INTO r FROM number_ranges WHERE object = p_object FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO number_ranges(object, prefix, last_year)
      VALUES (p_object, UPPER(LEFT(p_object,2)), v_year)
      RETURNING * INTO r;
  END IF;

  IF r.year_reset AND (r.last_year IS DISTINCT FROM v_year) THEN
    v_no := 1;
  ELSE
    v_no := r.current_no + 1;
  END IF;

  UPDATE number_ranges
     SET current_no = v_no, last_year = v_year
   WHERE object = p_object;

  RETURN r.prefix || '-' || v_year::TEXT || '-' || LPAD(v_no::TEXT, r.width, '0');
END $$;

-- ---------------------------------------------------------------------
-- 3) 마스터 데이터 (Master Data)
-- ---------------------------------------------------------------------
-- 결제 조건 마스터
CREATE TABLE IF NOT EXISTS payment_terms (
  code        TEXT PRIMARY KEY,                -- 예: 'TT30'
  name        TEXT NOT NULL,                   -- 예: 'T/T 30 days'
  due_days    INT DEFAULT 0,
  method      TEXT,                            -- tt/lc/cad/oa
  description TEXT
);

-- BOM (자재 명세서) — 생산 모듈의 자재 소요 산출용. products(id)를 소프트 참조.
CREATE TABLE IF NOT EXISTS material_bom (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id   UUID NOT NULL,                 -- 완제품 products.id
  component_id  UUID NOT NULL,                 -- 구성품 products.id
  quantity      NUMERIC NOT NULL DEFAULT 1,
  uom           TEXT DEFAULT 'PCS',
  scrap_pct     NUMERIC DEFAULT 0,
  sort_order    INT DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bom_material ON material_bom(material_id);

-- ---------------------------------------------------------------------
-- 4) 문서 흐름(Document Flow) + 상태 관리(Status Management)
-- ---------------------------------------------------------------------
-- VBFA 유사: 선행문서 -> 후속문서 연결 (타입+UUID 소프트 링크)
CREATE TABLE IF NOT EXISTS document_flow (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  predecessor_type   TEXT NOT NULL,            -- 'quotation','order','production',...
  predecessor_id     UUID NOT NULL,
  predecessor_no     TEXT,
  successor_type     TEXT NOT NULL,
  successor_id       UUID NOT NULL,
  successor_no       TEXT,
  flow_qty           NUMERIC,
  note               TEXT,
  created_by         TEXT,
  created_at         TIMESTAMPTZ DEFAULT now(),
  UNIQUE (predecessor_type, predecessor_id, successor_type, successor_id)
);
CREATE INDEX IF NOT EXISTS idx_flow_pred ON document_flow(predecessor_type, predecessor_id);
CREATE INDEX IF NOT EXISTS idx_flow_succ ON document_flow(successor_type, successor_id);

-- 상태 전이 규칙 (허용 transition). requires_role 가 있으면 통제 대상.
CREATE TABLE IF NOT EXISTS doc_status_transitions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type      TEXT NOT NULL,
  from_status   TEXT NOT NULL,
  to_status     TEXT NOT NULL,
  label         TEXT,
  requires_role TEXT,                          -- NULL=누구나, 그 외=해당 역할 필요
  UNIQUE (doc_type, from_status, to_status)
);

-- 상태 변경 이력 (모든 문서 공통)
CREATE TABLE IF NOT EXISTS document_status_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type    TEXT NOT NULL,
  doc_id      UUID NOT NULL,
  doc_no      TEXT,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  note        TEXT,
  changed_by  TEXT,
  changed_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_status_hist_doc ON document_status_history(doc_type, doc_id);

-- ---------------------------------------------------------------------
-- 5) 재무·회계 (FI / GL)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gl_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_no      TEXT UNIQUE NOT NULL,        -- 예: '1200'
  name            TEXT NOT NULL,               -- 외상매출금
  type            TEXT NOT NULL,               -- asset/liability/equity/revenue/expense
  company_code_id UUID REFERENCES org_company_codes(id),
  is_recon        BOOLEAN DEFAULT FALSE,       -- 통제계정(AR/AP)
  active          BOOLEAN DEFAULT TRUE
);

-- 회계 전표 헤더
CREATE TABLE IF NOT EXISTS journal_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_no          TEXT UNIQUE,                 -- JE-2026-0001
  company_code_id UUID REFERENCES org_company_codes(id),
  posting_date    DATE DEFAULT CURRENT_DATE,
  doc_date        DATE DEFAULT CURRENT_DATE,
  currency        TEXT DEFAULT 'USD',
  fx_rate         NUMERIC DEFAULT 1,
  ref_type        TEXT,                        -- 'shipment','payment',...
  ref_id          UUID,
  ref_no          TEXT,
  description     TEXT,
  partner_id      UUID,                        -- companies.id (소프트)
  total_debit     NUMERIC DEFAULT 0,
  total_credit    NUMERIC DEFAULT 0,
  is_reversed     BOOLEAN DEFAULT FALSE,
  reversal_of     UUID,
  posted_by       TEXT,
  posted_at       TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_je_ref ON journal_entries(ref_type, ref_id);

-- 회계 전표 라인
CREATE TABLE IF NOT EXISTS journal_entry_lines (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id      UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  line_no       INT NOT NULL DEFAULT 1,
  gl_account_id UUID REFERENCES gl_accounts(id),
  gl_account_no TEXT,
  debit         NUMERIC DEFAULT 0,
  credit        NUMERIC DEFAULT 0,
  partner_id    UUID,
  description   TEXT
);
CREATE INDEX IF NOT EXISTS idx_jel_entry ON journal_entry_lines(entry_id);

-- ---------------------------------------------------------------------
-- 6) 통제·워크플로우 (Controls / Workflow)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_roles (
  code        TEXT PRIMARY KEY,                -- admin/sales/production/finance/viewer
  name        TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS app_users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT UNIQUE NOT NULL,
  name        TEXT,
  role_code   TEXT REFERENCES app_roles(code),
  active      BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- 역할별 권한 (object = 모듈/문서타입)
CREATE TABLE IF NOT EXISTS role_authorizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_code   TEXT REFERENCES app_roles(code),
  object      TEXT NOT NULL,                   -- 'order','quotation','payment','gl',...
  can_create  BOOLEAN DEFAULT FALSE,
  can_read    BOOLEAN DEFAULT TRUE,
  can_update  BOOLEAN DEFAULT FALSE,
  can_delete  BOOLEAN DEFAULT FALSE,
  can_approve BOOLEAN DEFAULT FALSE,
  UNIQUE (role_code, object)
);

-- 승인 요청 (워크플로우)
CREATE TABLE IF NOT EXISTS approval_requests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type       TEXT NOT NULL,
  doc_id         UUID NOT NULL,
  doc_no         TEXT,
  amount         NUMERIC,
  currency       TEXT,
  reason         TEXT,                          -- 승인 필요 사유(예: 신용한도 초과, 할인율 초과)
  status         TEXT DEFAULT 'pending',        -- pending/approved/rejected/cancelled
  approver_role  TEXT,
  requested_by   TEXT,
  requested_at   TIMESTAMPTZ DEFAULT now(),
  decided_by     TEXT,
  decided_at     TIMESTAMPTZ,
  decision_note  TEXT
);
CREATE INDEX IF NOT EXISTS idx_appr_status ON approval_requests(status);
CREATE INDEX IF NOT EXISTS idx_appr_doc ON approval_requests(doc_type, doc_id);

-- 감사 로그 (append-only)
CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ts          TIMESTAMPTZ DEFAULT now(),
  user_email  TEXT,
  action      TEXT NOT NULL,                   -- create/update/delete/status/post/approve/reject
  object_type TEXT,
  object_id   UUID,
  object_no   TEXT,
  before_data JSONB,
  after_data  JSONB,
  note        TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_obj ON audit_log(object_type, object_id);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts DESC);

-- ---------------------------------------------------------------------
-- 7) 기존 거래 문서 보강 (존재할 때만 컬럼 추가 — 안전)
-- ---------------------------------------------------------------------
-- 거래처(=Business Partner) 마스터 보강
ALTER TABLE IF EXISTS companies ADD COLUMN IF NOT EXISTS bp_role         TEXT DEFAULT 'customer'; -- customer/vendor/both
ALTER TABLE IF EXISTS companies ADD COLUMN IF NOT EXISTS credit_limit    NUMERIC DEFAULT 0;
ALTER TABLE IF EXISTS companies ADD COLUMN IF NOT EXISTS credit_currency TEXT DEFAULT 'USD';
ALTER TABLE IF EXISTS companies ADD COLUMN IF NOT EXISTS payment_terms_code TEXT;
ALTER TABLE IF EXISTS companies ADD COLUMN IF NOT EXISTS incoterms_default  TEXT;
ALTER TABLE IF EXISTS companies ADD COLUMN IF NOT EXISTS tax_number      TEXT;
ALTER TABLE IF EXISTS companies ADD COLUMN IF NOT EXISTS rating          TEXT;     -- 신용등급 A/B/C
ALTER TABLE IF EXISTS companies ADD COLUMN IF NOT EXISTS blocked         BOOLEAN DEFAULT FALSE;

-- 품목(=Material) 마스터 보강
ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS material_type TEXT DEFAULT 'FERT'; -- FERT완제품/HALB반제품/ROH원자재
ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS std_cost      NUMERIC DEFAULT 0;    -- 표준원가(마진/COGS 계산)
ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS std_price     NUMERIC DEFAULT 0;
ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS net_weight_kg NUMERIC DEFAULT 0;
ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS plant_id      UUID;

-- 모든 거래 문서 공통 보강: 조직배정 / 감사 / 승인상태
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['quotations','orders','production_orders',
                           'customs_declarations','shipments','payments','claims'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS company_code_id UUID', t);
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS sales_org_id UUID', t);
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT ''none''', t);
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS created_by TEXT', t);
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS updated_by TEXT', t);
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS gl_posted BOOLEAN DEFAULT FALSE', t);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 8) 시드 데이터 (재실행 안전: ON CONFLICT DO NOTHING)
-- ---------------------------------------------------------------------
-- 8.1 조직
INSERT INTO org_company_codes(code, name, currency, country)
VALUES ('1000', '본사 (Head Office)', 'KRW', 'KR')
ON CONFLICT (code) DO NOTHING;

INSERT INTO org_sales_orgs(code, name, company_code_id)
SELECT 'EXP', '수출영업본부', id FROM org_company_codes WHERE code='1000'
ON CONFLICT (code) DO NOTHING;

INSERT INTO org_plants(code, name, company_code_id)
SELECT 'P100', '본社 공장', id FROM org_company_codes WHERE code='1000'
ON CONFLICT (code) DO NOTHING;

-- 8.2 번호 범위
INSERT INTO number_ranges(object, prefix, width) VALUES
  ('quotation',  'QT', 4),
  ('sales_order','SO', 4),
  ('production',  'PR', 4),
  ('customs',     'CU', 4),
  ('shipment',    'SH', 4),
  ('payment',     'PM', 4),
  ('claim',       'CL', 4),
  ('journal',     'JE', 4),
  ('approval',    'AP', 4)
ON CONFLICT (object) DO NOTHING;

-- 8.3 결제 조건
INSERT INTO payment_terms(code, name, due_days, method, description) VALUES
  ('TT_ADV', 'T/T in advance',     0,  'tt',  '선급 T/T'),
  ('TT30',   'T/T 30 days',        30, 'tt',  'B/L 후 30일'),
  ('TT60',   'T/T 60 days',        60, 'tt',  'B/L 후 60일'),
  ('LC_SImport','L/C at sight',    0,  'lc',  '일람불 신용장'),
  ('LC_USANCE','L/C usance 90d',   90, 'lc',  '기한부 신용장'),
  ('CAD',    'Cash against doc',   0,  'cad', '서류상환'),
  ('OA60',   'Open account 60d',   60, 'oa',  '청산결제 60일')
ON CONFLICT (code) DO NOTHING;

-- 8.4 계정과목 (수출 무역 표준 차트)
INSERT INTO gl_accounts(account_no, name, type, is_recon) VALUES
  ('1100','현금및예금',        'asset',    FALSE),
  ('1200','외상매출금',        'asset',    TRUE),
  ('1210','받을어음/매입외환', 'asset',    TRUE),
  ('1300','재고자산',          'asset',    FALSE),
  ('1310','미착품',            'asset',    FALSE),
  ('2100','외상매입금',        'liability',TRUE),
  ('2200','선수금',            'liability',FALSE),
  ('2300','부가세예수금',      'liability',FALSE),
  ('3000','자본금',            'equity',   FALSE),
  ('4000','제품매출',          'revenue',  FALSE),
  ('4100','수출매출',          'revenue',  FALSE),
  ('4200','외환차익',          'revenue',  FALSE),
  ('5000','매출원가',          'expense',  FALSE),
  ('6100','지급수수료',        'expense',  FALSE),
  ('6200','외환차손',          'expense',  FALSE),
  ('6300','운임/부대비용',     'expense',  FALSE)
ON CONFLICT (account_no) DO NOTHING;

-- 8.5 역할
INSERT INTO app_roles(code, name, description) VALUES
  ('admin',     '관리자',   '전체 권한'),
  ('sales',     '영업',     '문의·견적·수주'),
  ('production','생산',     '생산/발주'),
  ('logistics', '물류',     '통관·선적·서류'),
  ('finance',   '재무',     '대금·전표·승인'),
  ('viewer',    '조회',     '읽기 전용')
ON CONFLICT (code) DO NOTHING;

-- 8.6 기본 사용자(현재 사용자 = 관리자)
INSERT INTO app_users(email, name, role_code)
VALUES ('junebee7@naver.com', '관리자', 'admin')
ON CONFLICT (email) DO NOTHING;

-- 8.7 역할별 권한 매트릭스
INSERT INTO role_authorizations(role_code, object, can_create, can_read, can_update, can_delete, can_approve) VALUES
  ('admin','*',          TRUE, TRUE, TRUE, TRUE, TRUE),
  ('sales','quotation',  TRUE, TRUE, TRUE, TRUE, FALSE),
  ('sales','order',      TRUE, TRUE, TRUE, FALSE,FALSE),
  ('sales','company',    TRUE, TRUE, TRUE, FALSE,FALSE),
  ('production','production', TRUE, TRUE, TRUE, FALSE, FALSE),
  ('logistics','customs',TRUE, TRUE, TRUE, FALSE,FALSE),
  ('logistics','shipment',TRUE,TRUE, TRUE, FALSE,FALSE),
  ('finance','payment',  TRUE, TRUE, TRUE, FALSE,TRUE),
  ('finance','gl',       TRUE, TRUE, TRUE, FALSE,TRUE),
  ('finance','order',    FALSE,TRUE, FALSE,FALSE,TRUE),
  ('viewer','*',         FALSE,TRUE, FALSE,FALSE,FALSE)
ON CONFLICT (role_code, object) DO NOTHING;

-- 8.8 상태 전이 규칙 (수주 Order 예시 — 문서흐름 척추)
INSERT INTO doc_status_transitions(doc_type, from_status, to_status, label, requires_role) VALUES
  ('order','received','confirmed',     '수주 확인',  'sales'),
  ('order','confirmed','in_production','생산 착수',  'production'),
  ('order','in_production','ready',    '선적 준비',  'production'),
  ('order','ready','shipped',          '선적 완료',  'logistics'),
  ('order','shipped','completed',      '거래 완료',  'finance'),
  ('order','received','cancelled',     '취소',       'sales'),
  ('order','confirmed','cancelled',    '취소',       'sales'),
  ('quotation','draft','sent',         '발송',       'sales'),
  ('quotation','sent','won',           '수주 전환',  'sales'),
  ('quotation','sent','lost',          '실주',       'sales'),
  ('payment','pending','partial',      '부분 입금',  'finance'),
  ('payment','pending','completed',    '입금 완료',  'finance'),
  ('payment','partial','completed',    '입금 완료',  'finance')
ON CONFLICT (doc_type, from_status, to_status) DO NOTHING;

-- ---------------------------------------------------------------------
-- 9) 분석 뷰
-- ---------------------------------------------------------------------
-- 9.1 AR(미수금) Aging — payments 테이블이 있을 때만 생성
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='payments') THEN
    EXECUTE $v$
      CREATE OR REPLACE VIEW v_ar_aging AS
      SELECT
        p.id,
        p.company_id,
        p.invoice_currency,
        COALESCE(p.outstanding_amount,0) AS outstanding,
        p.due_date,
        CASE
          WHEN p.due_date IS NULL THEN 'no_due'
          WHEN p.due_date >= CURRENT_DATE THEN 'current'
          WHEN p.due_date >= CURRENT_DATE - 30 THEN '1-30'
          WHEN p.due_date >= CURRENT_DATE - 60 THEN '31-60'
          WHEN p.due_date >= CURRENT_DATE - 90 THEN '61-90'
          ELSE '90+'
        END AS aging_bucket
      FROM payments p
      WHERE COALESCE(p.outstanding_amount,0) > 0
        AND COALESCE(p.status,'') <> 'completed';
    $v$;
  END IF;
END $$;

-- 9.2 문서 흐름 그래프 (양방향 조회 편의)
CREATE OR REPLACE VIEW v_document_flow AS
SELECT predecessor_type AS from_type, predecessor_id AS from_id, predecessor_no AS from_no,
       successor_type   AS to_type,   successor_id   AS to_id,   successor_no   AS to_no,
       flow_qty, created_at
FROM document_flow;

-- ---------------------------------------------------------------------
-- 10) 권한 부여 (Supabase anon/authenticated 가 새 테이블/함수 접근)
--     기존 앱이 anon 키로 직접 CRUD 하므로 동일 정책을 새 객체에도 적용.
--     역할이 없는 환경(비-Supabase)에서도 에러 없이 건너뛴다.
--     ※ 보안 하드닝(RLS)은 Blueprint의 Phase 5 항목.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    GRANT USAGE ON SCHEMA public TO anon;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    GRANT USAGE ON SCHEMA public TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
  END IF;
END $$;

-- =====================================================================
--  실행 끝. 결과 확인:
--    SELECT next_number('sales_order');     -- SO-2026-0001
--    SELECT * FROM gl_accounts ORDER BY account_no;
--    SELECT * FROM doc_status_transitions WHERE doc_type='order';
-- =====================================================================
