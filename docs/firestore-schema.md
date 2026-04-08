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
  updatedAt: string;    // ISO
}
```

권장 인덱스:
- `sido` Asc
- `sido` Asc + `sigungu` Asc
- `sido` Asc + `sigungu` Asc + `installPlaceCode` Asc

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
