"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  saveShipmentContainersAction,
  type ContainerFormState,
} from "./containerActions";
import {
  containerMetrics,
  lineAllocationStatus,
  type AllocationLike,
} from "@/services/containerLogic";
// 컨테이너 diff 의미론은 화물 라인과 **동일**하다(id-diff-upsert) — 새 함수를 만들지
// 않고 검증된 계획기를 그대로 쓴다(payload 에서 빠진 저장 행 = 삭제 예정).
import { planCargoLineDiff } from "@/services/cargoLogic";
import { CONTAINER_TYPE_SUGGESTIONS } from "@/services/codes";
import type {
  ShipmentCargoLine,
  ShipmentContainer,
  ShipmentContainerAllocation,
} from "@/services/types";
import { inputClass } from "@/components/Field";

/**
 * 적입(P5.2 · E5) 카드 — 화물 카드 **아래의 별도 카드, 별도 저장 버튼**.
 * 저장은 RPC(save_shipment_containers) 하나로만 간다 — 컨테이너는 diff-upsert,
 * 배분은 세트 전량교체다.
 *
 * ⚠️ 무역서류(CI/PL) 발행 잠금 **비대상**이다(화인과 같은 등급) — 적입 실측은
 *    서류 발행 뒤에도 확정·정정되는 사실이라 잠그지 않는다.
 * ⚠️ 화면에 보이는 적입 지표(배분 포장수 합·비례 G.W./CBM·용적률)는 **전부 파생**이며
 *    저장되지 않는다. VGM 은 입력값이고 G.W. 합은 파생값이라 서로 비교하지 않는다.
 *
 * 경고 2종은 확인일 뿐 차단이 아니다(원칙 8): ① 과배분 ② 저장 시 컨테이너 삭제.
 * 반면 (컨테이너×라인) 중복 배분은 DB unique 위반이라 저장을 막는다.
 */

interface AllocRow {
  key: string;
  shipmentLineId: string;
  count: string;
}

interface ContainerRow {
  key: string; // = RPC 로 보내는 ref(payload 내 임시키). 저장 행은 id 기반이라 안정적.
  id: string | null;
  containerNo: string;
  containerType: string;
  sealNo: string;
  vgmKg: string;
  allocs: AllocRow[];
}

function isPositiveInt(v: string): boolean {
  const n = Number((v || "").replace(/,/g, ""));
  return Number.isFinite(n) && Number.isInteger(n) && n > 0;
}

// 로케일 고정 — 클라이언트 컴포넌트의 SSR·CSR 표기가 갈리지 않게(폼 선례와 동일).
function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

/**
 * 배분 줄의 상태 — payload 에 실리는 줄과 실리지 않는 줄을 화면이 구분해 말하기 위한 축.
 *  ok         : 라인 실존 + 포장수가 양의 정수 → 저장된다
 *  ghost      : 고른 화물 라인이 지금은 없다(다른 화면에서 삭제됨) → 저장 불가
 *  incomplete : 뭔가 입력했지만 아직 배분이 아니다(라인만·수량만·0·소수·음수) → 저장 안 됨
 *  empty      : 아무것도 안 쓴 줄 → 조용히 무시해도 되는 유일한 경우
 */
type AllocState = "ok" | "ghost" | "incomplete" | "empty";

export function ContainerCard({
  shipmentId,
  cancelled,
  initialContainers,
  initialAllocations,
  cargoLines,
}: {
  shipmentId: string;
  cancelled: boolean;
  initialContainers: ShipmentContainer[];
  initialAllocations: ShipmentContainerAllocation[];
  cargoLines: ShipmentCargoLine[];
}) {
  const [state, formAction, pending] = useActionState<
    ContainerFormState,
    FormData
  >(saveShipmentContainersAction, {});

  const counter = useRef(0);
  const makeKey = (prefix: string) => `${prefix}-n${counter.current++}`;

  function toRows(
    containers: ShipmentContainer[],
    allocations: ShipmentContainerAllocation[],
  ): ContainerRow[] {
    const byContainer = new Map<string, ShipmentContainerAllocation[]>();
    for (const a of allocations) {
      byContainer.set(a.containerId, [
        ...(byContainer.get(a.containerId) ?? []),
        a,
      ]);
    }
    // 렌더 중 ref 접근 금지(react-hooks/refs) — 저장 행은 id 가 유일하니 그대로 키로.
    return containers.map((c) => ({
      key: `ct-${c.id}`,
      id: c.id,
      containerNo: c.containerNo ?? "",
      containerType: c.containerType ?? "",
      sealNo: c.sealNo ?? "",
      vgmKg: c.vgmKg != null ? String(c.vgmKg) : "",
      allocs: (byContainer.get(c.id) ?? []).map((a) => ({
        key: `al-${a.id}`,
        shipmentLineId: a.shipmentLineId,
        count: String(a.allocatedPackageCount),
      })),
    }));
  }

  const [rows, setRows] = useState<ContainerRow[]>(() =>
    toRows(initialContainers, initialAllocations),
  );
  // 저장된 정본(컨테이너 id 세트)의 기준 — diff 미리보기·동시성 베이스라인의 축.
  const [savedContainers, setSavedContainers] =
    useState<ShipmentContainer[]>(initialContainers);

  // 저장 성공 → 서버 정본으로 동기화(새 컨테이너가 id 를 받아 다음 저장에서 중복 INSERT 방지).
  const lastSync = useRef<number>(0);
  useEffect(() => {
    if (state.saved && state.savedAt && state.savedAt !== lastSync.current) {
      lastSync.current = state.savedAt;
      setRows(toRows(state.saved.containers, state.saved.allocations));
      setSavedContainers(state.saved.containers);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.savedAt]);

  function patchRow(key: string, patch: Partial<ContainerRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function addContainer() {
    setRows((prev) => [
      ...prev,
      {
        key: makeKey("ct"),
        id: null,
        containerNo: "",
        containerType: "",
        sealNo: "",
        vgmKg: "",
        allocs: [],
      },
    ]);
  }
  function removeContainer(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }
  function addAlloc(containerKey: string) {
    setRows((prev) =>
      prev.map((r) =>
        r.key === containerKey
          ? {
              ...r,
              allocs: [
                ...r.allocs,
                { key: makeKey("al"), shipmentLineId: "", count: "" },
              ],
            }
          : r,
      ),
    );
  }
  function patchAlloc(
    containerKey: string,
    allocKey: string,
    patch: Partial<AllocRow>,
  ) {
    setRows((prev) =>
      prev.map((r) =>
        r.key === containerKey
          ? {
              ...r,
              allocs: r.allocs.map((a) =>
                a.key === allocKey ? { ...a, ...patch } : a,
              ),
            }
          : r,
      ),
    );
  }
  function removeAlloc(containerKey: string, allocKey: string) {
    setRows((prev) =>
      prev.map((r) =>
        r.key === containerKey
          ? { ...r, allocs: r.allocs.filter((a) => a.key !== allocKey) }
          : r,
      ),
    );
  }

  /* ---------- payload — 유효한 것만 싣되, 빠진 줄은 반드시 말한다 ---------- */
  // ⚠️ 적대검증 확정: 예전엔 라인을 고르고 수량을 잘못 쓴 줄이 **경고 없이** payload
  //    에서 빠지고 초록 성공 배너가 떴다(사용자 입력의 조용한 폐기). 이제는 상태를
  //    분류해 화면·확인창이 그 줄을 지목한다. 막지는 않는다(원칙 8).
  const knownLineIds = new Set(cargoLines.map((l) => l.id));
  const allocStateByKey = new Map<string, AllocState>();
  for (const r of rows) {
    for (const a of r.allocs) {
      const hasLine = a.shipmentLineId !== "";
      const hasCount = a.count.trim() !== "";
      let st: AllocState;
      if (hasLine && !knownLineIds.has(a.shipmentLineId)) st = "ghost";
      else if (hasLine && isPositiveInt(a.count)) st = "ok";
      else if (hasLine || hasCount) st = "incomplete";
      else st = "empty";
      allocStateByKey.set(a.key, st);
    }
  }
  const ghostCount = [...allocStateByKey.values()].filter((s) => s === "ghost").length;
  const incompleteCount = [...allocStateByKey.values()].filter(
    (s) => s === "incomplete",
  ).length;

  const validAllocs: AllocationLike[] = rows.flatMap((r) =>
    r.allocs
      .filter((a) => allocStateByKey.get(a.key) === "ok")
      .map((a) => ({
        containerRef: r.key,
        shipmentLineId: a.shipmentLineId,
        allocatedPackageCount: Number(a.count.replace(/,/g, "")),
      })),
  );

  const containersPayload = JSON.stringify(
    rows.map((r) => ({
      ref: r.key,
      id: r.id,
      containerNo: r.containerNo,
      containerType: r.containerType,
      sealNo: r.sealNo,
      vgmKg: r.vgmKg,
    })),
  );
  const allocationsPayload = JSON.stringify(validAllocs);
  // 동시성 베이스라인 — 이 화면이 알고 있는 저장 컨테이너 id. 서비스가 DB 와 대조해
  // 다른 화면이 추가한 컨테이너를 diff-DELETE 가 지우지 않도록 막는다.
  const knownIdsPayload = JSON.stringify(savedContainers.map((c) => c.id));

  /* ---------- 파생 지표 · 경고 (표시 전용 — 저장 없음) ---------- */
  const metrics = containerMetrics(
    rows.map((r) => ({ ref: r.key, containerType: r.containerType || null })),
    cargoLines,
    validAllocs,
  );
  const metricByRef = new Map(metrics.map((m) => [m.ref, m]));

  const lineStatus = lineAllocationStatus(cargoLines, validAllocs);
  const statusByLine = new Map(lineStatus.map((s) => [s.lineId, s]));
  const lineName = new Map(cargoLines.map((l) => [l.id, l.itemName]));
  const overLines = lineStatus.filter((s) => s.over);

  // (컨테이너×라인) 중복 — DB unique 제약 위반이라 저장 자체를 막는다(경고 아님).
  const dupPairs: string[] = [];
  for (const r of rows) {
    const seen = new Set<string>();
    for (const a of r.allocs) {
      if (allocStateByKey.get(a.key) !== "ok") continue;
      if (seen.has(a.shipmentLineId)) {
        dupPairs.push(
          `${r.containerNo || "(번호 미입력 컨테이너)"} · ${
            lineName.get(a.shipmentLineId) ?? "(라인)"
          }`,
        );
      }
      seen.add(a.shipmentLineId);
    }
  }

  const plan = planCargoLineDiff(
    savedContainers.map((c) => c.id),
    rows.map((r) => ({ id: r.id })),
  );

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (dupPairs.length > 0) {
      e.preventDefault();
      window.alert(
        `같은 컨테이너에 같은 화물 라인을 두 번 배분했습니다:\n${dupPairs
          .map((d) => `· ${d}`)
          .join("\n")}\n\n한 줄로 합친 뒤 저장하세요.`,
      );
      return;
    }
    const blocks: string[] = [];
    if (incompleteCount > 0 || ghostCount > 0) {
      const parts: string[] = [];
      if (incompleteCount > 0)
        parts.push(`· 입력이 덜 된 배분 줄 ${incompleteCount}건(라인 미선택 또는 포장수가 1 이상의 정수가 아님)`);
      if (ghostCount > 0)
        parts.push(`· 지금은 없는 화물 라인을 가리키는 배분 줄 ${ghostCount}건(화물 내역에서 삭제된 라인)`);
      blocks.push(`[저장 제외] 아래 줄은 저장되지 않습니다.\n${parts.join("\n")}`);
    }
    if (overLines.length > 0) {
      blocks.push(
        "[라인 포장수 초과 배분]\n" +
          overLines
            .map(
              (s) =>
                `· ${lineName.get(s.lineId) ?? "(라인)"}: 포장수 ${s.packageCount} → 배분 ${s.allocated}`,
            )
            .join("\n"),
      );
    }
    if (plan.deletes.length > 0) {
      blocks.push(
        `[삭제] 저장하면 기존 컨테이너 ${plan.deletes.length}건과 그 배분이 함께 삭제됩니다.`,
      );
    }
    if (blocks.length === 0) return;
    const ok = window.confirm(
      `${blocks.join("\n\n")}\n\n막지는 않습니다(원칙 8). 그대로 저장할까요?`,
    );
    if (!ok) e.preventDefault();
  }

  if (cancelled) {
    return (
      <section className="mt-10 rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-600">
        🔒 취소된 선적입니다 — 적입(컨테이너·배분)은 수정할 수 없습니다.
        {initialContainers.length > 0 && (
          <span className="ml-1 text-xs text-slate-500">
            (기록 {initialContainers.length}건은 S/I 인쇄에서 확인할 수 있습니다)
          </span>
        )}
      </section>
    );
  }

  return (
    <section className="mt-10 space-y-4">
      <div className="border-b border-zinc-100 pb-1">
        <h2 className="text-base font-semibold text-slate-900">
          적입 (컨테이너 · 배분 · VGM)
        </h2>
        <p className="mt-0.5 text-xs text-slate-500">
          위 카드들과 <b>저장이 분리</b>돼 있습니다 — 이 카드는 아래{" "}
          <b>[적입 내역 저장]</b> 버튼으로만 저장됩니다. 무역서류가 발행된
          선적에서도 적입은 수정할 수 있습니다. 배분은 <b>선택 사항</b>입니다
          (컨테이너만 기록해도 됩니다).
        </p>
      </div>

      <form action={formAction} onSubmit={onSubmit}>
        {/* 저장 중 입력 잠금 — 대기 창에 친 키가 동기화(setRows)로 증발하는 것을 막는다 */}
        <fieldset disabled={pending} className="m-0 border-0 p-0 space-y-4">
          <input type="hidden" name="shipmentId" value={shipmentId} />
          <input type="hidden" name="containers" value={containersPayload} />
          <input type="hidden" name="allocations" value={allocationsPayload} />
          <input
            type="hidden"
            name="knownContainerIds"
            value={knownIdsPayload}
          />

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

          <datalist id="container-type-suggestions">
            {CONTAINER_TYPE_SUGGESTIONS.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>

          {rows.length === 0 ? (
            <p className="rounded-md border border-dashed border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-500">
              기록된 컨테이너가 없습니다 — [+ 컨테이너 추가]로 시작하세요.
            </p>
          ) : (
            <div className="space-y-3">
              {rows.map((r, ci) => {
                const m = metricByRef.get(r.key);
                return (
                  <div
                    key={r.key}
                    className="rounded-lg border border-slate-200 p-3"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-slate-500">
                        컨테이너 {ci + 1}
                      </p>
                      <button
                        type="button"
                        onClick={() => removeContainer(r.key)}
                        className="rounded px-1.5 py-0.5 text-zinc-400 hover:bg-red-50 hover:text-red-600"
                        title="이 컨테이너 삭제 (저장 시 반영 — 배분도 함께 삭제)"
                      >
                        ✕
                      </button>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-4">
                      <label className="block">
                        <span className="mb-1 block text-[11px] text-slate-500">
                          컨테이너 번호
                        </span>
                        <input
                          value={r.containerNo}
                          onChange={(e) =>
                            patchRow(r.key, { containerNo: e.target.value })
                          }
                          placeholder="ABCD1234567"
                          className={inputClass}
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[11px] text-slate-500">
                          타입 (자유 입력)
                        </span>
                        <input
                          value={r.containerType}
                          onChange={(e) =>
                            patchRow(r.key, { containerType: e.target.value })
                          }
                          list="container-type-suggestions"
                          placeholder="40HC"
                          className={inputClass}
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[11px] text-slate-500">
                          씰 번호
                        </span>
                        <input
                          value={r.sealNo}
                          onChange={(e) =>
                            patchRow(r.key, { sealNo: e.target.value })
                          }
                          className={inputClass}
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[11px] text-slate-500">
                          VGM (kg)
                        </span>
                        <input
                          value={r.vgmKg}
                          onChange={(e) =>
                            patchRow(r.key, { vgmKg: e.target.value })
                          }
                          inputMode="decimal"
                          className={inputClass}
                        />
                      </label>
                    </div>

                    {/* ---------- 배분 (선택) ---------- */}
                    <div className="mt-3">
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                        화물 라인 배분 (포장수)
                      </p>
                      {cargoLines.length === 0 ? (
                        <p className="text-xs text-slate-500">
                          배분할 화물 라인이 없습니다 — 위 화물 카드에서 라인을
                          먼저 저장하세요(컨테이너만 기록해도 됩니다).
                        </p>
                      ) : (
                        <>
                          {r.allocs.map((a) => {
                            const st = a.shipmentLineId
                              ? statusByLine.get(a.shipmentLineId)
                              : undefined;
                            const as = allocStateByKey.get(a.key) ?? "empty";
                            return (
                              <div
                                key={a.key}
                                className="mb-1 flex flex-wrap items-center gap-2 text-sm"
                              >
                                <select
                                  value={a.shipmentLineId}
                                  onChange={(e) =>
                                    patchAlloc(r.key, a.key, {
                                      shipmentLineId: e.target.value,
                                    })
                                  }
                                  className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
                                >
                                  <option value="">— 화물 라인 선택 —</option>
                                  {cargoLines.map((l) => (
                                    <option key={l.id} value={l.id}>
                                      {l.itemName}
                                      {l.packageCount != null
                                        ? ` (포장 ${l.packageCount}${l.packageType ? ` ${l.packageType}` : ""})`
                                        : " (포장수 미기재)"}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  value={a.count}
                                  onChange={(e) =>
                                    patchAlloc(r.key, a.key, {
                                      count: e.target.value,
                                    })
                                  }
                                  inputMode="numeric"
                                  placeholder="포장수"
                                  className={`w-20 rounded border px-2 py-1 text-right ${
                                    as === "incomplete"
                                      ? "border-red-400 bg-red-50"
                                      : st?.over
                                        ? "border-amber-400 bg-amber-50"
                                        : "border-slate-300"
                                  }`}
                                />
                                {as === "ghost" ? (
                                  <span className="text-xs text-red-700">
                                    삭제된 화물 라인 — 줄을 지우거나 라인을 다시
                                    선택하세요 (저장되지 않음)
                                  </span>
                                ) : as === "incomplete" ? (
                                  <span className="text-xs text-red-700">
                                    입력이 덜 됐습니다 — 라인 선택 + 1 이상의 정수
                                    (저장되지 않음)
                                  </span>
                                ) : (
                                  st && (
                                    <span className="text-xs tabular-nums text-slate-500">
                                      {st.remaining === null
                                        ? "잔여 판단 불가(포장수 미기재)"
                                        : `잔여 ${st.remaining}`}
                                    </span>
                                  )
                                )}
                                <button
                                  type="button"
                                  onClick={() => removeAlloc(r.key, a.key)}
                                  className="rounded px-1.5 py-0.5 text-zinc-400 hover:bg-red-50 hover:text-red-600"
                                  title="이 배분 줄 삭제"
                                >
                                  ✕
                                </button>
                              </div>
                            );
                          })}
                          <button
                            type="button"
                            onClick={() => addAlloc(r.key)}
                            className="mt-1 rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50"
                          >
                            + 배분 추가
                          </button>
                        </>
                      )}
                    </div>

                    {/* ---------- 파생 지표 (표시 전용 — 저장되지 않음) ---------- */}
                    {m && m.allocationCount > 0 && (
                      <p className="mt-2 rounded bg-slate-50 px-2 py-1 text-xs text-slate-600">
                        배분 포장수 <b>{fmt(m.packages)}</b> · 비례 G.W.{" "}
                        <b>{fmt(m.grossWeightKg)}</b> kg
                        {m.gwIncomplete && "*"} · 비례 CBM{" "}
                        <b>{fmt(m.cbm)}</b>
                        {m.cbmIncomplete && "*"}
                        {m.utilization !== null && (
                          <>
                            {" "}
                            · 용적률 <b>{(m.utilization * 100).toFixed(1)}%</b>
                            <span className="text-slate-400">
                              {" "}
                              (공칭 {m.nominalCbm} m³ 기준 · 자문)
                            </span>
                          </>
                        )}
                        {(m.gwIncomplete || m.cbmIncomplete) && (
                          <span className="text-slate-400">
                            {" "}
                            * 원값(포장수·중량·CBM)이 없는 라인이 있어 일부만 합산
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <button
            type="button"
            onClick={addContainer}
            className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50"
          >
            + 컨테이너 추가
          </button>

          {dupPairs.length > 0 && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
              ⛔ 같은 컨테이너에 같은 화물 라인이 두 번 배분되었습니다(
              {dupPairs.length}건) — 한 줄로 합쳐야 저장할 수 있습니다.
            </p>
          )}
          {(incompleteCount > 0 || ghostCount > 0) && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
              ⚠️ 저장되지 않는 배분 줄이 있습니다
              {incompleteCount > 0 && ` · 입력이 덜 된 줄 ${incompleteCount}건`}
              {ghostCount > 0 && ` · 삭제된 화물 라인을 가리키는 줄 ${ghostCount}건`}
              . 막지는 않지만 저장 시 확인합니다(원칙 8).
            </p>
          )}
          {overLines.length > 0 && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              ⚠️ 라인 포장수보다 많이 배분했습니다({overLines.length}개 라인).
              막지는 않지만 저장 시 확인합니다(원칙 8 — 포장 재구성·혼적은 정상
              업무입니다).
            </p>
          )}
          {plan.deletes.length > 0 && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-800">
              저장하면 기존 컨테이너 {plan.deletes.length}건이 삭제됩니다(그
              컨테이너의 배분도 함께 사라집니다 — diff 저장, 남긴 컨테이너의 id
              는 유지됩니다).
            </p>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {pending ? "저장 중…" : "적입 내역 저장"}
            </button>
            <span className="text-xs text-slate-500">
              배분 포장수 합·비례 중량/CBM·용적률은 <b>화면 계산</b>입니다 —
              저장되지 않습니다. VGM 은 입력값이라 비례 중량과 별개입니다.
            </span>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
