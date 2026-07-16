"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  saveShipmentCargoAction,
  type CargoFormState,
} from "./cargoActions";
import {
  planCargoLineDiff,
  defaultShipmentParties,
  type ShipmentPartyDraft,
  type ShipmentPartyRole,
  type SellerLike,
  type PartnerLike,
} from "@/services/cargoLogic";
import { round6 } from "@/services/docFlow";
import { SHIPMENT_PARTY_ROLES, labelOf } from "@/services/codes";
import type {
  ShipmentCargoLine,
  ShipmentParty,
  ShippableOrderLine,
} from "@/services/types";
import { inputClass } from "@/components/Field";

/**
 * 화물 내역·당사자 카드 (P4.4) — 구 선적 폼 **아래의 별도 카드, 별도 저장 버튼**.
 * 저장은 diff-upsert RPC(save_shipment_cargo)로만 간다 — 구 폼의 전량교체 저장이
 * 화물·당사자·마킹을 건드리지 않게 하는 경계다.
 *
 * 경고 2종 — 둘 다 차단이 아니라 확인(원칙 8):
 *  ① 초과 선적(주문라인 잔량보다 많이) ② 저장 시 기존 라인 삭제(diff 미리보기)
 * 단위 불명 라인은 P4.3f 와 같은 문구로 잠근다(단위 없는 수량은 서류에 못 싣는다).
 */

interface CargoRow {
  key: string;
  id: string | null; // 저장된 행이면 id — diff-upsert 의 UPDATE 키
  orderType: "SO" | "PO";
  orderLineId: string;
  itemName: string;
  uomDisplay: string; // 지금 해석된 단위 — 저장 시 서비스가 같은 체인으로 재해석
  uomSaved?: string; // 저장 스냅샷 — 지금 해석과 다르면 "저장 시 변경" 경고 표시
  qty: string;
  packageCount: string;
  packageType: string;
  grossWeightKg: string;
  cbm: string;
  memo: string;
}

export function CargoCard({
  shipmentId,
  direction,
  cancelled,
  initialLines,
  initialParties,
  initialMarks,
  shippable,
  partner,
  seller,
}: {
  shipmentId: string;
  direction: string | null;
  cancelled: boolean;
  initialLines: ShipmentCargoLine[];
  initialParties: ShipmentParty[];
  initialMarks: string | null;
  shippable: ShippableOrderLine[];
  partner: PartnerLike | null;
  seller: SellerLike;
}) {
  const [state, formAction, pending] = useActionState<CargoFormState, FormData>(
    saveShipmentCargoAction,
    {},
  );

  const byLineId = new Map(shippable.map((s) => [s.orderLineId, s]));
  const counter = useRef(0);
  const makeKey = () => `cg-${counter.current++}`;

  function toRows(lines: ShipmentCargoLine[]): CargoRow[] {
    // 렌더 중 ref 접근 금지(react-hooks/refs) — 저장 행은 id 가 유일하니 그대로 키로.
    return lines.map((l) => {
      // ★ 표시 단위는 "지금 다시 해석한 값"(불러오기 목록과 같은 원천) — 저장이 매번
      //   재해석하므로 저장 스냅샷을 그대로 보여주면 마스터 정정 후 화면과 저장 결과가
      //   어긋난다(폼 표시 == 저장 결과 불변식).
      const resolvedNow =
        (l.orderLineId ? byLineId.get(l.orderLineId)?.uom : null) ?? l.uom;
      return {
        key: `cg-${l.id}`,
        id: l.id,
        orderType: l.orderType,
        orderLineId: l.orderLineId ?? "",
        itemName: l.itemName,
        uomDisplay: resolvedNow,
        uomSaved: l.uom,
        qty: String(l.qty),
        packageCount: l.packageCount != null ? String(l.packageCount) : "",
        packageType: l.packageType ?? "",
        grossWeightKg: l.grossWeightKg != null ? String(l.grossWeightKg) : "",
        cbm: l.cbm != null ? String(l.cbm) : "",
        memo: l.memo ?? "",
      };
    });
  }

  // 저장된 스냅샷 그대로 — 없는 역할은 **빈 블록**(비운 것을 존중한다. 기본값을 다시
  // 채워 넣으면 "당사자 삭제"가 다음 저장에서 조용히 부활한다).
  function toPartiesStrict(saved: ShipmentParty[]): ShipmentPartyDraft[] {
    const bySaved = new Map(saved.map((p) => [p.role, p]));
    return (["shipper", "consignee", "notify"] as ShipmentPartyRole[]).map(
      (role) => {
        const s = bySaved.get(role);
        return s
          ? {
              role,
              companyId: s.companyId,
              name: s.name,
              address: s.address,
              contact: s.contact,
            }
          : { role, companyId: null, name: "", address: null, contact: null };
      },
    );
  }

  const [rows, setRows] = useState<CargoRow[]>(() => toRows(initialLines));
  const [parties, setParties] = useState<ShipmentPartyDraft[]>(() =>
    // 기본값 프리필은 "아무것도 저장된 적 없는" 신선한 화물에서만 — 라인은 있는데
    // 당사자가 0이면 사용자가 지운 것일 수 있으므로 빈 블록을 존중한다.
    initialParties.length === 0 && initialLines.length === 0
      ? defaultShipmentParties({ direction, seller, partner })
      : toPartiesStrict(initialParties),
  );
  const [marks, setMarks] = useState(initialMarks ?? "");
  // 저장된 정본(라인 id 세트)의 기준 — diff 미리보기·초과 계산의 축.
  const [savedLines, setSavedLines] = useState<ShipmentCargoLine[]>(initialLines);

  // 저장 성공 → 서버 정본으로 동기화(새 행이 id 를 받아 다음 저장에서 중복 INSERT 방지).
  // 동기화는 strict — 기본값을 다시 채우지 않는다(비운 당사자의 부활 방지).
  const lastSync = useRef<number>(0);
  useEffect(() => {
    if (state.saved && state.savedAt && state.savedAt !== lastSync.current) {
      lastSync.current = state.savedAt;
      setRows(toRows(state.saved.lines));
      setParties(toPartiesStrict(state.saved.parties));
      setMarks(state.saved.shippingMarks ?? "");
      setSavedLines(state.saved.lines);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.savedAt]);

  function patchRow(key: string, patch: Partial<CargoRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function removeRow(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }
  function addFromShippable(s: ShippableOrderLine) {
    const uom = s.uom;
    if (!uom) return; // 단위 불명 — 버튼도 비활성이지만 이중 방어
    setRows((prev) => [
      ...prev,
      {
        key: makeKey(),
        id: null,
        orderType: s.orderType,
        orderLineId: s.orderLineId,
        itemName: s.itemName ?? "(이름 없음)",
        uomDisplay: uom,
        qty: s.openQty > 0 ? String(s.openQty) : "",
        packageCount: "",
        packageType: "",
        grossWeightKg: "",
        cbm: "",
        memo: "",
      },
    ]);
  }

  /* ---------- 초과 선적 판정 — 주문라인별 합산(같은 라인 여러 행 허용) ---------- */
  // 뷰의 openQty 는 이 선적의 저장된 라인까지 이미 뺀 값이다 → 이 선적 몫을 되돌려
  // "이 선적을 제외한 잔량"을 만들고, 카드의 현재 행 합과 비교한다.
  const savedQtyByLine = new Map<string, number>();
  for (const l of savedLines) {
    if (!l.orderLineId) continue;
    savedQtyByLine.set(
      l.orderLineId,
      round6((savedQtyByLine.get(l.orderLineId) ?? 0) + l.qty),
    );
  }
  const currentQtyByLine = new Map<string, number>();
  for (const r of rows) {
    const q = Number((r.qty || "").replace(/,/g, ""));
    if (!Number.isFinite(q) || q <= 0) continue;
    currentQtyByLine.set(
      r.orderLineId,
      round6((currentQtyByLine.get(r.orderLineId) ?? 0) + q),
    );
  }
  const overLines = [...currentQtyByLine.entries()]
    .map(([lineId, q]) => {
      const s = byLineId.get(lineId);
      if (!s) return null;
      const effectiveOpen = round6(s.openQty + (savedQtyByLine.get(lineId) ?? 0));
      return q > effectiveOpen
        ? { lineId, name: s.itemName ?? "(이름 없음)", open: effectiveOpen, q }
        : null;
    })
    .filter(
      (x): x is { lineId: string; name: string; open: number; q: number } =>
        x !== null,
    );
  const overLineIds = new Set(overLines.map((o) => o.lineId));

  // payload 에는 수량이 유효한 행만 실린다 — diff 계획도 **같은 집합**으로 계산해야
  // "수량을 지운 저장 행"이 무경고 삭제되지 않는다(빠진 행 = 삭제 예정으로 집계돼
  // 아래 confirm 에 잡힌다).
  const payloadRows = rows.filter((r) => {
    const q = Number((r.qty || "").replace(/,/g, ""));
    return Number.isFinite(q) && q > 0;
  });
  const plan = planCargoLineDiff(
    savedLines.map((l) => l.id),
    payloadRows.map((r) => ({ id: r.id })),
  );

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    const blocks: string[] = [];
    if (overLines.length > 0) {
      blocks.push(
        "[선적 잔량 초과]\n" +
          overLines
            .map((o) => `· ${o.name}: 잔량 ${o.open} → 선적 ${o.q} (${round6(o.q - o.open)} 초과)`)
            .join("\n"),
      );
    }
    if (plan.deletes.length > 0) {
      blocks.push(`[삭제] 저장하면 기존 화물 라인 ${plan.deletes.length}줄이 삭제됩니다.`);
    }
    if (blocks.length === 0) return;
    const ok = window.confirm(
      `${blocks.join("\n\n")}\n\n막지는 않습니다(원칙 8). 그대로 저장할까요?`,
    );
    if (!ok) e.preventDefault();
  }

  /* ---------- payload ---------- */
  const linesPayload = JSON.stringify(
    payloadRows.map((r) => ({
      id: r.id,
      orderType: r.orderType,
      orderLineId: r.orderLineId,
      itemName: r.itemName,
      qty: r.qty,
      packageCount: r.packageCount,
      packageType: r.packageType,
      grossWeightKg: r.grossWeightKg,
      cbm: r.cbm,
      memo: r.memo,
    })),
  );
  const partiesPayload = JSON.stringify(parties);
  // 동시성 베이스라인 — 이 화면이 알고 있는 저장 라인 id. 서비스가 DB 와 대조해
  // 다른 화면이 추가한 라인을 diff-DELETE 가 지우지 않도록 막는다.
  const knownIdsPayload = JSON.stringify(savedLines.map((l) => l.id));

  /* ---------- 불러오기 목록: 주문별 그룹 ---------- */
  const orderGroups = new Map<string, ShippableOrderLine[]>();
  for (const s of shippable) {
    const k = `${s.orderType}|${s.orderId}`;
    orderGroups.set(k, [...(orderGroups.get(k) ?? []), s]);
  }

  const partnerRole: ShipmentPartyRole =
    direction === "import" ? "shipper" : "consignee";

  function pullPartner() {
    if (!partner) return;
    const drafts = defaultShipmentParties({ direction, seller, partner });
    const fresh = drafts.find((d) => d.role === partnerRole)!;
    setParties((prev) => prev.map((p) => (p.role === partnerRole ? fresh : p)));
  }
  function fillDefaults() {
    setParties(defaultShipmentParties({ direction, seller, partner }));
  }
  // companyId 는 "어디서 떠온 스냅샷인가"의 출처 기록일 뿐이라 수기 수정에도 유지한다.
  function patchParty(role: ShipmentPartyRole, patch: Partial<ShipmentPartyDraft>) {
    setParties((prev) =>
      prev.map((p) => (p.role === role ? { ...p, ...patch } : p)),
    );
  }

  if (cancelled) {
    return (
      <section className="mt-10 rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-600">
        🔒 취소된 선적입니다 — 화물 내역·당사자는 수정할 수 없습니다.
        {initialLines.length > 0 && (
          <span className="ml-1 text-xs text-slate-500">
            (기록 {initialLines.length}줄은 S/I 인쇄에서 확인할 수 있습니다)
          </span>
        )}
      </section>
    );
  }

  return (
    <section className="mt-10 space-y-4">
      <div className="border-b border-zinc-100 pb-1">
        <h2 className="text-base font-semibold text-slate-900">
          화물 내역 · 당사자 (S/I 재료)
        </h2>
        <p className="mt-0.5 text-xs text-slate-500">
          위 선적 폼과 <b>저장이 분리</b>돼 있습니다 — 이 카드는 아래{" "}
          <b>[화물 내역 저장]</b> 버튼으로만 저장됩니다. 라인이 있는 주문은 수정이
          잠깁니다(원칙 5).
        </p>
      </div>

      <form action={formAction} onSubmit={onSubmit}>
        {/* 저장 중 입력 잠금 — 대기 창에 친 키가 동기화(setRows)로 증발하는 것을 막는다 */}
        <fieldset disabled={pending} className="m-0 border-0 p-0 space-y-4">
        <input type="hidden" name="shipmentId" value={shipmentId} />
        <input type="hidden" name="lines" value={linesPayload} />
        <input type="hidden" name="parties" value={partiesPayload} />
        <input type="hidden" name="knownLineIds" value={knownIdsPayload} />

        {state.error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {state.error}
          </p>
        )}
        {state.ok && !state.error && (
          <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {state.ok}
          </p>
        )}

        {/* ---------- 라인 불러오기 (연결 주문별) ---------- */}
        {orderGroups.size === 0 ? (
          <p className="rounded-md border border-dashed border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-500">
            연결된 주문이 없습니다 — 먼저 위 폼에서 수주/발주를 연결하고 저장하세요.
          </p>
        ) : (
          <details className="rounded-lg border border-slate-200">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-700">
              📋 주문 라인 불러오기 (잔량 프리필)
            </summary>
            <div className="divide-y divide-slate-100 border-t border-slate-100">
              {[...orderGroups.entries()].map(([k, group]) => {
                const first = group[0];
                return (
                  <div key={k} className="px-3 py-2">
                    <p className="mb-1 text-xs font-medium text-slate-500">
                      <span
                        className={`mr-1 rounded px-1 py-0.5 ${
                          first.orderType === "SO"
                            ? "bg-blue-50 text-blue-700"
                            : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {first.orderType}
                      </span>
                      <span className="font-mono">{first.orderNumber ?? "(번호 없음)"}</span>
                    </p>
                    <ul className="space-y-1">
                      {group.map((s) => (
                        <li
                          key={s.orderLineId}
                          className="flex items-center justify-between gap-2 text-sm"
                        >
                          <span className="min-w-0 truncate">
                            {s.itemName ?? "(이름 없음)"}
                            <span className="ml-2 text-xs tabular-nums text-slate-500">
                              잔량 {s.openQty}
                              {s.uom ? ` ${s.uom}` : ""} / 주문 {s.orderedQty}
                            </span>
                            {s.uom === null && (
                              <span className="ml-2 text-xs text-amber-700">
                                단위 없음 — 선적 불가 (품목 마스터에 단위를 입력하세요)
                              </span>
                            )}
                          </span>
                          <button
                            type="button"
                            disabled={s.uom === null}
                            onClick={() => addFromShippable(s)}
                            className="shrink-0 rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50 disabled:opacity-40"
                          >
                            + 담기
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </details>
        )}

        {/* ---------- 화물 라인 ---------- */}
        {rows.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">품목</th>
                  <th className="px-3 py-2 text-right">수량</th>
                  <th className="px-3 py-2">단위</th>
                  <th className="px-3 py-2 text-right">포장수</th>
                  <th className="px-3 py-2">포장</th>
                  <th className="px-3 py-2 text-right">중량(kg)</th>
                  <th className="px-3 py-2 text-right">CBM</th>
                  <th className="px-3 py-2">비고</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const s = byLineId.get(r.orderLineId);
                  const q = Number((r.qty || "").replace(/,/g, ""));
                  const lineOver = overLineIds.has(r.orderLineId);
                  return (
                    <tr key={r.key}>
                      <td className="px-3 py-2">
                        {r.itemName}
                        <div className="text-xs text-slate-400">
                          {r.orderType} · {s?.orderNumber ?? "(주문)"}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          value={r.qty}
                          onChange={(e) => patchRow(r.key, { qty: e.target.value })}
                          inputMode="decimal"
                          className={`w-20 rounded border px-2 py-1 text-right ${
                            lineOver && Number.isFinite(q) && q > 0
                              ? "border-amber-400 bg-amber-50"
                              : "border-slate-300"
                          }`}
                        />
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        {r.uomDisplay}
                        {r.uomSaved && r.uomSaved !== r.uomDisplay && (
                          <div
                            className="text-[10px] text-amber-700"
                            title="주문 라인/품목 마스터의 단위가 저장 이후 바뀌었습니다. 저장하면 새 단위로 기록됩니다."
                          >
                            저장분 {r.uomSaved} → {r.uomDisplay}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          value={r.packageCount}
                          onChange={(e) => patchRow(r.key, { packageCount: e.target.value })}
                          inputMode="numeric"
                          className="w-16 rounded border border-slate-300 px-2 py-1 text-right"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={r.packageType}
                          onChange={(e) => patchRow(r.key, { packageType: e.target.value })}
                          placeholder="CTN"
                          className="w-16 rounded border border-slate-300 px-2 py-1 text-xs"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          value={r.grossWeightKg}
                          onChange={(e) =>
                            patchRow(r.key, { grossWeightKg: e.target.value })
                          }
                          inputMode="decimal"
                          className="w-20 rounded border border-slate-300 px-2 py-1 text-right"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          value={r.cbm}
                          onChange={(e) => patchRow(r.key, { cbm: e.target.value })}
                          inputMode="decimal"
                          className="w-16 rounded border border-slate-300 px-2 py-1 text-right"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={r.memo}
                          onChange={(e) => patchRow(r.key, { memo: e.target.value })}
                          className="w-24 rounded border border-slate-300 px-2 py-1 text-xs"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => removeRow(r.key)}
                          className="rounded px-1.5 py-0.5 text-zinc-400 hover:bg-red-50 hover:text-red-600"
                          title="이 줄 삭제 (저장 시 반영)"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {overLines.length > 0 && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            ⚠️ 주문 잔량보다 많이 싣습니다({overLines.length}개 라인). 막지는 않지만
            저장 시 확인합니다(원칙 8 — 분할선적·포장 분리는 정상 업무입니다).
          </p>
        )}
        {plan.deletes.length > 0 && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-800">
            저장하면 기존 화물 라인 {plan.deletes.length}줄이 삭제됩니다(diff 저장 —
            남긴 줄의 id 는 유지됩니다).
          </p>
        )}

        {/* ---------- 당사자 3블록 (스냅샷 — 자유 수정) ---------- */}
        <div>
          <div className="mb-2 flex items-center justify-between border-b border-zinc-100 pb-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              당사자 (S/I 는 이 스냅샷만 인쇄한다 — 거래처 마스터를 나중에 고쳐도 불변)
            </p>
            <span className="flex gap-2">
              {partner && (
                <button
                  type="button"
                  onClick={pullPartner}
                  className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50"
                >
                  거래처에서 불러오기 ({labelOf(SHIPMENT_PARTY_ROLES, partnerRole)})
                </button>
              )}
              <button
                type="button"
                onClick={fillDefaults}
                className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50"
              >
                기본값 채우기
              </button>
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {parties.map((p) => (
              <div key={p.role} className="rounded-lg border border-slate-200 p-3">
                <p className="mb-2 text-xs font-semibold text-slate-500">
                  {labelOf(SHIPMENT_PARTY_ROLES, p.role)}
                </p>
                <input
                  value={p.name}
                  onChange={(e) => patchParty(p.role, { name: e.target.value })}
                  placeholder="이름 (비우면 이 블록은 저장 안 함)"
                  className={`${inputClass} mb-2`}
                />
                <textarea
                  value={p.address ?? ""}
                  onChange={(e) =>
                    patchParty(p.role, { address: e.target.value || null })
                  }
                  placeholder="주소"
                  rows={2}
                  className={`${inputClass} mb-2`}
                />
                <input
                  value={p.contact ?? ""}
                  onChange={(e) =>
                    patchParty(p.role, { contact: e.target.value || null })
                  }
                  placeholder="연락처 (전화/이메일)"
                  className={inputClass}
                />
              </div>
            ))}
          </div>
        </div>

        {/* ---------- Shipping Marks ---------- */}
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Shipping Marks (화인)
          </p>
          <textarea
            name="shippingMarks"
            value={marks}
            onChange={(e) => setMarks(e.target.value)}
            rows={3}
            placeholder={"예)\nACME / LONDON\nC/NO. 1-10\nMADE IN KOREA"}
            className={inputClass}
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {pending ? "저장 중…" : "화물 내역 저장"}
          </button>
          <span className="text-xs text-slate-500">
            수량 총계는 단위별, 포장 총계는 포장 유형별로 따로 계산됩니다(섞어 더하지
            않음 — P4.3e 규칙).
          </span>
        </div>
        </fieldset>
      </form>
    </section>
  );
}
