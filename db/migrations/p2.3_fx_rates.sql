-- ============================================================================
--  P2.3 — 환율 기록 대장(fx_rates)   (SPEC F5, 원칙 1-B 돈=금액+통화·원칙 5 불변)
-- ============================================================================
--  실행: Supabase 대시보드 → SQL Editor → New query → 이 파일 전체 붙여넣기 → Run.
--  성격: 신규 테이블 1개만 추가. 멱등(재실행 무해). 라이브 객체 무변경.
--
--  ⚠️ 이미 DB에 존재하는 라이브 객체는 재생성/오버로딩/재실행 금지:
--       next_doc_number(text,text,text) · save_quotation(...) · save_sales_order(...)
--       · fn_audit() · quotations · quotation_items · sales_orders · so_lines · companies
--     이 파일은 신규 객체(fx_rates)만 추가한다. 새 RPC도 만들지 않는다.
--
--  설계:
--   · 추가-전용 대장(원칙 5) — UPDATE/DELETE 권한을 안 준다. 정정은 새 행 추가.
--   · rate = "1 quote_currency = rate × base_currency" — 항상 **1단위 기준으로 정규화** 저장
--     (예: 1 USD = 1,350 KRW → rate=1350).
--   · ⚠️ 100단위 고시 통화(JPY 등) 함정: 한국 은행은 100엔당 원화(예: 905)로 고시한다.
--     이를 그대로 넣으면 금액이 100배 틀어진다. → quote_unit(고시단위, JPY=100)을 함께 저장하고
--     rate는 정규화값(905/100 = 9.05, 1엔당)으로 저장한다. 정규화는 입력 폼/서비스 한 곳에서만
--     수행(원칙 7) → 프리필·문서·합계 등 모든 소비자는 1단위 rate만 쓰므로 절대 100배 오류 없음.
--     원본 고시값 = rate × quote_unit 으로 언제든 재현(감사·표시용).
--   · 최신 환율 = quote_currency별 rate_date desc, quoted_at desc, created_at desc 첫 행.
--   · 문서(견적/수주)는 이 대장을 FK로 참조하지 않는다 — 폼이 값을 "복사(스냅샷)"만 한다.
--     → 대장에 새 환율이 쌓여도 과거 문서의 exchange_rate는 영원히 불변(원칙 1-B).
--   · 단일 행 저장이라 SECURITY DEFINER RPC 불필요 — 앱이 직접 INSERT(원자성 이슈 없음).
--     (다중문 원자성이 필요한 save_quotation/save_sales_order와 달리 라인·발번이 없다.)
--   · 감사 트리거 미부착: 대장 자체가 이미 append-only 불변 → fn_audit 부착은 중복.
-- ============================================================================

-- 1) 환율 대장 (추가 전용)
create table if not exists public.fx_rates (
  id             uuid primary key default gen_random_uuid(),
  base_currency  text        not null,             -- 기준통화 (앱 BASE_CURRENCY와 일치, 예: KRW)
  quote_currency text        not null,             -- 대상통화 (USD·EUR·JPY…)
  rate           numeric     not null,             -- **1단위 정규화값**: 1 quote = rate × base
  quote_unit     numeric     not null default 1,   -- 고시단위(원본 표기): JPY=100, 대부분 1. 원본고시=rate×quote_unit
  rate_date      date        not null,             -- 적용 고시일
  source         text,                             -- 출처 (한국은행·하나은행 고시·수동입력…)
  quoted_at      timestamptz,                      -- 고시 시점(있으면)
  note           text,
  created_at     timestamptz not null default now()
);
-- 최신 환율 조회용(기준통화 고정 + 대상통화별 최신 정렬).
create index if not exists fx_rates_lookup_idx
  on public.fx_rates (base_currency, quote_currency, rate_date desc, created_at desc);
-- ※ (base, quote, rate_date) 유니크 제약은 두지 않는다 — 같은 날 정정도 새 행으로 허용(원칙 5).

-- 2) 권한: SELECT + INSERT 만. UPDATE/DELETE 미부여 → 앱이 대장을 수정·삭제할 수 없다(원칙 5).
--    (인증 도입 전 현 단계는 anon 사용 — 쓰기경로 세분권한은 P8 RBAC에서 강화)
grant select, insert on public.fx_rates to anon, authenticated;

-- 3) PostgREST 스키마 캐시 새로고침 — 새 테이블을 REST API가 즉시 인식하게 한다.
--    (없으면 "Could not find the table 'public.fx_rates' in the schema cache" 발생)
notify pgrst, 'reload schema';

-- ── 검증(선택) ──────────────────────────────────────────────────────────────
--   insert into public.fx_rates (base_currency, quote_currency, rate, quote_unit, rate_date, source)
--   values ('KRW','USD',1350,   1, current_date,'수동입력'),   -- 1 USD = 1,350 KRW
--          ('KRW','JPY',9.05, 100, current_date,'수동입력');   -- 100 JPY = 905 KRW → 1엔당 9.05
--   select quote_currency, rate, quote_unit, (rate*quote_unit) as as_quoted, rate_date
--     from public.fx_rates order by created_at desc limit 5;

-- ── 되돌리기(rollback) ───────────────────────────────────────────────────────
--   drop table if exists public.fx_rates;
