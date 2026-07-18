-- ============================================================================
--  P4.5 테스트 잔여물 정리 — 1회성 수술 스크립트 (아키텍트 승인 2026-07-18 종결 지시 2)
-- ============================================================================
--  실행: Supabase 대시보드 → SQL Editor → New query → 전체 붙여넣기 → Run 1회.
--  성격: **마이그레이션 아님**(db/migrations 밖 기록용 보존 — 664bd61 전례 형식).
--        SQL Editor 는 postgres(소유자)로 실행되는 승인된 소유자 수술이며,
--        그래서 이 파일로 레포에 기록을 남긴다.
--
--  대상: P4.5 E2E(P45검증 표식) 잔여물 전체 —
--        · 무역서류 4건(CI-202607-001~004)+라인 7  · 선적 SHP-202607-006
--          +화물 3+당사자 3+주문연결 2(+마일스톤 0 — 의존 위치에 명시 포함)
--        · 수주 SO-202607-007/008+라인 3  · 품목 P45-ITEM-1/2  · 거래처 고객A/B
--
--  무역서류 4건 삭제 근거(기록): D1 '삭제 금지'의 보호 대상은 **실거래 이력**이다.
--        이 4건은 가짜 Seller('P45-TEST SELLER') 스냅샷을 품은 테스트 주입물로
--        실전표 참조 0이며, 방치가 문서 대장의 신뢰성을 훼손한다 — P4.4h fx 정리와
--        동일 논리. 식별자도 상태(전부 cancelled)가 아니라 가짜 Seller 표식이다.
--
--  카운터 불가촉(기록): trade_document 4·sales_order 2·shipment 1 소비분은 롤백
--        금지 — 번호 공백은 정직한 상태이고, 롤백은 재사용 충돌 위험+가짜 청결이다.
--        공백 사유는 이 스크립트의 레포 기록이 감사 기록이다. audit_log 불가촉
--        (불변 원칙 — P45 문자열을 품은 감사 행 잔존은 정상이며 아래에 수치 기록).
--
--  절차: [0 사전 광역 탐지(전 테이블 P45 계열 문자열 스캔 — 목록 외 행 포착·보고)]
--        → [행별 비-P45 참조 가드(FK+소프트 포인터 전수 — 참조 존재 시 스킵+보고)]
--        → [FK·가드 트리거를 충족하는 역순 DELETE] → [사후 검증: 표식 잔존=스킵분
--        일치 + 광역 잔존 0 + 전면 스캔 요약(객체 31·위반 0 유지)].
--  순서: 문서라인 → 문서 → 화물라인 → 당사자 → 주문연결 → 마일스톤 → 선적
--        → 수주라인 → 수주 → 품목 → 거래처.
--  트리거 비활성화(session_replication_role 등) 금지 — 순서로 해결한다. 잠금
--        가드(활성 문서)는 4건 전부 cancelled+선삭제라 발화하지 않고, 지연 가드
--        (주문연결 해제·수주라인 소비)는 선적이 cancelled+선삭제라 통과한다.
--        예상 밖 트리거 차단이 나면 전체 롤백된다 — 그 오류 원문을 회신할 것.
--  멱등: 재실행 시 대상이 없으면 아무것도 지우지 않는다(무해).
--  ※ 광역 탐지는 **탐지·보고 전용** — 삭제는 표식 목록 기반 명시 단계로만 한다.
--     사후 광역 잔존이 0 이 아니면 지우지 말고 결과표를 회신(아키텍트 재판정).
-- ============================================================================

create temp table if not exists p45_cleanup_report (
  seq  serial primary key,
  구분 text,
  항목 text,
  값   text
);
truncate table p45_cleanup_report;  -- 재실행 시 이전 결과 혼입 방지(전례 규칙)

do $$
declare
  r           record;
  v_refs      text;
  v_cnt       bigint;
  -- P45 계열 표식 패턴(광역 탐지용 — E2E 가 투입한 문자열 전 계열)
  v_patterns  constant text[] := array[
    '%p45검증%', '%p45-test%', '%p45-item%', '%p45-bkg%', '%p45bl%',
    '%p45u1234%', '%p45 %', '%p45test@%', '%p45-buyer%'];
  -- 식별 집합
  v_doc_ids   uuid[];
  v_ship_ids  uuid[];
  v_so_ids    uuid[];
  v_del_dl integer := 0;
  v_del_doc integer := 0; v_skip_doc integer := 0;
  v_del_sl integer := 0;  v_skip_sl integer := 0;
  v_del_sp integer := 0;  v_del_so_link integer := 0; v_del_ms integer := 0;
  v_del_shp integer := 0; v_skip_shp integer := 0;
  v_del_sol integer := 0; v_skip_sol integer := 0;
  v_del_so integer := 0;  v_skip_so integer := 0;
  v_del_item integer := 0; v_skip_item integer := 0;
  v_del_co integer := 0;   v_skip_co integer := 0;
begin
  -- ── 식별: 표식 기준 (문서=가짜 Seller 스냅샷 / 선적=P45 부킹·B/L 등 / 수주=P45 거래처) ──
  select coalesce(array_agg(id), '{}') into v_doc_ids
    from public.trade_documents where seller_name like 'P45-TEST SELLER%';
  select coalesce(array_agg(id), '{}') into v_ship_ids
    from public.shipments
   where booking_no like 'P45-%' or bl_no like 'P45%'
      or forwarder ilike 'P45 %' or carrier ilike 'P45 %' or vessel_voyage ilike 'P45 %';
  select coalesce(array_agg(id), '{}') into v_so_ids
    from public.sales_orders
   where partner_id in (select id from public.companies where company_name like 'P45검증%');

  insert into p45_cleanup_report(구분, 항목, 값) values
    ('0.식별', '무역서류(가짜 Seller 표식) / 선적(P45 부킹 계열) / 수주(P45 거래처)',
     coalesce(array_length(v_doc_ids, 1), 0) || '건 / ' ||
     coalesce(array_length(v_ship_ids, 1), 0) || '건 / ' ||
     coalesce(array_length(v_so_ids, 1), 0) || '건');

  -- ── 0.사전 광역 탐지 — 전 테이블 text 컬럼 P45 계열 스캔(감사 로그 제외·보고 전용) ──
  for r in
    select c.table_name, c.column_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
       and c.data_type in ('text', 'character varying')
       and c.table_name <> 'audit_log'
  loop
    execute format('select count(*) from public.%I where %I ilike any ($1)',
                   r.table_name, r.column_name) into v_cnt using v_patterns;
    if v_cnt > 0 then
      insert into p45_cleanup_report(구분, 항목, 값)
      values ('0.사전 광역 탐지', r.table_name || '.' || r.column_name, v_cnt::text || '행');
    end if;
  end loop;

  -- ── ① 무역서류 라인 (문서 스코프 — 참조자 없음) ─────────────────────────────
  delete from public.trade_document_lines where document_id = any(v_doc_ids);
  get diagnostics v_del_dl = row_count;
  insert into p45_cleanup_report(구분, 항목, 값)
  values ('1.삭제', '무역서류 라인(문서 스코프)', v_del_dl || '행');

  -- ── ② 무역서류 (가드: issued 는 삭제 불가 — 활성 문서 오삭 방지) ─────────────
  for r in
    select id, doc_number, status from public.trade_documents
     where id = any(v_doc_ids) order by created_at
  loop
    if r.status = 'issued' then
      v_skip_doc := v_skip_doc + 1;
      insert into p45_cleanup_report(구분, 항목, 값)
      values ('스킵(활성 문서)', '무역서류: ' || r.doc_number, '취소 후 재실행 필요');
    else
      delete from public.trade_documents where id = r.id;
      v_del_doc := v_del_doc + 1;
      insert into p45_cleanup_report(구분, 항목, 값)
      values ('1.삭제', '무역서류: ' || r.doc_number || ' (' || r.status || ')', r.id::text);
    end if;
  end loop;

  -- ── ③ 선적 화물 라인 (가드: 잔존 무역서류 라인의 소프트 포인터) ──────────────
  for r in
    select id, item_name from public.shipment_lines
     where shipment_id = any(v_ship_ids) order by item_name, id
  loop
    v_refs := concat_ws(', ',
      case when exists (select 1 from public.trade_document_lines l where l.shipment_line_id = r.id)
           then '무역서류 라인(shipment_line_id)' end);
    if v_refs <> '' then
      v_skip_sl := v_skip_sl + 1;
      insert into p45_cleanup_report(구분, 항목, 값)
      values ('스킵(참조 존재)', '화물 라인: ' || r.item_name, v_refs);
    else
      delete from public.shipment_lines where id = r.id;
      v_del_sl := v_del_sl + 1;
    end if;
  end loop;
  insert into p45_cleanup_report(구분, 항목, 값)
  values ('1.삭제', '선적 화물 라인', v_del_sl || '행 (스킵 ' || v_skip_sl || ')');

  -- ── ④ 선적 당사자 → ⑤ 주문연결 → ⑥ 마일스톤 (선적 스코프 — 참조자 없음) ─────
  delete from public.shipment_parties where shipment_id = any(v_ship_ids);
  get diagnostics v_del_sp = row_count;
  delete from public.shipment_orders where shipment_id = any(v_ship_ids);
  get diagnostics v_del_so_link = row_count;
  delete from public.milestones where shipment_id = any(v_ship_ids);
  get diagnostics v_del_ms = row_count;
  insert into p45_cleanup_report(구분, 항목, 값)
  values ('1.삭제', '당사자 / 주문연결 / 마일스톤',
          v_del_sp || ' / ' || v_del_so_link || ' / ' || v_del_ms || '행');

  -- ── ⑦ 선적 (가드: 잔존 무역서류·화물·당사자·연결) ────────────────────────────
  for r in
    select id, ship_number, status from public.shipments
     where id = any(v_ship_ids) order by created_at
  loop
    v_refs := concat_ws(', ',
      case when exists (select 1 from public.trade_documents d where d.shipment_id = r.id) then '무역서류' end,
      case when exists (select 1 from public.shipment_lines sl where sl.shipment_id = r.id) then '화물 라인' end,
      case when exists (select 1 from public.shipment_parties sp where sp.shipment_id = r.id) then '당사자' end,
      case when exists (select 1 from public.shipment_orders so where so.shipment_id = r.id) then '주문연결' end,
      case when exists (select 1 from public.milestones m where m.shipment_id = r.id) then '마일스톤' end);
    if v_refs <> '' then
      v_skip_shp := v_skip_shp + 1;
      insert into p45_cleanup_report(구분, 항목, 값)
      values ('스킵(참조 존재)', '선적: ' || r.ship_number, v_refs);
    else
      delete from public.shipments where id = r.id;
      v_del_shp := v_del_shp + 1;
      insert into p45_cleanup_report(구분, 항목, 값)
      values ('1.삭제', '선적: ' || r.ship_number || ' (' || coalesce(r.status, '-') || ')', r.id::text);
    end if;
  end loop;

  -- ── ⑧ 수주 라인 (가드: 화물·출고·무역서류 라인·발주 back-to-back 소프트 포인터) ─
  for r in
    select l.id, l.product_name from public.so_lines l
     where l.so_id = any(v_so_ids) order by l.so_id, l.sort_order nulls last, l.id
  loop
    v_refs := concat_ws(', ',
      case when exists (select 1 from public.shipment_lines s where s.order_line_id = r.id) then '선적 화물 라인' end,
      case when exists (select 1 from public.delivery_lines d where d.so_line_id = r.id) then '출고 라인' end,
      case when exists (select 1 from public.trade_document_lines t where t.order_line_id = r.id) then '무역서류 라인' end,
      case when exists (select 1 from public.po_lines p where p.ref_so_line_id = r.id) then '발주 라인(back-to-back)' end);
    if v_refs <> '' then
      v_skip_sol := v_skip_sol + 1;
      insert into p45_cleanup_report(구분, 항목, 값)
      values ('스킵(참조 존재)', '수주 라인: ' || coalesce(r.product_name, '(이름 없음)'), v_refs);
    else
      delete from public.so_lines where id = r.id;
      v_del_sol := v_del_sol + 1;
    end if;
  end loop;
  insert into p45_cleanup_report(구분, 항목, 값)
  values ('1.삭제', '수주 라인', v_del_sol || '행 (스킵 ' || v_skip_sol || ')');

  -- ── ⑨ 수주 (가드: 잔존 라인·주문연결·출고·발주 참조) ─────────────────────────
  for r in
    select id, so_number from public.sales_orders
     where id = any(v_so_ids) order by created_at
  loop
    v_refs := concat_ws(', ',
      case when exists (select 1 from public.so_lines l where l.so_id = r.id) then '수주 라인' end,
      case when exists (select 1 from public.shipment_orders s
                         where s.order_type = 'SO' and s.order_id = r.id) then '선적 연결' end,
      case when exists (select 1 from public.deliveries d
                         where d.ref_doc_type = 'sales_order' and d.ref_doc_id = r.id) then '출고' end,
      case when exists (select 1 from public.purchase_orders p where p.ref_sales_order_id = r.id) then '발주(참조 생성)' end);
    if v_refs <> '' then
      v_skip_so := v_skip_so + 1;
      insert into p45_cleanup_report(구분, 항목, 값)
      values ('스킵(참조 존재)', '수주: ' || r.so_number, v_refs);
    else
      delete from public.sales_orders where id = r.id;
      v_del_so := v_del_so + 1;
      insert into p45_cleanup_report(구분, 항목, 값)
      values ('1.삭제', '수주: ' || r.so_number, r.id::text);
    end if;
  end loop;

  -- ── ⑩ 품목 (하류 참조 8곳 — 664bd61 전례 가드 전수) ──────────────────────────
  for r in
    select id, product_name from public.products
     where product_name like 'P45검증%' order by created_at
  loop
    v_refs := concat_ws(', ',
      case when exists (select 1 from public.inquiries       where product_id = r.id) then '문의' end,
      case when exists (select 1 from public.quotation_items where product_id = r.id) then '견적 라인' end,
      case when exists (select 1 from public.so_lines        where product_id = r.id) then '수주 라인' end,
      case when exists (select 1 from public.po_lines        where product_id = r.id) then '발주 라인' end,
      case when exists (select 1 from public.gr_lines        where item_id    = r.id) then '입고 라인' end,
      case when exists (select 1 from public.delivery_lines  where item_id    = r.id) then '출고 라인' end,
      case when exists (select 1 from public.shipment_lines  where item_id    = r.id) then '선적 화물 라인' end,
      case when exists (select 1 from public.stock_movements where item_id    = r.id) then '재고 원장' end);
    if v_refs <> '' then
      v_skip_item := v_skip_item + 1;
      insert into p45_cleanup_report(구분, 항목, 값)
      values ('스킵(참조 존재)', '품목: ' || r.product_name, v_refs);
    else
      delete from public.products where id = r.id;
      v_del_item := v_del_item + 1;
      insert into p45_cleanup_report(구분, 항목, 값)
      values ('1.삭제', '품목: ' || r.product_name, r.id::text);
    end if;
  end loop;

  -- ── ⑪ 거래처 (하류 참조 6곳 — 664bd61 전례 가드 전수) ────────────────────────
  for r in
    select id, company_name from public.companies
     where company_name like 'P45검증%' order by created_at
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
      insert into p45_cleanup_report(구분, 항목, 값)
      values ('스킵(참조 존재)', '거래처: ' || r.company_name, v_refs);
    else
      delete from public.companies where id = r.id;
      v_del_co := v_del_co + 1;
      insert into p45_cleanup_report(구분, 항목, 값)
      values ('1.삭제', '거래처: ' || r.company_name, r.id::text);
    end if;
  end loop;

  -- ── 2.사후 검증 — 표식 잔존은 스킵분과 정확히 일치해야 정상 ──────────────────
  insert into p45_cleanup_report(구분, 항목, 값) values
    ('2.사후 검증', '무역서류 삭제/스킵/잔존',
     v_del_doc || ' / ' || v_skip_doc || ' / ' ||
     (select count(*) from public.trade_documents where seller_name like 'P45-TEST SELLER%')),
    ('2.사후 검증', '선적 삭제/스킵/잔존',
     v_del_shp || ' / ' || v_skip_shp || ' / ' ||
     (select count(*) from public.shipments
       where booking_no like 'P45-%' or bl_no like 'P45%'
          or forwarder ilike 'P45 %' or carrier ilike 'P45 %' or vessel_voyage ilike 'P45 %')),
    ('2.사후 검증', '수주 삭제/스킵/잔존',
     v_del_so || ' / ' || v_skip_so || ' / ' ||
     (select count(*) from public.sales_orders where id = any(v_so_ids))),
    ('2.사후 검증', '품목 삭제/스킵/잔존',
     v_del_item || ' / ' || v_skip_item || ' / ' ||
     (select count(*) from public.products where product_name like 'P45검증%')),
    ('2.사후 검증', '거래처 삭제/스킵/잔존',
     v_del_co || ' / ' || v_skip_co || ' / ' ||
     (select count(*) from public.companies where company_name like 'P45검증%')),
    ('2.사후 검증', '카운터 불가촉 확인(trade_document 202607 last_no — 4 유지가 정상)',
     coalesce((select last_no::text from public.doc_counters
                where doc_type = 'trade_document' and period = '202607'), '(행 없음)'));

  -- ── 3.사후 광역 탐지 — 전 테이블 P45 계열 잔존(0 이 정상 — 감사 로그 제외) ────
  v_cnt := 0;
  for r in
    select c.table_name, c.column_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
       and c.data_type in ('text', 'character varying')
       and c.table_name <> 'audit_log'
  loop
    declare v_c bigint;
    begin
      execute format('select count(*) from public.%I where %I ilike any ($1)',
                     r.table_name, r.column_name) into v_c using v_patterns;
      if v_c > 0 then
        v_cnt := v_cnt + v_c;
        insert into p45_cleanup_report(구분, 항목, 값)
        values ('3.광역 잔존(0이 정상)', r.table_name || '.' || r.column_name, v_c::text || '행');
      end if;
    end;
  end loop;
  insert into p45_cleanup_report(구분, 항목, 값) values
    ('3.광역 잔존(0이 정상)', '합계(컬럼 매치 총합)',
     case when v_cnt = 0 then '0 — ✅ 표식 잔존 없음'
          else v_cnt::text || ' — ⚠️ 잔존(지우지 말고 이 표를 회신 — 아키텍트 재판정)' end),
    ('3.광역 잔존(0이 정상)', 'audit_log 내 P45 관련 행(불변 기록 — 잔존이 정상)',
     (select count(*)::text from public.audit_log
       where before_json::text ilike '%p45검증%' or after_json::text ilike '%p45검증%'
          or before_json::text ilike '%p45-test%' or after_json::text ilike '%p45-test%'));

  -- ── 4.전면 스캔 요약 — 정리가 봉인을 건드리지 않았음(객체 31·위반 0 유지) ─────
  insert into p45_cleanup_report(구분, 항목, 값)
  select '4.전면 스캔 요약', 'public 테이블·뷰 총수(31 유지가 정상)', count(*)::text
    from pg_class cls join pg_namespace n on n.oid = cls.relnamespace
   where n.nspname = 'public' and cls.relkind in ('r', 'p', 'v', 'm');
  insert into p45_cleanup_report(구분, 항목, 값)
  select '4.전면 스캔 요약', '쓰기권한 위반 건수(0이 정상)',
         case when count(*) = 0 then '0 — ✅ 봉인 유지' else count(*)::text || ' — ⚠️ 봉인 이상' end
    from (
      select 1
        from pg_class cls
        join pg_namespace n on n.oid = cls.relnamespace
        cross join (values ('anon'), ('authenticated')) rr(role)
        cross join (values ('INSERT'), ('UPDATE'), ('DELETE')) pr(priv)
       where n.nspname = 'public' and cls.relkind in ('r', 'p', 'v', 'm')
         and has_table_privilege(rr.role, cls.oid, pr.priv)
    ) viol;
end $$;

-- 마지막 문장 = 결과표 (SQL Editor 는 마지막 SELECT 만 보여준다 — 드래그 복사해 회신)
select 구분, 항목, 값 from p45_cleanup_report order by seq;
