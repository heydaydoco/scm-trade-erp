-- ============================================================================
--  P4.5(c0) — marks 전용 쓰기 경로 update_shipment_marks   (아키텍트 판정: 신설 승인)
-- ============================================================================
--  배경(확정 검증 — 커밋 c0 배경 검증 결과):
--  · marks 의 유일한 기존 쓰기 경로는 save_shipment_cargo(p_shipping_marks)인데,
--    이 RPC 는 라인 diff-upsert(payload 행 UPDATE·빠진 행 DELETE)와 당사자
--    전량교체(DELETE+INSERT)를 **항상** 수행한다 → 활성(issued) 무역서류가 있는
--    선적에서는 P4.5 잠금 가드(trg_shipment_lines/parties_trade_doc_guard)에
--    걸려 marks 만 고치는 저장도 전면 차단된다(부수 차단 확인).
--  · shipments 의 비-cancelled 상태 전환(운항 진행 등)은 save_shipment 경로
--    (헤더·주문연결·마일스톤만 기록 — 화물·당사자 불가촉)라 가드 비대상이며,
--    shipments 가드는 cancelled "전환"만 차단한다 → 차단 없음 확인(상태 전환
--    RPC 신설 불요).
--  · marks 는 발행 시점에 trade_documents.shipping_marks 로 스냅샷되므로(D2),
--    발행 후 marks 수정은 기발행 문서에 영향을 주지 않는다 — 스펙이 명시적으로
--    가드 비대상으로 남겨 둔 필드다(p4.5 마이그레이션 헤더 주석 참조).
--
--  본 RPC:
--  · 검증 = 선적 존재 + 미취소(취소 선적은 식별 가능 메시지로 RAISE).
--  · 갱신 = shipping_marks 단일 컬럼(+표준 타임스탬프 updated_at) — 타 컬럼 불가촉.
--    빈 값 허용: 공백/빈 문자열은 NULL 로 정규화(save_shipment_cargo 와 동일 관례)
--    — marks 지우기는 정당한 조작이다.
--  · 잠긴 RPC(save_shipment / save_shipment_cargo)와 가드 트리거는 무수정.
--
--  ⚠️ 실행 안내: 실행형이지만 권한 회수(REVOKE) 없음 · 신규 함수 1개 추가뿐이라
--     기존 화면 동작에 영향 0. 순수 추가·멱등(CREATE OR REPLACE) — 재실행 안전.
--  ⚠️ 맨 끝 감사 SELECT 가 이 파일의 마지막 문장 — 결과표 전체를 드래그 복사해
--     회신한다. 기대: 위반 0행 · 객체 총수 31 유지 · update_shipment_marks
--     prosecdef true · 함수 수 1(오버로드 없음).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) RPC — update_shipment_marks (SECURITY DEFINER, 단일 문장 갱신)
-- ----------------------------------------------------------------------------
create or replace function public.update_shipment_marks(
  p_shipment_id uuid,
  p_marks       text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shipment public.shipments%rowtype;
  v_marks    text;
begin
  if p_shipment_id is null then
    raise exception '선적이 지정되지 않았습니다.';
  end if;

  -- 헤더 락 — 동시 저장(구 RPC 포함)과의 직렬화 베이스라인(관례 준수).
  select * into v_shipment
    from public.shipments
   where id = p_shipment_id
   for update;
  if not found then
    raise exception '선적을 찾을 수 없습니다.';
  end if;
  if v_shipment.status = 'cancelled' then
    raise exception '취소된 선적의 화인(Shipping Marks)은 수정할 수 없습니다. (선적번호: %)',
      coalesce(v_shipment.ship_number, p_shipment_id::text);
  end if;

  -- 빈 값 허용 — 공백은 NULL 정규화(marks 지우기는 정당). 타 컬럼 불가촉.
  v_marks := nullif(btrim(coalesce(p_marks, '')), '');
  update public.shipments
     set shipping_marks = v_marks,
         updated_at     = now()
   where id = p_shipment_id;

  return jsonb_build_object(
    'id', p_shipment_id,
    'shipNumber', v_shipment.ship_number,
    'shippingMarks', v_marks
  );
end;
$$;

grant execute on function
  public.update_shipment_marks(uuid, text)
  to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2) PostgREST 스키마 리로드 + 전면 스캔 감사 (마지막 문장 — 결과표 회신용)
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
     and p.proname = 'update_shipment_marks'
)
select * from (
  select '1.봉인 전면 스캔'::text as 구분,
         (v.kind || ' ' || v.obj || ' × ' || v.role || ' × ' || v.priv)::text as 항목,
         '⚠️ true'::text as 값
    from viol v
  union all
  select '1.봉인 전면 스캔', 'public 테이블·뷰 총수(31 유지가 기대 — 신규 테이블 없음)', count(*)::text from scan
  union all
  select '1.봉인 전면 스캔', '검사한 (객체×롤×권한) 조합수', (count(*) * 6)::text from scan
  union all
  select '1.봉인 전면 스캔', '위반 건수(0이 정상)',
         case when count(*) = 0 then '0 — ✅ 봉인 정상' else count(*)::text || ' — ⚠️ 봉인 실패' end
    from viol
  union all
  select '2.신설 RPC prosecdef(true 가 정상)', f.fname || '(' || f.args || ')', f.prosecdef::text
    from newfn f
  union all
  select '2.신설 RPC prosecdef(true 가 정상)', 'update_shipment_marks 함수 수(1이 정상 — 오버로드 없음)',
         count(*)::text from newfn
  union all
  select '3.가드 트리거 잔존(4종·enabled — c0 는 무수정)', t.tgname::text,
         'on ' || t.tgrelid::regclass::text
           || case t.tgenabled when 'O' then ' / enabled — ✅' else ' / ⚠️ ' || t.tgenabled::text end
    from pg_trigger t
   where not t.tgisinternal
     and t.tgname in ('trg_shipment_lines_trade_doc_guard',
                      'trg_shipment_parties_trade_doc_guard',
                      'trg_shipments_cancel_trade_doc_guard',
                      'trg_audit_trade_documents')
) x
order by 구분, 항목;
