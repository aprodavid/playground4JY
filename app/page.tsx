import SearchForm from './components/SearchForm';

export default function Page() {
  return (
    <main className="mx-auto max-w-7xl p-6">
      <h1 className="mb-4 text-2xl font-bold">공공데이터 기반 어린이 놀이시설 추천 v1</h1>
      <p className="mb-2 text-sm text-slate-600">Vercel(Next.js)은 UI/검색과 job 상태 조회만 담당합니다.</p>
      <p className="mb-6 text-sm text-slate-600">공공데이터 수집과 baseline/ride 캐시 생성은 Firebase Functions 백그라운드 워커가 처리합니다.</p>
      <SearchForm />
    </main>
  );
}
