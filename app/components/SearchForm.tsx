'use client';

import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_WEIGHTS, INSTALL_PLACE_LABELS, type SearchResult, type WeightConfig } from '@/types/domain';

type SearchResponse = {
  summary: { totalCandidates: number; recommended: number };
  excellentSection: SearchResult[];
  top: SearchResult[];
  nearMiss: SearchResult[];
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
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/sido').then((r) => r.json()).then((d) => setSidoList(d.sido ?? []));
  }, []);

  useEffect(() => {
    if (!sido) return;
    fetch(`/api/sigungu?sido=${encodeURIComponent(sido)}`).then((r) => r.json()).then((d) => setSigunguList(d.sigungu ?? []));
  }, [sido]);

  const weightFields = useMemo(() => [
    ['recent3yBonus', '최근 3년 가산'],
    ['recent5yBonus', '최근 5년 가산'],
    ['area300', '면적 >=300'], ['area600', '면적 >=600'], ['area1000', '면적 >=1000'],
    ['type3', '기구 종류수 >=3'], ['type4', '기구 종류수 >=4'], ['type6', '기구 종류수 >=6'],
    ['ride5', '기구 개수 >=5'], ['ride8', '기구 개수 >=8'],
    ['excellentBonus', '우수시설 가점'],
  ] as const, []);

  async function onSearch() {
    setLoading(true);
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sido,
        sigungu: sigungu || undefined,
        installPlaces,
        installYearFrom: installYearFrom || undefined,
        topN,
        weights,
      }),
    });
    const json = await res.json();
    setData(json);
    setLoading(false);
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl bg-white p-4 shadow">
        <h2 className="mb-4 text-lg font-bold">검색 조건</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <select className="rounded border p-2" value={sido} onChange={(e) => { setSido(e.target.value); setSigungu(''); }}>
            <option value="">시/도 선택</option>
            {sidoList.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <select className="rounded border p-2" value={sigungu} onChange={(e) => setSigungu(e.target.value)}>
            <option value="">시/군/구 선택</option>
            {sigunguList.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <input className="rounded border p-2" type="number" placeholder="설치연도(이후)" value={installYearFrom} onChange={(e) => setInstallYearFrom(e.target.value ? Number(e.target.value) : '')} />
          <input className="rounded border p-2" type="number" min={1} max={50} value={topN} onChange={(e) => setTopN(Number(e.target.value))} />
        </div>

        <div className="mt-3">
          <p className="mb-2 text-sm font-semibold">설치장소</p>
          <div className="flex flex-wrap gap-3">
            {Object.entries(INSTALL_PLACE_LABELS).map(([code, label]) => (
              <label key={code} className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={installPlaces.includes(code)}
                  onChange={(e) => {
                    setInstallPlaces((prev) => e.target.checked ? [...prev, code] : prev.filter((x) => x !== code));
                  }}
                />
                {label} ({code})
              </label>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-2 md:grid-cols-3">
          {weightFields.map(([k, label]) => (
            <label key={k} className="text-xs">
              {label}
              <input
                className="mt-1 w-full rounded border p-2"
                type="number"
                value={weights[k]}
                onChange={(e) => setWeights((prev) => ({ ...prev, [k]: Number(e.target.value) }))}
              />
            </label>
          ))}
        </div>

        <button onClick={onSearch} disabled={loading || !sido} className="mt-4 rounded bg-blue-600 px-4 py-2 font-semibold text-white disabled:bg-slate-400">
          {loading ? '실행 중...' : '실행'}
        </button>
      </section>

      {data && (
        <>
          <section className="rounded-xl bg-white p-4 shadow">
            <h3 className="font-bold">우수시설 섹션</h3>
            <p className="text-sm text-slate-600">총 {data.summary.totalCandidates}개 후보, 추천 {data.summary.recommended}개</p>
            <ResultTable rows={data.excellentSection} />
          </section>
          <section className="rounded-xl bg-white p-4 shadow">
            <h3 className="font-bold">TOP N 결과</h3>
            <ResultTable rows={data.top} />
          </section>
          <section className="rounded-xl bg-white p-4 shadow">
            <h3 className="font-bold">아깝게 탈락한 후보</h3>
            <ResultTable rows={data.nearMiss} />
          </section>
        </>
      )}
    </div>
  );
}

function ResultTable({ rows }: { rows: SearchResult[] }) {
  return (
    <div className="mt-3 overflow-auto">
      <table className="min-w-full text-xs">
        <thead>
          <tr className="border-b bg-slate-50 text-left">
            <th className="p-2">시설</th><th className="p-2">점수</th><th className="p-2">추천</th><th className="p-2">점수 내역</th><th className="p-2">추천 이유</th><th className="p-2">주의 태그</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.pfctSn} className="border-b align-top">
              <td className="p-2">{r.facilityName}<div className="text-[11px] text-slate-500">{r.address}</div></td>
              <td className="p-2 font-semibold">{r.score}</td>
              <td className="p-2">{r.recommended ? '★' : '-'}</td>
              <td className="p-2">{r.scoreBreakdown.join(', ') || '-'}</td>
              <td className="p-2">{r.reasons.join(', ') || '-'}</td>
              <td className="p-2">{r.warnings.join(', ') || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
