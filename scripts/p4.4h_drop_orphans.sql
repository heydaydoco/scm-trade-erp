-- ============================================================================
--  P4.4h 고아 7종 DROP — 1회성 스크립트 (아키텍트 종결 승인 2026-07-17)
-- ============================================================================
--  실행: Supabase 대시보드 → SQL Editor → New query → 전체 붙여넣기 → Run 1회.
--  성격: **마이그레이션 아님**(db/migrations 밖, 기록용 보존 — 정리 SQL 관례,
--        664bd61 전례). SQL Editor 는 postgres(소유자)로 실행된다.
--  대상: claims · customs_declarations · orders · order_items · payments ·
--        production_orders · shipments_legacy_20260714072446
--  승인 근거(기록): 인구조사 전원 0행 + 앱 코드 참조 0건 + 고아 참조 뷰 0 +
--        레포에 생성 SQL 부재 — 빈 DB 재구축 시 존재하지 않을 테이블이라 DROP 이
--        곧 스키마 드리프트 해소다. 잔존 시 미래 단계(클레임·통관·생산 등)의
--        명칭 충돌 위험만 남는다.
--  안전장치:
--   · ① Run 시점에 존재·행수를 **재확인** — 하나라도 행이 생겼으면 그 테이블은
--     DROP 에서 제외하고 결과표에 표시한다(인구조사 이후의 변화 방어).
--   · ② 대상 전원을 **단일 DROP 문**으로 — 고아끼리의 상호 FK 는 함께 지워져
--     무해하다. **CASCADE 금지**: 모르는 외부 의존이 있으면 에러로 멈추는 것이
--     정상 동작이다(무엇을 놓쳤는지 드러난다).
--   · ③ 사후 검증 — 7종 to_regclass 전부 absent + 전면 스캔 요약 재출력
--     (기대: 객체 총수 36 → 29, 쓰기권한 위반 0행 유지).
--  멱등: 재실행 시 전부 absent 로 보고되고 아무것도 지우지 않는다(무해).
-- ============================================================================

create temp table if not exists p44h_drop_report (
  seq  serial primary key,
  구분 text,
  항목 text,
  값   text
);
truncate table p44h_drop_report;

do $$
declare
  t         text;
  v_cnt     bigint;
  v_targets text[] := '{}'::text[];
begin
  -- ── ① 존재·행수 재확인 — 0행인 것만 DROP 대상에 올린다 ────────────────────
  foreach t in array array[
    'claims', 'customs_declarations', 'orders', 'order_items',
    'payments', 'production_orders', 'shipments_legacy_20260714072446'
  ]
  loop
    if to_regclass('public.' || t) is null then
      insert into p44h_drop_report(구분, 항목, 값)
      values ('① 재확인', t, 'absent — 이미 없음(스킵)');
    else
      execute format('select count(*) from public.%I', t) into v_cnt;
      if v_cnt > 0 then
        insert into p44h_drop_report(구분, 항목, 값)
        values ('① 재확인', t, v_cnt || '행 — ⚠️ DROP 제외(빈 테이블 아님 — 재실사 필요)');
      else
        v_targets := v_targets || t;
        insert into p44h_drop_report(구분, 항목, 값)
        values ('① 재확인', t, '0행 — DROP 대상');
      end if;
    end if;
  end loop;

  -- ── ② 단일 DROP (CASCADE 없음 — 외부 의존 발견 시 여기서 에러로 멈춘다) ────
  if array_length(v_targets, 1) is not null then
    execute 'drop table '
      || (select string_agg(format('public.%I', x), ', ') from unnest(v_targets) x);
    insert into p44h_drop_report(구분, 항목, 값)
    values ('② DROP 실행', array_to_string(v_targets, ', '),
            array_length(v_targets, 1) || '개 — 단일 문·CASCADE 없음');
  else
    insert into p44h_drop_report(구분, 항목, 값)
    values ('② DROP 실행', '(대상 없음)', '아무것도 지우지 않음');
  end if;

  -- ── ③ 사후 검증 — 7종 전부 absent + 전면 스캔 요약 재출력 ─────────────────
  foreach t in array array[
    'claims', 'customs_declarations', 'orders', 'order_items',
    'payments', 'production_orders', 'shipments_legacy_20260714072446'
  ]
  loop
    insert into p44h_drop_report(구분, 항목, 값)
    values ('③ 사후 검증', t,
            case when to_regclass('public.' || t) is null
                 then 'absent (정상)' else '⚠️ 잔존' end);
  end loop;

  insert into p44h_drop_report(구분, 항목, 값)
  select '③ 스캔 요약', 'public 테이블·뷰 총수(기대 29)', count(*)::text
    from pg_class cls
    join pg_namespace n on n.oid = cls.relnamespace
   where n.nspname = 'public' and cls.relkind in ('r', 'p', 'v', 'm');

  insert into p44h_drop_report(구분, 항목, 값)
  select '③ 스캔 요약', '쓰기권한 위반 건수(0이 정상)', count(*)::text
    from (
      select 1
        from pg_class cls
        join pg_namespace n on n.oid = cls.relnamespace
        cross join (values ('anon'), ('authenticated')) r(role)
        cross join (values ('INSERT'), ('UPDATE'), ('DELETE')) pr(priv)
       where n.nspname = 'public'
         and cls.relkind in ('r', 'p', 'v', 'm')
         and has_table_privilege(r.role, cls.oid, pr.priv)
    ) v;
end $$;

-- PostgREST 스키마 캐시 갱신 — 지워진 테이블이 캐시에 남지 않게.
notify pgrst, 'reload schema';

-- 마지막 문장 = 결과표 (드래그 복사해 회신)
select 구분, 항목, 값 from p44h_drop_report order by seq;
