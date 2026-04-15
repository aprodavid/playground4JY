'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { INSTALL_PLACE_LABELS } from '@/src/config/installPlaces';
import { DEFAULT_WEIGHTS } from '@/src/config/uiDefaults';
import type { SearchResult, WeightConfig } from '@/types/domain';

type SearchResponse = {
  summary: { totalCandidates: number; recommended: number };
  excellentFacilities: SearchResult[];
  topResults: SearchResult[];
  nearMissResults: SearchResult[];
  message?: string;
  needsCacheBuild?: boolean;
};

type DebugStatus = {
  selectedSido: string;
  baseline: {
    status: string;
    ready: boolean;
    currentStage: string;
    currentInstallPlace: string | null;
    currentPage: number;
    totalPages: number | null;
    pagesFetched: number;
    rawFacilityCount: number;
    filteredFacilityCount: number;
    lastPageItemCount: number;
    parsePathUsed: string;
    lastError: string | null;
    lastSuccessfulBaselineAt: string | null;
  } | null;
  ride: {
    status: string;
    progress: {
      totalTargets: number;
      processedTargets: number;
      updatedTargets: number;
      errorTargets: number;
      skippedExistingTargets: number;
    };
    lastError: string | null;
    lastSuccessfulAt: string | null;
  } | null;
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
  const [status, setStatus] = useState<DebugStatus | null>(null);
  const [globalMessage, setGlobalMessage] = useState('');
  const [globalError, setGlobalError] = useState('');
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [runningAdminAction, setRunningAdminAction] = useState<'' | 'baseline' | 'baseline-force' | 'ride' | 'stop'>('');

  useEffect(() => {
    fetch('/api/sido').then((r) => r.json()).then((d) => setSidoList(d.sido ?? [])).catch(() => setGlobalError('시/도 목록을 불러오지 못했습니다.'));
  }, []);

  const refreshStatus = useCallback(async (targetSido?: string) => {
    const selected = targetSido ?? sido;
    if (!selected) return;
    setLoadingStatus(true);
    try {
      const statusRes = await fetch(`/api/debug/status?sido=${encodeURIComponent(selected)}`);
      setStatus(await statusRes.json());
    } catch {
      setGlobalError('상태 정보를 불러오지 못했습니다.');
    } finally {
      setLoadingStatus(false);
    }
  }, [sido]);

  useEffect(() => { if (sido) refreshStatus(); }, [refreshStatus, sido]);

  const loadSigungu = useCallback(async (nextSido: string) => {
    setSigunguList([]);
    setSigungu('');
    try {
      const res = await fetch(`/api/sigungu?sido=${encodeURIComponent(nextSido)}`);
      const json = await res.json();
      if (!res.ok) {
        setGlobalMessage(json.message ?? '해당 시도의 기준선 캐시가 필요합니다');
      }
      setSigunguList(json.sigungu ?? []);
    } catch {
      setSigunguList([]);
    }
  }, []);

  useEffect(() => { if (sido) loadSigungu(sido); }, [loadSigungu, sido]);

  const baselineProgress = useMemo(() => {
    const totalPages = status?.baseline?.totalPages ?? 0;
    const pagesFetched = status?.baseline?.pagesFetched ?? 0;
    if (!totalPages || totalPages <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((pagesFetched / totalPages) * 100)));
  }, [status?.baseline?.pagesFetched, status?.baseline?.totalPages]);

  const rideProgress = useMemo(() => {
    const totalTargets = status?.ride?.progress?.totalTargets ?? 0;
    const processedTargets = status?.ride?.progress?.processedTargets ?? 0;
    if (!totalTargets || totalTargets <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((processedTargets / totalTargets) * 100)));
  }, [status?.ride?.progress]);

  async function onSearch() {
    setLoadingSearch(true);
    setGlobalError('');
    setGlobalMessage('');
    try {
      const res = await fetch('/api/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sido, sigungu: sigungu || undefined, installPlaces, installYearFrom: installYearFrom || undefined, topN, weights }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detailMessage ?? json.message ?? '검색 실패');
      setData(json);
      setGlobalMessage(json.message ?? '검색을 완료했습니다.');
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : '검색 실패');
      setData(null);
    } finally {
      setLoadingSearch(false);
    }
  }

  async function runAdminAction(action: 'baseline' | 'baseline-force' | 'ride' | 'stop') {
    if (!sido && action !== 'ride') {
      setGlobalError('시/도를 먼저 선택해주세요.');
      return;
    }
    setRunningAdminAction(action);
    setGlobalError('');
    setGlobalMessage('');
    try {
      if (action === 'stop') {
        const stopPayload = status?.baseline?.status === 'running' || status?.baseline?.status === 'queued'
          ? { type: 'baseline', sido }
          : { type: 'ride' };
        await fetch('/api/admin/jobs/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(stopPayload) });
        setGlobalMessage('작업 중지 요청을 보냈습니다.');
      } else if (action === 'ride') {
        await fetch('/api/admin/jobs/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'ride' }) });
        setGlobalMessage('ride 캐시 갱신을 요청했습니다.');
      } else {
        const mode = action === 'baseline-force' ? 'force-rebuild' : 'normal';
        await fetch('/api/admin/jobs/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'baseline', sido, mode }) });
        setGlobalMessage(`선택 시도(${sido}) 기준선 작업을 요청했습니다.`);
      }
      await refreshStatus();
      await loadSigungu(sido);
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : '관리자 액션 실패');
    } finally {
      setRunningAdminAction('');
    }
  }

  const weightFields = [
    ['recent3yBonus', '최근 3년 가산'], ['recent5yBonus', '최근 5년 가산'], ['area300', '면적 >=300'], ['area600', '면적 >=600'], ['area1000', '면적 >=1000'],
    ['type3', '기구 종류수 >=3'], ['type4', '기구 종류수 >=4'], ['type6', '기구 종류수 >=6'], ['ride5', '기구 개수 >=5'], ['ride8', '기구 개수 >=8'], ['excellentBonus', '우수시설 가점'],
  ] as const;

  return <div className="space-y-6">
    <section className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">검색은 Firestore read-only이며, 선택 시도 baseline 없으면 409를 반환합니다.</section>

    <section className="rounded-xl bg-white p-4 shadow"><h2 className="mb-3 text-lg font-bold">운영 패널</h2>
      <div className="flex flex-wrap gap-2"><button onClick={() => runAdminAction('baseline')} disabled={runningAdminAction !== '' || !sido} className="rounded bg-blue-700 px-3 py-2 text-sm font-semibold text-white disabled:bg-slate-400">기준선 캐시 생성 (선택 시도)</button><button onClick={() => runAdminAction('baseline-force')} disabled={runningAdminAction !== '' || !sido} className="rounded bg-sky-800 px-3 py-2 text-sm font-semibold text-white disabled:bg-slate-400">기준선 강제 재생성 (선택 시도)</button><button onClick={() => runAdminAction('ride')} disabled={runningAdminAction !== ''} className="rounded bg-indigo-700 px-3 py-2 text-sm font-semibold text-white disabled:bg-slate-400">ride 캐시 갱신</button><button onClick={() => refreshStatus()} disabled={loadingStatus || !sido} className="rounded border px-3 py-2 text-sm">상태 새로고침</button><button onClick={() => runAdminAction('stop')} disabled={runningAdminAction !== ''} className="rounded bg-rose-700 px-3 py-2 text-sm font-semibold text-white disabled:bg-slate-400">작업 중지</button></div>
      <div className="mt-3 rounded border bg-slate-50 p-3 text-xs space-y-2"><p>선택 시도: {sido || '-'}</p><p>Baseline 상태: {status?.baseline?.status ?? 'idle'} / ready: {status?.baseline?.ready ? 'yes' : 'no'}</p><p>Baseline 마지막 성공 시각: {status?.baseline?.lastSuccessfulBaselineAt ?? '-'}</p><p>Baseline stage/place/page: {status?.baseline?.currentStage ?? '-'} / {status?.baseline?.currentInstallPlace ?? '-'} / {status?.baseline?.currentPage ?? '-'} / {status?.baseline?.totalPages ?? '-'}</p><p>Baseline pages/raw/filtered: {status?.baseline?.pagesFetched ?? 0} / {status?.baseline?.rawFacilityCount ?? 0} / {status?.baseline?.filteredFacilityCount ?? 0}</p><p>Baseline lastPageItemCount/parsePathUsed: {status?.baseline?.lastPageItemCount ?? 0} / {status?.baseline?.parsePathUsed ?? '-'}</p><p>Baseline lastError: {status?.baseline?.lastError ?? '-'}</p><div className="mt-1 mb-1 h-3 w-full overflow-hidden rounded bg-slate-200"><div className="h-full bg-blue-600" style={{ width: `${baselineProgress}%` }} /></div><p>Baseline 진행률: {baselineProgress}%</p><p>Ride 상태: {status?.ride?.status ?? 'idle'} / lastError: {status?.ride?.lastError ?? '-'}</p><div className="mt-1 mb-1 h-3 w-full overflow-hidden rounded bg-slate-200"><div className="h-full bg-indigo-600" style={{ width: `${rideProgress}%` }} /></div><p>Ride 진행률: {rideProgress}%</p></div>
    </section>

    <section className="rounded-xl bg-white p-4 shadow"><h2 className="mb-4 text-lg font-bold">검색 조건</h2><div className="grid gap-3 md:grid-cols-2"><select className="rounded border p-2" value={sido} onChange={(e) => setSido(e.target.value)}><option value="">시/도 선택</option>{sidoList.map((x) => <option key={x} value={x}>{x}</option>)}</select><select className="rounded border p-2" value={sigungu} onChange={(e) => setSigungu(e.target.value)} disabled={!sido || sigunguList.length === 0}><option value="">시/군/구 선택</option>{sigunguList.map((x) => <option key={x} value={x}>{x}</option>)}</select><input className="rounded border p-2" type="number" placeholder="설치연도(이후)" value={installYearFrom} onChange={(e) => setInstallYearFrom(e.target.value ? Number(e.target.value) : '')} /><input className="rounded border p-2" type="number" min={1} max={50} value={topN} onChange={(e) => setTopN(Number(e.target.value))} /></div><div className="mt-3"><p className="mb-2 text-sm font-semibold">설치장소</p><div className="flex flex-wrap gap-3">{Object.entries(INSTALL_PLACE_LABELS).map(([code, label]) => (<label key={code} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={installPlaces.includes(code)} onChange={(e) => { setInstallPlaces((prev) => e.target.checked ? [...prev, code] : prev.filter((x) => x !== code)); }} />{label} ({code})</label>))}</div></div><div className="mt-4 grid gap-2 md:grid-cols-3">{weightFields.map(([k, label]) => (<label key={k} className="text-xs">{label}<input className="mt-1 w-full rounded border p-2" type="number" value={weights[k]} onChange={(e) => setWeights((prev) => ({ ...prev, [k]: Number(e.target.value) }))} /></label>))}</div><button onClick={onSearch} disabled={loadingSearch || !sido} className="mt-4 rounded bg-blue-600 px-4 py-2 font-semibold text-white disabled:bg-slate-400">{loadingSearch ? '검색 중...' : '검색 실행'}</button></section>
    {globalMessage && <section className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-800">{globalMessage}</section>}
    {globalError && <section className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">{globalError}</section>}
    {data && data.summary.totalCandidates > 0 && (<><section className="rounded-xl bg-white p-4 shadow"><h3 className="font-bold">우수시설 섹션</h3><p className="text-sm text-slate-600">총 {data.summary.totalCandidates}개 후보, 추천 {data.summary.recommended}개</p><ResultTable rows={data.excellentFacilities} /></section><section className="rounded-xl bg-white p-4 shadow"><h3 className="font-bold">TOP N 결과</h3><ResultTable rows={data.topResults} /></section><section className="rounded-xl bg-white p-4 shadow"><h3 className="font-bold">Near miss 결과</h3><ResultTable rows={data.nearMissResults} /></section></>)}
  </div>;
}

function ResultTable({ rows }: { rows: SearchResult[] }) {
  if (rows.length === 0) return <p className="mt-2 text-sm text-slate-500">결과 없음</p>;
  return <div className="mt-3 overflow-auto"><table className="min-w-full text-xs"><thead><tr className="border-b bg-slate-50 text-left"><th className="p-2">시설</th><th className="p-2">점수</th><th className="p-2">추천</th></tr></thead><tbody>{rows.map((r) => (<tr key={r.pfctSn} className="border-b align-top"><td className="p-2">{r.facilityName}<div className="text-[11px] text-slate-500">{r.address}</div></td><td className="p-2 font-semibold">{r.score}</td><td className="p-2">{r.recommended ? '★' : '-'}</td></tr>))}</tbody></table></div>;
}
