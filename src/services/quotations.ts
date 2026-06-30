import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEFAULT_QUOTATION_TERMS, round2 } from "./codes";
import type {
  Inquiry,
  Quotation,
  QuotationInput,
  QuotationLine,
  QuotationLineInput,
} from "./types";

/* ---------- 물리 테이블 행 모양 (이 파일 바깥으로 노출 안 함) ---------- */

interface QuotationRow {
  id: string;
  quotation_number: string | null;
  inquiry_id: string | null;
  company_id: string | null;
  quotation_date: string | null;
  valid_until: string | null;
  currency: string | null;
  exchange_rate: number | string | null;
  incoterms: string | null;
  payment_terms: string | null;
  destination_country: string | null;
  destination_port: string | null;
  destination_airport: string | null;
  transport: string | null;
  subtotal: number | string | null;
  discount: number | string | null;
  total_amount: number | string | null;
  status: string | null;
  notes: string | null;
  terms_conditions: string | null;
  companies?: { company_name: string | null; country: string | null } | null;
}

interface QuotationLineRow {
  id: string;
  quotation_id: string;
  product_id: string | null;
  product_name: string | null;
  hs_code: string | null;
  description: string | null;
  quantity: number | string | null;
  unit: string | null;
  unit_price: number | string | null;
  amount: number | string | null;
  sort_order: number | null;
}

const QUOTATION_COLUMNS =
  "id, quotation_number, inquiry_id, company_id, quotation_date, valid_until, currency, exchange_rate, incoterms, payment_terms, destination_country, destination_port, destination_airport, transport, subtotal, discount, total_amount, status, notes, terms_conditions, companies(company_name, country)";

const LINE_COLUMNS =
  "id, quotation_id, product_id, product_name, hs_code, description, quantity, unit, unit_price, amount, sort_order";

/* ---------- 순수 계산/매핑 (I/O 없음 → 단위 테스트 가능) ---------- */

/** 라인 금액 = 수량 × 단가 (소수 2자리 정리로 부동소수 드리프트 방지). */
export function lineAmount(quantity: number, unitPrice: number): number {
  return round2(quantity * unitPrice);
}

/** quotation_date(YYYY-MM-DD)에서 발번 기간(YYYYMM) 도출. 없으면 오늘 기준. */
function periodOf(dateStr: string | null): string {
  const d = dateStr ?? new Date().toISOString().slice(0, 10);
  return d.slice(0, 7).replace("-", "");
}

/** 입력에서 합계 재계산 (원칙 2 — 항상 라인의 합). */
function computeTotals(input: QuotationInput): {
  subtotal: number;
  total: number;
} {
  const subtotal = round2(
    input.lines.reduce((sum, l) => sum + lineAmount(l.quantity, l.unitPrice), 0),
  );
  return { subtotal, total: round2(subtotal - (input.discount ?? 0)) };
}

function mapLineRow(row: QuotationLineRow): QuotationLine {
  const quantity = Number(row.quantity ?? 0);
  const unitPrice = Number(row.unit_price ?? 0);
  return {
    id: row.id,
    lineNo: (row.sort_order ?? 0) + 1,
    productId: row.product_id,
    productName: row.product_name?.trim() ?? "",
    hsCode: row.hs_code,
    description: row.description,
    quantity,
    unit: row.unit,
    unitPrice,
    amount: lineAmount(quantity, unitPrice),
  };
}

/**
 * 헤더 행 + (선택)라인 행 → 도메인 Quotation.
 * 라인이 주어지면 합계를 라인에서 재계산(원칙 2), 없으면(목록) 저장된 스냅샷 사용.
 */
function assembleQuotation(
  row: QuotationRow,
  lineRows: QuotationLineRow[] | null,
): Quotation {
  const lines = (lineRows ?? []).map(mapLineRow);
  const discount = Number(row.discount ?? 0);
  const subtotal =
    lineRows != null
      ? round2(lines.reduce((s, l) => s + l.amount, 0))
      : Number(row.subtotal ?? 0);
  const total =
    lineRows != null
      ? round2(subtotal - discount)
      : Number(row.total_amount ?? 0);

  return {
    id: row.id,
    quotationNumber: row.quotation_number ?? "",
    inquiryId: row.inquiry_id,
    partnerId: row.company_id,
    partnerName: row.companies?.company_name ?? null,
    partnerCountry: row.companies?.country ?? null,
    quotationDate: row.quotation_date,
    validUntil: row.valid_until,
    currency: row.currency,
    exchangeRate: row.exchange_rate == null ? null : Number(row.exchange_rate),
    incoterms: row.incoterms,
    paymentTerms: row.payment_terms,
    destinationCountry: row.destination_country,
    destinationPort: row.destination_port,
    destinationAirport: row.destination_airport,
    transport: row.transport,
    discount,
    subtotal,
    total,
    status: row.status ?? "draft",
    notes: row.notes,
    termsConditions: row.terms_conditions,
    lines,
  };
}

/** 도메인 입력 → quotations 헤더 컬럼. quotationNumber는 등록 시에만 포함(수정 시 불변). */
function buildHeader(
  input: QuotationInput,
  totals: { subtotal: number; total: number },
  quotationNumber?: string,
): Record<string, unknown> {
  const header: Record<string, unknown> = {
    inquiry_id: input.inquiryId,
    company_id: input.partnerId,
    quotation_date: input.quotationDate,
    valid_until: input.validUntil,
    currency: input.currency,
    exchange_rate: input.exchangeRate ?? 1,
    incoterms: input.incoterms,
    payment_terms: input.paymentTerms,
    destination_country: input.destinationCountry,
    destination_port: input.destinationPort,
    destination_airport: input.destinationAirport,
    transport: input.transport,
    subtotal: totals.subtotal,
    discount: input.discount,
    total_amount: totals.total,
    status: input.status,
    notes: input.notes,
    terms_conditions: input.termsConditions,
    updated_at: new Date().toISOString(),
  };
  if (quotationNumber) header.quotation_number = quotationNumber;
  return header;
}

function buildLineRows(
  quotationId: string,
  lines: QuotationLineInput[],
): Record<string, unknown>[] {
  return lines.map((l, i) => ({
    quotation_id: quotationId,
    product_id: l.productId,
    product_name: l.productName,
    hs_code: l.hsCode,
    description: l.description,
    quantity: l.quantity,
    unit: l.unit,
    unit_price: l.unitPrice,
    amount: lineAmount(l.quantity, l.unitPrice),
    sort_order: i,
  }));
}

/**
 * 문의 → 견적 드래프트 (원칙 3 — 참조 생성).
 * 문의 데이터를 복사해 견적 입력 초안을 만든다(저장 X). 첫 라인은 문의 품목.
 */
export function buildQuotationDraftFromInquiry(inq: Inquiry): QuotationInput {
  return {
    inquiryId: inq.id,
    partnerId: inq.partnerId,
    quotationDate: null, // 폼에서 오늘로 기본
    validUntil: null,
    currency: "USD",
    exchangeRate: 1,
    incoterms: inq.incoterms,
    paymentTerms: inq.paymentTerms,
    destinationCountry: inq.destinationCountry,
    destinationPort: inq.destinationPort,
    destinationAirport: inq.destinationAirport,
    transport: inq.transport,
    discount: 0,
    status: "draft",
    notes: inq.notes,
    termsConditions: DEFAULT_QUOTATION_TERMS,
    lines: [
      {
        productId: inq.productId,
        productName: inq.productName,
        hsCode: inq.hsCode,
        description: null,
        quantity: inq.quantity ?? 0,
        unit: inq.unit,
        unitPrice: 0,
      },
    ],
  };
}

/* ---------- I/O (서비스). 화면은 이 함수들만 호출한다. ---------- */

/**
 * 견적번호 원자적 발번 (원칙 6) — P1.1에서 만든 3-arg DB 함수를 호출한다.
 * doc_type는 'quotation'(='QT' 아님, 기존 카운터 행과 일치). 완성 문자열을 받는다.
 * 참조: db/migrations/p1.1_doc_numbering.sql
 */
async function generateQuotationNumber(
  supabase: SupabaseClient,
  period: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("next_doc_number", {
    p_doc_type: "quotation",
    p_prefix: "QT",
    p_period: period,
  });
  if (error) throw new Error(`견적번호 발번 실패: ${error.message}`);
  if (typeof data !== "string") {
    throw new Error("견적번호 발번 결과가 올바르지 않습니다.");
  }
  return data;
}

async function insertLines(
  supabase: SupabaseClient,
  quotationId: string,
  lines: QuotationLineInput[],
): Promise<void> {
  if (!lines.length) return;
  const { error } = await supabase
    .from("quotation_items")
    .insert(buildLineRows(quotationId, lines));
  if (error) throw new Error(`견적 품목 저장 실패: ${error.message}`);
}

/** 견적 목록 (최신순). 합계는 저장된 스냅샷 사용(저장 시 라인에서 재계산됨). */
export async function listQuotations(): Promise<Quotation[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("quotations")
    .select(QUOTATION_COLUMNS)
    .order("quotation_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) throw new Error(`견적 목록 조회 실패: ${error.message}`);
  const rows = (data ?? []) as unknown as QuotationRow[];
  return rows.map((r) => assembleQuotation(r, null));
}

/** 견적 1건 조회 (라인 포함, 합계는 라인에서 재계산). 없으면 null. */
export async function getQuotation(id: string): Promise<Quotation | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("quotations")
    .select(QUOTATION_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`견적 조회 실패: ${error.message}`);
  if (!data) return null;

  const { data: lineData, error: lineErr } = await supabase
    .from("quotation_items")
    .select(LINE_COLUMNS)
    .eq("quotation_id", id)
    .order("sort_order", { ascending: true });
  if (lineErr) throw new Error(`견적 품목 조회 실패: ${lineErr.message}`);

  return assembleQuotation(
    data as unknown as QuotationRow,
    (lineData ?? []) as unknown as QuotationLineRow[],
  );
}

/** 견적 등록 — 번호 발번 + 헤더 + 라인. */
export async function createQuotation(
  input: QuotationInput,
): Promise<Quotation> {
  const supabase = createSupabaseServerClient();
  const totals = computeTotals(input);
  if (totals.total < 0) {
    throw new Error("할인이 소계를 초과할 수 없습니다.");
  }
  // 음수 합계 가드를 발번보다 먼저 — 검증 실패 시 번호를 소모하지 않게.
  const number = await generateQuotationNumber(
    supabase,
    periodOf(input.quotationDate),
  );

  const { data, error } = await supabase
    .from("quotations")
    .insert(buildHeader(input, totals, number))
    .select("id")
    .single();
  if (error) throw new Error(`견적 등록 실패: ${error.message}`);

  const quotationId = (data as { id: string }).id;
  await insertLines(supabase, quotationId, input.lines);

  const created = await getQuotation(quotationId);
  if (!created) throw new Error("견적 등록 후 조회에 실패했습니다.");
  return created;
}

/**
 * 견적 수정 (정정). 번호는 불변(원칙 6). 라인은 통째로 교체.
 * 삭제 기능은 없다 — 종결은 상태(rejected/expired)로 (원칙 5).
 */
export async function updateQuotation(
  id: string,
  input: QuotationInput,
): Promise<Quotation> {
  const supabase = createSupabaseServerClient();
  const totals = computeTotals(input);
  if (totals.total < 0) {
    throw new Error("할인이 소계를 초과할 수 없습니다.");
  }

  const { error: headerErr } = await supabase
    .from("quotations")
    .update(buildHeader(input, totals))
    .eq("id", id);
  if (headerErr) throw new Error(`견적 수정 실패: ${headerErr.message}`);

  const { error: delErr } = await supabase
    .from("quotation_items")
    .delete()
    .eq("quotation_id", id);
  if (delErr) throw new Error(`견적 품목 갱신 실패: ${delErr.message}`);

  await insertLines(supabase, id, input.lines);

  const updated = await getQuotation(id);
  if (!updated) throw new Error("견적 수정 후 조회에 실패했습니다.");
  return updated;
}
