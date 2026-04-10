# 어린이 놀이시설 추천 웹앱 v3 (Vercel + Firebase Functions Worker)

## 아키텍처 요약
- **Vercel(Next.js 15.3.8)**: UI, 검색, 작업(Job) 생성/조회/중지 API만 담당
- **Firebase Functions 2nd gen**: baseline/ride 캐시를 백그라운드 배치로 생성
- **Firestore**: `jobs`, `cacheMeta`, `facilities`, `rideCache`, `sigunguIndex` 저장소
- 사용자 요청 당 공공데이터 API 직접 호출 없음(검색은 Firestore 캐시 조회만 수행)

## 왜 구조를 바꿨나?
기존 구조는 Vercel Route Handler가 전국 페이지 순회를 직접 수행해서 **요청-응답이 장시간 점유**되고 타임아웃/지연이 발생했습니다. 이제 무거운 작업은 Functions 워커가 처리하고 Vercel은 상태 조회만 합니다.

## 컬렉션 구조
- `jobs/{jobId}`
  - `type`: `baseline | ride`
  - `status`: `queued | running | success | error | stopped`
  - `currentStage`, `currentInstallPlace`, `currentPage`, `totalPages`, `pagesFetched`
  - `rawFacilityCount`, `filteredFacilityCount`, `successCount`, `errorCount`
  - `startedAt`, `updatedAt`, `lastError`, `resultSummary`, `cursor`, `stopRequested`
- `cacheMeta/baseline:global`
  - baseline/ride의 통합 캐시 메타 상태
- `facilities/{pfctSn}`
  - `pfctSn`, 시설명, 설치장소코드, 주소, 시도/시군구, 설치연도, 면적, 좌표, 우수시설 여부
- `rideCache/{pfctSn}`
  - ride 집계 캐시
- `sigunguIndex/{sido}`
  - 시/도별 시/군/구 목록

## Vercel 환경변수 (이름 고정)
- `PUBLIC_DATA_BASE_URL`
- `PUBLIC_DATA_SERVICE_KEY`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

## 로컬 실행
```bash
npm install
cp .env.example .env.local
npm run dev
```

## 운영 플로우 (온라인 전용)
1. 운영 패널에서 **기준선 캐시 빌드 시작** 클릭 (`/api/admin/jobs/start`, type=baseline)
2. 프론트가 `/api/admin/jobs/status` + `/api/debug/status`를 polling
3. Firebase Functions 스케줄러가 queued/running baseline job을 이어서 처리
4. 완료 시 `facilities`, `sigunguIndex`, `cacheMeta` 업데이트
5. 운영 패널에서 **ride 캐시 갱신 시작** 클릭 (type=ride)
6. Functions가 대표 좌표 dedupe 대상에 대해 ride cache를 부분 배치 갱신

## Firebase/GCP 수동 설정 순서
1. Firebase 프로젝트 생성 및 Blaze 요금제 활성화
2. Firestore Native 모드 생성
3. Functions 배포 준비
   - `cd functions && npm install && npm run build`
4. Secret 등록
   - `firebase functions:secrets:set PUBLIC_DATA_SERVICE_KEY`
5. Parameter 등록
   - `firebase functions:config:set` 대신 **2nd gen param 값** 설정(`PUBLIC_DATA_BASE_URL`)
   - 또는 배포 시 콘솔에서 param 값 입력
6. 배포
   - `firebase deploy --only functions`
7. Cloud Scheduler 확인
   - `workerTick`(2분 간격) 트리거 활성화 확인
8. Vercel 환경변수 입력(이름 변경 금지)

## Vercel API
- `POST /api/admin/jobs/start` (`baseline|ride`)
- `GET /api/admin/jobs/status`
- `POST /api/admin/jobs/stop`
- `POST /api/search` (Firestore 캐시만 조회)
- `GET /api/sigungu?sido=...` (`sigunguIndex`만 조회)
- `GET /api/debug/status`, `GET /api/health`

## 참고
- `FIREBASE_PRIVATE_KEY`의 `\n`은 서버에서 실제 개행으로 복원됩니다.
- 수동 파일 업로드 경로는 비활성화(410)되어 있습니다.
