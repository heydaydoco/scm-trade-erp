# Global SCM + Trade ERP — 마스터 설계 사양서 (SPEC)

> 이 문서는 시스템의 **단일 진실(Single Source of Truth)** 이다.
> Claude Code는 코드를 짜기 전 항상 이 문서를 먼저 읽고, 이 문서의 원칙을 어기지 않는다.
> 새 기능을 추가할 때마다 이 문서의 해당 섹션도 함께 갱신한다.

---

## 0. 이 시스템이 무엇인가 / 무엇이 아닌가

- **이다**: 글로벌 제조·수출입 기업의 SCM(공급망)과 수출입 무역 업무를 하나로 묶은 운영 시스템.
- **아니다**: 회계 장부의 법정 원장(전자세금계산서 발행 등 회계 적합성·세무 신고)을 대체하지 않는다. 회계는 별도 시스템/세무대리인과 연동하고, 이 시스템은 그 앞단(영업·물류·무역·재고)을 담당한다.
- **핵심 가치 3가지** (화면이 예쁜 게 아니라 이게 가치다):
  1. **잔량(open quantity) 추적** — 주문 100개 중 60개 출고 → 잔량 40개를 시스템이 안다.
  2. **기일 역산 알림** — L/C 유효기일, 선적 마감, 대금 만기를 놓치지 않게 먼저 알려준다.
  3. **문서 정합성** — 한 데이터에서 모든 서류(CI/PL/견적/주문)를 생성해 숫자가 구조적으로 일치한다.

### 도메인 관점 — 이 전체는 "하나의 SCM"이다 (SCOR 모델)
구매·생산·재고·무역은 별개 시스템이 아니라 하나의 공급망(SCM)의 부분들이다. 업계 표준 지도 SCOR로 정리:

| 기둥 | 의미 | 이 시스템의 모듈 |
|---|---|---|
| **Plan** | 수요예측·S&OP·MRP | 섹션 H |
| **Source** | 구매·소싱 | 섹션 C (Procure-to-Pay) |
| **Make** | 생산 | 섹션 H (생산오더) |
| **Deliver** | 수주→출고→무역·물류 | 섹션 B + E |
| **Return** | RMA·반품·클레임 | 섹션 G |

받침대 레이어: 마스터데이터(A) · 재무·원가(F) · 품질(QC/클레임) · 컴플라이언스(수출통제·FTA·HS) · 물류/창고(D·E) · 분석/KPI(I) · AI 코파일럿(J).
**수출입 무역은 별도 도메인이 아니라 Deliver(수출)와 Source(수입)를 국경 넘어 실행하는 레이어다.**

---

## 1. 설계 철학 — 절대 어기지 않는 5원칙

이 5개를 어기는 순간 "장난감"이 된다. SAP이 50년 산 이유가 이 원칙들이다.

### 원칙 1 — 재고와 거래는 "숫자"가 아니라 "원장(Ledger)"이다
`items.qty = 47` 같이 **수정 가능한 잔량 필드는 금지**. 누가 언제 왜 47로 만들었는지 모르는 순간 복구 불능이 된다.
```
stock_movements(id, 일시, type_code, item_id, location_id, qty±, ref_type, ref_id, ref_line, 사유, 작성자)
  → 이 테이블은 절대 UPDATE / DELETE 하지 않는다 (append-only)
현재고 = Σ(stock_movements.qty)  품목·위치별 합산
```
잘못 입력했으면 **수정이 아니라 역방향 이동 + 재입력**.

### 원칙 1-B — 돈은 "숫자"가 아니라 "(금액 + 통화)" 한 덩어리다
`amount = 1000` 만 저장하고 통화를 떼면 안 된다. EUR 1000과 USD 1000을 그냥 더하면 매출이 거짓말이 된다.
- 모든 금액 필드는 **항상 통화와 짝**으로 저장.
- **어떤 합계도 환율 테이블을 통해 기준통화(예: KRW 또는 USD)로 환산한 뒤에만 더한다.**
- 환율은 거래 확정 시점 값으로 고정 저장(원칙 5와 연결).

### 원칙 2 — 모든 전표는 헤더-라인(Header-Line) 구조
모든 거래 문서 = 헤더 1개 + 라인 N개.
- 헤더: 전표번호, 거래처, 일자, 상태, 통화, 환율
- 라인: 품목, 수량, 단가, 금액, 선행참조
- **합계는 항상 라인의 합으로 계산·검증.** 헤더에 총액을 따로 저장하면 안 맞는다.
- 이 구조 하나로 "한 주문에 품목 1개" / "한 주문에 품목 500개"가 **똑같이** 처리된다 ← FMCG 대량 오더 해결.

### 원칙 3 — 후속 전표는 "참조 생성(Reference Copy)"한다
주문 → 출고 → 청구를 각각 손으로 다시 입력하면 100% 어긋난다. 후속 전표는 선행 전표를 **복사 + 참조 링크**로 만든다.
```
출고 생성(주문번호 입력):
  주문 라인을 읽어 → 출고 라인으로 복사 (품목·수량·단가)
  → 사용자는 수량만 조정 (잔량 이내로만, 감소만 허용)
  → 선행참조 저장 (ref_type='SO', ref_id, ref_line)
```
**수기 재입력 화면을 만들지 않는 것**이 ERP 사고방식의 핵심.

### 원칙 4 — 이동/상태는 자유 텍스트가 아니라 "코드 테이블"
입출고 유형, 문서 상태를 자유 입력으로 받지 않는다. 코드 테이블로 정의(부호·의미·회계방향). 새 패턴이 생기면 `if`문 증식이 아니라 **코드 추가**로 확장.

### 원칙 5 — 전표는 불변(Immutable), 삭제 없음
- 확정/전기된 전표는 수정 불가. 바꾸려면 **취소 전표(역분개) 또는 정정 전표**를 새로 만든다.
- **삭제 기능은 만들지 않는다.** 모든 변경은 이력(audit log)에 남는다.
- "관리자는 다 고칠 수 있게" 요구 → 거부하고 정정 전표 + 이력으로 대체 설계. (만능 수정이 장부 신뢰를 죽인다.)

**이행 현황 — 이 원칙은 P4까지 절반만 구현돼 있었다.** "삭제 없음 + 상태로 종결"은 P1부터 지켰지만, **"확정 전표 수정 불가"는 아무 데도 강제되지 않았다**(2026-07-16 전수감사 확인). `status='confirmed'`인 수주·발주도 금액·라인을 그대로 고칠 수 있었고, 저장 시 `save_*`가 라인을 **전량 DELETE 후 재작성**한다. P1~P3에서는 전표가 전부 독립이라 드러나지 않았으나, **P4부터 후속 전표가 선행 전표의 잔량을 소비하기 시작하면 잔량 계산의 신뢰 기반이 무너진다**(입고가 참조하던 발주 라인이 조용히 사라지고 새 id로 다시 생김 → 소프트 포인터가 끊긴다).

- **P4 이행분 = "잔량 소비 가드"** — 후속 전표가 참조 중인 선행 전표는 **물리적으로 수정할 수 없게 한다**.
  - **DB 하드 가드(최종 방어선)**: 선행 라인 테이블에 `BEFORE DELETE` 트리거 → 살아있는(취소 아닌) 후속 라인이 참조 중이면 예외. `save_*`가 전량 DELETE 방식이므로, **잠긴 RPC를 수정하지 않고도** 참조된 전표의 수정 저장이 실패한다. 순수 추가.
  - **서비스 가드**: 수정·취소 진입 전에 살아있는 후속 전표 검사 → 한국어로 거부하며 "먼저 후속 전표를 취소하세요" 안내.
  - **UI**: 잠긴 전표는 수정 버튼 대신 잠금 표시 + 사유.
  - 적용: 발주↔입고 = **P4.2**, 수주↔출고 = **P4.3**(`delivery_lines` 생성 시 미러), 선적 라인 = P4.4.
- **'확정 해제(unlock)' 워크플로** — 승인권자가 잠금을 풀어 정정하는 절차는 결재선이 필요하므로 `[P7]`(I4 결재/승인 워크플로)에서 다룬다. 그전까지 정정 경로는 **후속 전표 취소 → 선행 전표 수정** 뿐이다.

### 원칙 6 — 전표번호는 원자적으로 발번한다
"마지막 번호 읽고 +1"은 두 사람이 동시에 만들면 같은 번호를 집는다(다중 사용자에서 필연적으로 충돌). **DB 시퀀스/원자적 카운터**로 발번한다. 채번 규칙(QT-YYYYMM-NNN 등)은 유지하되 카운터 자체는 DB가 보장.

### 원칙 7 — 로직과 화면을 분리한다 (서비스 레이어 = 코파일럿의 기반)
모든 업무 기능(주문생성·재고조회·출고·발번 등)은 화면에 박지 않고 **독립 함수(서비스 레이어)** 로 만든다.
- 화면(UI)도 이 함수를 호출, 나중에 AI 코파일럿(J)도 같은 함수를 호출.
- I/O(DB·네트워크)와 순수 로직을 분리 → 테스트 가능 + 저장소 교체 가능.
- **이걸 P0부터 안 깔면 코파일럿 붙일 때 전부 다시 뜯어야 한다** (가장 비싼 재작업).

### 원칙 8 — 마이너스 재고 정책: 경고 후 허용 + 일일 리포트
출고가 현재고를 초과할 때 → **차단이 아니라 경고 후 허용**(제조·무역은 입고 전기가 늦는 현실). 단 마이너스 재고 품목 일일 리포트를 반드시 붙인다(마이너스 = 어딘가 전기 누락 신호). *[영준 결정: 운영 우선]*

---

## 2. 기술 스택 결정 (ADR — Architecture Decision Record)

```
# ADR-001 — 시스템 기록소(System of Record)로 Supabase(PostgreSQL) 채택
- 상황: 관계형 무결성(외래키), 다중 사용자, 뷰/함수/트리거, 권한이 필요
- 대안: 직접 Postgres 구축(운영 부담 큼), Firebase(관계형 약함)
- 결정: Supabase 유지 — 이미 검증됨, 비개발자 운영에 최적
- 감수: 무료 한도(동시접속 50, 500MB) — 전사 확대 시 유료 전환

# ADR-002 — 프론트엔드를 단일 HTML → 컴포넌트 프레임워크로 전환
- 상황: 화면 수십~수백 개, 단일 HTML 파일로는 유지보수 불능
- 대안: 바닐라 JS 다중 파일(컴포넌트 재사용 약함)
- 결정: React 기반 (Next.js 권장) + Vercel 배포
- 감수: 비개발자에게 dev 서버 실행이 허들 → Claude Code가 실행/배포 대행,
        Vercel은 GitHub 푸시 시 자동 배포되므로 로컬 실행 의존도 낮음

# ADR-003 — "지루한 기술" 원칙
- 신기술은 프로젝트당 1~2개만. 나머지는 전부 검증된 표준 조합.
- 스택: Supabase + Next.js + Vercel (가장 보편적인 풀스택 조합) + TypeScript
```

**규모 설계 기준: 현재의 10배까지만.** 과잉 설계(사용자 10명에 대기업 인프라)는 미래 준비가 아니라 현재를 망치는 것.

---

## 3. 시스템 전체 구조 — 3개 도메인 + 2개 문서 사슬

```
┌─────────────────────────────────────────────────────────────────┐
│                      마스터 데이터 (Master)                        │
│   품목 · BOM · 거래처(고객/공급사) · 창고/위치 · 코드테이블          │
└─────────────────────────────────────────────────────────────────┘
            │                                      │
   ┌────────┴─────────┐                  ┌─────────┴──────────┐
   │  Order-to-Cash   │                  │  Procure-to-Pay    │
   │   (수주→대금)     │                  │   (구매→지급)        │
   │                  │                  │                    │
   │ 문의 → 견적 →    │                  │ 발주요청(PR) →     │
   │ 수주(SO) →       │                  │ 발주(PO) →         │
   │ 출고(Delivery) → │                  │ 입고(GR) →         │
   │ 청구(Invoice) →  │                  │ 송장검수(IR) →     │
   │ 대금회수         │                  │ 지급               │
   └────────┬─────────┘                  └─────────┬──────────┘
            │            ┌──────────────┐          │
            └───────────►│  재고 원장     │◄─────────┘
                         │ (Inventory)   │
                         └──────┬───────┘
                                │
   ┌────────────────────────────┴────────────────────────────────┐
   │                  무역 실행 레이어 (Trade)                       │
   │  선적부킹 · 통관 · 무역서류(CI/PL/BL) · L/C · 결제/외환 · RMA    │
   └──────────────────────────────────────────────────────────────┘
                                │
   ┌────────────────────────────┴────────────────────────────────┐
   │              계획 레이어 (Planning) · 분석 (Analytics)          │
   │  수요예측 · S&OP · MRP · 발주점 · ATP/할당 · KPI 대시보드        │
   └──────────────────────────────────────────────────────────────┘
```

**문서 흐름(Document Flow) 추적이 심장**: 어떤 전표에서든 사슬 전체를 조회.
예) `SO-2026-0012 → 출고 2건 → 청구 1건, 잔량 5 → 백오더 1건`

---

## 4. 모듈 전체 지도 (완전 열거 — "빠지는 파트 없이")

각 모듈 옆 `[Pn]` = 구현 단계(로드맵). 전부 한 번에 만들지 않는다.

### A. 마스터 데이터 (Foundation)
- A1. 품목 마스터 (HS코드, 단위, 표준단가, 원산지, 위험물여부, 시리얼/로트 관리여부) ✅ *구현(P1.3)* `[P1]`
- A2. BOM (자재명세서, 다단, 스크랩률, 유효일자=설계변경 컷인) `[P5]`
- A3. 거래처 마스터 (고객/공급사/both, 결제조건, 통화, Incoterms, 국가/도시/주소, 담당자) ✅ *구현(P1.2 — 물리 `companies` 재사용, 서비스 레이어가 도메인 `Partner`로 매핑)* `[P1]`
  - ⛔ **미구현(백로그)**: **사업자번호**(§7의 10자리 체크섬 검증 포함) · **신용한도(credit_limit)** — 컬럼도 입력 칸도 없다. 2026-07-16 전수감사에서 "✅ 완료"가 실물과 어긋난 유일한 지점으로 확인돼 서술을 정정했다. 여신 관리가 실제로 필요해지는 **AR/AP 단계 `[P8]`** 에서 `companies`에 컬럼 추가로 해소한다(사업자번호는 그 전에 필요하면 단독 추가 가능).
- A4. 거래처 연락처/주소 (역할: shipper/consignee/notify/bill-to/ship-to) `[P2]`
- A5. 창고·위치 마스터 (창고 → 구역 → 로케이션, 외주처도 '위치'로) `[P4]`
- A6. 코드 테이블 (이동유형, 문서상태, 단위, 통화, 국가/항구/공항) `[P1]`
- A7. 마스터 변경 관리 (ECN/설계변경, 중복 자재 방지, 필드 오너십) `[P7]`

### B. Order-to-Cash (수주→대금)
- B1. 문의 접수 (Inquiry) ✅ *구현(P1.4 — 이식 + 품목 소프트링크)* `[P1]`
- B2. 견적 (Quotation / Proforma Invoice) ✅ *구현(P1.5 — 헤더-라인·참조생성·원자적 발번·인쇄)* `[P1]`
- B3. 수주 (Sales Order, 헤더-라인, 견적 참조 생성) ✅ *구현(P2.2 — save_sales_order 원자 저장·견적 참조생성·감사 상속)* `[P2]`
- B4. 주문 확인서 (Order Confirmation) 발행 ✅ *구현(P2.2 — 전용 인쇄 페이지 → 브라우저 PDF)* `[P2]`
- B5. ATP(납기 가용성 점검) — 현재고 + 입고예정 − 기확약 `[P6]`
- B6. 재고 할당(Allocation) — 부족 시 배분 룰 `[P6]`
- B7. **백오더(Backorder) 관리** — 미충족 수량 추적·재공급 연결 `[P6]`
- B8. 출고/납품 (Delivery, SO 참조 생성, 부분출고, 재고 차감) ✅ *구현(P4.3 — 수주 참조생성·`DLV_OUT` 원장 전기·SO 잔량 뷰·부분출고·마이너스 경고 후 허용·상태 자동전환·취소=역분개·잔량 소비 가드·거래명세서 인쇄)* `[P4]`
- B9. 청구 (Commercial Invoice, Delivery 참조 생성) `[P4]`
- B10. 대금 회수/미수금(AR) 관리, 입금 대사 `[P8]`
- B11. 수주잔고(Backlog) 관리 `[P6]`

### C. Procure-to-Pay (구매→지급)
- C1. 발주 요청 (Purchase Requisition) `[P5]`
- C2. RFQ(견적요청) / 복수 벤더 견적 비교 `[P7]`
- C3. 발주 (Purchase Order, 헤더-라인) ✅ *구현(P3.1 — save_purchase_order 원자 저장·수주 참조생성(back-to-back)·환율 프리필·발주서 인쇄·감사 상속)* `[P3]`
- C4. 발주 확인(Order Confirmation) 접수 — 상태값(공급사확정)으로 반영, 별도 접수 화면은 후속 `[P3]`
- C5. 입고 (Goods Receipt, PO 참조 생성, 부분입고, 재고 가산) ✅ *구현(P4.2 — 발주 참조생성·`GR_IN` 원장 전기·잔량 뷰·부분입고·상태 자동전환·취소=역분개·잔량 소비 가드)* `[P4]`
- C6. 입고 검수(QC) / 검사성적서 `[P5]`
- C7. 송장 검수 (Invoice Receipt, 3-way match: PO↔GR↔Invoice) `[P8]`
- C8. 미지급금(AP) / 지급 관리 `[P8]`
- C9. 납기 추적(Expediting) — 납기경과 미입고 리스트 `[P3]`
- C10. 공급사 평가(Scorecard, QCD) `[P7]`

### D. 재고·창고 (Inventory & Warehouse)
- D1. 재고 원장 (stock_movements, append-only) ✅ *구현(P4.1 — 부호 원장·권한 봉인·역분개·lot/serial/location 칸 선제 생성)* `[P4]`
- D2. 이동유형 코드 (구매입고+, 판매출고−, 생산투입−, 생산입고+, 실사조정±, 위치이동) ✅ *구현(P4.1 — `MOVEMENT_TYPES` 6종: INIT·ADJ_IN·ADJ_OUT·GR_IN·DLV_OUT·REVERSAL. `sign`이 부호의 단일 진실 — 화면은 양수만 받고 +/−는 유형이 정한다)* `[P4]`
- D3. 현재고 조회 (품목·위치·로트·시리얼별) ✅ *부분구현(P4.1 — 뷰 `stock_on_hand`로 품목×창고×단위별. 위치·로트·시리얼별 조회는 P5에서 칸을 활성화하며 추가)* `[P4]`
- D4. 발주점(ROP) 자동 알림 (현재고+발주잔량 ≤ ROP) `[P6]`
- D5. 재고 실사 (스냅샷 비교, 승인 후 조정 이동) `[P7]`
- D6. 로트/시리얼 추적 (입고~출고 이력) `[P5]`
- D7. FIFO/FEFO, 유효기간 관리 `[P5]`
- D8. 사급재고(Consignment) 대사 — 외주처 제공/소비 `[P9]`
- D9. 안전재고/EOQ/ABC 분석 `[P9]`

### E. 무역 실행 (Trade Execution)
- E1. 선적 부킹 (포워더, 선사/항공사, 선명/편명, ETD/ETA, 컨테이너) ✅ *구현(P3.2 — shipments 부킹헤더·부킹번호/BL/컨테이너 분리·주문 M:N)* `[P3]`
- E2. Shipping Instruction (S/I) 작성·전달 — shipment_parties 도입 후(P4) `[P3]`
- E3. 선적 마일스톤 (서류마감/Cargo Closing/ETD/ETA/VGM) + **기일 역산 알림** ✅ *마일스톤(P3.2) + 기일 역산 알림(P3.3 — 앱내 임박기일 목록 D-7/3/1·KST 기준·홈 배지)* `[P3]`
- E4. 분할선적 차수 관리 (1 SO → N 선적) — 주문↔선적 연결(M:N)은 *P3.2 구현*, 수량 배분 추적은 P4 `[P4]`
- E5. 컨테이너 적입(CBM/적입계획), 쉬핑마크, VGM `[P5]`
- E6. 수출 통관 (수출신고, 신고수리, 적재의무기한=수리일+30일) `[P5]`
- E7. 무역서류 생성기 (CI / PL / B/L draft / C/O) — 한 데이터원에서 생성, 교차검증 `[P4]`
- E8. FTA 원산지 관리 (PSR 충족, C/O 발급, 인증수출자) `[P7]`
- E9. 수입 통관 (수입신고, 관세/부가세, 수입요건) `[P5]`
- E10. HS코드 분류 보조 (참고 메모 수준 — 자동 단정 금지) `[P7]`
- E11. 위험물(DG)/검역 대상 관리 `[P9]`
- E12. 수출통제 / 전략물자 스크리닝 (제재 리스트 대조, 캐치올, ECCN, 우려거래자) `[P7]`

### F. 결제·외환 (Trade Finance)
- F1. L/C 관리 (조건, tolerance ±%, 유효기일, 최종선적일, 제시기간) `[P6]`
- F2. L/C 하자(Discrepancy) 체크리스트 (UCP600) `[P6]`
- F3. 결제조건 구조화 (기산점 + 일수 → 만기 자동계산) `[P6]`
- F4. T/T·D/P·D/A·O/A 결제 추적, 송금(SWIFT) `[P8]`
- F5. 환율 기록 대장 (확정 시점 고정, 출처·고시시점 명시) ✅ *구현(P2.3 — fx_rates 추가전용 대장·1단위 정규화(JPY 100단위 함정 처리)·통화별 최신 뷰·견적/수주 프리필)* `[P2]`
- F6. 환리스크/환차손익, 수출보험(K-SURE) `[P9]`
- F7. 수입원가(Landed Cost) 계산 + 제품 원가(Costing) — 관세·운임·부대비용 포함 실원가 `[P8]`

### G. 반품·클레임 (Returns & Claims)
- G1. **수출 RMA** — 고객 반품 (원 출고/CI 참조), 재수입 통관(재수입면세) `[P6]`
- G2. **수입 RMA** — 공급사 반품 (원 PO/GR 참조), 재수출 `[P6]`
- G3. 하자 처리 디스포지션 (수리/교체/대금공제/폐기) `[P6]`
- G4. 클레임 관리 (품질불량/수량부족/파손/오선적), 적하보험 구상 `[P9]`
- G5. 교체품 재출고 / 대체 선적 `[P6]`

### H. 계획 (Planning)
- H1. 수요예측 (이동평균/지수평활/계절성, MAPE·Bias) `[P9]`
- H2. S&OP (수요-공급-재무 정렬, 월간 사이클) `[P9]`
- H3. MRP (소요량 전개, BOM 기반, 스크랩 가산, pegging) `[P9]`
- H4. MPS(주생산계획), 능력계획(CRP) `[P9]`
- H5. 생산오더 (Planned→Production Order, 투입/확인/입고, 백플러시) `[P9]`

### I. 분석·관리 (Analytics & Cross-cutting)
- I1. 대시보드 (수출실적, 국가별/품목별/거래처별 매출) — 홈에 임박 기일 요약 배지 착수(P3.3) `[P2~]`
- I2. SCM KPI (납기준수율 OTIF, 재고회전율, DSO, 수주잔고) `[P8]`
- I3. 문서 흐름 추적 화면 (전표 사슬 전체 조회) `[P4]`
- I4. 결재/승인 워크플로 (기안→검토→승인→반려, 대결/전결) `[P7]`
- I5. 감사 추적(Audit Log) — 모든 변경 이력 ✅ *구현(P2.1 — 범용 DB 트리거 `fn_audit`, 읽기전용 `/audit`)* `[P2]` (처음부터)
  - 부착 대상 = **전표 헤더 4개**(quotations·sales_orders·purchase_orders·shipments) + **마스터 2개**(companies·products — P4.0-b에서 추가). 마스터는 RPC가 아니라 앱이 직접 UPDATE 하는데도 감사 밖이라 표준단가 변경 이력이 남지 않던 것을 해소했다.
  - **미부착(의도적)**: 라인 테이블(quotation_items·so_lines·po_lines·shipment_orders·milestones) — 저장 시 전량 DELETE+재INSERT라 감사행 폭주·시각적 '삭제' 모순. `fx_rates` — 대장 자체가 추가전용 불변이라 중복. `inquiries` — 후속 단계에서 트리거 2줄로 부착 가능.
  - 한계: `actor`는 인증 도입 전까지 항상 `system`(트리거는 `app.actor` 세션 변수를 읽게 돼 있으나 설정 주체가 없음) → RBAC `[P8]`에서 해소.
- I6. 사용자/권한 (역할 기반 RBAC, 부서별 접근) `[P8]`
- I7. 알림 엔진 (기일 D-7/D-3/D-1, 발주점, 미수금) — ✅ *기일 임박 목록 부분구현(P3.3 — 앱내 D-7/3/1·KST); 이메일·푸시·발주점·미수금은 후속* `[P6]`

### J. AI 코파일럿 (ERP 내장 Claude — 차별화 핵심)
- J1. 코파일럿 채팅 패널 (ERP 전 화면에서 호출, 자연어 대화) `[P10]`
- J2. 도구(Function) 레이어 — 모든 ERP 기능을 Claude가 호출 가능한 함수로 등록 `[P0부터 설계, P10 연결]`
  - 조회 도구(주문/재고/견적/선적 조회 등): **자동 실행 허용**
  - 변경 도구(전표 생성/수정, 출고, 발주 등): **사용자 확인 후에만 실행** (원칙 5 — 불변·감사)
- J3. 자연어 → 작업 자동화 (예: "베트남 7일+ 백오더 정리", "이 견적으로 PI 초안 만들어줘") `[P10]`
- J4. 백엔드 라우트에서 Anthropic API(tool use) 호출 — API 키는 서버에만 보관(클라이언트 노출 금지) `[P10]`
- **설계 원칙**: 처음부터 모든 기능을 "함수로" 만들면(원칙대로) 코파일럿은 그 함수를 호출만 하면 된다 → 지금부터 "코파일럿 준비된" 구조로 짓는다.
- **비용 주의**: Anthropic API는 Claude Pro 구독과 별개 과금(토큰당). 운영비로 계상.

---

## 5. 핵심 데이터 모델 (도메인별)

> 실제 컬럼은 구현 시 확정. 여기는 뼈대(스파인)와 관계(FK)를 정의한다.

### 마스터
```sql
partners(id, type[customer/supplier/both], name, biz_reg_no, country,
         payment_terms, currency, incoterms, credit_limit, active)
partner_contacts(id, partner_id, role[shipper/consignee/notify/bill_to/ship_to],
                 name, address, email, phone)
items(id, code, name, hs_code, base_uom, std_price, currency, origin_country,
      is_dangerous, lot_managed, serial_managed, active)
bom(id, parent_item_id, child_item_id, qty, scrap_rate, valid_from, valid_to)
warehouses(id, code, name) ; locations(id, warehouse_id, code, type[normal/subcon])
code_tables(category, code, label, sign, meaning)   -- 이동유형·상태 등
```

### O2C (수주→대금)
```sql
sales_orders(id, so_number, partner_id, order_date, currency, exchange_rate,
             incoterms, payment_terms, status, ref_quotation_id)
so_lines(id, so_id, line_no, item_id, qty, uom, unit_price, amount,
         ref_quotation_line_id)
   -- ※ shipped_qty/backorder_qty는 컬럼으로 저장하지 않는다 (원칙 1 위반)
   --   출고수량 = Σ(delivery_lines.qty where so_line_id=this), 잔량 = qty − 출고수량 (계산)
deliveries(id, dlv_number, so_id, delivery_date, status)
delivery_lines(id, delivery_id, line_no, so_line_id, item_id, qty, uom)
sales_invoices(id, inv_number, delivery_id, invoice_date, subtotal, tax, total, status)
backorders(id, so_line_id, qty, reason, status, expected_supply_date)
   -- backorder는 "미충족이 확정되어 추적이 필요한 건"만 명시적으로 생성 (파생 잔량과 구분)
```
- **잔량 = so_lines.qty − Σ(delivery_lines.qty)** ← ERP의 심장
- 잔량 0 → SO 헤더 상태 자동 '출고완료'. 후속 전부 취소 시 되돌림.
- 초과 출고(주문보다 많이) 시도 → 거부.

### P2P (구매→지급)
```sql
purchase_orders(id, po_number, partner_id, order_date, currency, exchange_rate, status)
po_lines(id, po_id, line_no, item_id, qty, uom, unit_price, amount)
   -- received_qty도 저장 안 함. 입고수량 = Σ(gr_lines.qty), 잔량 = qty − 입고수량 (계산)
goods_receipts(id, gr_number, po_id, receipt_date, status)
gr_lines(id, gr_id, line_no, po_line_id, item_id, qty, lot_no, serial_no)
purchase_invoices(id, inv_number, po_id, gr_id, invoice_date, subtotal, tax, total, status)
```
- 3-way match: PO 단가 ↔ GR 수량 ↔ Invoice 금액 차이 검출.

### 재고 (원장)
```sql
stock_movements(id, moved_at, type_code, item_id, location_id, qty,   -- qty는 ±, append-only
                lot_no, serial_no, ref_type, ref_id, ref_line, reason, created_by)
item_params(item_id, avg_daily_demand[자동계산], lead_time_days,
            safety_stock, rop, moq, order_multiple)
stocktake_sessions(id, snapshot_at, status) ; stocktake_lines(...)  -- 실사 스냅샷
```

### 무역
```sql
shipments(id, ship_number, direction[export/import], partner_id,
          incoterms, payment_terms, currency, exchange_rate, fx_date, status)
   -- ※ so_id/po_id를 직접 박지 않는다. 주문↔선적은 M:N (분할선적 + 합짐 둘 다 대응)
shipment_orders(id, shipment_id, order_type[SO/PO], order_id)   -- 연결 테이블 (M:N)
shipment_lines(id, shipment_id, line_no, ref_order_line_id, item_id, hs_code,
               qty, unit_price, amount, origin)
shipment_parties(shipment_id, role, name, address)
milestones(id, shipment_id, type, planned_date, actual_date, tz, memo)  -- 기일 엔진 원천
trade_documents(id, shipment_id, doc_type[CI/PL/BL/CO/LC], doc_number, doc_date, file, status)
lc_terms(shipment_id, lc_number, issuing_bank, amount, tolerance,
         expiry_date, latest_shipment_date, presentation_days, partial_allowed, transship_allowed)
```
- **M:N 이유**: 프로젝트형은 1 주문 → N 분할선적, FMCG형은 N 주문 → 1 컨테이너(합짐). 둘 다 `shipment_orders`로 자연 처리.

### RMA
```sql
rma(id, rma_number, type[export_return/import_return], ref_doc_type, ref_doc_id,
    partner_id, reason, disposition[repair/replace/credit/scrap], status,
    is_reimport, customs_ref)   -- 재수입/재수출 통관 연결
rma_lines(id, rma_id, line_no, item_id, qty, lot_no, serial_no, defect_desc)
```

### 공통
```sql
doc_status_log(id, doc_type, doc_id, from_status, to_status, changed_by, changed_at)
audit_log(id, table_name, record_id, action, before_json, after_json, user, at)
approvals(id, doc_type, doc_id, step, approver, status, acted_at)
```

---

## 6. 영준 요구사항 → 아키텍처 매핑 (어떻게 다 담기는가)

| 요구사항 | 어떻게 해결되는가 |
|---|---|
| **프로젝트형 대형 B2B** (시스템 단위 납품) | SO 1건에 라인 소수, 분할선적·부분출고·마일스톤 관리. 긴 리드타임 → 기일 엔진이 핵심. |
| **FMCG형 다품목 대량** (수백 라인) | 헤더-라인 구조라 라인 1개든 500개든 동일 처리. CSV 일괄 업로드 라인 입력 + 잔량 관리. |
| **백오더 관리** | `so_lines.backorder_qty` + `backorders` 테이블. ATP 부족분이 자동으로 백오더로 전환, 재공급 시 연결. |
| **RMA (수출입 양방향)** | `rma` 테이블 type으로 양방향. 원 전표(CI/GR) 참조 생성. 재수입/재수출 통관(면세) 연결. 디스포지션(수리/교체/공제/폐기). |
| **글로벌 메이저 수준 깊이** | 위 모듈 지도 A~I 전체가 그 범위. 단, P1부터 단계적으로. |
| **누락 없는 실무 디테일** | 문서 사슬·잔량·기일·정합성 검증을 모든 전표에 일관 적용 = 디테일이 구조에서 나온다. |

---

## 7. 한국 비즈니스 특수사항 (반드시 반영)

- 사업자등록번호 검증 (10자리 체크섬)
- 부가가치세 분리 (공급가/세액/합계), 영세율(수출) 처리
- 원화/외화 병행, 환율 확정 시점 고정 저장
- 한글 CSV/엑셀 출력 시 인코딩(BOM) — 한글 깨짐 방지
- 금액은 정수(소수점 오차 방지), 통화별 소수 자리수 규칙
- 결재선(전자결재) 문화 — 기안→승인→반려, 대결/전결

---

## 8. 단계별 로드맵 (워킹 스켈레톤 → 살 붙이기)

**가장 얇은 끝-끝 한 줄을 먼저.** 연결 문제(인증·배포·권한)는 항상 예상보다 어렵고 마지막에 발견하면 재앙.

- **P0 — 골격**: Next.js + Supabase + Vercel 배포 파이프라인. "거래처 목록 1화면"이 실제 URL에서 뜨는 것까지. (이미 있는 1단계 HTML 자산을 React로 이식)
  - ✅ **완료 (2026-06-29)** — https://scm-trade-erp.vercel.app/partners 라이브. 스택: Next.js 16 + React 19 + TypeScript + Tailwind v4 + Supabase + Vercel(GitHub 자동배포).
  - 구조: 화면(`app/partners`) → 서비스(`services/partners.listPartners`) → I/O(`lib/supabase/server`) → Supabase 3겹으로 **원칙 7** 적용. 화면은 물리 테이블을 모름.
  - 데이터: 기존 `companies` 테이블 **유지**(읽기 전용), 서비스 레이어에서 도메인 `Partner`로 매핑(buyer→customer, supplier→supplier). 실제 `partners` 테이블 이전은 **P1/P2**로 미룸.
- **P1 — 마스터 + 영업 초입**: 품목·거래처·코드테이블 / 문의·견적 (기존 기능 이식 + 정리)
  - ✅ **거래처(P1.2)·품목(P1.3) 마스터 완료** (2026-06-30) — 목록 + 등록/수정, **삭제 없음 → active 토글**(원칙 5). 기존 `companies`/`products` 테이블 **재사용** + 서비스 레이어에서 도메인(`Partner`/`Item`)으로 매핑(원칙 7). 화면은 물리 테이블을 모름.
  - 품목 마스터는 P1.3에서 `products`에 컬럼 추가(품목코드·원산지·위험물·로트/시리얼 관리여부·active)로 A1 전체 필드 충족. (마이그레이션: `db/migrations/p1.3_items.sql`)
  - ✅ **문의(P1.4) 완료** (2026-06-30) — `inquiries` 이식. 거래처는 `company_id` **정식 참조**(PostgREST 임베드 조인으로 거래처명 표시), 품목은 `product_id` **소프트 링크**(품목 마스터에서 고르면 연결, 미등록은 자유텍스트 + 링크 해제 가능). 삭제 대신 상태(`lost`)로 종결(원칙 5). 코드값 정리(INQUIRY_STATUS 실제값 확정·TRANSPORT both·PAYMENT_TERMS 신설). (마이그레이션: `db/migrations/p1.4_inquiries.sql`)
  - ✅ **견적(P1.5) 완료** (2026-06-30) — `quotations`+`quotation_items` **헤더-라인**(원칙 2, 첫 등장). 문의→견적 **참조 생성**(원칙 3, `/quotations/new?from=`), **원자적 발번**(원칙 6 — P1.1 `next_doc_number(doc_type='quotation',...)` 호출, `db/migrations/p1.1_doc_numbering.sql`에 소급 기록), 합계는 항상 **라인에서 재계산**, 동적 라인 에디터 + 품목 검색, **인쇄용 Proforma Invoice**(전용 페이지 → 브라우저 PDF). 삭제 없음(상태로 종결, 원칙 5). 자사정보 플레이스홀더: `src/config/company.ts`. **저장은 단일 트랜잭션 RPC `save_quotation`로 원자 처리**(번호+헤더+라인 → 실패 시 전부 롤백, 데이터 손실·유령전표·결번 차단 — `db/migrations/p1.5_save_quotation.sql`; P2 SO/PO 저장의 토대). 다중에이전트 정합성 리뷰로 합계 반올림·음수합계·원자성 결함 교정.
  - ✅ **P1 완료** (2026-06-30) — 마스터(거래처·품목) + 영업 초입(문의·견적) 이식·정리 끝. 코드값은 `services/codes.ts` 상수로 일원화(편집형 `code_tables`는 후순위). **다음: P2(수주 SO·환율 대장·감사로그).**
- **P2 — 수주 + 환율 + 감사로그**: SO(참조생성), 주문확인서, 환율 대장, audit_log 기반 깔기
  - ✅ **P2.1 감사 추적 기반 완료** (2026-07-13) — 다중에이전트 설계로 P2를 ①감사기반 → ②수주(SO) → ③환율대장 순서 확정. 감사를 먼저 깐 이유: 가장 작고 순수추가·완전가역이라 오너 마이그레이션 절차를 안전하게 리허설하고, SO가 생기기 전에 I5 "처음부터"·원칙 5 공백 제거, **제네릭 트리거라 P2.2에서 SO는 트리거 2줄로 태생부터 감사**됨. 구현: 추가-전용 `audit_log` + 범용 트리거 `fn_audit`(SECURITY DEFINER, `to_jsonb(old/new)` 전후 스냅샷)를 `quotations` 헤더에 부착 — **라인테이블(quotation_items)은 미부착**(save_quotation의 라인 전량 DELETE+재INSERT로 인한 감사 폭주·시각적 '삭제' 모순 방지). 앱은 SELECT만(위조·삭제 불가, 원칙 5), 기록은 DB 트리거 전용. 읽기전용 `/audit` 화면(before→after 변경키 요약) + 사이드바 '관리' 그룹. (마이그레이션: `db/migrations/p2.1_audit_log.sql`, 오너 실행 완료) **다음: P2.2 수주(SO)+주문확인서 → P2.3 환율 대장.**
  - ✅ **P2.2 수주(SO)+주문확인서 완료** (2026-07-13) — 견적 모듈 미러: `sales_orders`/`so_lines` 신규 헤더-라인, `save_sales_order` RPC(save_quotation 미러·원자적, 3-arg `next_doc_number('sales_order','SO',period)` 별도 카운터), `salesOrders.ts` 서비스, 등록/수정 폼·목록·상세·**주문확인서(Order Confirmation) 인쇄**. **견적→수주 참조 생성**(원칙 3, `/sales-orders/new?from=`, 라인별 `ref_quotation_line_id` 스냅샷 포인터=FK아님). `partner_id`(SPEC 표준)→companies FK 임베드. 잔량/출고수량 컬럼 없음(원칙 1). exchange_rate 확정시점 스냅샷(원칙 1-B); `fx_source`/`fx_quoted_at`는 P2.3용 미리 심음. **P2.1 범용 감사 트리거를 2줄로 상속**(수주도 태생부터 감사). 다중에이전트 정합성 리뷰로 참조생성 시 환율 스냅샷 손실 버그 1건 교정. (마이그레이션: `db/migrations/p2.2_sales_orders.sql` + PostgREST 스키마 캐시 `notify pgrst`, 오너 실행 완료) **다음: P2.3 환율 대장(fx_rates) → P2 완료.**
  - ✅ **P2.3 환율 대장(fx_rates) 완료 = P2 전체 완료** (2026-07-14, 라이브 검증됨) — `fx_rates` **추가-전용 대장**(SELECT+INSERT만, UPDATE/DELETE 미부여로 불변 강제; 정정=새 행). 기준통화 `BASE_CURRENCY='KRW'`(원칙 1-B). **rate는 항상 1단위 정규화 저장**, `quote_unit`(JPY=100)로 **100단위 고시 함정** 처리(은행 화면값 그대로 입력→서비스 `normalizeRate` 한 곳에서 ÷단위→9.05; 프리필·문서·합계는 1단위만 써 100배 오류 원천 차단). **통화별 최신 뷰 `fx_rates_latest`**(DISTINCT ON, rate_date desc·created_at desc=정정이 이김)로 전역 limit 윈도우·정렬 함정 제거. 견적·수주 폼 **공용 프리필 훅 `useFxPrefill`**: 통화 선택 시 대장 최신 자동채움·수동수정 가능·**문서는 대장을 FK로 물지 않고 값만 스냅샷**(대장이 바뀌어도 과거 문서 환율 불변, 원칙 1-B). 수주는 `fx_source`/`fx_quoted_at`까지 저장(save_sales_order가 P2.2부터 지원), **견적은 rate만**(save_quotation 잠금·미개정). 다중에이전트 정합성 리뷰(돈·불변성·프리필 적대검증)로 실결함 3건 교정(통화변경 시 이전통화 환율/출처 승계·최신조회 윈도우·고시시점 타임존). (마이그레이션: `db/migrations/p2.3_fx_rates.sql` + `notify pgrst`, 오너 실행·검증 완료) **P2 완료 → 다음: P3(구매 PO·선적부킹·기일 역산 알림).**
- **P3 — 구매 + 선적부킹 + 기일엔진**: PO, 선적부킹/마일스톤, 기일 역산 알림
  - ✅ **P3.1 발주(PO) 완료** (2026-07-14, 라이브 검증됨) — 수주(P2.2) 모듈 미러: `purchase_orders`/`po_lines` 신규 헤더-라인, `save_purchase_order` RPC(save_sales_order 미러·원자, 공유 `next_doc_number('purchase_order','PO',period)` 별도 카운터), `purchaseOrders.ts` 서비스, 등록/수정 폼·목록·상세·**발주서(Purchase Order) 인쇄**(From Buyer=자사/To Supplier). **2경로 생성**: ① 단독 ② **수주 참조생성(back-to-back)**(원칙 3, `/purchase-orders/new?from=`, 헤더 `ref_sales_order_id` + 라인별 `ref_so_line_id` 스냅샷 포인터=FK아님, 라인 단위라 한 수주→여러 공급사 분할발주 가능). 승계 규칙: 거래처 비움(공급사=`company_type` supplier/both/미분류, 순수 고객 제외)·환율 미승계(발주 시점 대장 프리필, P2.3 `useFxPrefill` 재사용·`fx_source`/`fx_quoted_at` 스냅샷)·매입단가 0 초기화·인코텀즈/결제조건 비움(매입≠매출)·통화/운송/목적지 승계. 입고/잔량 컬럼 없음(원칙 1, GR는 P4). P2.1 감사 트리거 상속. 다중에이전트 정합성 리뷰(돈·원자성·참조생성·불변성) 통과(확인 버그 0). (마이그레이션: `db/migrations/p3.1_purchase_orders.sql` + `notify pgrst`, 오너 실행·검증 완료) **다음: P3.2 선적부킹·마일스톤 → P3.3 기일 역산 알림.**
  - ✅ **P3.2 선적 부킹·마일스톤 완료** (2026-07-14, 라이브 검증됨) — `shipments`/`shipment_orders`(M:N)/`milestones` 신규 + `save_shipment` RPC(save_sales_order 미러·원자: 번호+헤더+주문연결+마일스톤). **범위=부킹+일정만**(shipment_lines·parties·금액·무역서류·S/I·인쇄는 P4; **분할선적은 주문↔선적 연결 수준이고 수량 배분 추적은 P4**). direction(export/import)은 **라벨·필터·기본값일 뿐 주문 연결을 제한하지 않음** → 한 선적에 SO+PO 혼합(3자무역·직송), `partner_id` nullable. `shipment_orders`는 `order_id` 소프트포인터(SO/PO) + `unique(shipment_id,order_type,order_id)` **중복차단 3중**(폼 picker 제외 + 액션 dedup + RPC payload검사/unique) — 단, 같은 주문이 서로 다른 선적에 걸리는 **분할선적은 허용**. `booking_no`/`bl_no`/`container_no` 별도. 마일스톤=기일엔진(P3.3) 원천(유형 코드테이블 + **transport별 기본 템플릿 버튼**). 수주·발주에서 참조 부킹(`?fromSo=`/`?fromPo=`). P2.1 감사 상속. 다중에이전트 리뷰로 transport null 왕복 버그 1건 교정(P3.2f). (마이그레이션: `db/migrations/p3.2_shipments.sql` — 레거시 빈 shipments 자동 이전 포함 + `notify pgrst`, 오너 실행·검증 완료) **다음: P3.3 기일 역산 알림.**
  - ✅ **P3.3 기일 역산 알림 완료 = P3 전체 완료** (2026-07-14, 라이브 검증됨) — **스키마 없는 읽기전용 파생 뷰**(기존 날짜 컬럼 계산). `deadlines.ts`: 4소스 통합(선적 마일스톤[실적없음+선적 status≠cancelled, shipped 유지]·수주/발주 납기[status∉완료/취소]·견적 유효기일[status∈작성중/발송]) → **D-day**. **'오늘'은 반드시 한국(Asia/Seoul) 달력 날짜**(`todayKst`=toLocaleDateString en-CA + `daysBetween`=UTC자정 파싱 차 → 서버 UTC 무관·off-by-one 없음). `/deadlines` 목록(D-day 강조 지남>D-1>D-3>D-7, 기일 오름차순=지남 최상단, 필터 기본[지남+30일]/지남만/전체, 문서 링크) + **홈(`/`) 대시보드 요약 배지**(지남 N·7일 내 M, 숫자만) + 사이드바 '관리>임박 기일'. L/C 유효기일·최종선적일(P6)·대금 만기(P8)는 소스 생기는 단계에서 추가. 다중에이전트 리뷰(시간대·날짜경계·소스통합) 확인버그 0. 직접 검증(RPC+Playwright): 과거→'4일 지남'·미래→'D-11'·선적 취소 시 제외·홈 배지 렌더 모두 통과. **P3 완료 → 다음: P4(재고 원장 + 출고/입고 + 무역서류 생성 + 문서흐름 — 진짜 ERP 1차 완성).**
- **P4 — 재고 원장 + 출고/입고 + 서류생성 + 문서흐름**: 재고 코어, Delivery/GR(참조생성), CI/PL 생성기, 흐름 추적 화면 ← **여기까지가 진짜 ERP의 1차 완성**
  - ⚠️ 재고 원장 테이블은 **이 단계부터 로트/시리얼/위치 칸을 포함**해 만든다. (P5에서 컬럼을 추가하면 P4에 쌓인 과거 기록은 영원히 비어 소급 불가) → **P4.1에서 이행 완료.**
  - ✅ **P4.0 정지작업 완료** (2026-07-16) — P3 완료 후 전수감사(모듈 8개 실물대조 + 적대검증)로 확인된 실결함 4건 교정. ① **발번·날짜 전면 KST화**: 선적 발번이 UTC라 한국 8/1 08:00 부킹이 `SHP-202607`로 한 달 밀렸다(번호는 발번 후 불변=사후정정 불가). grep 전수 결과 선적뿐 아니라 견적·수주·발주의 날짜 미입력 폴백과 폼 기본날짜 9곳도 UTC였다 → `lib/date.ts`(`todayKst`/`periodKst`/`periodOfYmd`/`daysBetween`, `now` 주입으로 테스트 가능)로 추출·일원화. ② **마스터 감사 부착**(`companies`·`products` — I5 참조). ③ **`000_baseline.sql`**: DB에만 있던 5개 테이블(`companies`·`products`·`inquiries`·`quotations`·`quotation_items`)을 라이브 `pg_catalog`에서 소급 기록 — 이전엔 빈 DB에 마이그레이션을 순서대로 돌리면 p1.3에서 즉사했다(재구축 불가). 제약은 `create table` 안에 **인라인**으로 넣어야 멱등해진다. ④ SPEC A3 허위완료 정정.
  - ✅ **테스트 하네스 도입**(Vitest) — §8이 "각 단계마다 정합성 테스트를 코드 전에 작성"을 못박았으나 P0~P3는 0건이었다. 범위는 **I/O 없는 순수 로직**(DB 하네스는 P4.3 전 재평가). DB 정합성은 `scripts/checks.sql` 검산 세트가 담당(오너가 Run).
  - ✅ **P4.1 재고 원장 기반 완료 = D1·D2·D3** (2026-07-16, 라이브 검증됨) — **현재고라는 숫자를 어디에도 저장하지 않는다**(원칙 1). `stock_movements` 추가전용 원장에 부호 있는 행만 쌓고 현재고 = `SUM(qty)`(뷰 `stock_on_hand`, 품목×창고×**단위**별). 정정은 UPDATE가 아니라 **역분개**(반대부호 행) — 기존 `save_*`의 "라인 전량 DELETE 후 재작성" 패턴은 원장에 **절대 금지**. 쓰기 경로는 SECURITY DEFINER RPC 2종(`save_stock_adjustment`·`reverse_stock_movement`)뿐이고 **앱에는 INSERT 권한조차 없다**. 이중 역분개는 RPC 검사 + `reversal_of_id` UNIQUE 부분 인덱스로 2중 차단(레이스 포함). 유형 6종을 선제 정의(P4.2 `GR_IN`·P4.3 `DLV_OUT` 포함 — 나중에 CHECK를 고치면 그 사이 행이 흔들린다). 마이너스는 **차단이 아니라 경고 후 허용**(원칙 8) — 저장 전 예상재고 표시 + 확인창 + 홈 배지. 화면: `/stock`(현재고·조정)·`/stock/movements`(원장·역분개). 테스트 42개. 다중에이전트 적대검증(4관점→지적별 반박) 9건 중 5건 기각·**실결함 3건 교정**(NaN이 `p_qty<=0`을 통과해 현재고가 영구 NaN·역분개로도 복구불가 / 뷰가 원장 단위 스냅샷 대신 현재 마스터 단위를 써서 `100 PCS + (−10 KG) = 90 KG` 거짓합산 / 무제한 조회 1000행 절단으로 마이너스 경고 사망). (마이그레이션: `p4.1_stock_ledger.sql` + `p4.1f_review_fixes.sql`, 오너 실행·검증 완료)
  - 🔑 **Supabase 기본권한 함정 (전 단계 소급 적용)** — Supabase는 `public` 스키마에 `alter default privileges … grant all on tables to anon, authenticated`를 걸어둔다. **새 테이블은 만들자마자 `anon`이 전권을 갖는다** → "부여하지 않음"으로는 아무것도 못 막고 **명시적 `REVOKE`만 유효**하다. 확증: P2.1은 `grant select on audit_log`만 했는데 라이브에서 `insert_가능=true`였다. 따라서 **P2.3 `fx_rates`의 "UPDATE/DELETE 미부여로 불변 강제" 주장은 실제로 깨져 있었고**, P4.1에서 `fx_rates`·`audit_log`와 함께 봉인했다. → 앞으로 불변을 주장하는 객체는 반드시 `revoke`.
  - 🔑 **봉인 검증법** — `update … set`을 직접 쳐보는 방식으로는 검증할 수 없다. Supabase SQL Editor는 **테이블 소유자 `postgres`로 실행**되어 권한 검사를 통째로 우회하므로 봉인이 완벽해도 성공한다. `has_table_privilege('anon', …)`로 실효 권한을 직접 물어야 한다(역할 상속·PUBLIC 부여까지 계산). → `scripts/verify_seal.sql`.
  - ✅ **P4.2 입고(GR) 완료 = C5** (2026-07-16, 라이브 검증됨) — **발주 참조 생성 전용**(원칙 3 — 발주 없는 단독 입고 경로를 만들지 않았다. 재고 증가는 반드시 선행 전표를 갖는다). `goods_receipts`/`gr_lines` + `save_goods_receipt`(원자: 헤더+라인+`GR_IN` 원장 전기가 **한 트랜잭션** → 입고만 남거나 원장만 남는 상태가 없다) + `cancel_goods_receipt`(삭제가 아니라 status + **원장 역분개**). **부분입고 = 같은 발주에 GR 여러 건**(라인 분할이 아니다). 잔량 뷰 `po_open_qty`/`po_open_summary` — **잔량은 컬럼이 아니라 계산**(`received_qty`를 `po_lines`에 저장하지 않는다, 원칙 1). 초과입고는 **차단이 아니라 경고 후 허용**(원칙 8과 같은 결 — 공급사가 더 보내는 실무가 있고 막으면 입고 자체를 못 친다). 자유텍스트 품목(`po_lines.product_id` null)은 입고 거부(원장은 등록 품목만 받는다). 봉인: 앱엔 `select`만, 쓰기는 RPC로만. **`audit_log` insert 회수**(P2.1의 "위조 불가" 주장이 Supabase 기본권한 때문에 실제로 깨져 있던 것을 닫음).
    - **발주 상태 자동전환** — 잔량 0=`completed` / 일부=`partial`(**기계 전용 상태**, 폼 선택지에 노출 안 함) / 입고 0=복귀. `purchase_orders.status`에 CHECK가 없어 `partial` 신설이 잠긴 테이블을 안 건드린다. 전이는 **RPC 내부에서만**, 매번 살아있는 GR로 재계산(누적 델타 금지).
    - **세대(generation) 도장** — 복귀할 "원상태"를 저장할 곳이 없었다(`purchase_orders`는 잠긴 테이블이라 컬럼 추가 불가). → 살아있는 GR이 0건일 때 생성되는 GR만 `goods_receipts.po_status_before`에 발주 상태를 기록하고, 복귀 시 **"도장이 있는 GR 중 가장 최근"** 것을 쓴다. ⚠️ "가장 이른 GR"은 다세대에서 틀린다 — GR#1(confirmed)·#2 → 전량취소 → 발주를 sent로 수정 → GR#3 → #3 취소 시 정답은 sent인데 confirmed로 잘못 복귀한다.
    - 다중에이전트 적대검증(5관점→지적별 반박) 12건 중 6건 기각·**실결함 4건 교정**(p4.2f): 🔴 **교착** — 입고가 만든 `GR_IN`에 원장 화면의 [역분개] 버튼이 그대로 떠서, 누르면 입고는 살아있는 채 재고만 빠지고 그 뒤 [입고 취소]가 "이미 역분개된 행"으로 롤백 → **입고 영구 취소 불가 + 발주 영구 잠김**(앱 내 복구 경로 0). → **전표가 만든 원장 행은 원장에서 직접 되돌릴 수 없게** 하고(불리언 플래그는 안 씀 — anon이 그냥 true로 넘기면 우회된다), 취소를 **멱등**하게 만들어 이미 갇힌 데이터도 스스로 풀리게 했다. / 클라이언트 `itemId`를 신뢰해 **볼트를 발주하고 너트를 입고**해도 통과하던 것(→ 품목을 발주 라인에서 가져온다) / `poLineId` 없는 유령 입고 / 세대 도장 stale 스냅샷(→ 발주 행 `for update`).
    - 라이브 검증(Playwright 자동화): 잔량 10→입고 4→잔량 6·`부분입고`→잠금(수정 폼 사라짐)→입고 6→`완료`→초과입고 99 확인창 후 허용→원장에 [역분개] 버튼 없음·"입고에서 취소" 링크→3건 취소→**재고 209→100 정확히 원복 + 발주 `작성중` 세대 도장 복귀 + 잠금 해제**. 테스트 70개.
  - ✅ **P4.3 출고(Delivery) 완료 = B8** (2026-07-16, 라이브 검증됨) — **수주 참조 생성 전용**(원칙 3 — 수주 없는 단독 출고 경로를 만들지 않았다. 재고 감소는 반드시 선행 전표를 갖는다). P4.2 입고(GR)의 **정확한 미러 + 차이 3개**: ① 부호가 음수(`DLV_OUT`) → **마이너스 재고 경고 후 허용**(원칙 8, 차단 아님 — 제조·무역은 입고 전기가 늦어 막으면 출고 자체를 못 친다) ② 잔량 소비 가드 대상이 `so_lines` ③ 거래명세서 인쇄. `deliveries`/`delivery_lines` + `save_delivery`(원자: 헤더+라인+`DLV_OUT` 전기가 **한 트랜잭션**) + `cancel_delivery`(삭제가 아니라 status + **원장 역분개**). **부분출고 = 같은 수주에 출고 여러 건**. 잔량 뷰 `so_open_qty`/`so_open_summary` — **잔량은 컬럼이 아니라 계산**(`shipped_qty`를 `so_lines`에 저장하지 않는다, 원칙 1의 심장 = `so_lines.qty − Σ(delivery_lines.qty)`). 자유텍스트 품목(`product_id` null)은 출고 거부(원장은 등록 품목만 받는다). 품목은 **수주 라인에서** 가져온다(클라이언트 `itemId` 불신). 봉인: 앱엔 `select`만, 쓰기는 RPC로만.
    - **수주 상태 자동전환** — 잔량 0=`completed` / 일부=`partial`(**기계 전용 상태**, 폼 선택지 미노출) / 출고 0=세대 도장(`deliveries.so_status_before`) 복귀. P4.2 규칙 그대로: 살아있는 출고 0건일 때 생성되는 출고만 도장, 복귀는 "도장 있는 것 중 가장 최근"(가장 이른 것은 다세대에서 틀린다). 전이는 **RPC 내부에서만**, 매번 살아있는 출고로 재계산.
    - **교착 방지는 이미 확보돼 있었다** — P4.2f 가 `reverse_stock_movement` 에 "`ref_doc_type` 있으면 거부" 가드를 넣어, `DLV_OUT`(`ref_doc_type='delivery'`)은 원장 직접 역분개가 자동으로 막힌다. `cancel_delivery` 는 REVERSAL 을 **직접 insert**(가드 우회 아님 — 멱등: 이미 역분개된 행은 skip해 갇힌 데이터 자가복구). 원장 화면은 전표 발생분에 [역분개] 버튼 대신 **"출고에서 취소 →"** 링크(P4.2 미러).
    - **순수 로직 분리**(`stockProjection.ts`) — 출고 폼은 브라우저에서 매 입력마다 예상재고를 재계산해야 하는데 `services/deliveries.ts` 는 supabase 서버 클라이언트를 import 하므로 `"use client"` 에서 못 부른다 → 순수부만 떼어 재수출. **마이너스 경고는 품목별 합산**(라인별로 보면 각각 재고 이내인데 합치면 초과되는 함정) + **단위별 분리 집계**(뷰 입도가 품목×창고×단위라 섞으면 `100 PCS − 10 KG = 90` 거짓 — P4.1f 함정 재발 방지).
    - 다중에이전트 적대검증(5관점 → 지적별 3인 반박단, 12건 중 6건 기각·**실결함 1건 교정**(p4.3e): **거래명세서 TOTAL 이 단위를 섞어 합산**(`12 PCS + 5 SET = 17` — 서명란 달린 대외 문서에 존재하지 않는 수량). 폼·원장은 `byUom` 로 나누는데 정작 인쇄물만 뭉갰다 → 단위별 분리(`12 PCS · 5 SET`) + 헤더 할인 미반영 명시). ⚠️ 이 검증은 세션 한도로 배심원 다수가 도중 사망 → 0표 지적은 "기각"이 아니라 미검증이라, high 3건(전부 uom 계열)은 코드 추적으로 직접 판정해 기각했다(`l.unit ?? "PCS"` 는 P4.2 receipts 와 문자 단위로 동일한 미러이고, 폼이 조회하는 uom == RPC 가 원장에 쓰는 값이라 화면 경고가 원장을 정확히 예측).
    - **Playwright 자동 검증**(playwright-core + 로컬 Chrome, 2라운드 전부 통과): 잔량 프리필→마이너스 합산 경고("현재 100 → 예상 −10")→초과 경고→확인창(취소 시 저장 안 됨)→부분출고 저장→재고 100→88→**수주 잠금**(배너+"먼저 출고를 취소하세요"+폼 사라짐)→`partial`='부분출고' 라벨→원장 [역분개] 버튼 없음·"출고에서 취소 →"→거래명세서 단위별 총계→출고 취소→**재고 88→100 정확 원복**+세대 도장 `draft` 복귀+잠금 해제. **검증 데이터 전부 취소로 정리, delivery 원장 순합계 PCS/SET=0 확인.** 테스트 91개. (마이그레이션: `db/migrations/p4.3_deliveries.sql`, 오너 실행·검증 완료)
    - ✅ **P4.3f uom 폴백 정정 = P4.3 종결** (2026-07-16, 커밋 3d00227) — "라인 unit 이 null 이면 `products.unit` 대신 `'PCS'` 가 원장에 박히는" 백로그를 입고·출고 **일괄** 교정(한쪽만 고치면 두 원장이 어긋난다). 원인은 잠긴 RPC 가 아니라 **폼 페이지의 `l.unit ?? "PCS"` 조기 주입**(RPC 의 클라 uom → products.unit → 'PCS' 체인에서 마스터 폴백이 앱 경로에서 사문). 교정: 단위 해석 체인 = **라인 uom → products.unit → 저장 거부**(한국어) — 'PCS' 를 지어내지 않는다(단위 불명 수량이 원장에 들어가는 것 자체가 정합성 결함 — 원칙 8 의 경고-허용 대상 아님). 순수 규칙 `docFlow.resolveUom/resolveDocLineUom` 단일 진실 + 저장 I/O `uomResolution.resolveDocLineUoms`(입고·출고 공용, **전표 id 스코프 조회** — 타 전표 라인·품목 미연결·마스터 단절엔 단위 오류를 지어내지 않고 RPC 의 정확한 에러에 양보) + 표시용 `items.resolveOpenLineUoms`(두 폼 공용). 서비스가 DB 라인→마스터에서 해석해 RPC 로 보내고 폼의 hidden uom 필드는 제거(클라이언트 값 불신 — P4.2f itemId 와 같은 결). 둘 다 없으면 폼 라인 잠금("단위 없음 — 입고/출고 불가"). 테스트 112개.
    - P4.3e 미검증 high 3건(전부 uom 계열) 정식 재검증: ① 'PCS' 가 마스터 단위를 무시하고 원장에 박힘 → **실결함 확인**(P4.3f 로 해소) ② 마이너스 경고의 조회 키와 실제 재고 버킷 불일치 → **실결함(파생) 확인**(같은 수정으로 해소 — 이제 폼 키 = 마스터 단위 = 조정/입고 버킷) ③ RPC 가 클라이언트 uom 을 라인·마스터보다 우선 신뢰 → **부분 확인**(앱 경로는 해소, anon 직접 REST 경로엔 잔존 — RPC 마이그레이션 사안). 라이브 검산: 살아있는 원장에 의심 uom 0건 → **백필 불요**. **남은 uom 백로그**: 재고조정 경로(`save_stock_adjustment` + `/stock` 폼)도 `coalesce(unit,'PCS')` 로 단위를 발명 — 제3의 원장 쓰기 경로(RPC 마이그레이션 + 조정 폼 가드 필요, 현재 unit 빈 품목 0개라 즉시 노출 없음).
    - P4.3f 적대검증(다중에이전트 26, 지적 29건 → 11결함 수렴): 반영 6(라인 조회 전표 id 스코프 누락·소프트링크 단절 시 RPC 에러 가림·거부 메시지 클라이언트 이름 우선·해석기 3중 복붙 공용화)·기각 4(백필=검산 대상 0건 / TOCTOU=원칙 8 사전경고 설계와 동급 윈도 / 동시 연결 레이스=직접호출 클래스 / RPC 폴백 잔존=위 ③)·백로그 1(재고조정 경로). 배포앱 Playwright: 단위 빈 라인 출고·입고 → 원장 **마스터 단위(KG·SET) 전기** 확인, 취소 시 역분개 원복·둘다없음 라인 잠금 전부 통과, 검증 데이터 전량 취소·원장 순합 0·테스트 품목 비활성 정리. **오너 스팟체크 3항목(출고 왕복 원복 · 단위 폴백 · 거래명세서 단위별 총계)은 오너 명시 위임으로 대행 수행, 화면 증거와 함께 전부 통과 = P4.3 종결.**
  - ✅ **P4.4 선적 화물·당사자 스냅샷·S/I 완료 = P4.4 종결** (2026-07-17, 커밋 86e3818~a6bab2a) — `shipment_lines`(주문라인 소프트 포인터가 잔량·가드의 축. **원장 전기 없음** — 선적은 물류 전표, 재고 이동은 GR/DLV 만. 금액·환율 없음 — P4 수량 전용) + `shipment_parties`(shipper/consignee/notify, `unique(shipment_id, role)` — **인쇄는 이 스냅샷만 본다**: 거래처 마스터를 나중에 고쳐도 과거 서류가 소급 변경되지 않는다) + `shipments.shipping_marks`. 승인된 잠금 예외 3건 적용: `ship_number` UNIQUE(중복 0)·status/direction CHECK(위반 0).
    - `save_shipment_cargo` RPC — 라인 **diff-upsert**(들어온 id 는 UPDATE·무id 는 INSERT·빠진 기존행만 DELETE. 전량교체 금지 — 라인 id 안정성은 P4.6 문서흐름 추적의 전제) + **동시성 베이스라인**(화면이 알고 있던 저장 라인 id 집합을 서버가 DB 와 대조해, 다른 화면이 그 사이 추가한 행을 diff-DELETE 가 조용히 지우지 못하게 저장을 중단시키는 검사) + 부모 주문 헤더 `for update`(P4.2f·P4.3 확립 패턴 — 잠긴 save_* 의 라인 전량 재작성과 직렬화해 유령 order_line 차단). parties 는 전량교체(참조자 없음·≤3행), marks 는 헤더 행 update.
    - 잔량 뷰 `shipment_line_totals`(원칙 1 — 잔량은 계산, 취소 선적 제외) · 선적잔량 프리필 · 초과는 **경고 후 허용**(원칙 8 — 분할선적·포장 분리는 정상 업무). **uom 은 P4.3f 체인 재사용**(주문라인 uom → products.unit → 거부, 'PCS' 발명 금지 — 스코프만 "이 선적에 연결된 주문의 라인"이고 연결 오류가 단위 오류에 **선행**한다).
    - 소비 가드 3겹(원칙 5): so/po_lines 에 **별개 이름** BEFORE DELETE 트리거 2종(기존 P4.2/4.3 가드 무수정) + shipment_orders **지연(DEFERRABLE INITIALLY DEFERRED)** 연결해제 가드 — 즉시형은 잠긴 save_shipment 의 "주문연결 전량 삭제·재삽입" 저장을 전부 오탐하므로 **지연형만이 잠긴 RPC 와 공존**한다(커밋 시점의 최종 상태로 판정) + 서비스/UI 층(SO/PO 상세 잠금 배너에 '선적 화물' 사유·연결 ✕ 잠금. 취소 선적은 잠그지 않음 — DB 가드와 동일 기준, UI 만 세면 교착).
    - S/I 인쇄 `/shipments/[id]/print` — **선적의 인쇄 뷰**(발번·문서 실체화 없음, 실체화는 P4.5~4.6 판단). 수량 TOTAL 단위별·포장수 TOTAL 포장유형별 분리(P4.3e 규칙)·중량(kg)/CBM 단일 합계·금액/환율 부재·CANCELLED 배너. PrintButton 4벌(바이트 동일 사본)을 공용 1벌로 추출 — 4문서 인쇄 **본문** 통합은 P4.5 사안.
    - 검증: 테스트 137(선작성 25 포함) · 적대검증 2회 — 마이그레이션(오너 Run 전) 19지적→3결함 교정(부모 주문 미잠금 레이스·role 누락 오진 등) / 앱 코드 47지적→15결함 수렴·12교정(수량 지운 저장 라인의 무경고 삭제·다른 화면 추가분의 무경고 삭제·비운 당사자 부활·PostgREST 1000행 절단 등) · 배포앱 Playwright 필수 6시나리오 ALL PASS(검증 데이터 전량 취소 정리·원장 순합 0). **스팟체크는 오너 직권 지시로 생략(2026-07-17), Playwright 6시나리오 결과로 갈음.**
    - **남은 백로그**: ①②③(H3 잔존·`save_stock_adjustment` 단위 발명·구 선적/`doc_counters` 봉인 공백)은 **P4.4h 에서 전부 종결**(아래) ④ 발번 999건/월 상한(lpad 절단) ⑤ `so_number`·`po_number` UNIQUE 부재 ⑥ 4문서 인쇄 본문 통합(P4.5 사안).
  - ✅ **P4.4h 구세대 봉인 하드닝 완료·종결** (2026-07-17, 커밋 `b7977d0`~`10405c4`) — **쓰기 아키텍처 성문화: 모든 쓰기는 SECURITY DEFINER RPC 단일 경로(24종·prosecdef 전수 확인), 직접 REST 쓰기는 사망.** 봉인 최종 상태: 구세대 13테이블(companies·products·inquiries·quotations·quotation_items·sales_orders·so_lines·purchase_orders·po_lines·shipments·shipment_orders·milestones·doc_counters) 쓰기 전면 회수·SELECT 유지 / `fx_rates` INSERT 회수 → 쓰기는 `save_fx_rate` 경유만(환율은 모든 금액 계산의 입력값 — 위조 주입 차단) / **뷰 전체 쓰기 동적 회수**(pg_class relkind v·m — matview 포함. `information_schema.views` 는 matview 를 누락한다) / **고아 7종**(claims·customs_declarations·orders·order_items·payments·production_orders·shipments_legacy_20260714072446 — 앱 참조 0·레포 생성 SQL 부재·전원 0행)은 SELECT 까지 회수 후 **DROP 완료**(Run 시점 행수 재확인·단일 문·CASCADE 금지, `scripts/p4.4h_drop_orphans.sql`, 커밋 `10405c4`). 라이브 확증: **전면 스캔 객체 36→29 · 쓰기권한 위반 0행**.
    - **신설 RPC 4종** `save_company`·`save_item`·`save_fx_rate`·`save_inquiry` — 구세대 4화면(거래처·품목·환율·문의)의 직접 쓰기 대체(`p_id` 부재=INSERT/존재=UPDATE, 검증은 현행 폼 수준 — 과잉 신설 금지). company_type '미분류'=null 로 기존 분류 보존. `save_item` 의 unit 은 `nullif(btrim…)` 정규화 — '' 저장 금지(공란/공백=없음 규칙을 마스터 저장부터 강제). 서비스에는 RPC 거부 경로의 **순수 미러**(`companyNameError` 등 — 메시지 전문 동일)를 저장 경로에 배선해 폼·서비스·DB 3겹이 같은 말을 한다. fx 정규화(고시값÷단위, round6)의 계산 지점은 RPC 로 이동, 서비스 `normalizeRate` 는 미러로 유지.
    - **uom 서버 재해석 매트릭스 = H3 종결(REST 봉인 + RPC 교정 이중 폐쇄)** — 교정 4종: `save_stock_adjustment`(coalesce 'PCS' 제거 → 입력 unit → products.unit → 거부. `p_uom` 추가는 구 시그니처 drop 후 재생성 — CREATE OR REPLACE 는 인자 추가 시 **오버로드**를 만들어 PostgREST 호출이 모호해진다) / `save_goods_receipt`·`save_delivery`(클라 uom 채택 폐지 → 원천 라인 uom → products.unit → 거부, 클라 uom 은 **일치 검사만** — 불일치=stale 폼 거부·새로고침 안내) / `save_shipment_cargo`(공란 거부에서 서버 재해석으로 격상 + uom 검사를 연결 검사 **뒤로**(오진 제거 — 서비스 선검사와 같은 순서)). 해당 없음: 취소·역분개 3종(원행 uom 스냅샷 승계) / **문서 3종**(`save_quotation`·`save_sales_order`·`save_purchase_order` — 클라 unit 원문 저장 = **문서가 단위의 출생지**, 원장 진입 게이트의 서버 재해석이 공란·불일치를 거른다) / `save_shipment`(unit 없음). `/stock` 조정 폼도 단위 불명 품목 잠금(입고·출고 폼 미러 — 'PCS' 표시 발명 제거).
    - 검증·정리: 테스트 172(거부 경로 미러 32케이스 추가·메시지 전문 일치) · **적대검증 2회**(각 23에이전트: 지적 19건 → 확정 13건 전부 교정, 6건 반박 기각) · 배포 후 프로드 스모크(거래처 실저장 1건·3폼 로드·콘솔 0) · 테스트 잔여물 정리 1회성 SQL(표식 기준·행별 참조 가드·광역 탐지·사후 검증 — 삭제 9·스킵 0·잔존 0, `scripts/p4.4h_cleanup_test_rows.sql`). 커밋: `b7977d0` 마이그레이션 / `284e90e` 앱 전환 / `066bd31` 테스트 / `76af1f6` 검증 스크립트 / `664bd61` 정리 SQL / `63825f0`·`add8286` 적대검증 교정 / `10405c4` 고아 DROP.
    - 백로그: "고아 7종 실사·처분" **종결**(전원 0행 확인 후 DROP — 잔존 시 미래 단계 클레임·통관·생산 명칭 충돌 위험만 있었다). 신규(코스메틱·후속): 읽기 표시 폴백 'PCS' 제거 — 단위 부재는 발명 없이 정직 표기('—' 등)로.
  - 🔑 **감사 SELECT 규율 격상 (이후 모든 마이그레이션에 적용)** — 감사는 **전면 스캔형**만 쓴다: public 전 객체(테이블·뷰·matview) × anon/authenticated × INSERT/UPDATE/DELETE 를 `has_table_privilege(role, oid, priv)` 로 훑어 **위반 0행 게이트** + **스캔 객체 총수 요약**(위반 0행만 달랑 나오는 공허통과 방지)을 함께 출력한다. **알려진 목록 나열형 금지** — P4.4 까지의 목록형 감사는 고아 7종의 쓰기 개방 42건을 한 번도 못 봤다. ⚠️ 함정: 격상 스캔이 처음 잡는 위반은 "이 마이그레이션이 만든 문제인가, 원래 열려 있던 것의 첫 노출인가"부터 판별할 것(이번 42건은 전부 후자 — 봉인 대상 임의 확장 없이 멈추고 보고가 정답이었다).
  - 🔑 **E2E 라이브 검증 데이터 관례 (성문화)** — ① 표식 명명 필수(예: 'P44H검증 …', 출처 'P4.4h …') ② 종료 시 잔여물 목록 보고 ③ 정리는 **아키텍트 승인 하의 1회성 SQL**(마이그레이션 밖·레포 기록·행별 참조 가드+사후 검증+광역 탐지 포함)만 — 클로드 코드 임의 삭제 금지. 근거: 추가 전용 대장(fx)은 남긴 테스트 행이 최신 뷰·프리필을 오염시키는데, 전표가 참조한 적 없는 테스트 주입값은 원칙 4(불변)의 보호 대상이 아니다.
  - ⚠️ **JS `trim()` ⊃ PG `btrim()` 비대칭 (관찰 기록 — 조치 없음)** — 이색 공백(탭 등)은 JS 만 없앤다. 직접 RPC 로 이색 공백 단위가 들어와도 결과는 데이터 손상이 아니라 **안전한 거부**(uom 불일치 RAISE)이므로 잠긴 RPC 재수술 없이 관찰만 기록한다.
  - **다음: P4.5** — 무역서류(CI/PL) 생성기 → P4.6 문서 흐름 추적 화면.
- **P5 — 통관 + 로트/시리얼 + 검수 + BOM**: 수출입 통관, 추적성, QC, BOM
- **P6 — ATP/할당/백오더 + L/C + RMA + 알림엔진**: 공급 제약 처리, 결제, 반품
- **P7 — RFQ/벤더평가 + FTA + 결재워크플로 + 실사**: 구매 고도화, 원산지, 승인
- **P8 — AR/AP/지급 + 3-way match + KPI + 권한**: 재무 연계, 성과지표
- **P9 — 계획(수요예측/S&OP/MRP) + 생산 + 사급 + 클레임**: 풀 SCM 고도화
- **P10 — AI 코파일럿 내장**: ERP 전 영역에서 Claude 호출 → 자연어 조회·작업·자동화 (조회 자동/변경 확인후). 단, J2 함수 레이어는 P0부터 모든 기능을 함수로 설계해 누적해온 것을 연결만 한다.

각 단계마다 **정합성 테스트**를 코드 전에 작성:
주문 10 → 출고 4+6 → 잔량 0 → 초과출고 거부 / 부분입고 3회 후 잔량 0 / 역방향 정정 후 잔량 복원 / 분할선적 기일 각각 계산 / 환율 변경돼도 확정건 금액 불변.

---

## 9. Claude Code 협업 규칙 (AI 페어 프로그래밍)

1. **계획 먼저 합의**: 새 단계 시작 시 Claude Code가 "이렇게 만들겠다"를 먼저 제시 → 영준 승인 후 코딩.
2. **작은 단위로**: 한 번에 한 모듈, 한 화면. 거대 변경 금지.
3. **체크포인트 커밋**: 동작하는 지점마다 git commit. 망가지면 되돌리기.
4. **검수**: AI 결과물을 그대로 믿지 말고, 정합성 테스트 시나리오로 검증.
5. **이 SPEC 갱신**: 기능 추가/변경 시 이 문서의 해당 섹션도 같이 수정 (단일 진실 유지).
6. **하지 말 것**: 전표 삭제 기능, 만능 수정 권한, 관세율 자동 단정, 수기 재입력 화면, 잔량을 수정가능 필드로.

---

*문서 버전: v2.5 · P0~P3 완료 + **P4.0~P4.4h 완료·종결**(2026-07-17) — 발번·날짜 전면 KST화 / 마스터 감사 / `000_baseline.sql` 재구축 복원 / Vitest(테스트 172) / `stock_movements` 추가전용 원장·권한 봉인·역분개(D1·D2·D3) / 입고 참조생성·`GR_IN` 전기·잔량 뷰·부분입고·세대 도장·잔량 소비 가드(C5) / 출고 참조생성·`DLV_OUT` 전기·부분출고·마이너스 경고 후 허용·거래명세서 인쇄(B8) / P4.3f uom 폴백 정정('PCS' 발명 금지) / P4.4 선적 화물 라인(diff-upsert·동시성 베이스라인·소비 가드 3겹) + 당사자 스냅샷(인쇄 불변) + S/I 인쇄(단위별·포장유형별 TOTAL·금액 부재) / **P4.4h 구세대 봉인 하드닝 — 쓰기=SECURITY DEFINER RPC 단일 경로(24종)·직접 REST 쓰기 사망·신설 RPC 4종(save_company·save_item·save_fx_rate·save_inquiry)·uom 서버 재해석(H3 종결)·고아 7종 DROP·전면 스캔 감사 격상(29객체·위반 0)**. 다음: P4.5 무역서류(CI/PL) → P4.6 문서 흐름 추적*
