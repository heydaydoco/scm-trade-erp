/**
 * 선적 화물(P4.4) 순수 로직 — I/O 없음 → 단위 테스트 대상(shipmentCargo.test.ts).
 *
 * ⚠️ **클라이언트 안전 모듈**이다(stockProjection.ts 와 같은 결) — 화물 카드는
 *    브라우저에서 diff 미리보기·당사자 프리필을 계산해야 하는데 services/shipmentCargo.ts
 *    는 supabase 서버 클라이언트를 import 하므로 "use client" 에서 못 부른다
 *    → 순수부만 여기 떼어 두고 shipmentCargo.ts 가 재수출한다.
 */
import { round6 } from "./docFlow";

/* ---------- ① diff-upsert 계획 — save_shipment_cargo RPC 의 diff 의미론 미러 ---------- */

export interface CargoDiffPlan {
  /** 들어온 id 중 기존에 실재 → UPDATE 대상 */
  updates: string[];
  /** 무id 신규 행 수 → INSERT 대상 */
  inserts: number;
  /** payload 에서 빠진 기존 행 → DELETE 대상 */
  deletes: string[];
  /** 들어온 id 인데 기존에 없음 — RPC 가 '이 선적의 화물 라인이 아닙니다'로 거부할 것 */
  unknown: string[];
}

/**
 * 라인 diff 계획 — RPC 는 전량교체가 아니라 diff-upsert 다(라인 id 안정성이
 * P4.6 문서흐름 추적의 전제). UI 는 이 계획으로 "저장 시 N줄 삭제"를 미리 경고한다.
 * payload 내 같은 id 중복은 한 번으로 센다.
 */
export function planCargoLineDiff(
  existingIds: readonly string[],
  incoming: readonly { id: string | null }[],
): CargoDiffPlan {
  const existing = new Set(existingIds);
  const incomingIds = new Set(
    incoming.map((l) => l.id).filter((v): v is string => v !== null && v !== ""),
  );
  return {
    updates: [...incomingIds].filter((id) => existing.has(id)),
    inserts: incoming.filter((l) => l.id === null || l.id === "").length,
    deletes: existingIds.filter((id) => !incomingIds.has(id)),
    unknown: [...incomingIds].filter((id) => !existing.has(id)),
  };
}

/* ---------- ② 당사자 스냅샷 프리필 (아키텍트 스펙 8) ---------- */
/*  export: shipper=자사 / consignee=선적 거래처, import: 반전,
    notify 기본값 "SAME AS CONSIGNEE". 전 필드는 스냅샷이므로 사용자가 자유 수정한다. */

export type ShipmentPartyRole = "shipper" | "consignee" | "notify";

export interface ShipmentPartyDraft {
  role: ShipmentPartyRole;
  companyId: string | null; // 출처 기록용 — 자사·수기 입력은 null
  name: string;
  address: string | null;
  contact: string | null;
}

export interface SellerLike {
  name: string;
  addressLines: string[];
  tel: string;
  email: string;
}

export interface PartnerLike {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  country: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
}

function sellerParty(role: ShipmentPartyRole, seller: SellerLike): ShipmentPartyDraft {
  return {
    role,
    companyId: null,
    name: seller.name,
    address: seller.addressLines.join("\n") || null,
    contact: [seller.tel, seller.email].filter(Boolean).join(" / ") || null,
  };
}

function partnerParty(
  role: ShipmentPartyRole,
  partner: PartnerLike | null,
): ShipmentPartyDraft {
  if (!partner) {
    // 혼합(3자무역) 선적은 거래처가 없다 — 이름을 비워 사용자 입력을 기다린다.
    return { role, companyId: null, name: "", address: null, contact: null };
  }
  return {
    role,
    companyId: partner.id,
    name: partner.name,
    address:
      [partner.address, partner.city, partner.country].filter(Boolean).join(", ") ||
      null,
    contact:
      [partner.contactName, partner.contactEmail, partner.contactPhone]
        .filter(Boolean)
        .join(" / ") || null,
  };
}

/** direction 프리필 — 미지정(null·레거시)은 export 로 간주. 반환 순서 고정(폼 3블록). */
export function defaultShipmentParties(opts: {
  direction: string | null;
  seller: SellerLike;
  partner: PartnerLike | null;
}): ShipmentPartyDraft[] {
  const isImport = opts.direction === "import";
  const shipper = isImport
    ? partnerParty("shipper", opts.partner)
    : sellerParty("shipper", opts.seller);
  const consignee = isImport
    ? sellerParty("consignee", opts.seller)
    : partnerParty("consignee", opts.partner);
  const notify: ShipmentPartyDraft = {
    role: "notify",
    companyId: null,
    name: "SAME AS CONSIGNEE",
    address: null,
    contact: null,
  };
  return [shipper, consignee, notify];
}

/* ---------- ④ S/I 총계 — P4.3e 교훈: 단위/유형을 섞어 더하지 않는다 ---------- */

export interface CargoQtyLike {
  qty: number;
  uom: string;
}

/** 수량 총계 — 단위별 분리(등장 순서 보존 → 인쇄 표기 안정). `100 M + 50 EA = 150` 금지. */
export function qtyTotalsByUom(lines: CargoQtyLike[]): { uom: string; qty: number }[] {
  const acc = new Map<string, number>();
  for (const l of lines) {
    acc.set(l.uom, round6((acc.get(l.uom) ?? 0) + l.qty));
  }
  return Array.from(acc, ([uom, qty]) => ({ uom, qty }));
}

export interface CargoPackageLike {
  packageCount: number | null;
  packageType: string | null;
}

/** 포장수 총계 — 포장 유형별 분리. 유형 미지정은 '(미지정)' 버킷, 수량 없는 줄 제외. */
export function packageTotalsByType(
  lines: CargoPackageLike[],
): { packageType: string; count: number }[] {
  const acc = new Map<string, number>();
  for (const l of lines) {
    if (!l.packageCount) continue; // null·0 은 총계 대상 아님
    const key = l.packageType?.trim() || "(미지정)";
    acc.set(key, round6((acc.get(key) ?? 0) + l.packageCount));
  }
  return Array.from(acc, ([packageType, count]) => ({ packageType, count }));
}

/** 중량(kg)·CBM(m³)은 고정 단위 — 단일 합계. null 은 건너뛴다(부동소수 정리). */
export function sumFinite(values: (number | null)[]): number {
  return round6(values.reduce<number>((s, v) => (v === null ? s : s + v), 0));
}
