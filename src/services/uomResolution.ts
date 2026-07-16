import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveDocLineUom, type DocLineUnitInfo } from "./docFlow";
import { listItemUnits } from "./items";

/**
 * ★ P4.3f 저장 경로 단위 해석 — 입고·출고 **공용 I/O 오케스트레이션**.
 *
 * 순수 규칙(폴백 체인·거부/양보 판정)은 docFlow(resolveUom·resolveDocLineUom)가
 * 단일 진실이고, 여기는 그 규칙에 먹일 재료(전표 라인·마스터 단위)를 조회만 한다.
 * docFlow 는 클라이언트 안전 모듈이라 supabase I/O 를 넣을 수 없어 파일을 나눴다.
 *
 * ⚠️ 두 벌로 복붙하지 않는다 — receipts/deliveries 가 각자 들고 있으면 한쪽만
 *    고쳐져 GR·DLV 원장이 어긋난다(이 단계가 잡은 바로 그 결함의 재생산).
 *
 * ⚠️ 라인 조회는 반드시 **전표 id 로 스코프**한다 — id 만으로 찾으면 타 전표의
 *    라인이 "유효한 라인"으로 잡혀, RPC 의 정확한 거부('이 발주/수주의 라인이
 *    아닙니다') 대신 엉뚱한 단위 오류를 지어내게 된다.
 */
/**
 * ★ P4.4 선적 화물용 단위 해석 — 규칙은 P4.3f 와 동일(라인 uom → products.unit →
 * 거부/양보, docFlow.resolveDocLineUom 단일 진실), **스코프만 다르다**: 화물 라인은
 * 한 선적에 연결된 여러 수주·발주에 걸치므로, "이 선적에 연결된 주문의 라인"으로
 * 스코프한다. 스코프 밖 라인은 null 양보 — RPC 가 '연결되지 않은 주문의 라인'으로
 * 정확히 거부한다(단위 오류를 지어내지 않는다).
 */
export async function resolveShipmentCargoUoms(opts: {
  shipmentId: string;
  lineRefs: {
    orderType: "SO" | "PO";
    lineId: string | null;
    itemName: string | null;
  }[];
}): Promise<(string | null)[]> {
  const supabase = createSupabaseServerClient();

  const { data: links, error: linkErr } = await supabase
    .from("shipment_orders")
    .select("order_type, order_id")
    .eq("shipment_id", opts.shipmentId);
  if (linkErr) throw new Error(`선적 주문연결 조회 실패: ${linkErr.message}`);
  const soIds = (links ?? [])
    .filter((l) => l.order_type === "SO")
    .map((l) => l.order_id as string);
  const poIds = (links ?? [])
    .filter((l) => l.order_type === "PO")
    .map((l) => l.order_id as string);

  const rowById = new Map<string, DocLineUnitInfo>();
  async function loadLines(
    table: "so_lines" | "po_lines",
    docColumn: "so_id" | "po_id",
    docIds: string[],
    ids: string[],
  ) {
    if (ids.length === 0 || docIds.length === 0) return;
    const { data, error } = await supabase
      .from(table)
      .select("id, unit, product_id, product_name")
      .in("id", ids)
      .in(docColumn, docIds);
    if (error) throw new Error(`주문 라인 단위 조회 실패: ${error.message}`);
    for (const r of (data ?? []) as unknown as {
      id: string;
      unit: string | null;
      product_id: string | null;
      product_name: string | null;
    }[]) {
      rowById.set(r.id, {
        unit: r.unit,
        productId: r.product_id,
        productName: r.product_name,
      });
    }
  }
  const soRefs = opts.lineRefs
    .filter((r) => r.orderType === "SO" && r.lineId)
    .map((r) => r.lineId as string);
  const poRefs = opts.lineRefs
    .filter((r) => r.orderType === "PO" && r.lineId)
    .map((r) => r.lineId as string);
  await loadLines("so_lines", "so_id", soIds, soRefs);
  await loadLines("po_lines", "po_id", poIds, poRefs);

  const needMaster: string[] = [];
  for (const r of opts.lineRefs) {
    const row = r.lineId ? rowById.get(r.lineId) : undefined;
    if (row?.productId && !row.unit?.trim()) needMaster.push(row.productId);
  }
  const masterUnits = await listItemUnits(needMaster);

  return opts.lineRefs.map((r) =>
    resolveDocLineUom(
      r.lineId ? rowById.get(r.lineId) : undefined,
      masterUnits,
      r.itemName,
    ),
  );
}

export async function resolveDocLineUoms(opts: {
  lineTable: "po_lines" | "so_lines";
  docColumn: "po_id" | "so_id";
  docId: string;
  /** 전표 라인 참조 + 표시용 이름(클라이언트 값 — DB 스냅샷이 없을 때만 쓴다). */
  lineRefs: { lineId: string | null; itemName: string | null }[];
  /** 에러 문구용 도메인 이름 — '발주' | '수주'. */
  docLabel: string;
}): Promise<(string | null)[]> {
  const supabase = createSupabaseServerClient();

  const ids = opts.lineRefs
    .map((r) => r.lineId)
    .filter((v): v is string => v !== null && v !== "");
  const rowById = new Map<string, DocLineUnitInfo>();
  if (ids.length > 0) {
    const { data, error } = await supabase
      .from(opts.lineTable)
      .select("id, unit, product_id, product_name")
      .in("id", ids)
      .eq(opts.docColumn, opts.docId);
    if (error)
      throw new Error(`${opts.docLabel} 라인 단위 조회 실패: ${error.message}`);
    for (const r of (data ?? []) as unknown as {
      id: string;
      unit: string | null;
      product_id: string | null;
      product_name: string | null;
    }[]) {
      rowById.set(r.id, {
        unit: r.unit,
        productId: r.product_id,
        productName: r.product_name,
      });
    }
  }

  // 라인에 단위가 없는 마스터 연결 품목만 마스터를 본다(그 외엔 조회 불필요).
  const needMaster: string[] = [];
  for (const r of opts.lineRefs) {
    const row = r.lineId ? rowById.get(r.lineId) : undefined;
    if (row?.productId && !row.unit?.trim()) needMaster.push(row.productId);
  }
  const masterUnits = await listItemUnits(needMaster);

  return opts.lineRefs.map((r) =>
    resolveDocLineUom(
      r.lineId ? rowById.get(r.lineId) : undefined,
      masterUnits,
      r.itemName,
    ),
  );
}
