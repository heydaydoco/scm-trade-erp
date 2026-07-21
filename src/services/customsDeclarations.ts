import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CustomsDeclaration, CustomsDeclarationInput } from "./types";

/**
 * 통관신고(P5.1 E6/E9) 서비스 — 헤더 온리, 인쇄물 없음.
 *
 * ⚠️ 쓰기는 SECURITY DEFINER RPC 2종(save_customs_declaration·cancel_customs_declaration)뿐이다.
 *    앱에는 customs_declarations 쓰기 권한이 없다(출생 봉인) — 방향 일치·상태 전이·필수/전용
 *    필드·금액통화·날짜 정합 검증은 전부 RPC 가 원자적으로(선적 헤더 락과 함께) 수행한다.
 *    순수 검증·계산은 services/customsDeclLogic.ts(클라 안전)가 담당한다 —
 *    이 서비스는 supabase 서버 클라이언트를 import 하므로 순수부를 재수출하지 않는다
 *    (재수출하면 클라 소비자가 서버 코드를 끌어오게 된다). 소비자는 customsDeclLogic 을 직접 import.
 */

/* ---------- 물리 행 모양 ---------- */

interface CdRow {
  id: string;
  decl_doc_no: string;
  decl_type: string;
  shipment_id: string;
  status: string;
  customs_decl_no: string | null;
  filing_date: string | null;
  acceptance_date: string | null;
  broker_name: string | null;
  taxable_value: number | string | null;
  duty_amount: number | string | null;
  vat_amount: number | string | null;
  tax_currency: string | null;
  loading_deadline_extended: string | null;
  memo: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
  shipments?: {
    ship_number: string | null;
    status: string | null;
    companies?: { company_name: string | null } | null;
  } | null;
}

const CD_COLUMNS =
  "id, decl_doc_no, decl_type, shipment_id, status, customs_decl_no, filing_date, acceptance_date, " +
  "broker_name, taxable_value, duty_amount, vat_amount, tax_currency, loading_deadline_extended, " +
  "memo, cancelled_at, cancel_reason, created_at, updated_at, " +
  "shipments(ship_number, status, companies(company_name))";

function numOrNull(v: number | string | null): number | null {
  if (v === null) return null;
  return typeof v === "number" ? v : Number(v);
}

function mapDecl(row: CdRow): CustomsDeclaration {
  return {
    id: row.id,
    declDocNo: row.decl_doc_no,
    declType: row.decl_type,
    shipmentId: row.shipment_id,
    status: row.status,
    customsDeclNo: row.customs_decl_no,
    filingDate: row.filing_date,
    acceptanceDate: row.acceptance_date,
    brokerName: row.broker_name,
    taxableValue: numOrNull(row.taxable_value),
    dutyAmount: numOrNull(row.duty_amount),
    vatAmount: numOrNull(row.vat_amount),
    taxCurrency: row.tax_currency,
    loadingDeadlineExtended: row.loading_deadline_extended,
    memo: row.memo,
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    shipmentNo: row.shipments?.ship_number ?? null,
    shipmentStatus: row.shipments?.status ?? null,
    partnerName: row.shipments?.companies?.company_name ?? null,
  };
}

/* ---------- I/O — 조회 ---------- */

/** 통관신고 목록 — 취소 포함(이력 보존). 유형·상태 필터. */
export async function listCustomsDeclarations(opts?: {
  declType?: string;
  status?: string;
  limit?: number;
}): Promise<CustomsDeclaration[]> {
  const supabase = createSupabaseServerClient();
  let query = supabase.from("customs_declarations").select(CD_COLUMNS);
  if (opts?.declType) query = query.eq("decl_type", opts.declType);
  if (opts?.status) query = query.eq("status", opts.status);

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(opts?.limit ?? 200);

  if (error) throw new Error(`통관신고 목록 조회 실패: ${error.message}`);
  return ((data ?? []) as unknown as CdRow[]).map(mapDecl);
}

/** 특정 선적의 통관신고 (선적 상세 "통관신고" 섹션 — 취소 포함). */
export async function listCustomsDeclarationsForShipment(
  shipmentId: string,
): Promise<CustomsDeclaration[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("customs_declarations")
    .select(CD_COLUMNS)
    .eq("shipment_id", shipmentId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`선적 통관신고 조회 실패: ${error.message}`);
  return ((data ?? []) as unknown as CdRow[]).map(mapDecl);
}

/** 통관신고 1건. */
export async function getCustomsDeclaration(id: string): Promise<CustomsDeclaration | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("customs_declarations")
    .select(CD_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`통관신고 조회 실패: ${error.message}`);
  if (!data) return null;
  return mapDecl(data as unknown as CdRow);
}

/* ---------- I/O — 쓰기 (RPC 단일 경로) ---------- */

/**
 * 저장(신규/수정) — 검증·발번(신규 1회)이 한 트랜잭션(RPC). id=null 이면 신규.
 * 값 검증은 서버가 최종 권위 — 이 함수는 입력을 그대로 실어 보내고 서버 예외를 그대로 surface.
 */
export async function saveCustomsDeclaration(
  input: CustomsDeclarationInput,
): Promise<{ id: string; declDocNo: string; status: string }> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.rpc("save_customs_declaration", {
    p_id: input.id,
    p_shipment_id: input.shipmentId,
    p_decl_type: input.declType,
    p_status: input.status,
    p_customs_decl_no: input.customsDeclNo,
    p_filing_date: input.filingDate,
    p_acceptance_date: input.acceptanceDate,
    p_broker_name: input.brokerName,
    p_taxable_value: input.taxableValue,
    p_duty_amount: input.dutyAmount,
    p_vat_amount: input.vatAmount,
    p_tax_currency: input.taxCurrency,
    p_loading_deadline_extended: input.loadingDeadlineExtended,
    p_memo: input.memo,
  });

  if (error) throw new Error(`통관신고 저장 실패: ${error.message}`);
  const r = data as { id: string; declDocNo: string; status: string };
  return { id: r.id, declDocNo: r.declDocNo, status: r.status };
}

/** 취소 — 삭제가 아니라 상태 전환(→cancelled)뿐. 사유 필수. */
export async function cancelCustomsDeclaration(id: string, reason: string): Promise<void> {
  if (!reason || reason.trim() === "") {
    throw new Error("통관신고 취소 사유는 필수입니다.");
  }
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.rpc("cancel_customs_declaration", {
    p_id: id,
    p_reason: reason.trim(),
  });
  if (error) throw new Error(`통관신고 취소 실패: ${error.message}`);
}
