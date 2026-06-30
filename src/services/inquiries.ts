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

/** 도메인 InquiryInput → inquiries 컬럼 (저장용) */
function mapInputToRow(input: InquiryInput): Record<string, unknown> {
  return {
    company_id: input.partnerId,
    inquiry_date: input.inquiryDate,
    product_id: input.productId,
    product_name: input.productName,
    hs_code: input.hsCode,
    quantity: input.quantity,
    unit: input.unit,
    transport: input.transport,
    destination_country: input.destinationCountry,
    destination_port: input.destinationPort,
    destination_airport: input.destinationAirport,
    incoterms: input.incoterms,
    payment_terms: input.paymentTerms,
    required_delivery_date: input.requiredDeliveryDate,
    sample_requested: input.sampleRequested,
    nda_required: input.ndaRequired,
    status: input.status,
    notes: input.notes,
    updated_at: new Date().toISOString(),
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

/** 문의 등록. */
export async function createInquiry(input: InquiryInput): Promise<Inquiry> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("inquiries")
    .insert(mapInputToRow(input))
    .select(INQUIRY_COLUMNS)
    .single();

  if (error) throw new Error(`문의 등록 실패: ${error.message}`);
  return mapRowToInquiry(data as unknown as InquiryRow);
}

/** 문의 수정 (정정. 삭제 없음 — 종결은 status='lost' 등으로, 원칙 5). */
export async function updateInquiry(
  id: string,
  input: InquiryInput,
): Promise<Inquiry> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("inquiries")
    .update(mapInputToRow(input))
    .eq("id", id)
    .select(INQUIRY_COLUMNS)
    .single();

  if (error) throw new Error(`문의 수정 실패: ${error.message}`);
  return mapRowToInquiry(data as unknown as InquiryRow);
}
