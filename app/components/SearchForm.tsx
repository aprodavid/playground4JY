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

type ImportStatus = {
  baselineStatus: 'idle' | 'running' | 'success' | 'error' | 'stopped';
  baselineSource: 'file-import' | 'api-crawl' | 'none';
  currentStage: string | null;
  progress: { total: number; processed: number; success: number; failure: number };
  uploadCounts: { pfc3: number; exfc5: number };
  baselineLastError: string | null;
  done: boolean;
};

export default function SearchForm() {
  const [pfc3File, setPfc3File] = useState<File | null>(null);
  const [exfc5File, setExfc5File] = useState<File | null>(null);
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
  const [baseline, setBaseline] = useState<ImportStatus | null>(null);
  const [sigunguMessage, setSigunguMessage] = useState('');
  const [globalMessage, setGlobalMessage] = useState('');
  const [globalError, setGlobalError] = useState('');
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [runningAdminAction, setRunningAdminAction] = useState<'' | 'upload-pfc3' | 'upload-exfc5' | 'baseline' | 'rides'>('');

  useEffect(() => {
    fetch('/api/sido').then((r) => r.json()).then((d) => setSidoList(d.sido ?? [])).catch(() => setGlobalError('시/도 목록을 불러오지 못했습니다.'));
  }, []);

  const refreshStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const [statusRes, baselineRes] = await Promise.all([fetch('/api/debug/status'), fetch('/api/admin/baseline-import/status')]);
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

  const importProgress = useMemo(() => {
    if (!baseline || baseline.progress.total === 0) return 0;
    return Math.round((baseline.progress.processed / baseline.progress.total) * 100);
  }, [baseline]);

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

  async function uploadFile(kind: 'pfc3' | 'exfc5') {
    const file = kind === 'pfc3' ? pfc3File : exfc5File;
    if (!file) throw new Error(`${kind} 파일을 먼저 선택하세요.`);

    const formData = new FormData();
    formData.append('file', file);
    const endpoint = kind === 'pfc3' ? '/api/admin/baseline-import/upload-pfc3' : '/api/admin/baseline-import/upload-exfc5';
    const res = await fetch(endpoint, { method: 'POST', body: formData });
    const json = await res.json();
    if (!res.ok) throw new Error(json.detailMessage ?? json.message ?? `${kind} 업로드 실패`);
  }

  async function runBaselineImport() {
    const res = await fetch('/api/admin/baseline-import/start', { method: 'POST' });
    const json = await res.json();
    if (!res.ok) throw new Error(json.detailMessage ?? json.message ?? '기준선 import 실패');
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
      if (json.done) break;
      first = false;
      guard += 1;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  async function runAdminAction(action: 'upload-pfc3' | 'upload-exfc5' | 'baseline' | 'rides') {
    setRunningAdminAction(action);
    setGlobalError('');
    setGlobalMessage('');
    try {
      if (action === 'upload-pfc3') {
        await uploadFile('pfc3');
        setGlobalMessage('1) pfc3 파일 업로드 완료');
      } else if (action === 'upload-exfc5') {
        await uploadFile('exfc5');
        setGlobalMessage('2) exfc5 파일 업로드 완료');
      } else if (action === 'baseline') {
        await runBaselineImport();
        setGlobalMessage('3) 기준선 캐시 생성(import) 완료');
      } else {
        await runRideBatch();
        setGlobalMessage('5) ride 캐시 갱신 완료');
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
    <section className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">사용자 검색은 Firestore facilities 캐시만 사용합니다. baseline이 없으면 먼저 파일데이터를 업로드해 기준선 캐시를 생성하세요.</section>

    <section className="rounded-xl bg-white p-4 shadow"><h2 className="mb-2 text-lg font-bold">진단 상태 요약</h2>
      <div className="grid gap-2 text-sm md:grid-cols-4"><StatusBadge label="Firebase" ok={status?.firebase.ok ?? false} okText="연결됨" failText="오류" /><StatusBadge label="공공데이터 API" ok={status?.publicApi.ok ?? false} okText="응답 가능" failText="오류" /><StatusBadge label="기준선 캐시" ok={status?.baselineMeta?.baselineStatus === 'success'} okText="준비됨" failText="미준비" /><StatusBadge label="기준선 소스" ok={status?.baselineMeta?.baselineSource === 'file-import'} okText="file-import" failText={status?.baselineMeta?.baselineSource ?? 'none'} /></div>
      <button onClick={refreshStatus} disabled={loadingStatus} className="mt-3 rounded border px-3 py-1 text-sm">{loadingStatus ? '상태 조회 중...' : '4) 상태 새로고침'}</button></section>

    <section className="rounded-xl bg-white p-4 shadow"><h2 className="mb-3 text-lg font-bold">운영 패널</h2>
      <ol className="list-decimal pl-5 text-sm text-slate-700 space-y-1 mb-3"><li>pfc3 파일 업로드</li><li>exfc5 파일 업로드</li><li>기준선 캐시 생성(import)</li><li>상태 새로고침</li><li>ride 캐시 갱신</li></ol>
      <div className="grid gap-2 md:grid-cols-2">
        <div className="rounded border p-3">
          <p className="mb-2 font-semibold text-sm">1) pfc3 파일</p>
          <input type="file" accept=".json,.csv" onChange={(e) => setPfc3File(e.target.files?.[0] ?? null)} className="text-xs" />
          <button onClick={() => runAdminAction('upload-pfc3')} disabled={runningAdminAction !== ''} className="mt-2 rounded bg-slate-800 px-3 py-1 text-xs text-white disabled:bg-slate-400">업로드</button>
        </div>
        <div className="rounded border p-3">
          <p className="mb-2 font-semibold text-sm">2) exfc5 파일</p>
          <input type="file" accept=".json,.csv" onChange={(e) => setExfc5File(e.target.files?.[0] ?? null)} className="text-xs" />
          <button onClick={() => runAdminAction('upload-exfc5')} disabled={runningAdminAction !== ''} className="mt-2 rounded bg-slate-800 px-3 py-1 text-xs text-white disabled:bg-slate-400">업로드</button>
        </div>
      </div>
      <div className="mt-3 rounded border bg-slate-50 p-3 text-xs">
        <p>업로드 건수: pfc3 {baseline?.uploadCounts.pfc3 ?? 0} / exfc5 {baseline?.uploadCounts.exfc5 ?? 0}</p>
        <p>단계: {baseline?.currentStage ?? '-'}</p>
        <div className="mb-2 h-3 w-full overflow-hidden rounded bg-slate-200"><div className={`h-full ${baseline?.baselineStatus === 'error' ? 'bg-red-500' : 'bg-blue-600'}`} style={{ width: `${importProgress}%` }} /></div>
        <p>진행률: {importProgress}%</p>
        <p>처리/총: {baseline?.progress.processed ?? 0} / {baseline?.progress.total ?? 0}</p>
        <p>성공/실패: {baseline?.progress.success ?? 0} / {baseline?.progress.failure ?? 0}</p>
        {baseline?.baselineLastError && <p className="text-red-700">오류: {baseline.baselineLastError}</p>}
      </div>
      <div className="mt-3 flex flex-wrap gap-2"><button onClick={() => runAdminAction('baseline')} disabled={runningAdminAction !== ''} className="rounded bg-blue-700 px-3 py-2 text-sm font-semibold text-white disabled:bg-slate-400">{runningAdminAction === 'baseline' ? '기준선 import 중...' : '3) 기준선 캐시 생성(import)'}</button><button onClick={() => runAdminAction('rides')} disabled={runningAdminAction !== '' || status?.baselineMeta?.baselineStatus !== 'success'} className="rounded bg-indigo-700 px-3 py-2 text-sm font-semibold text-white disabled:bg-slate-400">5) ride 캐시 갱신</button></div>
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
