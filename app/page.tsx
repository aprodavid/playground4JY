import SearchForm from './components/SearchForm';

export default function Page() {
  return (
    <main className="mx-auto max-w-7xl p-6">
      <h1 className="mb-4 text-2xl font-bold">공공데이터 기반 어린이 놀이시설 추천 v1</h1>
      <p className="mb-6 text-sm text-slate-600">공공데이터 API는 Next.js 서버 Route Handler에서 호출하고, ride4 결과는 Firestore 캐시에 저장합니다.</p>
      <SearchForm />
    </main>
  );
}
