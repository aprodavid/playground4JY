# Firebase Functions Worker (2nd gen)

## 역할
- baseline 캐시 생성(pfc3 + exfc5)
- ride 캐시 부분 갱신(대표 좌표 dedupe)
- Firestore `jobs` 상태 기반 재시작 가능한 배치 처리

## 필수 준비
1. Node 20+
2. Firebase CLI 로그인
3. 프로젝트 선택: `firebase use <project-id>`

## 환경 구성
- Parameter: `PUBLIC_DATA_BASE_URL`
- Secret: `PUBLIC_DATA_SERVICE_KEY`

설정 예시:
```bash
firebase functions:secrets:set PUBLIC_DATA_SERVICE_KEY
# PUBLIC_DATA_BASE_URL 은 배포 시 파라미터로 입력
```

## 빌드/검증
```bash
cd functions
npm install
npm run lint
npm run build
```

## 배포
```bash
firebase deploy --only functions
```

## 엔트리 포인트
- `workerTick` (schedule: every 2 minutes)
- `workerKick` (HTTP 수동 트리거)
