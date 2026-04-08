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

## `.env.local`에 넣어야 하는 키
아래 **이름 그대로** `.env.local`에 추가하세요.

```bash
PUBLIC_DATA_BASE_URL=
PUBLIC_DATA_SERVICE_KEY=
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
```

- 실제 공공데이터 인증키/서비스계정 키는 절대 코드/깃 저장소에 커밋하지 않습니다.
- 앱에서는 모든 값을 `process.env`에서만 읽습니다.

## Vercel Environment Variables 등록 이름
Vercel 대시보드에서 **Settings > Environment Variables** 로 이동한 뒤, 아래 이름으로 동일하게 등록하세요.

- `PUBLIC_DATA_BASE_URL`
- `PUBLIC_DATA_SERVICE_KEY`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

## 왜 `NEXT_PUBLIC_` 접두사를 붙이면 안 되나?
- `NEXT_PUBLIC_`로 시작하는 변수는 빌드 시 클라이언트 번들에 주입되어 브라우저에서 접근 가능해집니다.
- 공공데이터 서비스 키와 Firebase Admin 자격증명은 **서버 전용 비밀값**이므로 브라우저에 노출되면 안 됩니다.
- 따라서 본 프로젝트는 Next.js Route Handler(서버)에서만 공공데이터 API를 호출하고, 비밀값은 서버 런타임의 `process.env`에서만 사용합니다.

## Firebase 설정 방법
1. Firebase 프로젝트 생성
2. Firestore Database 활성화 (Native mode)
3. 서비스 계정 키(JSON) 발급
4. `.env.local`에 `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` 설정

## Vercel 배포 방법
1. GitHub 저장소를 Vercel에 Import
2. 위 5개 환경변수를 모두 등록
3. Build Command: `npm run build`, Output: `.next`
4. 배포 후 Admin API로 지역 캐시 빌드

## Firestore 컬렉션 설명
- `facilities`: pfc3 + exfc5 결합/정규화 시설 데이터
- `rideCache`: ride4 캐시(화이트리스트 필터 결과 포함)
- `cacheMeta`: 지역별 캐시 빌드 메타데이터

## 공공데이터 API 키 설정 방법
- `PUBLIC_DATA_SERVICE_KEY`에 인증키를 입력
- API base URL은 `PUBLIC_DATA_BASE_URL`로 관리
- 키는 코드에 하드코딩하지 않고 환경변수로만 사용

## API 엔드포인트
- `GET /api/sido`
- `GET /api/sigungu?sido=...`
- `POST /api/search`
- `GET /api/facility/[pfctSn]`
- `POST /api/admin/refresh-region`
- `POST /api/admin/refresh-rides`

## 현재 v1 한계
- 설치장소 코드 3종(A003/A022/A033)만 지원
- ride4 화이트리스트 코드만 반영
- 경고/추천 규칙은 v1 기준 정적 로직

## 추후 개선 포인트
- 지역 캐시 워커(배치/스케줄) 고도화
- 가중치 프리셋 저장 및 A/B 테스트
- 지도 기반 시각화 및 상세 비교 화면
- 데이터 품질 태그 정교화(v7.1 규칙 확장)
