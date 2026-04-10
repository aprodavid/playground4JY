'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_WEIGHTS, INSTALL_PLACE_LABELS, type CacheMetaDoc, type SearchResult, type WeightConfig } from '@/types/domain';

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
  publicApi: { ok: boolean };
  counts: { facilities: number; rideCache: number; cacheMeta: number; sigunguIndex: number };
  latestCacheBuild: CacheMetaDoc | null;
  baselineMeta: CacheMetaDoc | null;
};

type BaselineStatus = {
  status: 'idle' | 'running' | 'success' | 'error' | 'stopped';
  currentStage?: string;
  currentInstallPlace?: string | null;
  currentPage?: number;
  totalPages?: number | null;
  baselinePagesFetched?: number;
  baselineRawFacilityCount?: number;
  baselineFilteredFacilityCount?: number;
  baselineSampleMatchedRegions?: string[];
  baselineUnmatchedReasonCount?: Record<string, number>;
  baselineLastError?: string | null;
  rideStatus?: string;
  rideProgress?: { totalTargets: number; processedTargets: number; updatedTargets: number; errorTargets: number; skippedExistingTargets: number } | null;
  rideLastError?: string | null;
  done?: boolean;
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
  const [baseline, setBaseline] = useState<BaselineStatus | null>(null);
  const [sigunguMessage, setSigunguMessage] = useState('');
  const [globalMessage, setGlobalMessage] = useState('');
  const [globalError, setGlobalError] = useState('');
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [runningAdminAction, setRunningAdminAction] = useState<'' | 'baseline' | 'rides'>('');

  useEffect(() => {
    fetch('/api/sido').then((r) => r.json()).then((d) => setSidoList(d.sido ?? [])).catch(() => setGlobalError('시/도 목록을 불러오지 못했습니다.'));
  }, []);

  const refreshStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const [statusRes, baselineRes] = await Promise.all([fetch('/api/debug/status'), fetch('/api/admin/refresh-region/status')]);
      setStatus(await statusRes.json());
      if (baselineRes.ok) setBaseline(await baselineRes.json());
    } catch {
      setGlobalError('상태 정보를 불러오지 못했습니다.');
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => { refreshStatus(); }, [refreshStatus]);

  const loadSigungu = useCallback(async (nextSido: string) => {
    if (!nextSido) return;
    setSigunguList([]);
    setSigungu('');
    setSigunguMessage('시/군/구 목록을 확인 중입니다.');
    try {
      const res = await fetch(`/api/sigungu?sido=${encodeURIComponent(nextSido)}`);
      const json = await res.json();
      if ((json.sigungu?.length ?? 0) > 0) {
        setSigunguList(json.sigungu ?? []);
        setSigunguMessage('');
      } else {
        setSigunguList([]);
        setSigunguMessage(json.message ?? '시/군/구를 찾지 못했습니다.');
      }
    } catch {
      setSigunguMessage('시/군/구를 불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => { if (sido) loadSigungu(sido); }, [loadSigungu, sido]);

  const baselineProgress = useMemo(() => {
    if (!baseline || baseline.done || baseline.status === 'error') return 100;
    if (!baseline.totalPages || !baseline.currentPage) return 5;
    return Math.min(95, Math.round((baseline.currentPage / baseline.totalPages) * 100));
  }, [baseline]);

  const rideProgress = useMemo(() => {
    const p = baseline?.rideProgress;
    if (!p || p.totalTargets === 0) return 0;
    return Math.round((p.processedTargets / p.totalTargets) * 100);
  }, [baseline?.rideProgress]);

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

  async function runBaselineBuild() {
    await fetch('/api/admin/refresh-region/start', { method: 'POST' });
    let guard = 0;
    while (guard < 2000) {
      const statusRes = await fetch('/api/admin/refresh-region/status');
      const statusJson = await statusRes.json();
      setBaseline(statusJson);
      if (statusJson.done) {
        if (statusJson.status === 'error') throw new Error(statusJson.baselineLastError ?? 'baseline build failed');
        break;
      }
      await fetch('/api/admin/refresh-region/continue', { method: 'POST' });
      await new Promise((resolve) => setTimeout(resolve, 250));
      guard += 1;
    }
  }

  async function runRideBatch() {
    let first = true;
    let guard = 0;
    while (guard < 500) {
      const res = await fetch('/api/admin/refresh-rides', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: first ? 'start' : 'continue', batchSize: 120 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detailMessage ?? json.message ?? 'ride batch failed');
      await refreshStatus();
      if (json.done) break;
      first = false;
      guard += 1;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  async function stopBaselineBuild() {
    await fetch('/api/admin/refresh-region/stop', { method: 'POST' });
    await refreshStatus();
  }

  async function runAdminAction(action: 'baseline' | 'rides') {
    setRunningAdminAction(action);
    setGlobalError('');
    setGlobalMessage('');
    try {
      if (action === 'baseline') {
        await runBaselineBuild();
        setGlobalMessage('기준선 캐시 빌드가 완료되었습니다.');
      } else {
        await runRideBatch();
        setGlobalMessage('ride 캐시 배치 갱신을 완료했습니다.');
      }
      await refreshStatus();
      if (sido) await loadSigungu(sido);
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : '관리자 액션 실패');
    } finally {
      setRunningAdminAction('');
    }
  }

  const weightFields = useMemo(() => [
    ['recent3yBonus', '최근 3년 가산'], ['recent5yBonus', '최근 5년 가산'], ['area300', '면적 >=300'], ['area600', '면적 >=600'], ['area1000', '면적 >=1000'],
    ['type3', '기구 종류수 >=3'], ['type4', '기구 종류수 >=4'], ['type6', '기구 종류수 >=6'], ['ride5', '기구 개수 >=5'], ['ride8', '기구 개수 >=8'], ['excellentBonus', '우수시설 가점'],
  ] as const, []);

  return <div className="space-y-6">
    <section className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">사용자 검색은 Firestore 시설 캐시만 사용합니다. 전국 API 수집은 운영 패널의 "기준선 캐시 빌드"에서만 수행됩니다.</section>
    <section className="rounded-xl bg-white p-4 shadow"><h2 className="mb-2 text-lg font-bold">진단 상태 요약</h2>
      <div className="grid gap-2 text-sm md:grid-cols-3"><StatusBadge label="Firebase" ok={status?.firebase.ok ?? false} okText="연결됨" failText="오류" /><StatusBadge label="공공데이터 API" ok={status?.publicApi.ok ?? false} okText="응답 가능" failText="오류" /><StatusBadge label="기준선 캐시" ok={status?.baselineMeta?.baselineStatus === 'success'} okText="준비됨" failText="미준비" /></div>
      <button onClick={refreshStatus} disabled={loadingStatus} className="mt-3 rounded border px-3 py-1 text-sm">{loadingStatus ? '상태 조회 중...' : '상태 새로고침'}</button></section>
    <section className="rounded-xl bg-white p-4 shadow"><h2 className="mb-3 text-lg font-bold">운영 패널</h2>
      {baseline && <div className="grid gap-3 md:grid-cols-2 text-xs"><div className="rounded border bg-slate-50 p-3"><p className="font-semibold">기준선 캐시 빌드</p><div className="mb-2 h-3 w-full overflow-hidden rounded bg-slate-200"><div className={`h-full ${baseline.status === 'error' ? 'bg-red-500' : 'bg-blue-600'}`} style={{ width: `${baselineProgress}%` }} /></div><p>단계: {baseline.currentStage ?? '-'}</p><p>페이지: {baseline.currentPage ?? 0} / {baseline.totalPages ?? '-'}</p><p>raw: {baseline.baselineRawFacilityCount ?? 0} / filtered: {baseline.baselineFilteredFacilityCount ?? 0}</p><p>샘플 지역: {(baseline.baselineSampleMatchedRegions ?? []).slice(0, 4).join(', ') || '-'}</p>{baseline.baselineLastError && <p className="text-red-700">오류: {baseline.baselineLastError}</p>}</div><div className="rounded border bg-slate-50 p-3"><p className="font-semibold">ride 캐시 배치</p><div className="mb-2 h-3 w-full overflow-hidden rounded bg-slate-200"><div className="h-full bg-indigo-600" style={{ width: `${rideProgress}%` }} /></div><p>상태: {baseline.rideStatus ?? 'idle'}</p><p>처리: {baseline.rideProgress?.processedTargets ?? 0} / {baseline.rideProgress?.totalTargets ?? 0}</p><p>업데이트: {baseline.rideProgress?.updatedTargets ?? 0}, 오류: {baseline.rideProgress?.errorTargets ?? 0}</p>{baseline.rideLastError && <p className="text-red-700">오류: {baseline.rideLastError}</p>}</div></div>}
      <div className="mt-3 flex flex-wrap gap-2"><button onClick={() => runAdminAction('baseline')} disabled={runningAdminAction !== ''} className="rounded bg-slate-800 px-3 py-2 text-sm font-semibold text-white disabled:bg-slate-400">{runningAdminAction === 'baseline' ? '기준선 캐시 빌드 중...' : '기준선 캐시 빌드'}</button><button onClick={() => runAdminAction('rides')} disabled={runningAdminAction !== ''} className="rounded bg-indigo-700 px-3 py-2 text-sm font-semibold text-white disabled:bg-slate-400">{runningAdminAction === 'rides' ? 'ride 캐시 갱신 중...' : 'ride 캐시 갱신'}</button><button onClick={refreshStatus} disabled={loadingStatus} className="rounded border px-3 py-2 text-sm">상태 새로고침</button><button onClick={stopBaselineBuild} className="rounded border border-red-300 px-3 py-2 text-sm text-red-700">캐시 수집 중지</button></div>
    </section>
    <section className="rounded-xl bg-white p-4 shadow"><h2 className="mb-4 text-lg font-bold">검색 조건</h2><div className="grid gap-3 md:grid-cols-2"><select className="rounded border p-2" value={sido} onChange={(e) => setSido(e.target.value)}><option value="">시/도 선택</option>{sidoList.map((x) => <option key={x} value={x}>{x}</option>)}</select><select className="rounded border p-2" value={sigungu} onChange={(e) => setSigungu(e.target.value)} disabled={!sido || sigunguList.length === 0}><option value="">시/군/구 선택</option>{sigunguList.map((x) => <option key={x} value={x}>{x}</option>)}</select><input className="rounded border p-2" type="number" placeholder="설치연도(이후)" value={installYearFrom} onChange={(e) => setInstallYearFrom(e.target.value ? Number(e.target.value) : '')} /><input className="rounded border p-2" type="number" min={1} max={50} value={topN} onChange={(e) => setTopN(Number(e.target.value))} /></div>{sigunguMessage && <p className="mt-2 text-xs text-slate-600">{sigunguMessage}</p>}<div className="mt-3"><p className="mb-2 text-sm font-semibold">설치장소</p><div className="flex flex-wrap gap-3">{Object.entries(INSTALL_PLACE_LABELS).map(([code, label]) => (<label key={code} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={installPlaces.includes(code)} onChange={(e) => { setInstallPlaces((prev) => e.target.checked ? [...prev, code] : prev.filter((x) => x !== code)); }} />{label} ({code})</label>))}</div></div><div className="mt-4 grid gap-2 md:grid-cols-3">{weightFields.map(([k, label]) => (<label key={k} className="text-xs">{label}<input className="mt-1 w-full rounded border p-2" type="number" value={weights[k]} onChange={(e) => setWeights((prev) => ({ ...prev, [k]: Number(e.target.value) }))} /></label>))}</div><button onClick={onSearch} disabled={loadingSearch || !sido} className="mt-4 rounded bg-blue-600 px-4 py-2 font-semibold text-white disabled:bg-slate-400">{loadingSearch ? '검색 중...' : '검색 실행'}</button></section>
    {globalMessage && <section className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-800">{globalMessage}</section>}
    {globalError && <section className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">{globalError}</section>}
    {data && data.summary.totalCandidates === 0 && <section className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{data.message ?? '조건에 맞는 결과가 없습니다.'} {data.emptyReason ? `(reason: ${data.emptyReason})` : ''}</section>}
    {data && data.summary.totalCandidates > 0 && (<><section className="rounded-xl bg-white p-4 shadow"><h3 className="font-bold">우수시설 섹션</h3><p className="text-sm text-slate-600">총 {data.summary.totalCandidates}개 후보, 추천 {data.summary.recommended}개</p><ResultTable rows={data.excellentSection} /></section><section className="rounded-xl bg-white p-4 shadow"><h3 className="font-bold">TOP N 결과</h3><ResultTable rows={data.top} /></section><section className="rounded-xl bg-white p-4 shadow"><h3 className="font-bold">아깝게 탈락한 후보</h3><ResultTable rows={data.nearMiss} /></section></>)}
  </div>;
}

function StatusBadge({ label, ok, okText, failText }: { label: string; ok: boolean; okText: string; failText: string }) {
  return <div className={`rounded border p-2 ${ok ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700'}`}><div className="text-xs text-slate-500">{label}</div><div className="font-semibold">{ok ? okText : failText}</div></div>;
}

function ResultTable({ rows }: { rows: SearchResult[] }) {
  if (rows.length === 0) return <p className="mt-2 text-sm text-slate-500">결과 없음</p>;
  return <div className="mt-3 overflow-auto"><table className="min-w-full text-xs"><thead><tr className="border-b bg-slate-50 text-left"><th className="p-2">시설</th><th className="p-2">점수</th><th className="p-2">추천</th><th className="p-2">점수 내역</th><th className="p-2">추천 이유</th><th className="p-2">데이터주의 태그</th></tr></thead><tbody>{rows.map((r) => (<tr key={r.pfctSn} className="border-b align-top"><td className="p-2">{r.facilityName}<div className="text-[11px] text-slate-500">{r.address}</div></td><td className="p-2 font-semibold">{r.score}</td><td className="p-2">{r.recommended ? '★' : '-'}</td><td className="p-2">{r.scoreBreakdown.join(', ') || '-'}</td><td className="p-2">{r.reasons.join(', ') || '-'}</td><td className="p-2">{r.warnings.join(', ') || '-'}</td></tr>))}</tbody></table></div>;
}
