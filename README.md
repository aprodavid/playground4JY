# 어린이 놀이시설 추천 웹앱 v1

공공데이터(pfc3, ride4, exfc5)와 Firebase Firestore 캐시를 이용해 어린이 놀이시설 추천 결과를 제공하는 Next.js 앱입니다.

## 기술 스택
- Next.js (App Router)
- TypeScript
- Tailwind CSS
- Firebase Firestore (캐시/저장소)

## 로컬 실행 방법
```bash
npm install
cp .env.example .env.local
npm run dev
```

## Firebase 설정 방법
1. Firebase 프로젝트 생성
2. Firestore Database 활성화 (Native mode)
3. 서비스 계정 키(JSON) 발급
4. `.env.local`에 `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` 설정

## Vercel 배포 방법
1. GitHub 저장소를 Vercel에 Import
2. Environment Variables에 `.env.example`의 키 전부 등록
3. Build Command: `npm run build`, Output: `.next`
4. 배포 후 첫 진입에서 운영 패널로 지역 캐시 빌드

### 배포 안정성 메모 (중요)
- Firebase/Public Data 환경변수 검사는 **빌드 시점이 아닌 API Route 실행 시점**에 수행됩니다.
- 환경변수가 누락되어도 빌드 자체는 실패하지 않으며, 실제 API 호출 시 JSON 에러를 반환합니다.
- Firebase 관련 Route Handler는 모두 `runtime = 'nodejs'`로 동작합니다.
- `FIREBASE_PRIVATE_KEY`는 `\\n` 문자열 줄바꿈을 서버에서 자동으로 실제 줄바꿈으로 복원합니다.

## Firestore 컬렉션 설명
- `facilities`: pfc3 + exfc5 결합/정규화 시설 데이터
- `rideCache`: ride4 캐시(화이트리스트 필터 결과 포함)
- `cacheMeta`: 지역별 캐시 빌드 메타데이터

## 공공데이터 API 키 설정 방법
- `PUBLIC_DATA_SERVICE_KEY`에 인증키를 입력
- API base URL은 `PUBLIC_DATA_BASE_URL`로 관리
- 키는 코드에 하드코딩하지 않고 환경변수로만 사용
- base URL은 `pfc3 / ride4 / exfc5` 경로를 뒤에 붙여 호출되며, 끝 슬래시는 있어도/없어도 동작하도록 처리되어 있습니다.

## 사용자/운영 흐름 (v1)
1. 시/도 선택 (정적 목록으로 항상 표시)
2. 시/군/구 선택 (Firestore 캐시 우선, 없으면 공공데이터 API 조회)
3. 캐시 상태 확인 및 필요 시 캐시 빌드
4. 검색 실행

## API 엔드포인트
- `GET /api/sido`
- `GET /api/sigungu?sido=...`
- `POST /api/search`
- `GET /api/facility/[pfctSn]`
- `POST /api/admin/refresh-region`
- `POST /api/admin/refresh-rides`
- `GET /api/debug/status`
- `GET /api/health`

## 상태/진단 응답
`/api/debug/status` 또는 `/api/health`는 아래를 JSON으로 제공합니다.
- 환경변수 준비 여부
- Firebase 연결 가능 여부
- 공공데이터 API base URL 형식 확인
- Firestore 컬렉션 문서 수 요약
- 마지막 캐시 빌드 메타데이터

## 현재 v1 한계
- 설치장소 코드 3종(A003/A022/A033)만 지원
- ride4 화이트리스트 코드만 반영
- 경고/추천 규칙은 v1 기준 정적 로직

## 추후 개선 포인트
- 지역 캐시 워커(배치/스케줄) 고도화
- 가중치 프리셋 저장 및 A/B 테스트
- 지도 기반 시각화 및 상세 비교 화면
- 데이터 품질 태그 정교화(v7.1 규칙 확장)
