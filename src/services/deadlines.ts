import { createSupabaseServerClient } from "@/lib/supabase/server";
import { todayKst, daysBetween } from "@/lib/date";
import { MILESTONE_TYPES, labelOf } from "./codes";
import type { DeadlineItem, DeadlineSummary } from "./types";

// P4.0-a: 순수 날짜 로직을 lib/date로 옮겨 발번 경로와 공유한다(단위 테스트 대상).
// 기존 import 경로(@/services/deadlines)를 깨지 않도록 재수출.
export { todayKst, daysBetween };

/**
 * 임박 기일(기일 역산 알림) 서비스 — SPEC I7·E3, 원칙 7(로직/화면 분리).
 *
 * ⚠️ 읽기 전용 파생 뷰: 스키마·저장 없음. 기존 날짜 컬럼을 모아 D-day로 계산·정렬한다.
 * ⚠️ '오늘'은 반드시 **한국(Asia/Seoul) 달력 날짜** 기준(서버 UTC로 계산하면 KST 자정~09시 하루 어긋남).
 *
 * 소스(4종):
 *   · 선적 마일스톤: milestones.planned_date (actual_date 없음 + 소속 선적 status ≠ cancelled).
 *       '선적완료(shipped)'는 제외하지 않는다 — ETA처럼 선적 후에도 유효한 기일이 있다.
 *   · 수주 납기: sales_orders.requested_delivery_date (status ∉ {completed, cancelled}).
 *   · 발주 납기: purchase_orders.requested_delivery_date (status ∉ {completed, cancelled}).
 *   · 견적 유효기일: quotations.valid_until (status ∈ {draft, sent} — 승인/반려/만료 제외).
 *   · (미루는 소스: L/C 유효기일·최종선적일=P6, 대금 만기=P8 — 해당 테이블 생기면 추가)
 */

/* ---------- 물리 행 모양 (이 파일 바깥으로 노출 안 함) ---------- */

interface CompanyEmbed {
  company_name: string | null;
}
interface MilestoneRow {
  type: string | null;
  planned_date: string | null;
  memo: string | null;
  shipments: {
    id: string;
    ship_number: string | null;
    status: string | null;
    companies?: CompanyEmbed | null;
  } | null;
}
interface OrderRow {
  id: string;
  requested_delivery_date: string | null;
  status: string | null;
  companies?: CompanyEmbed | null;
  so_number?: string | null;
  po_number?: string | null;
}
interface QuotationRow {
  id: string;
  quotation_number: string | null;
  valid_until: string | null;
  status: string | null;
  companies?: CompanyEmbed | null;
}

/* ---------- I/O (서비스). 화면은 이 함수들만 호출한다. ---------- */

/** 모든 소스에서 미해결 기일을 모아 DeadlineItem[]로 (창 필터 전, 기일 오름차순=지남 최상단). */
async function gatherDeadlines(): Promise<DeadlineItem[]> {
  const supabase = createSupabaseServerClient();
  const today = todayKst();

  const [msRes, soRes, poRes, qtRes] = await Promise.all([
    supabase
      .from("milestones")
      .select(
        "type, planned_date, memo, shipments(id, ship_number, status, companies(company_name))",
      )
      .not("planned_date", "is", null)
      .is("actual_date", null),
    supabase
      .from("sales_orders")
      .select("id, so_number, requested_delivery_date, status, companies(company_name)")
      .not("requested_delivery_date", "is", null)
      .not("status", "in", "(completed,cancelled)"),
    supabase
      .from("purchase_orders")
      .select("id, po_number, requested_delivery_date, status, companies(company_name)")
      .not("requested_delivery_date", "is", null)
      .not("status", "in", "(completed,cancelled)"),
    supabase
      .from("quotations")
      .select("id, quotation_number, valid_until, status, companies(company_name)")
      .not("valid_until", "is", null)
      .in("status", ["draft", "sent"]),
  ]);

  for (const r of [msRes, soRes, poRes, qtRes]) {
    if (r.error) throw new Error(`임박 기일 조회 실패: ${r.error.message}`);
  }

  const items: DeadlineItem[] = [];

  // 선적 마일스톤 — 소속 선적 status='cancelled'면 제외(취소 선적의 기일이 영원히 남으면 안 됨).
  for (const m of (msRes.data ?? []) as unknown as MilestoneRow[]) {
    const s = m.shipments;
    if (!s || !m.planned_date) continue;
    if (s.status === "cancelled") continue;
    items.push({
      source: "milestone",
      sourceLabel: "선적 마일스톤",
      kind: labelOf(MILESTONE_TYPES, m.type),
      date: m.planned_date,
      dDay: daysBetween(today, m.planned_date),
      docType: "shipment",
      docId: s.id,
      docNumber: s.ship_number ?? "",
      partnerName: s.companies?.company_name ?? null,
      memo: m.memo,
    });
  }

  const pushOrder = (
    rows: OrderRow[],
    source: string,
    label: string,
    docType: string,
    numKey: "so_number" | "po_number",
  ) => {
    for (const o of rows) {
      if (!o.requested_delivery_date) continue;
      items.push({
        source,
        sourceLabel: label,
        kind: "납기 요청일",
        date: o.requested_delivery_date,
        dDay: daysBetween(today, o.requested_delivery_date),
        docType,
        docId: o.id,
        docNumber: o[numKey] ?? "",
        partnerName: o.companies?.company_name ?? null,
        memo: null,
      });
    }
  };
  pushOrder((soRes.data ?? []) as unknown as OrderRow[], "so", "수주 납기", "sales_order", "so_number");
  pushOrder((poRes.data ?? []) as unknown as OrderRow[], "po", "발주 납기", "purchase_order", "po_number");

  // 견적 유효기일
  for (const q of (qtRes.data ?? []) as unknown as QuotationRow[]) {
    if (!q.valid_until) continue;
    items.push({
      source: "quotation",
      sourceLabel: "견적 유효기일",
      kind: "유효기일",
      date: q.valid_until,
      dDay: daysBetween(today, q.valid_until),
      docType: "quotation",
      docId: q.id,
      docNumber: q.quotation_number ?? "",
      partnerName: q.companies?.company_name ?? null,
      memo: null,
    });
  }

  // 기일 오름차순(=dDay 오름차순) → 지남(과거)이 최상단. 동일 기일이면 소스·번호로 안정 정렬.
  items.sort(
    (a, b) =>
      a.dDay - b.dDay ||
      a.sourceLabel.localeCompare(b.sourceLabel) ||
      a.docNumber.localeCompare(b.docNumber),
  );
  return items;
}

export type DeadlineWindow = "default" | "all" | "overdue";

/**
 * 임박 기일 목록. 창(window):
 *  · default: 지남 전체 + 앞으로 30일 (dDay ≤ 30)
 *  · all:     먼 미래 포함 전체
 *  · overdue: 지남만 (dDay < 0)
 */
export async function listDeadlines(
  window: DeadlineWindow = "default",
): Promise<DeadlineItem[]> {
  const all = await gatherDeadlines();
  if (window === "all") return all;
  if (window === "overdue") return all.filter((d) => d.dDay < 0);
  return all.filter((d) => d.dDay <= 30); // default: 지남 전체 + 30일
}

/** 홈 배지 요약 — 지남 건수 + 7일 내 건수. */
export async function getDeadlineSummary(): Promise<DeadlineSummary> {
  const all = await gatherDeadlines();
  return {
    overdue: all.filter((d) => d.dDay < 0).length,
    within7: all.filter((d) => d.dDay >= 0 && d.dDay <= 7).length,
  };
}
