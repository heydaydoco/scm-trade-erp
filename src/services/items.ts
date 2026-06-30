import { createSupabaseServerClient } from "@/lib/supabase/server";
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
