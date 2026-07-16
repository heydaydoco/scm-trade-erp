-- ============================================================================
-- P4.0-c ① 라이브 스키마 조회  (읽기 전용 — 아무것도 바꾸지 않습니다)
-- ============================================================================
-- 목적: DB에만 존재하고 저장소에는 없는 5개 테이블의 "실제 정의"를 가져온다.
--        companies · products · inquiries · quotations · quotation_items
--        (이 5개는 P1.1/P1.2 시절 Supabase 대시보드에서 직접 만들어져,
--         레포의 마이그레이션 9개를 빈 DB에 순서대로 돌리면 p1.3에서 즉시 실패한다)
--
-- 안전성: SELECT / string_agg 만 한다. CREATE·ALTER·DROP·INSERT 없음.
--         테이블·데이터·권한·RLS를 전혀 건드리지 않는다. 몇 번 돌려도 무해하다.
--
-- 사용법: 전체 붙여넣고 Run → 결과가 1행 1열로 나온다 → 그 셀 하나를 복사.
--
-- ※ 이 파일은 마이그레이션이 아니라 조회 도구다(파일명 앞의 _ 가 그 표시).
--   여기서 얻은 결과로 000_baseline.sql 을 작성한다.
-- ============================================================================

with target(tbl, ord) as (
  values ('companies', 1), ('products', 2), ('inquiries', 3),
         ('quotations', 4), ('quotation_items', 5)
),

-- 컬럼: 이름 · 타입(정밀도 포함) · not null · default
col as (
  select t.tbl, t.ord,
         string_agg(
           '  ' || quote_ident(a.attname) || ' ' ||
           format_type(a.atttypid, a.atttypmod) ||
           case when a.attnotnull then ' not null' else '' end ||
           coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), ''),
           e',\n' order by a.attnum
         ) as body
  from target t
  join pg_class c
    on c.relname = t.tbl and c.relnamespace = 'public'::regnamespace
  join pg_attribute a
    on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d
    on d.adrelid = c.oid and d.adnum = a.attnum
  group by t.tbl, t.ord
),

-- 제약: PK · FK · UNIQUE · CHECK (정의 원문 그대로)
con as (
  select t.tbl, t.ord,
         string_agg(
           'alter table public.' || quote_ident(t.tbl) ||
           ' add constraint ' || quote_ident(k.conname) || ' ' ||
           pg_get_constraintdef(k.oid) || ';',
           e'\n' order by k.contype desc, k.conname
         ) as body
  from target t
  join pg_class c
    on c.relname = t.tbl and c.relnamespace = 'public'::regnamespace
  join pg_constraint k on k.conrelid = c.oid
  group by t.tbl, t.ord
),

-- 인덱스: 제약이 자동 생성한 인덱스는 제외(위 con에서 이미 나옴)
idx as (
  select t.tbl, t.ord,
         string_agg(i.indexdef || ';', e'\n' order by i.indexname) as body
  from target t
  join pg_class c
    on c.relname = t.tbl and c.relnamespace = 'public'::regnamespace
  join pg_indexes i
    on i.schemaname = 'public' and i.tablename = t.tbl
  where not exists (
    select 1 from pg_constraint k
    where k.conrelid = c.oid and k.conname = i.indexname
  )
  group by t.tbl, t.ord
),

-- 권한: 누가 이 테이블에 무엇을 할 수 있는가 (anon/authenticated 등)
grt as (
  select t.tbl, t.ord,
         string_agg(
           'grant ' || lower(g.privilege_type) || ' on public.' ||
           quote_ident(t.tbl) || ' to ' || quote_ident(g.grantee) || ';',
           e'\n' order by g.grantee, g.privilege_type
         ) as body
  from target t
  join information_schema.role_table_grants g
    on g.table_schema = 'public' and g.table_name = t.tbl
  where g.grantee in ('anon', 'authenticated', 'service_role')
  group by t.tbl, t.ord
),

-- RLS 활성 여부
rls as (
  select t.tbl, t.ord,
         case when c.relrowsecurity
              then 'alter table public.' || quote_ident(t.tbl) || ' enable row level security;'
              else '-- RLS 비활성'
         end as body
  from target t
  join pg_class c
    on c.relname = t.tbl and c.relnamespace = 'public'::regnamespace
)

select string_agg(section, e'\n\n' order by ord) as live_schema_ddl
from (
  select t.ord,
         '-- ============================================================'  || e'\n' ||
         '-- ' || t.tbl                                                     || e'\n' ||
         '-- ============================================================'  || e'\n' ||
         case when col.body is null
              then '-- ⚠️ 이 테이블이 DB에 없습니다 (이름 확인 필요)'
              else 'create table if not exists public.' || quote_ident(t.tbl) || ' (' ||
                   e'\n' || col.body || e'\n);'
         end                                                                || e'\n\n' ||
         '-- 제약'      || e'\n' || coalesce(con.body, '-- (없음)')          || e'\n\n' ||
         '-- 인덱스'    || e'\n' || coalesce(idx.body, '-- (없음)')          || e'\n\n' ||
         '-- 권한'      || e'\n' || coalesce(grt.body, '-- (없음)')          || e'\n\n' ||
         '-- RLS'       || e'\n' || coalesce(rls.body, '-- (테이블 없음)')
         as section
  from target t
  left join col on col.tbl = t.tbl
  left join con on con.tbl = t.tbl
  left join idx on idx.tbl = t.tbl
  left join grt on grt.tbl = t.tbl
  left join rls on rls.tbl = t.tbl
) s;
