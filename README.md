# playground4JY v1 (Per-Sido Baseline + Global Ride)

## 아키텍처 역할 분리
- **Vercel / Next.js**: 검색 UI, 운영 패널, `/api/search`, `/api/sigungu`, `/api/health`, `/api/debug/status`.
- **Firebase Firestore 핵심 컬렉션**: `facilities`, `rideCache`, `sigunguIndex`, `cacheMeta`.
- **Firebase Functions 2nd gen**: 선택 시도 baseline builder + 전역 ride updater.

## 핵심 설계 철학
- baseline 캐시는 `cacheMeta/baseline:{sido}` 단위로 분리.
- ride 캐시는 `cacheMeta/ride:global` 상태 + `rideCache/{pfctSn}` 데이터로 전역 유지.
- 검색(`/api/search`)은 **Firestore read-only** 이며 원본 공공데이터 API를 호출하지 않음.
- baseline 완료 후 `sigunguIndex/{sido}`를 생성/갱신.

## 고정 상수
- `PFCT_URL = https://apis.data.go.kr/1741000/pfc3/getPfctInfo3`
- `RIDE_URL = https://apis.data.go.kr/1741000/ride4/getRide4`
- `EXFC_URL = https://apis.data.go.kr/1741000/exfc5/getExfc5`
- 설치장소 코드: `A003`, `A022`, `A033`
- 기구 화이트리스트: `D001..D009`, `D020..D022`, `D080`, `D050`, `D052`
- serviceKey fallback: raw → encoded

## 운영 패널 버튼 (v1)
- 기준선 캐시 생성 (선택 시도)
- 기준선 강제 재생성 (선택 시도)
- ride 캐시 갱신
- 상태 새로고침
- 작업 중지

## parser-zero-items 정책
- 페이지 fetch 성공 후 item 파싱 결과가 0이면 즉시 `parser-zero-items` 오류로 중단.
- 상태에 `lastPageItemCount`, `parsePathUsed`, `lastError` 기록.
- `pagesFetched`가 증가하는 페이지는 정상적으로 `rawFacilityCount` 증가를 동반하도록 설계.

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

## Firestore 인덱스 (필수)
현재 워커/검색 쿼리에 필요한 composite index는 아래 2개입니다.

- `facilities` (`queryScope: COLLECTION`)
  - `sido` ASC
  - `sigungu` ASC
- `cacheMeta` (`queryScope: COLLECTION`)
  - `status` ASC
  - `regionKey` ASC

반영 순서:
```bash
firebase.cmd deploy --only "firestore"
```

그 다음 Functions를 배포합니다.
```bash
firebase deploy --only functions
```
