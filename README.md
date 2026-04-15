# playground4JY v1 (Clean Rebuild)

## 아키텍처 역할 분리
- **Vercel / Next.js**: 검색 UI, 결과 UI, 운영 패널, `/api/search`, `/api/sigungu`, `/api/health`, `/api/debug/status`.
- **Firebase Firestore**: `facilities`, `rideCache`, `sigunguIndex`, `cacheMeta`, `jobs`.
- **Firebase Functions 2nd gen**: baseline worker, ride worker, job kick/tick/scheduler.

## 절대 운영 원칙
- 검색 경로는 Firestore 캐시만 읽습니다. (`facilities + rideCache`)
- 검색 버튼은 baseline/ride 생성 작업을 시작하지 않습니다.
- baseline은 최초 1회 생성 후 재사용합니다. (`force-rebuild`일 때만 전체 재생성)
- ride는 대표 `pfctSn` 기준으로 **없는 캐시만** 부분 갱신합니다.
- 수동 파일 업로드/Blob/Python 경로는 사용하지 않습니다.

## 고정 상수
- `PFCT_URL = https://apis.data.go.kr/1741000/pfc3/getPfctInfo3`
- `RIDE_URL = https://apis.data.go.kr/1741000/ride4/getRide4`
- `EXFC_URL = https://apis.data.go.kr/1741000/exfc5/getExfc5`
- 설치장소 코드: `A003`, `A022`, `A033`
- 시/도 목록: 정적 상수 유지
- 기구 화이트리스트: `D001..D009`, `D020..D022`, `D080`, `D050`, `D052`

## baseline 최초 생성 순서
1. 운영 패널에서 **기준선 캐시 생성** 클릭
2. job 상태머신 진행: `queued -> pfc3 -> exfc5 -> finalize -> success`
3. 완료 시 `baselineReady=true` + `sigunguIndex` 생성/갱신

## ride 캐시 갱신 순서
1. 운영 패널에서 **ride 캐시 갱신** 클릭
2. 상태머신 진행: `queued -> ride -> success`
3. 대표 `pfctSn` 대상 중 미존재 문서만 채움

## 검색 플로우
- `/api/search`는 baseline 미준비 시 `409`와 안내 메시지를 반환합니다.
- baseline 준비 후에는 재생성을 트리거하지 않고 즉시 캐시 조회만 수행합니다.

## 환경변수 이름 (변경 금지)
- `PUBLIC_DATA_BASE_URL`
- `PUBLIC_DATA_SERVICE_KEY`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

## 로컬 검증
### 루트 앱
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
```

## 배포 순서
1. Firestore index 반영
```bash
firebase deploy --only firestore
```
2. Functions 배포
```bash
cd functions
firebase deploy --only functions
```
3. Vercel은 루트 앱을 배포 (UI/검색 전용)

## 인덱스 운영 규칙
- 코드에서 사용하는 쿼리는 `firestore.indexes.json`에 고정 관리합니다.
- 운영 중 수동 생성한 인덱스가 있으면 반드시 `firestore.indexes.json`에도 반영합니다.
