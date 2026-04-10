'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_WEIGHTS, INSTALL_PLACE_LABELS, type CacheMetaDoc, type SearchResult, type WeightConfig } from '@/types/domain';

type SearchResponse = {
  summary: { totalCandidates: number; recommended: number };
  excellentSection: SearchResult[];
  top: SearchResult[];
  nearMiss: SearchResult[];
  message?: string;
  autoBuiltCache?: boolean;
  needsCacheBuild?: boolean;
};

type StatusResponse = {
  env: Record<string, boolean>;
  firebase: { ok: boolean; error: string | null };
  publicApi: {
    ok: boolean;
    baseUrl: string | null;
    endpoint: string;
    finalUrl: string | null;
    keyFallback: { rawAttempted: boolean; rawSuccess: boolean; encodedAttempted: boolean; encodedSuccess: boolean };
    status: number | null;
    parseOk: boolean;
    errorType: string | null;
    errorMessage: string | null;
  };
  counts: { facilities: number; rideCache: number; cacheMeta: number };
  latestCacheBuild: CacheMetaDoc | null;
};

type RefreshRegionStatus = {
  status: 'idle' | 'running' | 'success' | 'error';
  currentStage?: string;
  currentInstallPlace?: string | null;
  currentPage?: number;
  totalPages?: number | null;
  pagesFetched?: number;
  rawFacilityCount?: number;
  filteredFacilityCount?: number;
  successCount?: number;
  errorCount?: number;
  done?: boolean;
  lastError?: string | null;
  selectedRegion?: { sido: string; sigungu?: string };
  startedAt?: string;
  updatedAt?: string;
  facilitiesCount?: number;
};

export default function SearchForm() {
  const [sidoList, setSidoList] = useState<string[]>([]);
  const [sigunguList, setSigunguList] = useState<string[]>([]);
  const [sido, setSido] = useState('');
  const [sigungu, setSigungu] = useState('');
  const [installPlaces, setInstallPlaces] = useState<string[]>(['A003', 'A022', 'A033']);
  const [installYearFrom, setInstallYearFrom] = useState<number | ''>('');
  const [topN, setTopN] = useState(10);
  const [weights, setWeights] = useState<WeightConfig>(DEFAULT_WEIGHTS);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [regionProgress, setRegionProgress] = useState<RefreshRegionStatus | null>(null);
  const [sigunguMessage, setSigunguMessage] = useState('');
  const [globalMessage, setGlobalMessage] = useState('');
  const [globalError, setGlobalError] = useState('');
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [runningAdminAction, setRunningAdminAction] = useState<'' | 'region' | 'rides'>('');

  useEffect(() => {
    fetch('/api/sido').then((r) => r.json()).then((d) => setSidoList(d.sido ?? [])).catch(() => setGlobalError('시/도 목록을 불러오지 못했습니다.'));
  }, []);

  async function refreshStatus() {
    setLoadingStatus(true);
    try {
      const res = await fetch('/api/debug/status');
      const json = await res.json();
      setStatus(json);
    } catch {
      setGlobalError('상태 정보를 불러오지 못했습니다.');
    } finally {
      setLoadingStatus(false);
    }
  }

  const fetchRegionStatus = useCallback(async () => {
    if (!sido) return null;
    const query = `/api/admin/refresh-region/status?sido=${encodeURIComponent(sido)}${sigungu ? `&sigungu=${encodeURIComponent(sigungu)}` : ''}`;
    const res = await fetch(query);
    const json = await res.json();
    if (!res.ok) {
      return null;
    }
    setRegionProgress(json);
    return json as RefreshRegionStatus;
  }, [sido, sigungu]);

  useEffect(() => {
    refreshStatus();
  }, []);

  const loadSigungu = useCallback(async (nextSido: string) => {
    if (!nextSido) return;
    setSigunguList([]);
    setSigungu('');
    setSigunguMessage('시/군/구 목록을 불러오는 중입니다.');

    try {
      const res = await fetch(`/api/sigungu?sido=${encodeURIComponent(nextSido)}`);
      const json = await res.json();
      if (!res.ok) {
        const detail = [json.errorType, json.status ? `HTTP ${json.status}` : null, json.endpoint, json.detailMessage].filter(Boolean).join(' / ');
        throw new Error(detail ? `${json.message ?? 'sigungu load failed'} (${detail})` : (json.message ?? 'sigungu load failed'));
      }

      setSigunguList(json.sigungu ?? []);
      const detail = json.errorType ? ` [${json.errorType}${json.status ? ` / HTTP ${json.status}` : ''}]` : '';
      const emptyReasonLabel = json.emptyReason ? ` (${json.emptyReason})` : '';
      setSigunguMessage(json.message ? `${json.message}${detail}${emptyReasonLabel}` : ((json.sigungu?.length ?? 0) > 0 ? '' : '해당 시/도의 시/군/구 데이터가 없습니다.'));
    } catch (e) {
      setSigunguMessage(e instanceof Error ? e.message : '시/군/구를 불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => {
    if (!sido) return;
    loadSigungu(sido);
    fetchRegionStatus();
  }, [fetchRegionStatus, loadSigungu, sido]);

  const weightFields = useMemo(() => [
    ['recent3yBonus', '최근 3년 가산'], ['recent5yBonus', '최근 5년 가산'],
    ['area300', '면적 >=300'], ['area600', '면적 >=600'], ['area1000', '면적 >=1000'],
    ['type3', '기구 종류수 >=3'], ['type4', '기구 종류수 >=4'], ['type6', '기구 종류수 >=6'],
    ['ride5', '기구 개수 >=5'], ['ride8', '기구 개수 >=8'], ['excellentBonus', '우수시설 가점'],
  ] as const, []);

  const progressValue = useMemo(() => {
    if (!regionProgress || regionProgress.done || regionProgress.status === 'error') return 100;
    if (!regionProgress.totalPages || !regionProgress.currentPage) return 5;
    return Math.min(95, Math.round((regionProgress.currentPage / regionProgress.totalPages) * 100));
  }, [regionProgress]);

  async function onSearch() {
    setLoadingSearch(true);
    setGlobalError('');
    setGlobalMessage('');
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sido, sigungu: sigungu || undefined, installPlaces, installYearFrom: installYearFrom || undefined, topN, weights }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detailMessage ?? json.message ?? '검색 실패');
      setData(json);
      setGlobalMessage(json.message ?? '검색을 완료했습니다.');
      await refreshStatus();
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : '검색 실패');
      setData(null);
    } finally {
      setLoadingSearch(false);
    }
  }

  async function runRegionBuildJob() {
    const payload = { sido, sigungu: sigungu || undefined };
    const startRes = await fetch('/api/admin/refresh-region/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const startJson = await startRes.json();
    if (!startRes.ok) throw new Error(startJson.detailMessage ?? startJson.message ?? 'region build start failed');

    let guard = 0;
    while (guard < 1000) {
      const statusRes = await fetch(`/api/admin/refresh-region/status?sido=${encodeURIComponent(sido)}${sigungu ? `&sigungu=${encodeURIComponent(sigungu)}` : ''}`);
      const statusJson = await statusRes.json();
      if (!statusRes.ok) throw new Error(statusJson.detailMessage ?? statusJson.message ?? 'region status failed');
      setRegionProgress(statusJson);
      if (statusJson.done) {
        if (statusJson.status === 'error') throw new Error(statusJson.lastError ?? 'refresh-region job failed');
        break;
      }

      const continueRes = await fetch('/api/admin/refresh-region/continue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const continueJson = await continueRes.json();
      if (!continueRes.ok) throw new Error(continueJson.detailMessage ?? continueJson.message ?? 'region continue failed');
      setRegionProgress(continueJson);
      if (continueJson.done) {
        if (continueJson.status === 'error') throw new Error(continueJson.lastError ?? 'refresh-region job failed');
        break;
      }
      guard += 1;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  async function runAdminAction(action: 'region' | 'rides') {
    if (!sido) {
      setGlobalError('먼저 시/도를 선택하세요.');
      return;
    }

    setRunningAdminAction(action);
    setGlobalError('');
    setGlobalMessage('');

    try {
      if (action === 'region') {
        await runRegionBuildJob();
        setGlobalMessage('선택 지역 캐시 빌드가 완료되었습니다.');
      } else {
        const res = await fetch('/api/admin/refresh-rides', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sido, sigungu: sigungu || undefined }) });
        const json = await res.json();
        if (!res.ok) throw new Error(json.detailMessage ?? json.message ?? '관리자 액션 실패');
        setGlobalMessage(json.message ?? 'ride 캐시 갱신 완료');
      }
      await refreshStatus();
      await loadSigungu(sido);
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : '관리자 액션 실패');
    } finally {
      setRunningAdminAction('');
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900"><h2 className="mb-2 text-base font-bold">사용 순서 (v1)</h2><ol className="list-decimal space-y-1 pl-5"><li>시/도를 선택합니다.</li><li>시/군/구를 선택합니다. (선택)</li><li>캐시가 비어 있으면 운영 패널에서 캐시를 빌드합니다.</li><li>검색 실행 버튼으로 추천 결과를 확인합니다.</li></ol></section>
      <section className="rounded-xl bg-white p-4 shadow"><h2 className="mb-2 text-lg font-bold">진단 상태 요약</h2><div className="grid gap-2 text-sm md:grid-cols-3"><StatusBadge label="Firebase" ok={status?.firebase.ok ?? false} okText="연결됨" failText="오류" /><StatusBadge label="공공데이터 API" ok={status?.publicApi.ok ?? false} okText="응답 가능" failText="오류" /><StatusBadge label="캐시" ok={(status?.counts.facilities ?? 0) > 0} okText="준비됨" failText="미준비" /></div><button onClick={refreshStatus} disabled={loadingStatus} className="mt-3 rounded border px-3 py-1 text-sm">{loadingStatus ? '상태 조회 중...' : '상태 새로고침'}</button></section>
      <section className="rounded-xl bg-white p-4 shadow">
        <h2 className="mb-3 text-lg font-bold">운영 패널 (캐시 빌드/갱신)</h2>
        <div className="grid gap-2 text-sm md:grid-cols-2"><p>facilities 문서 수: <b>{status?.counts.facilities ?? 0}</b></p><p>rideCache 문서 수: <b>{status?.counts.rideCache ?? 0}</b></p><p>마지막 빌드 시각: <b>{status?.latestCacheBuild?.lastBuiltAt ?? '-'}</b></p><p>마지막 빌드 상태: <b>{status?.latestCacheBuild?.lastBuildStatus ?? '-'}</b></p><p>마지막 빌드 오류: <b>{status?.latestCacheBuild?.lastError ?? '-'}</b></p></div>

        {regionProgress && (
          <div className="mt-3 rounded border bg-slate-50 p-3 text-xs">
            <div className="mb-2 h-3 w-full overflow-hidden rounded bg-slate-200">
              <div className={`h-full ${regionProgress.status === 'error' ? 'bg-red-500' : 'bg-blue-600'}`} style={{ width: `${progressValue}%` }} />
            </div>
            <p>단계: <b>{regionProgress.currentStage ?? '-'}</b></p>
            <p>설치장소: <b>{regionProgress.currentInstallPlace ?? '-'}</b></p>
            <p>페이지: <b>{regionProgress.currentPage ?? 0}</b> / <b>{regionProgress.totalPages ?? '-'}</b></p>
            <p>pagesFetched: <b>{regionProgress.pagesFetched ?? 0}</b> / raw: <b>{regionProgress.rawFacilityCount ?? 0}</b> / filtered: <b>{regionProgress.filteredFacilityCount ?? 0}</b></p>
            <p>저장 완료 시설 수: <b>{regionProgress.successCount ?? 0}</b></p>
            {regionProgress.lastError && <p className="text-red-700">오류: {regionProgress.lastError}</p>}
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-2"><button onClick={() => runAdminAction('region')} disabled={runningAdminAction !== ''} className="rounded bg-slate-800 px-3 py-2 text-sm font-semibold text-white disabled:bg-slate-400">{runningAdminAction === 'region' ? '지역 캐시 빌드 중...' : '선택 지역 캐시 빌드'}</button><button onClick={() => runAdminAction('rides')} disabled={runningAdminAction !== ''} className="rounded bg-indigo-700 px-3 py-2 text-sm font-semibold text-white disabled:bg-slate-400">{runningAdminAction === 'rides' ? 'ride 캐시 갱신 중...' : '선택 지역 ride 캐시 갱신'}</button><button onClick={refreshStatus} disabled={loadingStatus} className="rounded border px-3 py-2 text-sm">상태 새로고침</button></div>
      </section>
      <section className="rounded-xl bg-white p-4 shadow"><h2 className="mb-4 text-lg font-bold">검색 조건</h2><div className="grid gap-3 md:grid-cols-2"><select className="rounded border p-2" value={sido} onChange={(e) => setSido(e.target.value)}><option value="">시/도 선택</option>{sidoList.map((x) => <option key={x} value={x}>{x}</option>)}</select><select className="rounded border p-2" value={sigungu} onChange={(e) => setSigungu(e.target.value)} disabled={!sido || sigunguList.length === 0}><option value="">시/군/구 선택</option>{sigunguList.map((x) => <option key={x} value={x}>{x}</option>)}</select><input className="rounded border p-2" type="number" placeholder="설치연도(이후)" value={installYearFrom} onChange={(e) => setInstallYearFrom(e.target.value ? Number(e.target.value) : '')} /><input className="rounded border p-2" type="number" min={1} max={50} value={topN} onChange={(e) => setTopN(Number(e.target.value))} /></div>{sigunguMessage && <p className="mt-2 text-xs text-slate-600">{sigunguMessage}</p>}<div className="mt-3"><p className="mb-2 text-sm font-semibold">설치장소</p><div className="flex flex-wrap gap-3">{Object.entries(INSTALL_PLACE_LABELS).map(([code, label]) => (<label key={code} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={installPlaces.includes(code)} onChange={(e) => { setInstallPlaces((prev) => e.target.checked ? [...prev, code] : prev.filter((x) => x !== code)); }} />{label} ({code})</label>))}</div></div><div className="mt-4 grid gap-2 md:grid-cols-3">{weightFields.map(([k, label]) => (<label key={k} className="text-xs">{label}<input className="mt-1 w-full rounded border p-2" type="number" value={weights[k]} onChange={(e) => setWeights((prev) => ({ ...prev, [k]: Number(e.target.value) }))} /></label>))}</div><button onClick={onSearch} disabled={loadingSearch || !sido} className="mt-4 rounded bg-blue-600 px-4 py-2 font-semibold text-white disabled:bg-slate-400">{loadingSearch ? '검색 중...' : '검색 실행'}</button></section>
      {globalMessage && <section className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-800">{globalMessage}</section>}
      {globalError && <section className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">{globalError}</section>}
      {!data && !loadingSearch && <section className="rounded-xl border border-dashed bg-white p-4 text-sm text-slate-600">아직 검색 결과가 없습니다. 위 순서대로 지역 선택 → 필요 시 캐시 빌드 → 검색 실행을 진행하세요.</section>}
      {data && data.summary.totalCandidates === 0 && <section className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{data.message ?? '조건에 맞는 결과가 없습니다.'}</section>}
      {data && data.summary.totalCandidates > 0 && (<><section className="rounded-xl bg-white p-4 shadow"><h3 className="font-bold">우수시설 섹션</h3><p className="text-sm text-slate-600">총 {data.summary.totalCandidates}개 후보, 추천 {data.summary.recommended}개</p><ResultTable rows={data.excellentSection} /></section><section className="rounded-xl bg-white p-4 shadow"><h3 className="font-bold">TOP N 결과</h3><ResultTable rows={data.top} /></section><section className="rounded-xl bg-white p-4 shadow"><h3 className="font-bold">아깝게 탈락한 후보</h3><ResultTable rows={data.nearMiss} /></section></>)}
    </div>
  );
}

function StatusBadge({ label, ok, okText, failText }: { label: string; ok: boolean; okText: string; failText: string }) {
  return <div className={`rounded border p-2 ${ok ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700'}`}><div className="text-xs text-slate-500">{label}</div><div className="font-semibold">{ok ? okText : failText}</div></div>;
}

function ResultTable({ rows }: { rows: SearchResult[] }) {
  if (rows.length === 0) return <p className="mt-2 text-sm text-slate-500">결과 없음</p>;
  return <div className="mt-3 overflow-auto"><table className="min-w-full text-xs"><thead><tr className="border-b bg-slate-50 text-left"><th className="p-2">시설</th><th className="p-2">점수</th><th className="p-2">추천</th><th className="p-2">점수 내역</th><th className="p-2">추천 이유</th><th className="p-2">데이터주의 태그</th></tr></thead><tbody>{rows.map((r) => (<tr key={r.pfctSn} className="border-b align-top"><td className="p-2">{r.facilityName}<div className="text-[11px] text-slate-500">{r.address}</div></td><td className="p-2 font-semibold">{r.score}</td><td className="p-2">{r.recommended ? '★' : '-'}</td><td className="p-2">{r.scoreBreakdown.join(', ') || '-'}</td><td className="p-2">{r.reasons.join(', ') || '-'}</td><td className="p-2">{r.warnings.join(', ') || '-'}</td></tr>))}</tbody></table></div>;
}
