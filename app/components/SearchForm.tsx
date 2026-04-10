'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_WEIGHTS, INSTALL_PLACE_LABELS, type JobDoc, type SearchResult, type WeightConfig } from '@/types/domain';

type SearchResponse = {
  summary: { totalCandidates: number; recommended: number };
  excellentSection: SearchResult[];
  top: SearchResult[];
  nearMiss: SearchResult[];
  message?: string;
  needsCacheBuild?: boolean;
  emptyReason?: string;
};

type StatusResponse = {
  env: Record<string, boolean>;
  firebase: { ok: boolean; error: string | null };
  counts: { facilities: number; rideCache: number; cacheMeta: number; sigunguIndex: number; jobs: number };
  baselineMeta: { baselineStatus?: string } | null;
  jobs: { baseline: JobDoc | null; ride: JobDoc | null };
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
  const [globalMessage, setGlobalMessage] = useState('');
  const [globalError, setGlobalError] = useState('');
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [runningAdminAction, setRunningAdminAction] = useState<'' | 'baseline' | 'ride' | 'stop'>('');

  useEffect(() => {
    fetch('/api/sido').then((r) => r.json()).then((d) => setSidoList(d.sido ?? [])).catch(() => setGlobalError('시/도 목록을 불러오지 못했습니다.'));
  }, []);

  const refreshStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const statusRes = await fetch('/api/debug/status');
      setStatus(await statusRes.json());
    } catch {
      setGlobalError('상태 정보를 불러오지 못했습니다.');
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => { refreshStatus(); }, [refreshStatus]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (status?.jobs?.baseline?.status === 'running' || status?.jobs?.baseline?.status === 'queued' || status?.jobs?.ride?.status === 'running' || status?.jobs?.ride?.status === 'queued') {
        refreshStatus();
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [refreshStatus, status?.jobs?.baseline?.status, status?.jobs?.ride?.status]);

  const loadSigungu = useCallback(async (nextSido: string) => {
    if (!nextSido) return;
    setSigunguList([]);
    setSigungu('');
    try {
      const res = await fetch(`/api/sigungu?sido=${encodeURIComponent(nextSido)}`);
      const json = await res.json();
      setSigunguList(json.sigungu ?? []);
    } catch {
      setSigunguList([]);
    }
  }, []);

  useEffect(() => { if (sido) loadSigungu(sido); }, [loadSigungu, sido]);

  const progress = useMemo(() => {
    const job = status?.jobs?.baseline ?? status?.jobs?.ride;
    const totalPages = job?.totalPages ?? 0;
    const pagesFetched = job?.pagesFetched ?? 0;
    if (!totalPages || totalPages <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((pagesFetched / totalPages) * 100)));
  }, [status?.jobs?.baseline, status?.jobs?.ride]);

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

  async function runJob(type: 'baseline' | 'ride') {
    const res = await fetch('/api/admin/jobs/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type }) });
    const json = await res.json();
    if (!res.ok && res.status !== 409) throw new Error(json.detailMessage ?? json.message ?? `${type} job 시작 실패`);
  }

  async function stopActiveJob() {
    const active = status?.jobs.baseline?.status === 'running' || status?.jobs.baseline?.status === 'queued'
      ? status.jobs.baseline
      : status?.jobs.ride;
    if (!active?.jobId) throw new Error('중지할 작업이 없습니다.');

    const res = await fetch('/api/admin/jobs/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId: active.jobId }) });
    const json = await res.json();
    if (!res.ok) throw new Error(json.detailMessage ?? json.message ?? '중지 실패');
  }

  async function runAdminAction(action: 'baseline' | 'ride' | 'stop') {
    setRunningAdminAction(action);
    setGlobalError('');
    setGlobalMessage('');
    try {
      if (action === 'baseline') {
        await runJob('baseline');
        setGlobalMessage('기준선 캐시 빌드 작업을 큐에 등록했습니다.');
      } else if (action === 'ride') {
        await runJob('ride');
        setGlobalMessage('ride 캐시 갱신 작업을 큐에 등록했습니다.');
      } else {
        await stopActiveJob();
        setGlobalMessage('작업 중지 요청을 보냈습니다.');
      }
      await refreshStatus();
      if (sido) await loadSigungu(sido);
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : '관리자 액션 실패');
    } finally {
      setRunningAdminAction('');
    }
  }

  const activeJob = status?.jobs?.baseline?.status === 'running' || status?.jobs?.baseline?.status === 'queued'
    ? status.jobs.baseline
    : status?.jobs?.ride;

  const weightFields = [
    ['recent3yBonus', '최근 3년 가산'], ['recent5yBonus', '최근 5년 가산'], ['area300', '면적 >=300'], ['area600', '면적 >=600'], ['area1000', '면적 >=1000'],
    ['type3', '기구 종류수 >=3'], ['type4', '기구 종류수 >=4'], ['type6', '기구 종류수 >=6'], ['ride5', '기구 개수 >=5'], ['ride8', '기구 개수 >=8'], ['excellentBonus', '우수시설 가점'],
  ] as const;

  return <div className="space-y-6">
    <section className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">사용자 검색은 Firestore facilities/rideCache 캐시만 사용합니다. baseline/ride 생성은 Firebase Functions 백그라운드 작업으로 처리됩니다.</section>

    <section className="rounded-xl bg-white p-4 shadow"><h2 className="mb-3 text-lg font-bold">운영 패널</h2>
      <div className="flex flex-wrap gap-2"><button onClick={() => runAdminAction('baseline')} disabled={runningAdminAction !== ''} className="rounded bg-blue-700 px-3 py-2 text-sm font-semibold text-white disabled:bg-slate-400">기준선 캐시 빌드 시작</button><button onClick={() => runAdminAction('ride')} disabled={runningAdminAction !== '' || status?.baselineMeta?.baselineStatus !== 'success'} className="rounded bg-indigo-700 px-3 py-2 text-sm font-semibold text-white disabled:bg-slate-400">ride 캐시 갱신 시작</button><button onClick={refreshStatus} disabled={loadingStatus} className="rounded border px-3 py-2 text-sm">상태 새로고침</button><button onClick={() => runAdminAction('stop')} disabled={runningAdminAction !== '' || !activeJob?.jobId} className="rounded bg-rose-700 px-3 py-2 text-sm font-semibold text-white disabled:bg-slate-400">작업 중지</button></div>
      <div className="mt-3 rounded border bg-slate-50 p-3 text-xs"><p>활성 작업: {activeJob?.type ?? '-'} ({activeJob?.status ?? 'idle'})</p><p>현재 단계: {activeJob?.currentStage ?? '-'}</p><p>현재 페이지: {activeJob?.currentPage ?? '-'} / {activeJob?.totalPages ?? '-'}</p><p>현재 설치장소: {activeJob?.currentInstallPlace ?? '-'}</p><p>성공/실패: {activeJob?.successCount ?? 0} / {activeJob?.errorCount ?? 0}</p><p>마지막 오류: {activeJob?.lastError ?? '-'}</p><div className="mt-2 mb-1 h-3 w-full overflow-hidden rounded bg-slate-200"><div className="h-full bg-blue-600" style={{ width: `${progress}%` }} /></div><p>진행률: {progress}%</p></div>
    </section>

    <section className="rounded-xl bg-white p-4 shadow"><h2 className="mb-4 text-lg font-bold">검색 조건</h2><div className="grid gap-3 md:grid-cols-2"><select className="rounded border p-2" value={sido} onChange={(e) => setSido(e.target.value)}><option value="">시/도 선택</option>{sidoList.map((x) => <option key={x} value={x}>{x}</option>)}</select><select className="rounded border p-2" value={sigungu} onChange={(e) => setSigungu(e.target.value)} disabled={!sido || sigunguList.length === 0}><option value="">시/군/구 선택</option>{sigunguList.map((x) => <option key={x} value={x}>{x}</option>)}</select><input className="rounded border p-2" type="number" placeholder="설치연도(이후)" value={installYearFrom} onChange={(e) => setInstallYearFrom(e.target.value ? Number(e.target.value) : '')} /><input className="rounded border p-2" type="number" min={1} max={50} value={topN} onChange={(e) => setTopN(Number(e.target.value))} /></div><div className="mt-3"><p className="mb-2 text-sm font-semibold">설치장소</p><div className="flex flex-wrap gap-3">{Object.entries(INSTALL_PLACE_LABELS).map(([code, label]) => (<label key={code} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={installPlaces.includes(code)} onChange={(e) => { setInstallPlaces((prev) => e.target.checked ? [...prev, code] : prev.filter((x) => x !== code)); }} />{label} ({code})</label>))}</div></div><div className="mt-4 grid gap-2 md:grid-cols-3">{weightFields.map(([k, label]) => (<label key={k} className="text-xs">{label}<input className="mt-1 w-full rounded border p-2" type="number" value={weights[k]} onChange={(e) => setWeights((prev) => ({ ...prev, [k]: Number(e.target.value) }))} /></label>))}</div><button onClick={onSearch} disabled={loadingSearch || !sido} className="mt-4 rounded bg-blue-600 px-4 py-2 font-semibold text-white disabled:bg-slate-400">{loadingSearch ? '검색 중...' : '검색 실행'}</button></section>
    {globalMessage && <section className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-800">{globalMessage}</section>}
    {globalError && <section className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">{globalError}</section>}
    {data && data.summary.totalCandidates > 0 && (<><section className="rounded-xl bg-white p-4 shadow"><h3 className="font-bold">우수시설 섹션</h3><p className="text-sm text-slate-600">총 {data.summary.totalCandidates}개 후보, 추천 {data.summary.recommended}개</p><ResultTable rows={data.excellentSection} /></section><section className="rounded-xl bg-white p-4 shadow"><h3 className="font-bold">TOP N 결과</h3><ResultTable rows={data.top} /></section></>)}
  </div>;
}

function ResultTable({ rows }: { rows: SearchResult[] }) {
  if (rows.length === 0) return <p className="mt-2 text-sm text-slate-500">결과 없음</p>;
  return <div className="mt-3 overflow-auto"><table className="min-w-full text-xs"><thead><tr className="border-b bg-slate-50 text-left"><th className="p-2">시설</th><th className="p-2">점수</th><th className="p-2">추천</th></tr></thead><tbody>{rows.map((r) => (<tr key={r.pfctSn} className="border-b align-top"><td className="p-2">{r.facilityName}<div className="text-[11px] text-slate-500">{r.address}</div></td><td className="p-2 font-semibold">{r.score}</td><td className="p-2">{r.recommended ? '★' : '-'}</td></tr>))}</tbody></table></div>;
}
