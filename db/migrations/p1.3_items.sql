-- P1.3 품목 마스터 — products 테이블 확장 (1회 실행, Supabase SQL Editor)
-- 실행일: 2026-06-30 (영준 실행 완료)
--
-- 안전장치: 이미 있는 컬럼/인덱스는 자동으로 건너뜁니다(IF NOT EXISTS).
-- 기존 품목 행들은 기본값(위험물=false, 활성=true 등)으로 자동 채워집니다.
-- SPEC §4 A1 / §5 items 모델을 기존 products 테이블 위에 구현한다.
alter table public.products
  add column if not exists code            text,          -- 품목코드(SKU)
  add column if not exists origin_country  text,          -- 원산지
  add column if not exists is_dangerous    boolean not null default false,  -- 위험물여부
  add column if not exists lot_managed     boolean not null default false,  -- 로트 관리여부
  add column if not exists serial_managed  boolean not null default false,  -- 시리얼 관리여부
  add column if not exists active          boolean not null default true,   -- 활성(삭제 대신 비활성)
  add column if not exists updated_at      timestamptz not null default now();

-- 품목코드는 "입력했을 때만" 중복 금지(비워두면 여러 개 허용)
create unique index if not exists products_code_unique
  on public.products (code) where code is not null;
