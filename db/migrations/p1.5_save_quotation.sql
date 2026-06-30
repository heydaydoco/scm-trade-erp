-- P1.5g — 견적 저장을 단일 트랜잭션 RPC로 (원자성: 데이터 손실·유령전표·결번 차단). 1회 실행.
-- Supabase 대시보드 → SQL Editor → New query → 전체 붙여넣기 → Run.

-- (미뤄둔 정리) 발번 함수 검증용 테스트 카운터 행 제거
delete from public.doc_counters where doc_type = 'selftest';

-- 견적 저장 트랜잭션 함수: 번호발번 + 헤더 + 라인을 "한 트랜잭션"으로.
-- 중간 실패 시 전부 롤백(번호 결번도 롤백). p_id=null이면 등록, 있으면 수정.
create or replace function public.save_quotation(
  p_id     uuid,
  p_header jsonb,
  p_lines  jsonb,
  p_period text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid;
  v_number text;
begin
  if p_id is null then
    -- 등록: 번호 발번(같은 트랜잭션이라 실패 시 결번도 롤백) + 헤더 insert
    v_number := next_doc_number('quotation', 'QT', p_period);
    insert into quotations (
      quotation_number, inquiry_id, company_id, quotation_date, valid_until,
      currency, exchange_rate, incoterms, payment_terms,
      destination_country, destination_port, destination_airport, transport,
      subtotal, discount, total_amount, status, notes, terms_conditions, updated_at
    ) values (
      v_number,
      nullif(p_header->>'inquiry_id','')::uuid,
      nullif(p_header->>'company_id','')::uuid,
      nullif(p_header->>'quotation_date','')::date,
      nullif(p_header->>'valid_until','')::date,
      p_header->>'currency',
      coalesce((p_header->>'exchange_rate')::numeric, 1),
      p_header->>'incoterms',
      p_header->>'payment_terms',
      p_header->>'destination_country',
      p_header->>'destination_port',
      p_header->>'destination_airport',
      p_header->>'transport',
      (p_header->>'subtotal')::numeric,
      (p_header->>'discount')::numeric,
      (p_header->>'total_amount')::numeric,
      p_header->>'status',
      p_header->>'notes',
      p_header->>'terms_conditions',
      now()
    ) returning id into v_id;
  else
    -- 수정: 번호 불변, 헤더 update + 라인 통째 교체 (모두 같은 트랜잭션)
    v_id := p_id;
    update quotations set
      inquiry_id          = nullif(p_header->>'inquiry_id','')::uuid,
      company_id          = nullif(p_header->>'company_id','')::uuid,
      quotation_date      = nullif(p_header->>'quotation_date','')::date,
      valid_until         = nullif(p_header->>'valid_until','')::date,
      currency            = p_header->>'currency',
      exchange_rate       = coalesce((p_header->>'exchange_rate')::numeric, 1),
      incoterms           = p_header->>'incoterms',
      payment_terms       = p_header->>'payment_terms',
      destination_country = p_header->>'destination_country',
      destination_port    = p_header->>'destination_port',
      destination_airport = p_header->>'destination_airport',
      transport           = p_header->>'transport',
      subtotal            = (p_header->>'subtotal')::numeric,
      discount            = (p_header->>'discount')::numeric,
      total_amount        = (p_header->>'total_amount')::numeric,
      status              = p_header->>'status',
      notes               = p_header->>'notes',
      terms_conditions    = p_header->>'terms_conditions',
      updated_at          = now()
    where id = v_id;
    if not found then
      raise exception '견적을 찾을 수 없습니다: %', v_id;
    end if;
    delete from quotation_items where quotation_id = v_id;
  end if;

  -- 라인 insert (등록·수정 공통)
  insert into quotation_items (
    quotation_id, product_id, product_name, hs_code, description,
    quantity, unit, unit_price, amount, sort_order
  )
  select
    v_id,
    nullif(l->>'product_id','')::uuid,
    l->>'product_name',
    l->>'hs_code',
    l->>'description',
    (l->>'quantity')::numeric,
    l->>'unit',
    (l->>'unit_price')::numeric,
    (l->>'amount')::numeric,
    (l->>'sort_order')::int
  from jsonb_array_elements(p_lines) as l;

  return jsonb_build_object(
    'id', v_id,
    'quotation_number', coalesce(v_number,
      (select quotation_number from quotations where id = v_id))
  );
end;
$$;

grant execute on function public.save_quotation(uuid, jsonb, jsonb, text) to anon, authenticated;
