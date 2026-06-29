import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Partner, PartnerType } from "./types";

/**
 * 물리 테이블 `companies`의 행 모양 (P0 한정).
 * 이 인터페이스는 이 파일 바깥으로 노출하지 않는다 — 화면은 Partner만 안다.
 */
interface CompanyRow {
  id: string;
  company_name: string | null;
  company_type: string | null;
  country: string | null;
  city: string | null;
  currency: string | null;
  contact_name: string | null;
  contact_email: string | null;
  payment_terms: string | null;
  incoterms: string | null;
}

const COMPANY_COLUMNS =
  "id, company_name, company_type, country, city, currency, contact_name, contact_email, payment_terms, incoterms";

/** 순수 함수: companies.company_type → 도메인 PartnerType (I/O 없음 → 단위 테스트 가능) */
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

/** 순수 함수: companies 행 → 도메인 Partner (I/O 없음 → 단위 테스트 가능) */
export function mapCompanyToPartner(row: CompanyRow): Partner {
  return {
    id: row.id,
    name: row.company_name?.trim() || "(이름 없음)",
    type: mapCompanyTypeToPartnerType(row.company_type),
    country: row.country,
    city: row.city,
    currency: row.currency,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    paymentTerms: row.payment_terms,
    incoterms: row.incoterms,
  };
}

/**
 * 거래처 목록 조회 (I/O + 로직). 화면은 오직 이 함수만 호출한다.
 *
 * ★ 원칙 7의 보상: 나중에 companies → partners 테이블로 이전할 때
 *   이 함수 내부(쿼리/매핑)만 바꾸면 되고, 화면 코드는 손대지 않는다.
 */
export async function listPartners(): Promise<Partner[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("companies")
    .select(COMPANY_COLUMNS)
    .order("company_name", { ascending: true });

  if (error) {
    throw new Error(`거래처 목록 조회 실패: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as CompanyRow[];
  return rows.map(mapCompanyToPartner);
}
