import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '어린이 놀이시설 추천 v1',
  description: '공공데이터 + Firestore 캐시 기반 추천 웹앱',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
