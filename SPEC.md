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
- B8. 출고/납품 (Delivery, SO 참조 생성, 부분출고, 재고 차감) `[P4]`
- B9. 청구 (Commercial Invoice, Delivery 참조 생성) `[P4]`
- B10. 대금 회수/미수금(AR) 관리, 입금 대사 `[P8]`
- B11. 수주잔고(Backlog) 관리 `[P6]`

### C. Procure-to-Pay (구매→지급)
- C1. 발주 요청 (Purchase Requisition) `[P5]`
- C2. RFQ(견적요청) / 복수 벤더 견적 비교 `[P7]`
- C3. 발주 (Purchase Order, 헤더-라인) ✅ *구현(P3.1 — save_purchase_order 원자 저장·수주 참조생성(back-to-back)·환율 프리필·발주서 인쇄·감사 상속)* `[P3]`
- C4. 발주 확인(Order Confirmation) 접수 — 상태값(공급사확정)으로 반영, 별도 접수 화면은 후속 `[P3]`
- C5. 입고 (Goods Receipt, PO 참조 생성, 부분입고, 재고 가산) `[P4]`
- C6. 입고 검수(QC) / 검사성적서 `[P5]`
- C7. 송장 검수 (Invoice Receipt, 3-way match: PO↔GR↔Invoice) `[P8]`
- C8. 미지급금(AP) / 지급 관리 `[P8]`
- C9. 납기 추적(Expediting) — 납기경과 미입고 리스트 `[P3]`
- C10. 공급사 평가(Scorecard, QCD) `[P7]`

### D. 재고·창고 (Inventory & Warehouse)
- D1. 재고 원장 (stock_movements, append-only) `[P4]`
- D2. 이동유형 코드 (구매입고+, 판매출고−, 생산투입−, 생산입고+, 실사조정±, 위치이동) `[P4]`
- D3. 현재고 조회 (품목·위치·로트·시리얼별) `[P4]`
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
  - ⚠️ 재고 원장 테이블은 **이 단계부터 로트/시리얼/위치 칸을 포함**해 만든다. (P5에서 컬럼을 추가하면 P4에 쌓인 과거 기록은 영원히 비어 소급 불가)
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

*문서 버전: v2.0 · P0·P1·P2·**P3 전체 완료**(2026-07-14) — P3.1 발주(PO) + P3.2 선적부킹·마일스톤 + P3.3 기일 역산 알림(앱내 임박기일 D-7/3/1·KST·홈 배지). 다음: P4(재고 원장 + 출고/입고 + 무역서류 생성 + 문서흐름 = 진짜 ERP 1차 완성)*
