# Firestore Schema (v1)

## facilities
문서 ID: `pfctSn`(string)

```ts
{
  pfctSn: number;
  facilityName: string;
  sido: string;
  sigungu: string;
  address: string;
  normalizedAddress: string;
  lat?: number;
  lng?: number;
  installPlaceCode: 'A003'|'A022'|'A033';
  installYear?: number;
  area: number;         // 결측은 400 대체
  areaMissing: boolean; // true면 결측 대체
  isExcellent: boolean; // exfc5 결합
  contentHash?: string;
  updatedAt: string;    // ISO
}
```

권장 인덱스:
- 단일 필드 인덱스(자동)로 현재 조회 쿼리 처리 가능

## rideCache
문서 ID: `pfctSn`(string)

```ts
{
  pfctSn: number;
  rawCount: number;
  filteredCount: number;
  typeCount: number;
  types: string[];
  updatedAt: string;
  status: 'ok'|'empty'|'error';
  lastError?: string;
}
```

## cacheMeta
문서 ID: `{sido}:{sigungu|ALL}`

```ts
{
  regionKey: string;
  lastBuiltAt: string;
  facilitiesCount: number;
  rideCachedCount?: number;
  excellentCount: number;
  lastBuildStatus: 'ok'|'error';
}
```


## jobs
문서 ID: `jobId`(auto id)

```ts
{
  jobId: string;
  type: "baseline"|"ride";
  status: "queued"|"running"|"success"|"error"|"stopped";
  startedAt: string;
  updatedAt: string;
  ...
}
```

필수 composite index:
- `status` Asc + `startedAt` Asc (`where status in [...] + orderBy startedAt asc`)
- `type` Asc + `startedAt` Desc (`where type == ... + orderBy startedAt desc`)
