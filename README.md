# 어린이 놀이시설 추천 웹앱 v2

공공데이터(pfc3, ride4, exfc5)와 Firebase Firestore 캐시를 이용해 어린이 놀이시설 추천 결과를 제공하는 Next.js 앱입니다.

## 핵심 구조 (이번 변경)
- **Baseline facilities 캐시**: 공공데이터 전국 페이지 순회 제거, **파일 업로드(JSON/CSV) 기반 import**로 즉시 생성
- **Search**: Firestore `facilities`/`rideCache`만 사용 (검색 버튼이 API 크롤링을 유발하지 않음)
- **Ride cache**: `ride4` API를 대표 `pfctSn` 대상 **부분 배치**로만 갱신 (없는 시설만 채움)

## 기술 스택
- Next.js 15.3.8 (App Router)
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

## 운영 플로우(v2)
1. 운영 패널에서 `pfc3` 파일 업로드 (`.json`/`.csv`)
2. 운영 패널에서 `exfc5` 파일 업로드 (`.json`/`.csv`)
3. 운영 패널에서 **기준선 캐시 생성(import)** 실행
4. 상태 새로고침으로 진행률/처리건수/성공/실패 확인
5. baseline 준비 후 **ride 캐시 갱신** 실행
6. 사용자 검색은 Firestore 캐시로 즉시 처리

## API 엔드포인트
- `GET /api/sido`
- `GET /api/sigungu?sido=...`
- `POST /api/search`
- `GET /api/facility/[pfctSn]`
- `POST /api/admin/baseline-import/upload-pfc3`
- `POST /api/admin/baseline-import/upload-exfc5`
- `POST /api/admin/baseline-import/start`
- `GET /api/admin/baseline-import/status`
- `POST /api/admin/refresh-region` (하위 호환, baseline import 시작으로 위임)
- `POST /api/admin/refresh-rides`
- `GET /api/debug/status`
- `GET /api/health`

## 배포 안정성 메모
- Firebase/Public Data 환경변수 검사는 빌드 시점이 아닌 API Route 실행 시점에 수행됩니다.
- Firebase 관련 Route Handler는 모두 `runtime = 'nodejs'`를 유지합니다.
- `FIREBASE_PRIVATE_KEY`는 `\\n` 문자열 줄바꿈을 서버에서 실제 줄바꿈으로 복원합니다.
- 공공데이터 API는 브라우저에서 직접 호출하지 않고 Route Handler를 통해서만 호출됩니다.
