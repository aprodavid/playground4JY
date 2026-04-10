# 어린이 놀이시설 추천 웹앱 v3 (Next.js + Firebase Functions 2nd gen)

## 역할 분리 (핵심)
- **Vercel (Next.js 15.3.8)**
  - UI 렌더링
  - 검색 API(`/api/search`) 제공 (Firestore 캐시 읽기 전용)
  - 운영 패널에서 baseline/ride 작업 시작/중지/상태 polling
- **Firebase Functions 2nd gen**
  - baseline facilities 캐시 생성
  - ride 캐시 부분 갱신
  - Firestore `jobs` 상태머신을 따라 백그라운드 처리
  - 스케줄러 + Firestore 트리거로 작업 이어서 처리
- **Firestore**
  - `facilities`, `rideCache`, `sigunguIndex`, `cacheMeta`, `jobs`

---

## Firestore 컬렉션
- `facilities/{pfctSn}`: 시설 기준선 캐시
- `rideCache/{pfctSn}`: ride API 집계 캐시
- `sigunguIndex/{sido}`: 시/도별 시군구 인덱스
- `cacheMeta/baseline:global`: baseline/ride 통합 메타 상태
- `jobs/{jobId}`: 배경 작업 상태머신 (`queued/running/success/error/stopped`)

---

## 동작 흐름
1. 운영 패널에서 baseline 시작 (`POST /api/admin/jobs/start`, `{ type: "baseline" }`)
2. Vercel은 Firestore `jobs` 문서 생성만 수행 (장시간 작업 없음)
3. Functions 트리거(`onJobCreatedKick`) 또는 스케줄러(`workerTick`)가 baseline 단계 처리
4. baseline 완료 시:
   - `facilities` 갱신
   - `sigunguIndex` 생성/갱신
   - `cacheMeta` 상태 success 반영
5. 운영 패널에서 ride 시작 (`{ type: "ride" }`)
6. Functions가 `rideCache`를 배치 단위로 부분 갱신
7. 검색 API는 오직 Firestore 캐시만 읽음

---

## Vercel 환경변수 (이름 변경 금지)
- `PUBLIC_DATA_BASE_URL`
- `PUBLIC_DATA_SERVICE_KEY`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

> 참고: `PUBLIC_DATA_SERVICE_KEY`는 Vercel에 남겨둘 수 있지만, 실제 baseline/ride 실행은 Functions Secret을 사용합니다.

---

## Firebase Functions Secret/Param 설정
루트에서 실행:

```bash
firebase use aprodavid-playground4jy
firebase functions:secrets:set PUBLIC_DATA_SERVICE_KEY
```

`PUBLIC_DATA_BASE_URL`은 Functions param(defineString)로 사용됩니다. 최초 배포 시 CLI 프롬프트에서 입력하거나 사전 설정하세요.

---

## 배포 방법
### 1) Next.js (Vercel)
```bash
npm install
npm run lint
npm run build
```

### 2) Functions
```bash
cd functions
npm install
npm run lint
npm run build
firebase deploy --only functions
```

---

## 주요 API
- `POST /api/admin/jobs/start` (baseline/ride 작업 생성)
- `POST /api/admin/jobs/stop` (작업 중지 요청)
- `GET /api/admin/jobs/status` (작업 상태 조회)
- `POST /api/search` (Firestore `facilities` + `rideCache` 검색)
- `GET /api/sigungu?sido=...` (Firestore `sigunguIndex`만 사용)
- `GET /api/debug/status`
- `GET /api/health`

---

## Functions 엔드포인트/트리거
- `workerTick` (Scheduler, 2분): queued/running job 진행
- `workerKick` (HTTP): 강제 1 step 실행(운영 점검용)
- `onJobCreatedKick` (Firestore trigger): `jobs/{jobId}` 생성 시 즉시 1 step 실행

---

## 주의
- 수동 파일 업로드 경로는 비활성화(410) 상태입니다.
- `FIREBASE_PRIVATE_KEY`의 `\n` 복원 로직은 유지됩니다.
