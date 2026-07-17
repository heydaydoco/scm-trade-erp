import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Inquiry, InquiryInput } from "./types";

/**
 * 물리 테이블 `inquiries`의 행 모양 (P1 한정).
 * 이 인터페이스는 이 파일 바깥으로 노출하지 않는다 — 화면은 Inquiry만 안다.
 * companies(...) 는 company_id FK를 통한 PostgREST 임베드 조인 결과.
 */
interface InquiryRow {
  id: string;
  company_id: string | null;
  inquiry_date: string | null;
  product_id: string | null;
  product_name: string | null;
  hs_code: string | null;
  quantity: number | string | null;
  unit: string | null;
  transport: string | null;
  destination_country: string | null;
  destination_port: string | null;
  destination_airport: string | null;
  incoterms: string | null;
  payment_terms: string | null;
  required_delivery_date: string | null;
  sample_requested: boolean | null;
  nda_required: boolean | null;
  status: string | null;
  notes: string | null;
  companies?: { company_name: string | null; country: string | null } | null;
}

// 거래처명·국가는 company_id FK로 임베드 조인해 한 번에 가져온다.
const INQUIRY_COLUMNS =
  "id, company_id, inquiry_date, product_id, product_name, hs_code, quantity, unit, transport, destination_country, destination_port, destination_airport, incoterms, payment_terms, required_delivery_date, sample_requested, nda_required, status, notes, companies(company_name, country)";

/* ---------- 순수 매핑 함수 (I/O 없음 → 단위 테스트 가능) ---------- */

/** inquiries 행 → 도메인 Inquiry */
export function mapRowToInquiry(row: InquiryRow): Inquiry {
  return {
    id: row.id,
    partnerId: row.company_id,
    partnerName: row.companies?.company_name ?? null,
    partnerCountry: row.companies?.country ?? null,
    inquiryDate: row.inquiry_date,
    productId: row.product_id,
    productName: row.product_name?.trim() ?? "",
    hsCode: row.hs_code,
    quantity: row.quantity == null ? null : Number(row.quantity),
    unit: row.unit,
    transport: row.transport,
    destinationCountry: row.destination_country,
    destinationPort: row.destination_port,
    destinationAirport: row.destination_airport,
    incoterms: row.incoterms,
    paymentTerms: row.payment_terms,
    requiredDeliveryDate: row.required_delivery_date,
    sampleRequested: row.sample_requested ?? false,
    ndaRequired: row.nda_required ?? false,
    status: row.status ?? "received",
    notes: row.notes,
  };
}

/**
 * save_inquiry RPC 필수값 거부의 **순수 미러** — 폼과 같은 3필수(거래처·품목명·
 * 접수일)를 DB 왕복 없이 즉시 거부한다. 메시지는 RPC 의 RAISE 와 동일하게 유지.
 */
export function inquiryRequiredError(input: {
  partnerId: string | null;
  productName: string;
  inquiryDate: string | null;
}): string | null {
  if (!input.partnerId) return "거래처를 선택하세요.";
  if (input.productName.trim() === "") return "품목명을 입력하세요.";
  if (!input.inquiryDate) return "접수일을 입력하세요.";
  return null;
}

/** 도메인 InquiryInput → save_inquiry RPC 파라미터 (저장용 — P4.4h 봉인 이후 유일한 쓰기 경로) */
function saveInquiryParams(
  id: string | null,
  input: InquiryInput,
): Record<string, unknown> {
  return {
    p_id: id,
    p_company_id: input.partnerId,
    p_inquiry_date: input.inquiryDate,
    p_product_id: input.productId,
    p_product_name: input.productName,
    p_hs_code: input.hsCode,
    p_quantity: input.quantity,
    p_unit: input.unit, // RPC 가 공란=없음(nullif+btrim)으로 정규화한다
    p_transport: input.transport,
    p_destination_country: input.destinationCountry,
    p_destination_port: input.destinationPort,
    p_destination_airport: input.destinationAirport,
    p_incoterms: input.incoterms,
    p_payment_terms: input.paymentTerms,
    p_required_delivery_date: input.requiredDeliveryDate,
    p_sample_requested: input.sampleRequested,
    p_nda_required: input.ndaRequired,
    p_status: input.status,
    p_notes: input.notes,
  };
}

/* ---------- I/O (서비스). 화면은 이 함수들만 호출한다. ---------- */

/** 문의 목록 (최신 접수일 순). */
export async function listInquiries(): Promise<Inquiry[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("inquiries")
    .select(INQUIRY_COLUMNS)
    .order("inquiry_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) throw new Error(`문의 목록 조회 실패: ${error.message}`);
  const rows = (data ?? []) as unknown as InquiryRow[];
  return rows.map(mapRowToInquiry);
}

/** 문의 1건 조회 (없으면 null). */
export async function getInquiry(id: string): Promise<Inquiry | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("inquiries")
    .select(INQUIRY_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`문의 조회 실패: ${error.message}`);
  return data ? mapRowToInquiry(data as unknown as InquiryRow) : null;
}

/**
 * 문의 등록 — 쓰기는 save_inquiry RPC 경유(P4.4h: inquiries 직접 쓰기 봉인).
 * RPC 는 거래처명 임베드 조인을 돌려주지 않으므로 저장 후 1건 재조회로
 * 기존 반환 모양(partnerName·partnerCountry 포함)을 유지한다.
 */
export async function createInquiry(input: InquiryInput): Promise<Inquiry> {
  const requiredError = inquiryRequiredError(input);
  if (requiredError) throw new Error(requiredError);

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.rpc(
    "save_inquiry",
    saveInquiryParams(null, input),
  );

  if (error) throw new Error(`문의 등록 실패: ${error.message}`);
  const saved = await getInquiry((data as unknown as { id: string }).id);
  if (!saved) throw new Error("문의 등록 실패: 저장된 문의를 다시 읽지 못했습니다.");
  return saved;
}

/** 문의 수정 (정정. 삭제 없음 — 종결은 status='lost' 등으로, 원칙 5). */
export async function updateInquiry(
  id: string,
  input: InquiryInput,
): Promise<Inquiry> {
  const requiredError = inquiryRequiredError(input);
  if (requiredError) throw new Error(requiredError);

  const supabase = createSupabaseServerClient();
  const { error } = await supabase.rpc("save_inquiry", saveInquiryParams(id, input));

  if (error) throw new Error(`문의 수정 실패: ${error.message}`);
  const saved = await getInquiry(id);
  if (!saved) throw new Error("문의 수정 실패: 저장된 문의를 다시 읽지 못했습니다.");
  return saved;
}
