-- ============================================================================
--  P4.4h 테스트 잔여물 정리 — 1회성 수술 스크립트 (아키텍트 승인 2026-07-17 판정 5)
-- ============================================================================
--  실행: Supabase 대시보드 → SQL Editor → New query → 전체 붙여넣기 → Run 1회.
--  성격: **마이그레이션 아님**(db/migrations 밖에 기록용으로만 보존).
--        SQL Editor 는 postgres(소유자)로 실행되어 봉인 밖 경로다 — 봉인 우회가
--        아니라 승인된 소유자 수술이며, 그래서 이 파일로 기록을 남긴다.
--  대상: 표식 문자열 기준 일괄 식별 —
--        · 거래처  companies.company_name  LIKE 'P44H검증%'
--        · 품목    products.product_name   LIKE 'P44H검증%'
--        · 문의    inquiries.product_name  LIKE 'P44H검증%'
--        · 환율    fx_rates.source         LIKE 'P4.4h%'
--  절차: 행별 하류 참조 가드(FK·소프트 포인터 전수) → 참조 존재 시 스킵+보고,
--        없으면 DELETE → 사후 잔존 검증(잔존 = 스킵분과 일치해야 정상)
--        + 광역 탐지(ILIKE 비접두 변형까지 — 표식 패턴을 패턴 자신으로 검증하는
--        순환 맹점 보완) + 고아 SELECT 봉인·고아 참조 뷰 검증(기록).
--  가드 범위 주석: 고아 7종(claims 등)은 이 가드 목록에 없다 — P4.4h 인구조사
--        결과 **전 행 0**이라 무엇도 참조할 수 없음이 증명돼 있다(감사표 기록).
--  순서: 문의 → 품목 → 거래처 → 환율. 테스트 문의가 테스트 거래처·품목을 참조
--        하므로 문의를 먼저 지워야 거래처·품목 가드가 오탐하지 않는다.
--  fx 행 삭제 근거(기록): 원칙 4의 보호 대상은 전표가 참조한 이력이다. 이 행들은
--        어떤 전표도 참조한 적 없는 테스트 주입값이라 보존할 이력이 없고, 방치가
--        오히려 환율 대장 신뢰성을 훼손한다. (fx_rates 는 설계상 FK 참조가 없다 —
--        문서는 환율을 스냅샷 복사하므로 하류 가드 대상 자체가 없음.)
--  멱등: 재실행 시 대상이 없으면 아무것도 지우지 않는다(무해).
--  ※ companies·products 삭제는 감사 트리거(fn_audit)가 audit_log 에 기록한다.
--
--  ⚠️ 향후 관례(성문화): 라이브 E2E 검증 데이터는 표식 명명 필수 + 종료 시
--     잔여물 목록 보고 + 아키텍트 승인 하의 정리만(임의 삭제 금지).
-- ============================================================================

create temp table if not exists p44h_cleanup_report (
  seq  serial primary key,
  구분 text,
  항목 text,
  값   text
);
-- 같은 세션 재실행 시 이전 결과가 섞이지 않게 비운다(drop 이 아니라 truncate —
-- search_path 오해로 동명의 실테이블을 지우는 사고를 구조적으로 배제).
truncate table p44h_cleanup_report;

do $$
declare
  r          record;
  v_refs     text;
  v_del_inq  integer := 0;  v_skip_inq  integer := 0;
  v_del_item integer := 0;  v_skip_item integer := 0;
  v_del_co   integer := 0;  v_skip_co   integer := 0;
  v_del_fx   integer := 0;
begin
  -- ── ① 문의 (하류 참조: quotations.inquiry_id) ────────────────────────────
  for r in
    select id, product_name from public.inquiries
     where product_name like 'P44H검증%' order by created_at
  loop
    v_refs := concat_ws(', ',
      case when exists (select 1 from public.quotations q where q.inquiry_id = r.id)
           then '견적(quotations.inquiry_id)' end);
    if v_refs <> '' then
      v_skip_inq := v_skip_inq + 1;
      insert into p44h_cleanup_report(구분, 항목, 값)
      values ('스킵(참조 존재)', '문의: ' || r.product_name, v_refs);
    else
      delete from public.inquiries where id = r.id;
      v_del_inq := v_del_inq + 1;
      insert into p44h_cleanup_report(구분, 항목, 값)
      values ('삭제', '문의: ' || r.product_name, r.id::text);
    end if;
  end loop;

  -- ── ② 품목 (하류 참조 8곳: 문의·견적/수주/발주 라인·입고/출고/화물 라인·원장) ─
  for r in
    select id, product_name from public.products
     where product_name like 'P44H검증%' order by created_at
  loop
    v_refs := concat_ws(', ',
      case when exists (select 1 from public.inquiries       where product_id = r.id) then '문의(product_id)' end,
      case when exists (select 1 from public.quotation_items where product_id = r.id) then '견적 라인' end,
      case when exists (select 1 from public.so_lines        where product_id = r.id) then '수주 라인' end,
      case when exists (select 1 from public.po_lines        where product_id = r.id) then '발주 라인' end,
      case when exists (select 1 from public.gr_lines        where item_id    = r.id) then '입고 라인' end,
      case when exists (select 1 from public.delivery_lines  where item_id    = r.id) then '출고 라인' end,
      case when exists (select 1 from public.shipment_lines  where item_id    = r.id) then '선적 화물 라인' end,
      case when exists (select 1 from public.stock_movements where item_id    = r.id) then '재고 원장' end);
    if v_refs <> '' then
      v_skip_item := v_skip_item + 1;
      insert into p44h_cleanup_report(구분, 항목, 값)
      values ('스킵(참조 존재)', '품목: ' || r.product_name, v_refs);
    else
      delete from public.products where id = r.id;
      v_del_item := v_del_item + 1;
      insert into p44h_cleanup_report(구분, 항목, 값)
      values ('삭제', '품목: ' || r.product_name, r.id::text);
    end if;
  end loop;

  -- ── ③ 거래처 (하류 참조 6곳: 문의·견적·수주·발주·선적·선적 당사자) ────────
  for r in
    select id, company_name from public.companies
     where company_name like 'P44H검증%' order by created_at
  loop
    v_refs := concat_ws(', ',
      case when exists (select 1 from public.inquiries        where company_id = r.id) then '문의' end,
      case when exists (select 1 from public.quotations       where company_id = r.id) then '견적' end,
      case when exists (select 1 from public.sales_orders     where partner_id = r.id) then '수주' end,
      case when exists (select 1 from public.purchase_orders  where partner_id = r.id) then '발주' end,
      case when exists (select 1 from public.shipments        where partner_id = r.id) then '선적' end,
      case when exists (select 1 from public.shipment_parties where company_id = r.id) then '선적 당사자' end);
    if v_refs <> '' then
      v_skip_co := v_skip_co + 1;
      insert into p44h_cleanup_report(구분, 항목, 값)
      values ('스킵(참조 존재)', '거래처: ' || r.company_name, v_refs);
    else
      delete from public.companies where id = r.id;
      v_del_co := v_del_co + 1;
      insert into p44h_cleanup_report(구분, 항목, 값)
      values ('삭제', '거래처: ' || r.company_name, r.id::text);
    end if;
  end loop;

  -- ── ④ 환율 (참조 없음 — 설계상 FK 미사용, 전표는 스냅샷 복사) ─────────────
  for r in
    select id, quote_currency, rate, rate_date from public.fx_rates
     where source like 'P4.4h%' order by created_at
  loop
    delete from public.fx_rates where id = r.id;
    v_del_fx := v_del_fx + 1;
    insert into p44h_cleanup_report(구분, 항목, 값)
    values ('삭제', '환율: ' || r.quote_currency || ' ' || r.rate || ' (' || r.rate_date || ')',
            r.id::text || ' — 참조 없음(설계)');
  end loop;

  -- ── ⑤ 사후 검증 — 잔존은 스킵분과 정확히 일치해야 정상 ────────────────────
  insert into p44h_cleanup_report(구분, 항목, 값) values
    ('사후 검증', '문의 삭제/스킵/잔존',
     v_del_inq || ' / ' || v_skip_inq || ' / ' ||
     (select count(*) from public.inquiries where product_name like 'P44H검증%')),
    ('사후 검증', '품목 삭제/스킵/잔존',
     v_del_item || ' / ' || v_skip_item || ' / ' ||
     (select count(*) from public.products where product_name like 'P44H검증%')),
    ('사후 검증', '거래처 삭제/스킵/잔존',
     v_del_co || ' / ' || v_skip_co || ' / ' ||
     (select count(*) from public.companies where company_name like 'P44H검증%')),
    ('사후 검증', '환율 삭제/잔존',
     v_del_fx || ' / ' ||
     (select count(*) from public.fx_rates where source like 'P4.4h%')),
    ('사후 검증', '판정',
     case when (select count(*) from public.inquiries where product_name like 'P44H검증%') = v_skip_inq
           and (select count(*) from public.products  where product_name like 'P44H검증%') = v_skip_item
           and (select count(*) from public.companies where company_name like 'P44H검증%') = v_skip_co
           and (select count(*) from public.fx_rates  where source like 'P4.4h%') = 0
          then '✅ 정상 — 잔존은 전부 스킵분'
          else '⚠️ 불일치 — 잔존이 스킵분과 다름(재확인 필요)' end);

  -- ── ⑥ 광역 탐지 — 삭제 패턴을 패턴 자신으로 검증하는 순환 맹점 보완 ────────
  --  대소문자·비접두 변형(예: '[P4.4h] …', 'p44h…')까지 ILIKE 로 훑는다.
  --  기대: 거래처·품목·문의는 스킵분과 일치, 환율은 0. 초과분이 나오면 표식이
  --  어긋난 테스트 행이 살아남은 것 — 특히 환율은 fx_rates_latest 프리필을
  --  오염시키므로(최신 행이 이긴다) 0 이 아니면 반드시 재확인.
  insert into p44h_cleanup_report(구분, 항목, 값) values
    ('광역 탐지', '거래처 ILIKE %p44h% 잔존(스킵분과 일치가 정상)',
     (select count(*) from public.companies where company_name ilike '%p44h%')::text || ' (스킵 ' || v_skip_co || ')'),
    ('광역 탐지', '품목 ILIKE %p44h% 잔존(스킵분과 일치가 정상)',
     (select count(*) from public.products where product_name ilike '%p44h%')::text || ' (스킵 ' || v_skip_item || ')'),
    ('광역 탐지', '문의 ILIKE %p44h% 잔존(스킵분과 일치가 정상)',
     (select count(*) from public.inquiries where product_name ilike '%p44h%')::text || ' (스킵 ' || v_skip_inq || ')'),
    ('광역 탐지', '환율 출처·비고 ILIKE %p4.4h% 잔존(0이 정상)',
     (select count(*) from public.fx_rates
       where source ilike '%p4.4h%' or note ilike '%p4.4h%')::text),
    ('광역 탐지', '판정',
     case when (select count(*) from public.companies where company_name ilike '%p44h%') = v_skip_co
           and (select count(*) from public.products  where product_name ilike '%p44h%') = v_skip_item
           and (select count(*) from public.inquiries where product_name ilike '%p44h%') = v_skip_inq
           and (select count(*) from public.fx_rates  where source ilike '%p4.4h%' or note ilike '%p4.4h%') = 0
          then '✅ 정상 — 광역 탐지에도 초과 잔존 없음'
          else '⚠️ 초과 잔존 — 표식이 어긋난 테스트 행 의심(회신 후 재확인)' end);

  -- ── ⑦ 고아 봉인 검증(기록) — SELECT 회수 여부 + 고아를 참조하는 뷰 부재 ────
  --  전면 스캔 감사는 INSERT/UPDATE/DELETE 만 보므로 SELECT 봉인은 여기서 기록한다.
  --  뷰는 소유자 권한으로 실행되어 고아 참조 뷰가 있으면 SELECT 봉인이 우회된다.
  insert into p44h_cleanup_report(구분, 항목, 값)
  select '고아 SELECT 봉인', t.tbl,
         case when to_regclass('public.' || t.tbl) is null then 'absent'
              else 'anon select=' ||
                   has_table_privilege('anon', to_regclass('public.' || t.tbl), 'SELECT')::text ||
                   ' (false 가 정상)'
         end
    from (values
      ('claims'), ('customs_declarations'), ('orders'), ('order_items'),
      ('payments'), ('production_orders'), ('shipments_legacy_20260714072446')
    ) t(tbl);

  insert into p44h_cleanup_report(구분, 항목, 값) values
    ('고아 SELECT 봉인', '고아 참조 뷰 수(0이 정상)',
     (select count(*)::text from pg_views v
       where v.schemaname = 'public'
         and (v.definition ~* '\mclaims\M'
              or v.definition ~* '\mcustoms_declarations\M'
              or v.definition ~* '\morders\M'
              or v.definition ~* '\morder_items\M'
              or v.definition ~* '\mpayments\M'
              or v.definition ~* '\mproduction_orders\M'
              or v.definition ~* '\mshipments_legacy_20260714072446\M')));
end $$;

-- 마지막 문장 = 결과표 (SQL Editor 는 마지막 SELECT 만 보여준다 — 드래그 복사해 회신)
select 구분, 항목, 값 from p44h_cleanup_report order by seq;
