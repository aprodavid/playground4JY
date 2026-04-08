# PLAN - 어린이 놀이시설 추천 웹앱 v1

## 1) 아키텍처 요약
- **Frontend**: Next.js App Router + Tailwind CSS + TypeScript.
- **Backend(API)**: Next.js Route Handler.
  - 브라우저는 공공데이터 API를 직접 호출하지 않고 `/api/*`만 호출.
- **Data Store/Cache**: Firebase Firestore.
  - `facilities`, `rideCache`, `cacheMeta` 컬렉션 사용.
- **배포**: Vercel (Node 런타임).

## 2) 핵심 데이터 흐름
1. `/api/admin/refresh-region`
   - pfc3 + exfc5를 받아 `pfctSn` 기준 결합.
   - 면적 결측은 400으로 대체 + `areaMissing=true`.
   - 좌표 기준 중복 제거 후 `facilities` 저장.
2. `/api/search`
   - 시설 조건(지역, 설치장소, 설치연도)으로 후보 축소.
   - `rideCache` 조회.
   - 캐시 미존재 시설만 ride4를 서버에서 조회해 캐시 저장.
   - 점수 계산/추천 로직 적용 후 TOP N + near miss 반환.

## 3) 성능 전략
- 검색 단계에서 모든 시설 ride4 실시간 호출 금지.
- 후보군 기반 lazy cache + 우수시설/상위후보 우선 캐시.
- `refresh-rides`로 사전 캐시 워밍 가능.

## 4) v1 제약
- 설치장소: A003/A022/A033만.
- ride4 화이트리스트 코드만 반영.
- 점수 규칙은 v1 baseline이며 추후 재조정 가능.
