-- ============================================================================
--  P4.1 권한 봉인 검증  (읽기 전용 — SELECT만, 아무것도 바꾸지 않습니다)
-- ============================================================================
--  ⚠️ 왜 `update ... set qty=999` 로 테스트하면 안 되는가:
--     Supabase SQL Editor 는 **테이블 소유자인 postgres 역할**로 실행된다(상단 Role 표시).
--     소유자는 권한 검사를 통째로 우회하므로 봉인이 걸려 있어도 UPDATE가 성공한다.
--     → 봉인은 anon/authenticated 에 대한 것이므로, 그 역할의 권한을 직접 물어봐야 한다.
--
--  has_table_privilege('anon', …) 는 역할 상속·PUBLIC 부여까지 전부 계산한 **실효 권한**을
--  돌려준다. information_schema 를 훑는 것보다 확정적이다.
--
--  기대값:
--    stock_movements : select만 true — 쓰기는 SECURITY DEFINER RPC 경로로만
--    fx_rates        : select·insert true (추가 전용 대장), update/delete false
--    audit_log       : select·insert true, update/delete false
--                      ※ insert=true 는 이번 지시상 의도된 유지값(보고 참조).
-- ============================================================================

select
  t.tbl                                                as 테이블,
  r.role                                               as 역할,
  has_table_privilege(r.role, 'public.' || t.tbl, 'SELECT')   as select_가능,
  has_table_privilege(r.role, 'public.' || t.tbl, 'INSERT')   as insert_가능,
  has_table_privilege(r.role, 'public.' || t.tbl, 'UPDATE')   as update_가능,
  has_table_privilege(r.role, 'public.' || t.tbl, 'DELETE')   as delete_가능,
  has_table_privilege(r.role, 'public.' || t.tbl, 'TRUNCATE') as truncate_가능,
  case
    when t.tbl = 'stock_movements' then
      case when not has_table_privilege(r.role, 'public.stock_movements', 'INSERT')
            and not has_table_privilege(r.role, 'public.stock_movements', 'UPDATE')
            and not has_table_privilege(r.role, 'public.stock_movements', 'DELETE')
            and not has_table_privilege(r.role, 'public.stock_movements', 'TRUNCATE')
           then '✅ 봉인 정상 (읽기 전용)'
           else '⚠️ 봉인 실패 — 쓰기 권한 잔존' end
    else
      case when not has_table_privilege(r.role, 'public.' || t.tbl, 'UPDATE')
            and not has_table_privilege(r.role, 'public.' || t.tbl, 'DELETE')
            and not has_table_privilege(r.role, 'public.' || t.tbl, 'TRUNCATE')
           then '✅ 봉인 정상 (추가 전용)'
           else '⚠️ 봉인 실패 — 변경 권한 잔존' end
  end                                                  as 판정
from (values ('stock_movements'), ('fx_rates'), ('audit_log')) as t(tbl)
cross join (values ('anon'), ('authenticated')) as r(role)
order by t.tbl, r.role;
