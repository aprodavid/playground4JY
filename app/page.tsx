import SearchForm from './components/SearchForm';

export default function Page() {
  return (
    <main className="mx-auto max-w-7xl p-6">
      <h1 className="mb-4 text-2xl font-bold">공공데이터 기반 어린이 놀이시설 추천 v1</h1>
      <p className="mb-2 text-sm text-slate-600">공공데이터 API는 Next.js Route Handler에서만 호출하며, 시설/ride 데이터는 Firestore 캐시로 운영됩니다.</p>
      <p className="mb-6 text-sm text-slate-600">첫 화면에서 지역 선택, 캐시 상태 확인/빌드, 검색까지 한 번에 진행할 수 있습니다.</p>
      <SearchForm />
    </main>
  );
}
