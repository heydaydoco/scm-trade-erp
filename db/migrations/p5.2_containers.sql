-- ============================================================================
--  P5.2 — 적입(E5): 컨테이너 · 라인 배분 · VGM   (커밋 a: 마이그레이션 + RPC 1종)
-- ============================================================================
--  아키텍트 확정 스펙(P5.2) 반영. 재계획·재해석 금지.
--
--  · 범위: 선적 하위 실측 기록 2테이블(shipment_containers·shipment_container_
--          allocations) + 유일 쓰기 RPC 1종(save_shipment_containers). 전표 아님
--          → 채번 없음. doc_counters·chainLogic·기일엔진 무변경. 인쇄물 없음
--          (S/I 이관은 커밋 d, CI/PL 스냅샷 확장은 백로그).
--  · 적입 지표(배분 포장수 합·비례 G.W./CBM·용적률 등)는 전부 파생 계산 표시 전용
--          — 저장 컬럼 없음(SPEC 판정 ④). VGM(입력)과 G.W. 합(파생)은 별개·상호검증 없음.
--  · 텍스트 3필드(container_no·container_type·seal_no)는 RPC 에서 nullif(btrim())
--          정규화만 — 대문자 강제·문자 제거·ISO 체크디지트 검증 금지(입력 기록 원칙).
--  · shipments.container_no 헤더 스칼라는 P5.2에서 사장(폼·읽기체인·S/I셀 제거는
--          커밋 d) — 컬럼 존치, 잠긴 save_shipment RPC 무수정, trade_documents 체인 유지.
--  · 쓰기 경로: SECURITY DEFINER RPC save_shipment_containers 뿐. 직접 테이블 쓰기
--          금지(출생 봉인). 발행(issued CI/PL) 잠금 비대상 — update_shipment_marks
--          선례 동급(적입 실측은 발행 후에도 갱신 가능).
--
--  · FK 정책(SPEC 이월 문구): "hard RESTRICT 원칙은 전표-대-전표 발행 앵커 전용,
--          동일 전표 하위 실측 기록은 cascade." → 컨테이너/배분은 선적·화물라인·
--          컨테이너 삭제 시 cascade 동반 소멸(의도된 동작, 임의 '수정' 금지).
--
--  · diff-upsert(save_shipment_cargo 동형·판정): 두 자식셋 모두 payload 부재 행 = 삭제.
--          - shipment_containers: id-diff-upsert(shipment_lines 선례 — 가변컬럼 unique 없음).
--          - shipment_container_allocations: unique(container_id, shipment_line_id)가
--            있어 shipment_parties 선례대로 **전량교체(delete-all + insert)** — 라인 간
--            배분 스왑 시의 순간적 unique 위반을 원천 차단(참조자 없는 조인 행). {id|null}
--            payload 는 수용하되 저장 재사용 안 함(전량교체). "payload 부재 = 삭제" 충족.
--
--  실행: Supabase 대시보드 → SQL Editor → New query → 붙여넣기 → Run.
--  성격: 순수 추가(신규 2테이블·인덱스·감사 트리거 1종[shipment_containers만]·RPC 1종) · 멱등
--        (if not exists / create or replace / drop-if-exists). 기존 객체 무수정.
--
--  ⚠️ 실행 전제(P5.1 종결 기준선): public 테이블·뷰 총수 32 · 위반 0행 ·
--     shipment_containers·shipment_container_allocations 부재(고아 없음) ·
--     shipment_lines(id uuid) 실존 · fn_audit() 실존.
--  ⚠️ 맨 끝 감사 SELECT 가 이 파일의 마지막 문장 — 결과표 전체를 드래그 복사해 회신한다.
--     기대: 위반 0행 · 객체 총수 34(기존 32 + 신규 2) · prosecdef true(save_shipment_
--           containers) · 신규 2테이블 present · 제약·인덱스·트리거 1종 존재 · 출생봉인 완벽.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) shipment_containers — 컨테이너 실측(번호·타입·씰·VGM)
-- ----------------------------------------------------------------------------
--  텍스트 3필드는 입력 기록 원칙(정규화만). vgm_kg 는 입력값(파생 G.W. 합과 별개).
create table if not exists public.shipment_containers (
  id             uuid primary key default gen_random_uuid(),
  shipment_id    uuid not null
                 constraint shipment_containers_shipment_id_fkey
                 references public.shipments (id) on delete cascade,   -- 하위 실측 = cascade
  container_no   text,
  container_type text,
  seal_no        text,
  -- NaN/Infinity 차단은 P4.1f 확립 패턴(NaN 은 >=0 비교를 통과한다) — RPC 가 재검사.
  vgm_kg         numeric
                 constraint shipment_containers_vgm_kg_check
                 check (vgm_kg is null or vgm_kg >= 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- 출생 봉인 (P4.4h 관례 — Supabase 기본권한 전권 함정, 명시적 REVOKE 만 유효)
revoke all on public.shipment_containers from anon, authenticated;
grant select on public.shipment_containers to anon, authenticated;

-- 인덱스: 선적 역조회
create index if not exists idx_shipment_containers_shipment
  on public.shipment_containers (shipment_id);

-- 감사 트리거 (fn_audit 재사용 — 기존 함수 무수정)
drop trigger if exists trg_audit_shipment_containers on public.shipment_containers;
create trigger trg_audit_shipment_containers
  after insert or update or delete on public.shipment_containers
  for each row execute function public.fn_audit();

-- ----------------------------------------------------------------------------
-- 2) shipment_container_allocations — 컨테이너 × 화물라인 포장수 배분(선택적)
-- ----------------------------------------------------------------------------
--  과배분(라인 포장수 초과)·포장수 null 라인 배분은 서버 무차단(UI 경고 담당).
--  참조자 없는 조인 행 — 저장은 RPC 가 전량교체(스왑 unique 위반 차단).
create table if not exists public.shipment_container_allocations (
  id                      uuid primary key default gen_random_uuid(),
  container_id            uuid not null
                          constraint shipment_container_allocations_container_id_fkey
                          references public.shipment_containers (id) on delete cascade,
  shipment_line_id        uuid not null
                          constraint shipment_container_allocations_line_id_fkey
                          references public.shipment_lines (id) on delete cascade,
  allocated_package_count integer not null
                          constraint shipment_container_allocations_count_check
                          check (allocated_package_count > 0),
  created_at              timestamptz not null default now(),
  constraint shipment_container_allocations_uniq unique (container_id, shipment_line_id)
);

-- 출생 봉인
revoke all on public.shipment_container_allocations from anon, authenticated;
grant select on public.shipment_container_allocations to anon, authenticated;

-- 인덱스: 라인 역조회(라인별 배분 잔여 계산). unique 제약이 container_id 조회 겸용.
create index if not exists idx_shipment_container_allocations_line
  on public.shipment_container_allocations (shipment_line_id);

-- 감사 트리거 없음(의도적) — 배분은 전량교체(delete-all+insert)되는 **무참조 리프**
--  (인바운드 FK·스냅샷·외부 id 참조 0, 배분 id 외부 참조는 향후에도 금지 — SPEC 이월).
--  전량교체 자식 테이블에 감사를 붙이면 순 변경 0에도 churn 만 남는다(p2.1 관례:
--  quotation_items 등 전량교체 라인 테이블 감사 미부착). 실측 기록인 shipment_containers
--  1테이블만 감사한다.
--  (아키텍트 판정 2026-07-22 — 스펙의 '감사 2테이블'은 diff-upsert 전제 오지정, 본 판정이 대체.)

-- ----------------------------------------------------------------------------
-- 3) RPC — save_shipment_containers (SECURITY DEFINER, 유일 쓰기 경로)
-- ----------------------------------------------------------------------------
--  save_shipment_cargo 동형. 컨테이너 = id-diff-upsert(ref→id 맵 반환),
--  배분 = 전량교체(container_ref 로 신규·기존 공통 해석). 발행 잠금 비대상.
--
--  payload 키(save_shipment_cargo 관례 = camelCase):
--    p_containers[]  : { ref(필수·고유), id?(기존), containerNo?, containerType?,
--                        sealNo?, vgmKg? }
--    p_allocations[] : { id?, containerRef(필수·컨테이너 ref 참조), shipmentLineId,
--                        allocatedPackageCount }
create or replace function public.save_shipment_containers(
  p_shipment_id uuid,
  p_containers  jsonb,
  p_allocations jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shp         public.shipments%rowtype;
  v_c           jsonb;
  v_a           jsonb;
  v_no          integer := 0;
  v_ref         text;
  v_id          uuid;
  v_vgm         numeric;
  v_seen_refs   text[]  := '{}'::text[];
  v_keep        uuid[]  := '{}'::uuid[];
  v_ref_map     jsonb   := '{}'::jsonb;
  v_cid         uuid;
  v_line_id     uuid;
  v_line_shp    uuid;
  v_apc         integer;
  v_seen_alloc  text[]  := '{}'::text[];
  v_akey        text;
begin
  -- for update: 같은 선적에 동시 저장이 들어와도 직렬화(save_shipment_cargo 선례).
  select * into v_shp from public.shipments where id = p_shipment_id for update;
  if not found then
    raise exception '선적을 찾을 수 없습니다: %', p_shipment_id;
  end if;
  if v_shp.status = 'cancelled' then
    raise exception '취소된 선적에는 컨테이너 내역을 저장할 수 없습니다.';
  end if;

  if p_containers is null or jsonb_typeof(p_containers) <> 'array' then
    raise exception '컨테이너 payload 형식이 잘못됐습니다(배열 필요).';
  end if;
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' then
    raise exception '배분 payload 형식이 잘못됐습니다(배열 필요).';
  end if;

  -- ── 1) 컨테이너 upsert (id-diff) + ref→id 맵 ─────────────────────────────
  for v_c in select * from jsonb_array_elements(p_containers)
  loop
    v_no := v_no + 1;

    -- ref: 전 행 필수·payload 내 고유(배분이 신규·기존 컨테이너를 공통 참조하는 키).
    v_ref := nullif(btrim(coalesce(v_c->>'ref', '')), '');
    if v_ref is null then
      raise exception '컨테이너 임시키(ref)가 없습니다. (%번째 컨테이너)', v_no;
    end if;
    if v_ref = any (v_seen_refs) then
      raise exception '컨테이너 임시키(ref)가 중복됩니다: % (%번째)', v_ref, v_no;
    end if;
    v_seen_refs := v_seen_refs || v_ref;

    -- vgm: null 허용, 값이 오면 유한·비음수만.
    v_vgm := nullif(btrim(coalesce(v_c->>'vgmKg', '')), '')::numeric;
    if v_vgm is not null
       and (v_vgm in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) or v_vgm < 0) then
      raise exception 'VGM(kg)은 0 이상의 유한한 숫자여야 합니다. (%번째 컨테이너, 받은 값: %)',
        v_no, v_c->>'vgmKg';
    end if;

    v_id := nullif(btrim(coalesce(v_c->>'id', '')), '')::uuid;
    if v_id is not null then
      -- shipment_id 스코프 필수 — 다른 선적의 컨테이너 id 로 UPDATE 우회 차단.
      update public.shipment_containers
         set container_no   = nullif(btrim(coalesce(v_c->>'containerNo', '')), ''),
             container_type = nullif(btrim(coalesce(v_c->>'containerType', '')), ''),
             seal_no        = nullif(btrim(coalesce(v_c->>'sealNo', '')), ''),
             vgm_kg         = v_vgm,
             updated_at     = now()
       where id = v_id and shipment_id = p_shipment_id;
      if not found then
        raise exception '이 선적의 컨테이너가 아닙니다. (%번째)', v_no;
      end if;
    else
      insert into public.shipment_containers (
        shipment_id, container_no, container_type, seal_no, vgm_kg
      ) values (
        p_shipment_id,
        nullif(btrim(coalesce(v_c->>'containerNo', '')), ''),
        nullif(btrim(coalesce(v_c->>'containerType', '')), ''),
        nullif(btrim(coalesce(v_c->>'sealNo', '')), ''),
        v_vgm
      )
      returning id into v_id;
    end if;

    v_keep    := v_keep || v_id;
    v_ref_map := v_ref_map || jsonb_build_object(v_ref, v_id::text);
  end loop;

  -- diff DELETE: payload 에서 빠진 컨테이너만 삭제(빈 배열 = 전부). 배분은 cascade 소멸.
  delete from public.shipment_containers
   where shipment_id = p_shipment_id and id <> all (v_keep);

  -- ── 2) 배분 전량교체 (unique(container,line) 스왑 안전 — shipment_parties 선례) ─
  --  위 컨테이너 diff DELETE 로 빠진 컨테이너의 배분은 이미 cascade 소멸. 여기서
  --  남은(유지 컨테이너의) 배분까지 전부 지우고 payload 로 재삽입한다.
  delete from public.shipment_container_allocations a
   using public.shipment_containers c
   where a.container_id = c.id and c.shipment_id = p_shipment_id;

  v_no := 0;
  for v_a in select * from jsonb_array_elements(p_allocations)
  loop
    v_no := v_no + 1;

    -- container_ref → 방금 upsert 된 컨테이너 id 로 해석(신규·기존 공통). 미해석 = 거부.
    v_ref := nullif(btrim(coalesce(v_a->>'containerRef', '')), '');
    if v_ref is null then
      raise exception '배분의 컨테이너 참조(containerRef)가 없습니다. (%번째 배분)', v_no;
    end if;
    v_cid := nullif(v_ref_map->>v_ref, '')::uuid;
    if v_cid is null then
      raise exception '배분이 참조하는 컨테이너(ref=%)를 찾을 수 없습니다. (%번째 배분)', v_ref, v_no;
    end if;

    -- 배분 대상 화물 라인: 실존 + 이 선적 소속 강제(컨테이너 선적 = 라인 선적).
    v_line_id := nullif(btrim(coalesce(v_a->>'shipmentLineId', '')), '')::uuid;
    if v_line_id is null then
      raise exception '배분 대상 화물 라인(shipmentLineId)이 없습니다. (%번째 배분)', v_no;
    end if;
    select shipment_id into v_line_shp from public.shipment_lines where id = v_line_id;
    if not found then
      raise exception '배분 대상 화물 라인을 찾을 수 없습니다. (%번째 배분)', v_no;
    end if;
    if v_line_shp is distinct from p_shipment_id then
      raise exception '다른 선적의 화물 라인에는 배분할 수 없습니다. (%번째 배분)', v_no;
    end if;

    -- 배분 포장수: 양의 정수만. 과배분·포장수 null 라인 배분은 무차단(UI 경고).
    v_apc := nullif(btrim(coalesce(v_a->>'allocatedPackageCount', '')), '')::integer;
    if v_apc is null or v_apc <= 0 then
      raise exception '배분 포장수는 1 이상의 정수여야 합니다. (%번째 배분, 받은 값: %)',
        v_no, v_a->>'allocatedPackageCount';
    end if;

    -- (컨테이너, 라인) 중복 거부 — unique 제약의 친절 사전차단.
    v_akey := v_cid::text || '|' || v_line_id::text;
    if v_akey = any (v_seen_alloc) then
      raise exception '같은 컨테이너에 같은 화물 라인이 두 번 배분되었습니다. (%번째 배분)', v_no;
    end if;
    v_seen_alloc := v_seen_alloc || v_akey;

    insert into public.shipment_container_allocations (
      container_id, shipment_line_id, allocated_package_count
    ) values (
      v_cid, v_line_id, v_apc
    );
  end loop;

  return jsonb_build_object(
    'id', p_shipment_id,
    'containerRefs', v_ref_map,
    'containerCount', (select count(*) from public.shipment_containers
                        where shipment_id = p_shipment_id),
    'allocationCount', (select count(*) from public.shipment_container_allocations a
                         join public.shipment_containers c on c.id = a.container_id
                        where c.shipment_id = p_shipment_id)
  );
end;
$$;

grant execute on function
  public.save_shipment_containers(uuid, jsonb, jsonb)
  to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4) PostgREST 스키마 리로드 + 전면 스캔 감사 (마지막 문장 — 결과표 회신용)
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
     and p.proname in ('save_shipment_containers')
)
select * from (
  select '1.봉인 전면 스캔'::text as 구분,
         (v.kind || ' ' || v.obj || ' × ' || v.role || ' × ' || v.priv)::text as 항목,
         '⚠️ true'::text as 값
    from viol v
  union all
  select '1.봉인 전면 스캔', 'public 테이블·뷰 총수(34가 기대 — 기존 32 + 신규 2)', count(*)::text from scan
  union all
  select '1.봉인 전면 스캔', '검사한 (객체×롤×권한) 조합수', (count(*) * 6)::text from scan
  union all
  select '1.봉인 전면 스캔', '위반 건수(0이 정상)',
         case when count(*) = 0 then '0 — ✅ 봉인 정상' else count(*)::text || ' — ⚠️ 봉인 실패' end
    from viol
  union all
  select '2.신설 함수 prosecdef(true 기대)', f.fname || '(' || f.args || ')', f.prosecdef::text
    from newfn f
  union all
  select '3.신설 객체 존재', 'shipment_containers',
         case when to_regclass('public.shipment_containers') is not null
              then 'present — ✅' else '⚠️ absent' end
  union all
  select '3.신설 객체 존재', 'shipment_container_allocations',
         case when to_regclass('public.shipment_container_allocations') is not null
              then 'present — ✅' else '⚠️ absent' end
  union all
  select '3.신설 객체 존재', 'RPC save_shipment_containers 수(1이 정상 — 오버로드 없음)', count(*)::text from newfn
  union all
  select '3.신설 객체 존재', 'idx_shipment_containers_shipment 인덱스(1이 정상)', count(*)::text
    from pg_indexes
   where schemaname = 'public' and indexname = 'idx_shipment_containers_shipment'
  union all
  select '3.신설 객체 존재', 'idx_shipment_container_allocations_line 인덱스(1이 정상)', count(*)::text
    from pg_indexes
   where schemaname = 'public' and indexname = 'idx_shipment_container_allocations_line'
  union all
  select '4.제약 확인 — ' || c.conrelid::regclass::text,
         c.conname::text,
         pg_get_constraintdef(c.oid)
    from pg_constraint c
   where c.conrelid in ('public.shipment_containers'::regclass,
                        'public.shipment_container_allocations'::regclass)
  union all
  select '5.트리거 확인(1종·enabled — 배분 테이블은 감사 미부착)', t.tgname::text,
         'on ' || t.tgrelid::regclass::text
           || case t.tgenabled when 'O' then ' / enabled — ✅' else ' / ⚠️ ' || t.tgenabled::text end
    from pg_trigger t
   where not t.tgisinternal
     and t.tgname in ('trg_audit_shipment_containers')
  union all
  select '6.출생 봉인 상세(신규 2종)',
         s.relname || ' × ' || r.role || ' × ' || pr.priv,
         case
           when has_table_privilege(r.role, s.oid, pr.priv) then
             case when pr.priv = 'SELECT' then 'true — ✅ 조회 허용' else '⚠️ true — 봉인 실패' end
           else
             case when pr.priv = 'SELECT' then '⚠️ false — 조회 불가' else 'false — ✅ 봉인' end
         end
    from (select oid, relname::text from pg_class
           where oid in ('public.shipment_containers'::regclass,
                         'public.shipment_container_allocations'::regclass)) s
    cross join (values ('anon'), ('authenticated')) r(role)
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) pr(priv)
) x
order by 구분, 항목;
