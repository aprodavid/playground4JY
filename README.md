# 어린이 놀이시설 추천 웹앱 v1

공공데이터(pfc3, ride4, exfc5)와 Firebase Firestore 캐시를 이용해 어린이 놀이시설 추천 결과를 제공하는 Next.js 앱입니다.

## 기술 스택
- Next.js (App Router)
- TypeScript
- Tailwind CSS
- ESLint (flat config)
- Firebase Firestore (캐시/저장소)

## 로컬 실행 방법
```bash
npm install
cp .env.example .env.local
npm run dev
```

## 필수 환경변수
- `PUBLIC_DATA_BASE_URL`
- `PUBLIC_DATA_SERVICE_KEY`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

## 운영 플로우(v1)
1. 시/도 정적 목록 조회
2. 시/군/구 조회(Firestore 우선, 없으면 공공데이터 fallback)
3. 운영 패널에서 캐시 빌드/ride 캐시 갱신/상태 새로고침
4. 검색 실행 시 캐시 자동 빌드 시도 및 안내

## API 엔드포인트
- `GET /api/sido`
- `GET /api/sigungu?sido=...`
- `POST /api/search`
- `GET /api/facility/[pfctSn]`
- `POST /api/admin/refresh-region`
- `POST /api/admin/refresh-rides`
- `GET /api/debug/status`
- `GET /api/health`

## 배포 안정성 메모
- Firebase/Public Data 환경변수 검사는 빌드 시점이 아닌 API Route 실행 시점에 수행됩니다.
- Firebase 관련 Route Handler는 모두 `runtime = 'nodejs'`를 유지합니다.
- `FIREBASE_PRIVATE_KEY`는 `\\n` 문자열 줄바꿈을 서버에서 실제 줄바꿈으로 복원합니다.
- 공공데이터 API는 브라우저에서 직접 호출하지 않고 Route Handler를 통해서만 호출됩니다.
- ESLint는 Next 15 호환 flat config(`next/core-web-vitals`, `next/typescript`)로 유지합니다.
- Vercel/프로덕션 빌드에서는 `next.config.ts`의 `eslint.ignoreDuringBuilds`로 린트 설정 이슈가 배포를 차단하지 않도록 보호합니다.
