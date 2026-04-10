# 어린이 놀이시설 추천 웹앱 v4 (Next.js + Firebase Functions 2nd gen)

## 핵심 운영 원칙
- **baseline은 한 번 만들고 재사용**합니다.
- **검색(`/api/search`)은 Firestore 캐시(`facilities` + `rideCache`)만 즉시 조회**합니다.
- **ride 캐시는 baseline과 분리**되어 대표 `pfctSn` 대상만 부분 갱신합니다.
- 무거운 수집/가공은 **Firebase Functions 백그라운드 워커**가 처리하고, **Vercel은 UI/검색/상태 조회만 담당**합니다.

## 역할 분리
- **Vercel (Next.js 15.3.8 유지)**
  - 검색 UI/API
  - 운영 패널에서 작업 시작/중지/상태 polling
- **Firebase Functions 2nd gen (Node.js 20 runtime)**
  - baseline worker (`pfc3 -> exfc5 -> finalize`)
  - ride worker (대표 시설 대상 부분 갱신)
  - `jobs` 큐를 cursor 기반으로 이어서 처리 (중단/재개 가능)
- **Firestore**
  - `facilities`, `rideCache`, `sigunguIndex`, `cacheMeta`, `jobs`

## baseline 재사용/재생성 정책
- **기준선 캐시 생성 버튼(일반)**
  - baseline이 없으면 최초 생성
  - baseline이 이미 준비(`baselineReady=true`, `baselineStatus=success`)되어 있으면 **재사용(새 전체 재생성 안 함)**
- **기준선 강제 재생성 버튼**
  - 운영자가 명시적으로 전체 재생성이 필요할 때만 사용
  - 예: 데이터 스키마 변경, 대량 이상치 정리, 전국 재수집이 필요한 정책 변경

`cacheMeta/baseline:global`에 아래 핵심 메타를 유지합니다.
- `baselineReady`
- `baselineVersion`
- `lastSuccessfulBaselineAt`
- `baselineStatus`, `baselineCurrentStage`, `baselinePagesFetched` 등 진행 정보
- `rideProgress` (ride 전용 진행 메타)

## 검색 동작
1. `/api/search`는 baseline 재생성 로직을 절대 수행하지 않습니다.
2. baseline 미준비 시 409 + “기준선 캐시 생성 필요” 안내만 반환합니다.
3. baseline 준비 후에는 Firestore 캐시 조회만 수행합니다.

## 백그라운드 워커 동작
- 스케줄러: `workerTick` (2분마다)
- Firestore 트리거: `onJobCreatedKick` (job 생성 시 즉시 1회 실행)
- HTTP: `workerKick` (운영 점검용 수동 1step 실행)

### baseline worker
- cursor(`stage/installPlaceIndex/page/excellentPage`)를 `jobs/{jobId}`에 저장
- invocation마다 일부 단계만 처리 후 종료
- 다음 tick/trigger에서 이어서 처리
- BulkWriter + `contentHash` 비교로 변경 없는 문서 재쓰기 최소화

### ride worker
- baseline과 분리된 job 타입
- 시설 좌표 기준 대표 `pfctSn` 목록 생성
- **이미 있는 `rideCache` 문서는 건너뛰고 없는 대상만 채움**
- `rideProgress`에 processed/updated/error/skipped 누적

## 운영자가 해야 할 최소 순서
1. 상태 새로고침
2. baseline 미준비면 **기준선 캐시 생성** 실행 (필요 시에만 **기준선 강제 재생성**)
3. baseline 준비 후 **ride 캐시 갱신** 실행
4. 검색 기능 사용

## 환경변수 (이름 변경 금지)
- `PUBLIC_DATA_BASE_URL`
- `PUBLIC_DATA_SERVICE_KEY`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

> `FIREBASE_PRIVATE_KEY`의 `\n` 복원 로직 유지.

## 배포/검증 명령
### Next.js
```bash
npm install
npm run lint
npm run build
```

### Functions
```bash
cd functions
npm install
npm run lint
npm run build
firebase deploy --only functions
```

## 참고
- 시/도 정적 목록은 유지합니다.
- 시/군/구는 `sigunguIndex`를 즉시 조회합니다.
- 서비스키는 raw -> encoded fallback 호출을 유지합니다.
