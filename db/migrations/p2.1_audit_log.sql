-- ============================================================================
--  P2.1 — 변경 이력(감사 추적) 기반   (SPEC I5 "처음부터", 원칙 5 불변·삭제없음)
-- ============================================================================
--  실행: Supabase 대시보드 → SQL Editor → New query → 이 파일 전체 붙여넣기 → Run.
--  성격: 순수 추가(기존 데이터·스키마·동작 무변경) + 멱등(실수로 재실행해도 무해).
--
--  ⚠️ 이미 DB에만 존재하는 라이브 객체 — 절대 재생성/재실행/오버로딩 금지:
--       next_doc_number(text,text,text) · save_quotation(uuid,jsonb,jsonb,text)
--       · quotations · quotation_items   (카운터 분기·데이터 손상 위험)
--     이 파일은 신규 객체(audit_log, fn_audit, 트리거)만 추가한다.
--
--  왜 트리거인가: 앱에는 audit_log 쓰기권한을 주지 않고(SELECT만) DB 트리거만
--  기록 → 앱이 이력을 위조·삭제할 수 없다(원칙 5). 트리거는 부모 저장과 같은
--  트랜잭션이라, save_quotation이 롤백되면 감사행도 함께 롤백된다(고아행·결번 없음).
-- ============================================================================

-- 1) 추가-전용 감사 원장 (앱은 읽기만)
create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  table_name  text        not null,
  record_id   text,                      -- text: 테이블마다 id 타입이 달라도 하나의 트리거로 처리
  action      text        not null,      -- INSERT / UPDATE / DELETE
  before_json jsonb,                     -- 변경 전 행 (INSERT면 null)
  after_json  jsonb,                     -- 변경 후 행 (DELETE면 null)
  actor       text        not null default 'system',  -- SPEC의 'user'는 예약어 → actor (인증 도입 전엔 system)
  at          timestamptz not null default now()
);
create index if not exists audit_log_tr_idx on public.audit_log (table_name, record_id, at desc);
create index if not exists audit_log_at_idx on public.audit_log (at desc);

-- 2) 범용 캡처 함수 (SECURITY DEFINER → 앱에 쓰기권한 없이 트리거만 기록; next_doc_number와 동일 패턴)
create or replace function public.fn_audit() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text := coalesce(current_setting('app.actor', true), 'system');
begin
  insert into public.audit_log (table_name, record_id, action, before_json, after_json, actor)
  values (
    tg_table_name,
    (case when tg_op = 'DELETE' then old.id else new.id end)::text,
    tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('UPDATE', 'INSERT') then to_jsonb(new) end,
    v_actor
  );
  return case when tg_op = 'DELETE' then old else new end;  -- 절대 RAISE 안 함(부모 트랜잭션 보호)
end;
$$;

-- 3) 기존 견적 헤더에 부착 (멱등: drop → create).
--    save_quotation은 매 저장마다 updated_at=now()로 헤더를 UPDATE → 라인만 바뀌어도 저장 1건이 1행.
--    라인테이블(quotation_items)엔 부착하지 않는다: 수정 시 전량 DELETE+재INSERT 하므로
--    라인 트리거는 저장 1회에 감사행 폭주 + 시각적 '삭제' 모순(원칙 5)을 낳는다. (라인 그레인은 P2.2 이후 재평가)
drop trigger if exists trg_audit_quotations on public.quotations;
create trigger trg_audit_quotations
  after insert or update or delete on public.quotations
  for each row execute function public.fn_audit();

-- 4) 앱 권한: SELECT만. INSERT/UPDATE/DELETE 미부여 → 앱은 위조·삭제 불가(원칙 5). 기록은 트리거 전용.
grant select on public.audit_log to anon, authenticated;

-- ── 검증(선택, Run 후 아무 견적이나 열어 저장한 뒤) ─────────────────────────
--   select at, table_name, action, record_id from public.audit_log order by at desc limit 5;
--   → 방금 저장한 견적의 UPDATE 행 1건이 보이면 성공.

-- ── 되돌리기(rollback, 실행 시 이전 동작 그대로 복원) ───────────────────────
--   drop trigger if exists trg_audit_quotations on public.quotations;
--   drop function if exists public.fn_audit();
--   drop table if exists public.audit_log;

-- ⚠️ P2.2에서 sales_orders 생성 후 아래 2줄만 추가하면 SO도 태생부터 감사된다(제네릭이라 코드 0줄):
--   drop trigger if exists trg_audit_sales_orders on public.sales_orders;
--   create trigger trg_audit_sales_orders after insert or update or delete
--     on public.sales_orders for each row execute function public.fn_audit();
