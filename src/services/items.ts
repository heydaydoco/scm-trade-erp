import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveUom } from "./docFlow";
import type { Item, ItemInput } from "./types";

/**
 * 물리 테이블 `products`의 행 모양 (P1 한정).
 * 이 인터페이스는 이 파일 바깥으로 노출하지 않는다 — 화면은 Item만 안다.
 * (P1.3에서 products 테이블에 code/origin_country/is_dangerous/lot_managed/
 *  serial_managed/active/updated_at 컬럼을 추가했다 — db/migrations/p1.3_items.sql)
 */
interface ProductRow {
  id: string;
  code: string | null;
  product_name: string | null;
  hs_code: string | null;
  unit: string | null;
  unit_price: number | string | null; // numeric은 PostgREST가 문자열로 줄 수 있어 양쪽 허용
  currency: string | null;
  origin_country: string | null;
  is_dangerous: boolean | null;
  lot_managed: boolean | null;
  serial_managed: boolean | null;
  description: string | null;
  active: boolean | null;
}

const PRODUCT_COLUMNS =
  "id, code, product_name, hs_code, unit, unit_price, currency, origin_country, is_dangerous, lot_managed, serial_managed, description, active";

/* ---------- 순수 매핑 함수 (I/O 없음 → 단위 테스트 가능) ---------- */

/** products 행 → 도메인 Item */
export function mapProductToItem(row: ProductRow): Item {
  return {
    id: row.id,
    code: row.code,
    name: row.product_name?.trim() ?? "",
    hsCode: row.hs_code,
    baseUom: row.unit,
    stdPrice: row.unit_price == null ? null : Number(row.unit_price),
    currency: row.currency,
    originCountry: row.origin_country,
    isDangerous: row.is_dangerous ?? false,
    lotManaged: row.lot_managed ?? false,
    serialManaged: row.serial_managed ?? false,
    description: row.description,
    active: row.active ?? true,
  };
}

/** 도메인 ItemInput → products 컬럼 (저장용) */
function mapItemInputToProduct(input: ItemInput): Record<string, unknown> {
  return {
    code: input.code,
    product_name: input.name,
    hs_code: input.hsCode,
    unit: input.baseUom,
    unit_price: input.stdPrice,
    currency: input.currency,
    origin_country: input.originCountry,
    is_dangerous: input.isDangerous,
    lot_managed: input.lotManaged,
    serial_managed: input.serialManaged,
    description: input.description,
    active: input.active,
    updated_at: new Date().toISOString(),
  };
}

/* ---------- I/O (서비스). 화면은 이 함수들만 호출한다. ---------- */

/** 품목 목록 (활성·비활성 모두, 활성 먼저 → 품목명순). */
export async function listItems(): Promise<Item[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_COLUMNS)
    .order("active", { ascending: false })
    .order("product_name", { ascending: true });

  if (error) throw new Error(`품목 목록 조회 실패: ${error.message}`);
  const rows = (data ?? []) as unknown as ProductRow[];
  return rows.map(mapProductToItem);
}

/**
 * 품목 id → 마스터 단위(unit) 맵 — P4.3f 단위 폴백 체인(라인 uom → 마스터 unit)의
 * 표시층 조회용. 폼이 보여주는 단위와 서비스가 원장에 보내는 단위가 같은 규칙로
 * 해석돼야 "폼 예측 == 원장 기록" 불변식이 유지된다(해석 자체는 docFlow.resolveUom).
 */
export async function listItemUnits(
  ids: string[],
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  const unique = Array.from(new Set(ids)).filter((v) => v);
  if (unique.length === 0) return map;

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("products")
    .select("id, unit")
    .in("id", unique);

  if (error) throw new Error(`품목 단위 조회 실패: ${error.message}`);
  for (const r of (data ?? []) as unknown as {
    id: string;
    unit: string | null;
  }[]) {
    map.set(r.id, r.unit);
  }
  return map;
}

/**
 * 참조생성 폼(입고·출고)의 **표시용** 단위 해석 — 잔량 뷰 라인들을 받아
 * 라인 uom → 마스터 unit 체인으로 푼다. null = 단위 불명 → 폼이 그 줄을 잠근다.
 *
 * ⚠️ 두 폼 페이지가 각자 들고 있으면 입고·출고가 서로 다른 줄을 잠그게 드리프트
 *    한다 → 여기 한 벌만 둔다. 저장 경로(uomResolution.resolveDocLineUoms)와
 *    같은 순수 규칙(docFlow.resolveUom)을 쓰므로 "폼이 보여주는 단위 == 원장에
 *    박히는 단위" 불변식이 유지된다.
 */
export async function resolveOpenLineUoms(
  lines: { unit: string | null; productId: string | null }[],
): Promise<(string | null)[]> {
  const masterUnits = await listItemUnits(
    lines
      .filter((l) => l.productId && resolveUom(l.unit, null) === null)
      .map((l) => l.productId as string),
  );
  return lines.map((l) =>
    resolveUom(l.unit, l.productId ? masterUnits.get(l.productId) : null),
  );
}

/** 품목 1건 조회 (없으면 null). */
export async function getItem(id: string): Promise<Item | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`품목 조회 실패: ${error.message}`);
  return data ? mapProductToItem(data as unknown as ProductRow) : null;
}

/** 품목 등록. */
export async function createItem(input: ItemInput): Promise<Item> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("products")
    .insert(mapItemInputToProduct(input))
    .select(PRODUCT_COLUMNS)
    .single();

  if (error) throw new Error(`품목 등록 실패: ${error.message}`);
  return mapProductToItem(data as unknown as ProductRow);
}

/** 품목 수정 (정정. 삭제 대신 active 토글로 비활성 — 원칙 5). */
export async function updateItem(id: string, input: ItemInput): Promise<Item> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("products")
    .update(mapItemInputToProduct(input))
    .eq("id", id)
    .select(PRODUCT_COLUMNS)
    .single();

  if (error) throw new Error(`품목 수정 실패: ${error.message}`);
  return mapProductToItem(data as unknown as ProductRow);
}
