"use client";

import { useActionState, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { saveShipmentAction, type ShipmentFormState } from "./actions";
import type { Shipment, ShipmentInput } from "@/services/types";
import {
  INCOTERMS,
  MILESTONE_TEMPLATES,
  MILESTONE_TYPES,
  SHIPMENT_DIRECTION,
  SHIPMENT_STATUS,
  TRANSPORT,
  labelOf,
} from "@/services/codes";
import { Field, inputClass } from "@/components/Field";

/** 주문 연결 후보 (SO/PO 공통). */
export interface OrderOption {
  type: string; // 'SO' | 'PO'
  id: string;
  number: string;
  partnerName: string | null;
}

interface LinkedOrder {
  orderType: string;
  orderId: string;
  orderNumber: string;
}
interface MsRow {
  key: string;
  type: string;
  plannedDate: string;
  actualDate: string;
  memo: string;
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="sm:col-span-2">
      <p className="border-b border-zinc-100 pb-1 text-xs font-semibold uppercase tracking-wider text-zinc-400">
        {children}
      </p>
    </div>
  );
}

export function ShipmentForm({
  shipment,
  draft,
  partners,
  orderOptions,
}: {
  shipment?: Shipment;
  draft?: ShipmentInput;
  partners: { id: string; name: string; country: string | null }[];
  orderOptions: OrderOption[];
}) {
  const [state, formAction, pending] = useActionState<
    ShipmentFormState,
    FormData
  >(saveShipmentAction, {});
  const v = state.values;

  // 연결 주문 초기값: 수정 > 드래프트 > 없음
  const [linked, setLinked] = useState<LinkedOrder[]>(() => {
    const src = shipment?.orders?.length
      ? shipment.orders
      : draft?.orders?.length
        ? draft.orders
        : [];
    return src
      .filter((o) => o.orderId)
      .map((o) => ({
        orderType: o.orderType,
        orderId: o.orderId as string,
        orderNumber: o.orderNumber ?? "",
      }));
  });

  // 마일스톤 초기값
  const [ms, setMs] = useState<MsRow[]>(() => {
    const src = shipment?.milestones?.length
      ? shipment.milestones
      : draft?.milestones?.length
        ? draft.milestones
        : [];
    return src.map((m, i) => ({
      key: `ms-init-${i}`,
      type: m.type ?? "",
      plannedDate: m.plannedDate ?? "",
      actualDate: m.actualDate ?? "",
      memo: m.memo ?? "",
    }));
  });
  const msCounter = useRef(0);
  const makeKey = () => `ms-${msCounter.current++}`;

  // 편집 모드: 저장된 null을 '선택 안 함'('')으로 왕복(무단 변경·스푸리어스 감사 방지, 원칙 5).
  //   incoterms·partnerId(?? "")와 일관. 신규 모드: 기본 'sea'(UX·템플릿 버튼), draft 승계값 우선.
  const [transport, setTransport] = useState(
    shipment
      ? v?.transport ?? shipment.transport ?? ""
      : v?.transport ?? draft?.transport ?? "sea",
  );

  // 이미 연결된 주문 제외한 추가 후보(중복 연결 1차 차단)
  const available = orderOptions.filter(
    (o) => !linked.some((l) => l.orderType === o.type && l.orderId === o.id),
  );

  function addOrder(key: string) {
    if (!key) return;
    const [type, id] = key.split("::");
    const opt = orderOptions.find((o) => o.type === type && o.id === id);
    if (!opt) return;
    if (linked.some((l) => l.orderType === type && l.orderId === id)) return; // 중복 방지
    setLinked((prev) => [
      ...prev,
      { orderType: type, orderId: id, orderNumber: opt.number },
    ]);
  }
  function removeOrder(type: string, id: string) {
    setLinked((prev) =>
      prev.filter((l) => !(l.orderType === type && l.orderId === id)),
    );
  }

  function addMs(type = "") {
    setMs((prev) => [
      ...prev,
      { key: makeKey(), type, plannedDate: "", actualDate: "", memo: "" },
    ]);
  }
  function patchMs(key: string, patch: Partial<MsRow>) {
    setMs((prev) => prev.map((m) => (m.key === key ? { ...m, ...patch } : m)));
  }
  function removeMs(key: string) {
    setMs((prev) => prev.filter((m) => m.key !== key));
  }
  function fillTemplate() {
    const set = MILESTONE_TEMPLATES[transport] ?? MILESTONE_TEMPLATES.sea;
    const existing = new Set(ms.map((m) => m.type));
    const toAdd = set.filter((t) => !existing.has(t));
    setMs((prev) => [
      ...prev,
      ...toAdd.map((t) => ({
        key: makeKey(),
        type: t,
        plannedDate: "",
        actualDate: "",
        memo: "",
      })),
    ]);
  }

  const ordersPayload = JSON.stringify(
    linked.map((l) => ({
      orderType: l.orderType,
      orderId: l.orderId,
      orderNumber: l.orderNumber,
    })),
  );
  const milestonesPayload = JSON.stringify(
    ms
      .filter((m) => m.type)
      .map((m) => ({
        type: m.type,
        plannedDate: m.plannedDate || null,
        actualDate: m.actualDate || null,
        memo: m.memo.trim() || null,
      })),
  );

  const partnerDefault =
    v?.partnerId ?? shipment?.partnerId ?? draft?.partnerId ?? "";
  const partnerMissing =
    !!partnerDefault && !partners.some((p) => p.id === partnerDefault);

  return (
    <form action={formAction} className="space-y-6">
      {shipment ? <input type="hidden" name="id" value={shipment.id} /> : null}
      <input type="hidden" name="orders" value={ordersPayload} />
      <input type="hidden" name="milestones" value={milestonesPayload} />

      {state.error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.error}
        </div>
      ) : null}

      {shipment ? (
        <p className="text-sm text-zinc-500">
          선적번호{" "}
          <span className="font-mono font-medium text-zinc-800">
            {shipment.shipNumber}
          </span>{" "}
          <span className="text-zinc-400">(발번 후 불변 — 원칙 6)</span>
        </p>
      ) : (
        <p className="text-sm text-zinc-400">
          선적번호는 저장 시 자동 발번됩니다 (SHP-YYYYMM-NNN).
          {draft?.orders?.length ? " · 주문에서 부킹 생성됨" : ""}
        </p>
      )}

      {/* ---------- 기본 ---------- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SectionTitle>기본</SectionTitle>
        <Field label="방향 (라벨)">
          <select
            name="direction"
            className={inputClass}
            defaultValue={v?.direction ?? shipment?.direction ?? draft?.direction ?? "export"}
          >
            {SHIPMENT_DIRECTION.map((d) => (
              <option key={d.code} value={d.code}>
                {d.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="상태">
          <select
            name="status"
            className={inputClass}
            defaultValue={v?.status ?? shipment?.status ?? "draft"}
          >
            {SHIPMENT_STATUS.map((s) => (
              <option key={s.code} value={s.code}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="상대 거래처 (혼합 선적이면 비움)">
          <select
            name="partnerId"
            className={inputClass}
            defaultValue={partnerDefault}
          >
            <option value="">미지정 / 혼합</option>
            {partnerMissing ? (
              <option value={partnerDefault}>
                {shipment?.partnerName ?? partnerDefault} (기존 값)
              </option>
            ) : null}
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.country ? ` (${p.country})` : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="운송 방법">
          <select
            name="transport"
            className={inputClass}
            value={transport}
            onChange={(e) => setTransport(e.target.value)}
          >
            <option value="">선택 안 함</option>
            {TRANSPORT.map((t) => (
              <option key={t.code} value={t.code}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="포워더">
          <input
            name="forwarder"
            className={inputClass}
            defaultValue={v?.forwarder ?? shipment?.forwarder ?? ""}
          />
        </Field>
        <Field label="선사 / 항공사">
          <input
            name="carrier"
            className={inputClass}
            defaultValue={v?.carrier ?? shipment?.carrier ?? ""}
          />
        </Field>
        <Field label="선명·항차 / 편명">
          <input
            name="vesselVoyage"
            className={inputClass}
            defaultValue={v?.vesselVoyage ?? shipment?.vesselVoyage ?? ""}
          />
        </Field>
        <Field label="인코텀즈">
          <select
            name="incoterms"
            className={inputClass}
            defaultValue={v?.incoterms ?? shipment?.incoterms ?? draft?.incoterms ?? ""}
          >
            <option value="">선택 안 함</option>
            {INCOTERMS.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>

        <SectionTitle>항구 · 외부 참조번호</SectionTitle>
        <Field label="적출항 (POL)">
          <input
            name="pol"
            className={inputClass}
            defaultValue={v?.pol ?? shipment?.pol ?? ""}
          />
        </Field>
        <Field label="도착항 (POD)">
          <input
            name="pod"
            className={inputClass}
            defaultValue={v?.pod ?? shipment?.pod ?? ""}
          />
        </Field>
        <Field label="부킹번호 (포워더)">
          <input
            name="bookingNo"
            className={inputClass}
            defaultValue={v?.bookingNo ?? shipment?.bookingNo ?? ""}
          />
        </Field>
        <Field label="B/L 번호">
          <input
            name="blNo"
            className={inputClass}
            defaultValue={v?.blNo ?? shipment?.blNo ?? ""}
          />
        </Field>
        <Field label="컨테이너 번호">
          <input
            name="containerNo"
            className={inputClass}
            defaultValue={v?.containerNo ?? shipment?.containerNo ?? ""}
          />
        </Field>
      </div>

      {/* ---------- 연결 주문 (M:N) ---------- */}
      <div>
        <p className="mb-2 border-b border-zinc-100 pb-1 text-xs font-semibold uppercase tracking-wider text-zinc-400">
          연결 주문 — 수주(SO)·발주(PO) 혼합 가능 (합짐·직송·분할선적)
        </p>
        {linked.length > 0 ? (
          <ul className="mb-3 divide-y divide-zinc-100 rounded-lg border border-zinc-200">
            {linked.map((l) => {
              const opt = orderOptions.find(
                (o) => o.type === l.orderType && o.id === l.orderId,
              );
              return (
                <li
                  key={`${l.orderType}-${l.orderId}`}
                  className="flex items-center justify-between px-3 py-2 text-sm"
                >
                  <span>
                    <span
                      className={`mr-2 rounded px-1.5 py-0.5 text-xs font-medium ${
                        l.orderType === "SO"
                          ? "bg-blue-50 text-blue-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {l.orderType}
                    </span>
                    <span className="font-mono text-zinc-800">
                      {l.orderNumber}
                    </span>
                    {opt?.partnerName ? (
                      <span className="ml-2 text-zinc-400">
                        {opt.partnerName}
                      </span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeOrder(l.orderType, l.orderId)}
                    className="rounded px-1.5 py-0.5 text-zinc-400 hover:bg-red-50 hover:text-red-600"
                    title="연결 해제"
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mb-3 rounded-lg border border-dashed border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-400">
            연결된 주문이 없습니다. 아래에서 수주·발주를 추가하세요.
          </p>
        )}
        <select
          className={inputClass}
          value=""
          onChange={(e) => {
            addOrder(e.target.value);
            e.target.value = "";
          }}
        >
          <option value="">+ 주문 추가 (수주/발주 선택)…</option>
          {available.map((o) => (
            <option key={`${o.type}::${o.id}`} value={`${o.type}::${o.id}`}>
              [{o.type}] {o.number}
              {o.partnerName ? ` · ${o.partnerName}` : ""}
            </option>
          ))}
        </select>
      </div>

      {/* ---------- 마일스톤 ---------- */}
      <div>
        <div className="mb-2 flex items-center justify-between border-b border-zinc-100 pb-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            마일스톤 (일정) — 예정일이 기일 알림의 기준
          </p>
          <button
            type="button"
            onClick={fillTemplate}
            className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
          >
            기본 마일스톤 채우기 ({transport === "air" ? "항공" : "해상"})
          </button>
        </div>
        <div className="overflow-x-auto rounded-lg border border-zinc-200">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-2 py-2 text-left font-medium">유형</th>
                <th className="w-40 px-2 py-2 text-left font-medium">예정일</th>
                <th className="w-40 px-2 py-2 text-left font-medium">실적일</th>
                <th className="px-2 py-2 text-left font-medium">메모</th>
                <th className="w-8 px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {ms.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-3 text-center text-zinc-400">
                    마일스톤이 없습니다. &ldquo;기본 마일스톤 채우기&rdquo; 또는 아래 &ldquo;+ 행 추가&rdquo;.
                  </td>
                </tr>
              ) : (
                ms.map((m) => (
                  <tr key={m.key} className="align-top">
                    <td className="px-2 py-1.5">
                      <select
                        className={inputClass}
                        value={m.type}
                        onChange={(e) => patchMs(m.key, { type: e.target.value })}
                      >
                        <option value="">유형 선택</option>
                        {MILESTONE_TYPES.map((t) => (
                          <option key={t.code} value={t.code}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="date"
                        className={inputClass}
                        value={m.plannedDate}
                        onChange={(e) =>
                          patchMs(m.key, { plannedDate: e.target.value })
                        }
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="date"
                        className={inputClass}
                        value={m.actualDate}
                        onChange={(e) =>
                          patchMs(m.key, { actualDate: e.target.value })
                        }
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        className={inputClass}
                        value={m.memo}
                        onChange={(e) => patchMs(m.key, { memo: e.target.value })}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <button
                        type="button"
                        onClick={() => removeMs(m.key)}
                        className="rounded px-1.5 py-0.5 text-zinc-400 hover:bg-red-50 hover:text-red-600"
                        title="행 삭제"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          onClick={() => addMs()}
          className="mt-2 w-full rounded-lg border border-dashed border-zinc-300 bg-zinc-50 py-2 text-sm text-zinc-500 hover:bg-zinc-100"
        >
          + 행 추가
        </button>
        <p className="mt-1 text-[11px] text-zinc-400">
          유형: {MILESTONE_TYPES.map((t) => labelOf(MILESTONE_TYPES, t.code)).join(" · ")}
        </p>
      </div>

      {/* ---------- 비고 ---------- */}
      <Field label="비고 (Notes)" full>
        <textarea
          name="notes"
          rows={2}
          className={inputClass}
          defaultValue={v?.notes ?? shipment?.notes ?? ""}
        />
      </Field>

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
        >
          {pending ? "저장 중…" : shipment ? "수정 저장" : "등록"}
        </button>
        <Link
          href="/shipments"
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-600 transition-colors hover:bg-zinc-50"
        >
          취소
        </Link>
      </div>
    </form>
  );
}
