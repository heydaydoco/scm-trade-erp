-- P1.4 문의 — inquiries 테이블에 품목 소프트 링크 추가 (1회 실행, Supabase SQL Editor)
-- 실행일: 2026-06-30 (영준 실행 완료)
--
-- 안전장치: 이미 있으면 건너뜀(IF NOT EXISTS). 기존 문의 행은 product_id = NULL로 채워짐.
-- 기존 product_name(자유텍스트)은 그대로 두고, 품목 마스터에서 고른 경우에만
-- product_id(products 참조)를 함께 저장한다. 카탈로그에 없는 품목은 product_id = NULL.
-- (거래처는 기존 company_id FK가 이미 있어 추가 작업 없음.)
alter table public.inquiries
  add column if not exists product_id uuid
    references public.products(id) on delete set null;

-- '이 품목으로 들어온 문의' 조회를 빠르게
create index if not exists inquiries_product_id_idx
  on public.inquiries (product_id);
