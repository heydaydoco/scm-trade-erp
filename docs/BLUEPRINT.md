# Trade ERP — SAP급 재설계 Blueprint

> 단일 HTML 파일(빌드 불필요)을 유지하면서 내부를 **SAP식 엔터프라이즈 아키텍처**로 재설계한다.
> 실제 SAP 구축처럼 **Blueprint → Foundation → 모듈 단계 확장** 순서로 진행한다.

## 1. 무엇이 "SAP급"인가 — 4개 축

| 축 | 현재(기존) | 목표(SAP급) |
|----|-----------|------------|
| **문서 흐름** | 모듈별 독립 CRUD, 연결 약함 | 견적→수주→생산→통관→선적→대금이 **상태로 연결**, 후속문서 자동 생성, drill-down, 미처리 잔량 추적 (SAP *Document Flow / VBFA*) |
| **재무·회계** | 대금 모듈만 단독 | 물류 이벤트가 **회계 전표(GL)로 자동 전기**, 매출·원가·미수금 aging·환차손익 (SAP *FI 통합 전기*) |
| **마스터데이터** | 거래처/품목 단순 | 조직구조(회사코드·영업조직·공장), **신용한도·결제조건·BOM·표준원가** 마스터 (SAP *Org Structure / Master Data*) |
| **통제** | 없음 | **상태 전이 규칙·승인 워크플로우·역할권한(RBAC)·감사 로그** (SAP *Status Mgmt / Authorization*) |

## 2. 엔터프라이즈 구조 (조직)

```
Client (전체)
└─ Company Code 1000  본사 (FI·법인 단위, 통화 KRW)
   ├─ Sales Org  EXP   수출영업본부
   └─ Plant      P100  본사 공장
```
모든 거래 문서는 `company_code_id` / `sales_org_id` 로 조직에 귀속된다.

## 3. 문서 흐름 (Document Flow) — 시스템의 척추

```
문의   →  견적      →  수주        →  생산/발주    →  통관       →  선적        →  대금
inquiry   quotation    order          production      customs      shipment       payment
                          │                                          │              │
                          └─(후속 생성)──────────────────────────────┘   (전표 전기)─┘
                                                                       └→ GL: 매출/COGS, AR
```

- 모든 연결은 `document_flow` 테이블에 **(선행타입, 선행ID) → (후속타입, 후속ID)** 로 기록.
- Process Cockpit에서 어느 문서든 선택하면 **전체 체인**을 위/아래로 추적(drill-down)한다.
- 상태 전이는 `doc_status_transitions` 규칙으로만 허용되고 `document_status_history` 에 전부 남는다.

## 4. 재무 전기 규칙 (FI Posting) — 물류 → 회계

| 비즈니스 이벤트 | 차변 (Dr) | 대변 (Cr) |
|----------------|-----------|-----------|
| 선수금 입금 | 1100 현금및예금 | 2200 선수금 |
| 선적/CI 발행 (매출인식) | 1200 외상매출금 | 4100 수출매출 |
| 〃 (원가인식) | 5000 매출원가 | 1300 재고자산 |
| 대금 회수 | 1100 현금및예금 | 1200 외상매출금 |
| 환차익/환차손 | 6200 외환차손 또는 | 4200 외환차익 |
| 네고/은행 수수료 | 6100 지급수수료 | 1100 현금및예금 |

전기는 **명시적 액션**(Cockpit의 "전표 발행" 버튼)으로 실행 — SAP처럼 우발적 중복 전기를 막는다.
전기되면 문서의 `gl_posted=true`, `journal_entries` 헤더+라인 생성, 차·대변 균형 검증.

## 5. 통제 (Controls)

- **상태 전이 규칙**: 허용되지 않은 상태 변경 차단. 일부 전이는 `requires_role` 로 역할 제한.
- **승인 워크플로우**: 신용한도 초과·할인율 초과 시 `approval_requests` 생성 → 재무/관리자 승인 전까지 진행 차단.
- **RBAC**: `app_roles` × `role_authorizations(object, CRUD+approve)`. 현재 로그인 사용자 역할로 버튼 노출/차단.
- **감사 로그**: 생성/수정/삭제/상태변경/전기/승인 전부 `audit_log` 에 before/after(JSONB)로 기록.

## 6. 애플리케이션 아키텍처 (단일 HTML 내부)

기존의 "모듈별 전역 함수" 더미에서 **레이어드 코어 플랫폼**으로 재설계:

```
Core (플랫폼 레이어)
├─ Repo        PostgREST 데이터 접근 (select/insert/update/remove/rpc) + 에러 처리
├─ Store       마스터·거래 데이터 인메모리 캐시 + 구독
├─ Bus         이벤트 버스 (pub/sub) — 모듈 간 느슨한 결합
├─ Num         번호 범위 채번 (rpc next_number)
├─ Status      상태 전이 엔진 (규칙 검증 + 이력 기록)
├─ Flow        문서 흐름 엔진 (link / chain 추적 / 후속문서 생성)
├─ GL          회계 전기 엔진 (전표 생성 + 균형 검증)
├─ Auth        RBAC (현재 사용자·역할·권한 체크)
└─ Audit       감사 로그 기록
        ▲
        │ 모든 업무 모듈이 이 위에 올라간다
모듈: 문의·거래처·품목·견적·수주·생산·통관·선적·서류·대금·클레임·대시보드·Process Cockpit
```

기존 모듈은 깨뜨리지 않고(strangler pattern) 데이터 접근을 `Core.Repo`로 점진 이관하며,
SAP급 기능(흐름/상태/전표/승인/감사)은 횡단 엔진 + **Process Cockpit**으로 즉시 추가한다.

## 7. 단계별 로드맵

- [x] **Phase 1 — Foundation**: SQL 스키마(4축 backbone), 코어 플랫폼 엔진, Process Cockpit(문서흐름·상태·전표·승인·감사 조회), 채번/상태/전기 레퍼런스 배선.
- [ ] **Phase 2 — 문서 흐름 전면**: 견적→수주→생산→선적 후속문서 자동 생성·잔량 추적을 모든 모듈에 배선.
- [ ] **Phase 3 — 재무 통합**: 선적/대금 전기 자동화, AR aging 대시보드, 원가·마진 분석, 환차손익.
- [ ] **Phase 4 — 마스터·BOM**: 조직/신용한도/결제조건/BOM 관리 UI, 신용한도 체크 → 승인 트리거.
- [ ] **Phase 5 — 통제 강화**: RBAC UI, 승인 워크플로우 전면, (선택) Supabase RLS 보안 하드닝.

## 8. 적용 순서

1. Supabase SQL Editor에서 **`db/schema.sql`** 실행 (멱등 — 여러 번 실행해도 안전).
2. `trade_erp.html` 열기 → 좌측 새 **"Process Cockpit"** 메뉴에서 문서흐름·전표·감사 확인.
3. 이후 단계는 위 로드맵에 따라 확장.
