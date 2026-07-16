/**
 * 저장 전 예상재고 — 순수 로직(I/O 없음, 원칙 7·8).
 *
 * ⚠️ **클라이언트 안전 모듈**이다. 출고 폼은 사용자가 수량을 칠 때마다 예상재고를
 *    다시 계산해야 해서 브라우저에서 이 함수를 부른다. services/deliveries.ts 는
 *    supabase 서버 클라이언트를 import 하므로 "use client" 에서 못 부른다
 *    → 여기(순수)만 떼어 두고, deliveries.ts 가 재수출한다(호출부는 한 이름만 안다).
 */
import { round6 } from "./docFlow";

/** 출고 폼 한 줄의 수량 정보. */
export interface OutLineQty {
  itemId: string;
  itemName: string;
  qty: number;
  uom: string;
}

/** 품목별 예상재고. onHand 는 출고 창고 기준 현재고. */
export interface StockProjection {
  itemId: string;
  itemName: string;
  uom: string;
  onHand: number;
  outQty: number; // 이번 출고 합계(같은 품목 여러 라인을 합친 값)
  projected: number; // 음수 = 마이너스 재고 (차단 아님, 경고 대상)
}

/**
 * 저장 전 품목별 예상재고 — **같은 품목이 여러 수주 라인에 걸린 경우를 합산한다.**
 *
 * ★ 이게 이 단계의 함정: 라인별로 재고를 보면 각각은 통과하는데(6≤10, 5≤10)
 *   합치면 11 > 10 이라 −1 이 된다. 라인 단위로 경고하면 이 케이스를 놓친다.
 *
 * 수량 0/빈 줄은 "이번에 안 내보내는 품목"이라 집계에서 뺀다.
 *
 * ⚠️ 집계 키는 itemId 다 — **한 번에 넣는 lines 는 단위(uom)가 같아야 한다.**
 *    재고 뷰의 입도가 품목×창고×단위라 단위를 섞어 더하면 `100 PCS − 10 KG = 90`
 *    같은 거짓 숫자가 나온다(P4.1f에서 실제로 교정한 함정). 호출부가 단위별로 나눠 부른다.
 */
export function projectStockByItem(
  lines: OutLineQty[],
  onHandByItem: Record<string, number>,
): StockProjection[] {
  const agg = new Map<string, StockProjection>();

  for (const l of lines) {
    if (!Number.isFinite(l.qty) || l.qty <= 0) continue;
    const cur = agg.get(l.itemId);
    if (cur) {
      cur.outQty = round6(cur.outQty + l.qty);
      cur.projected = round6(cur.onHand - cur.outQty);
    } else {
      const onHand = onHandByItem[l.itemId] ?? 0;
      agg.set(l.itemId, {
        itemId: l.itemId,
        itemName: l.itemName,
        uom: l.uom,
        onHand,
        outQty: round6(l.qty),
        projected: round6(onHand - l.qty),
      });
    }
  }
  return Array.from(agg.values());
}

/** 마이너스가 되는 품목만 — 원칙 8: 차단하지 않고 확인만 받는다. */
export function shortagesOf(
  lines: OutLineQty[],
  onHandByItem: Record<string, number>,
): StockProjection[] {
  return projectStockByItem(lines, onHandByItem).filter((p) => p.projected < 0);
}
