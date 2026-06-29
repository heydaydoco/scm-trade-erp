import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Partner, PartnerInput, PartnerType } from "./types";

/**
 * 물리 테이블 `companies`의 행 모양 (P1 한정).
 * 이 인터페이스는 이 파일 바깥으로 노출하지 않는다 — 화면은 Partner만 안다.
 */
interface CompanyRow {
  id: string;
  company_name: string | null;
  company_type: string | null;
  country: string | null;
  city: string | null;
  address: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  currency: string | null;
  payment_terms: string | null;
  incoterms: string | null;
  notes: string | null;
  active: boolean | null;
}

const COMPANY_COLUMNS =
  "id, company_name, company_type, country, city, address, contact_name, contact_email, contact_phone, currency, payment_terms, incoterms, notes, active";

/* ---------- 순수 매핑 함수 (I/O 없음 → 단위 테스트 가능) ---------- */

/** companies.company_type → 도메인 PartnerType */
export function mapCompanyTypeToPartnerType(raw: string | null): PartnerType {
  switch ((raw ?? "").trim().toLowerCase()) {
    case "buyer":
    case "customer":
      return "customer";
    case "supplier":
    case "vendor":
      return "supplier";
    case "both":
      return "both";
    default:
      return "unknown";
  }
}

/** 도메인 PartnerType → companies.company_type (저장용) */
export function mapPartnerTypeToCompanyType(type: PartnerType): string {
  switch (type) {
    case "supplier":
      return "supplier";
    case "both":
      return "both";
    case "customer":
    default:
      return "buyer";
  }
}

/** companies 행 → 도메인 Partner */
export function mapCompanyToPartner(row: CompanyRow): Partner {
  return {
    id: row.id,
    name: row.company_name?.trim() ?? "",
    type: mapCompanyTypeToPartnerType(row.company_type),
    country: row.country,
    city: row.city,
    currency: row.currency,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    address: row.address,
    paymentTerms: row.payment_terms,
    incoterms: row.incoterms,
    notes: row.notes,
    active: row.active ?? true,
  };
}

/** 도메인 PartnerInput → companies 컬럼 (저장용) */
function mapPartnerInputToCompany(input: PartnerInput): Record<string, unknown> {
  const out: Record<string, unknown> = {
    company_name: input.name,
    country: input.country,
    city: input.city,
    address: input.address,
    contact_name: input.contactName,
    contact_email: input.contactEmail,
    contact_phone: input.contactPhone,
    currency: input.currency,
    payment_terms: input.paymentTerms,
    incoterms: input.incoterms,
    notes: input.notes,
    active: input.active,
    updated_at: new Date().toISOString(),
  };
  // 구분이 '미분류(unknown)'면 company_type을 건드리지 않아 원본을 보존한다.
  // (사용자가 의도적으로 분류를 고르기 전까지 NULL/예상밖 값이 buyer로 덮어써지지 않게)
  if (input.type !== "unknown") {
    out.company_type = mapPartnerTypeToCompanyType(input.type);
  }
  return out;
}

/* ---------- I/O (서비스). 화면은 이 함수들만 호출한다. ---------- */

/** 거래처 목록 (활성·비활성 모두, 이름순). */
export async function listPartners(): Promise<Partner[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("companies")
    .select(COMPANY_COLUMNS)
    .order("active", { ascending: false })
    .order("company_name", { ascending: true });

  if (error) throw new Error(`거래처 목록 조회 실패: ${error.message}`);
  const rows = (data ?? []) as unknown as CompanyRow[];
  return rows.map(mapCompanyToPartner);
}

/** 거래처 1건 조회 (없으면 null). */
export async function getPartner(id: string): Promise<Partner | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("companies")
    .select(COMPANY_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`거래처 조회 실패: ${error.message}`);
  return data ? mapCompanyToPartner(data as unknown as CompanyRow) : null;
}

/** 거래처 등록. */
export async function createPartner(input: PartnerInput): Promise<Partner> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("companies")
    .insert(mapPartnerInputToCompany(input))
    .select(COMPANY_COLUMNS)
    .single();

  if (error) throw new Error(`거래처 등록 실패: ${error.message}`);
  return mapCompanyToPartner(data as unknown as CompanyRow);
}

/** 거래처 수정 (정정. 삭제 대신 active 토글로 비활성 — 원칙 5). */
export async function updatePartner(
  id: string,
  input: PartnerInput,
): Promise<Partner> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("companies")
    .update(mapPartnerInputToCompany(input))
    .eq("id", id)
    .select(COMPANY_COLUMNS)
    .single();

  if (error) throw new Error(`거래처 수정 실패: ${error.message}`);
  return mapCompanyToPartner(data as unknown as CompanyRow);
}
