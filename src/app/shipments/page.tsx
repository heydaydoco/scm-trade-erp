import Link from "next/link";
import { listShipments } from "@/services/shipments";
import type { Shipment } from "@/services/types";
import { PageHeader } from "@/components/PageHeader";
import { Badge, type BadgeVariant } from "@/components/Badge";
import {
  MILESTONE_TYPES,
  SHIPMENT_DIRECTION,
  SHIPMENT_STATUS,
  TRANSPORT,
  labelOf,
} from "@/services/codes";

// 항상 요청 시점에 최신 데이터를 읽는다.
export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  draft: "zinc",
  booked: "blue",
  shipped: "violet",
  arrived: "green",
  cancelled: "red",
};

/** 다음 마일스톤 = 예정일 있고 실적 없는 것 중 가장 이른 것. */
function nextMilestone(s: Shipment) {
  const upcoming = s.milestones
    .filter((m) => m.plannedDate && !m.actualDate)
    .sort((a, b) => (a.plannedDate! < b.plannedDate! ? -1 : 1));
  return upcoming[0] ?? null;
}

export default async function ShipmentsPage() {
  let shipments: Shipment[] = [];
  let errorMessage: string | null = null;

  try {
    shipments = await listShipments();
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <PageHeader
        title="선적"
        subtitle="Shipments"
        count={errorMessage ? undefined : shipments.length}
        action={{ href: "/shipments/new", label: "+ 선적 부킹" }}
      />

      {errorMessage ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-semibold">데이터를 불러오지 못했습니다.</p>
          <p className="mt-1 break-all text-red-600">{errorMessage}</p>
          <p className="mt-2 text-xs text-red-500">
            shipments 테이블이 아직 없다면 db/migrations/p3.2_shipments.sql 을
            Supabase에서 먼저 실행하세요. (무료티어 정지 시 대시보드에서 Restore)
          </p>
        </div>
      ) : shipments.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-10 text-center text-zinc-500">
          등록된 선적이 없습니다. 수주·발주 화면의 &ldquo;→ 선적 부킹&rdquo; 또는 우측 상단 &ldquo;+ 선적 부킹&rdquo;으로 추가하세요.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-medium">선적번호</th>
                <th className="px-4 py-3 font-medium">방향</th>
                <th className="px-4 py-3 font-medium">상대 · 운송</th>
                <th className="px-4 py-3 font-medium">연결 주문</th>
                <th className="px-4 py-3 font-medium">다음 일정</th>
                <th className="px-4 py-3 font-medium">상태</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {shipments.map((s) => {
                const nm = nextMilestone(s);
                return (
                  <tr key={s.id} className="hover:bg-zinc-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/shipments/${s.id}`}
                        className="font-mono text-sm font-medium text-zinc-900 hover:text-blue-700 hover:underline"
                      >
                        {s.shipNumber || "(번호 없음)"}
                      </Link>
                      {s.bookingNo ? (
                        <span className="block text-xs text-zinc-400">
                          부킹 {s.bookingNo}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={s.direction === "import" ? "amber" : "blue"}>
                        {labelOf(SHIPMENT_DIRECTION, s.direction)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-zinc-700">
                      {s.partnerName ?? (
                        <span className="text-zinc-300">미지정/혼합</span>
                      )}
                      <span className="block text-xs text-zinc-400">
                        {s.transport ? labelOf(TRANSPORT, s.transport) : "-"}
                        {s.forwarder ? ` · ${s.forwarder}` : ""}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-600">
                      {s.orders.length > 0 ? (
                        <span>
                          {s.orders.length}건
                          <span className="ml-1 text-xs text-zinc-400">
                            {s.orders
                              .slice(0, 2)
                              .map((o) => `${o.orderType} ${o.orderNumber ?? ""}`)
                              .join(", ")}
                            {s.orders.length > 2 ? " …" : ""}
                          </span>
                        </span>
                      ) : (
                        <span className="text-zinc-300">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-600 tabular-nums">
                      {nm ? (
                        <span>
                          {labelOf(MILESTONE_TYPES, nm.type)}
                          <span className="ml-1 text-zinc-400">
                            {nm.plannedDate}
                          </span>
                        </span>
                      ) : (
                        <span className="text-zinc-300">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_VARIANT[s.status] ?? "zinc"}>
                        {labelOf(SHIPMENT_STATUS, s.status)}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-6 text-xs text-zinc-400">
        P3 진행 중 · 선적번호 클릭 = 수정 · 방향은 라벨(주문 연결은 SO·PO 혼합 가능) · 품목·수량 배분은 P4 · 데이터 출처: Supabase
      </p>
    </div>
  );
}
